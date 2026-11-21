"""Tests for the integration fixes (no database or Supabase needed)."""
import main


def test_cors_origins_default_to_vite_dev_server(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert main._cors_origins() == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_cors_origins_come_from_env(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5174, https://chotu.example/ ,")
    assert main._cors_origins() == ["http://localhost:5174", "https://chotu.example"]


# --- typed request bodies (fix 2) ---------------------------------------------
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

import schemas

client = TestClient(main.app)


def test_product_body_keeps_money_exact_and_ignores_unknown_keys():
    body = schemas.ProductCreate(name=" Rice ", selling_price="62.35", stock_quantity=10, id="ignored")
    dumped = body.model_dump(exclude_unset=True)
    assert dumped == {"name": "Rice", "selling_price": "62.35", "stock_quantity": Decimal("10")}


def test_product_name_longer_than_db_limit_is_rejected():
    with pytest.raises(ValidationError):
        schemas.ProductCreate(name="x" * 121)


def test_customer_update_accepts_old_field_name():
    assert schemas.CustomerUpdate(customer_name="Ravi").model_dump(exclude_unset=True) == {"customer_name": "Ravi"}


def test_otp_endpoints_reject_a_missing_phone():
    assert client.post("/auth/otp/send", json={}).status_code == 422
    assert client.post("/auth/otp/verify", json={"phone": "9876543210"}).status_code == 422


# --- OTP rate limits (fix 3) ----------------------------------------------------
class _Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


@pytest.fixture
def dev_otp(monkeypatch):
    clock = _Clock()
    monkeypatch.setattr(main.time, "monotonic", clock)
    monkeypatch.setattr(main, "OTP_MODE", "dev")
    monkeypatch.setattr(main, "DEV_OTP_CODE", "123456")
    for store in (main._sent_otps, main._verified_phones, main._otp_sends, main._otp_failures):
        store.clear()
    yield clock
    for store in (main._sent_otps, main._verified_phones, main._otp_sends, main._otp_failures):
        store.clear()


def test_otp_resend_must_wait_30_seconds(dev_otp):
    assert client.post("/auth/otp/send", json={"phone": "9845000001"}).status_code == 200
    too_soon = client.post("/auth/otp/send", json={"phone": "9845000001"})
    assert too_soon.status_code == 429
    assert "Try again in 30 seconds" in too_soon.json()["detail"]
    dev_otp.now += 31
    assert client.post("/auth/otp/send", json={"phone": "9845000001"}).status_code == 200


def test_otp_at_most_5_sends_per_hour(dev_otp):
    for _ in range(5):
        assert client.post("/auth/otp/send", json={"phone": "9845000002"}).status_code == 200
        dev_otp.now += 31
    assert client.post("/auth/otp/send", json={"phone": "9845000002"}).status_code == 429
    dev_otp.now += 3600
    assert client.post("/auth/otp/send", json={"phone": "9845000002"}).status_code == 200


def test_otp_blocks_after_5_wrong_codes(dev_otp):
    client.post("/auth/otp/send", json={"phone": "9845000003"})
    for _ in range(5):
        assert client.post("/auth/otp/verify", json={"phone": "9845000003", "otp": "000000"}).json() == {"verified": False}
    blocked = client.post("/auth/otp/verify", json={"phone": "9845000003", "otp": "123456"})
    assert blocked.status_code == 429
    dev_otp.now += 601
    assert client.post("/auth/otp/verify", json={"phone": "9845000003", "otp": "123456"}).json() == {"verified": True}


# --- balance edits are refused (problem 4) ----------------------------------------
from main import AuthContext, current_auth_context
from database import get_db

DEMO = AuthContext(user_id="00000000-0000-4000-8000-0000000000aa", shop_id="00000000-0000-4000-8000-0000000000bb", email="t@x.in")
CUSTOMER_ID = "00000000-0000-4000-8000-0000000000cc"


@pytest.fixture
def logged_in(monkeypatch):
    main.app.dependency_overrides[current_auth_context] = lambda: DEMO
    main.app.dependency_overrides[get_db] = lambda: object()
    monkeypatch.setattr(
        main,
        "_customer_row",
        lambda db, shop_id, cid: {"id": cid, "shop_id": shop_id, "name": "Ramesh", "phone": None, "whatsapp": None,
                                  "credit_score": None, "locality": None, "balance_paise": 84000},
    )
    yield
    main.app.dependency_overrides.clear()


def test_changing_a_balance_is_refused(logged_in):
    res = client.put(f"/customers/{CUSTOMER_ID}", json={"outstanding_balance": 500})
    assert res.status_code == 422
    assert "only change through bills, payments or undo" in res.json()["detail"]
    assert res.headers["X-Error-Field"] == "outstanding_balance"


def test_sending_the_same_balance_back_is_harmless(logged_in, monkeypatch):
    monkeypatch.setattr(main, "_customer_dict", lambda row: {"id": row["id"], "outstanding_balance": 840.0})
    res = client.put(f"/customers/{CUSTOMER_ID}", json={"outstanding_balance": "840.00"})
    assert res.status_code == 200


# --- payments larger than the due amount are refused (problem 5) ---------------
def test_rupee_format_uses_indian_grouping():
    assert main._format_rupees(84000) == "₹840"
    assert main._format_rupees(5450) == "₹54.50"
    assert main._format_rupees(10400000) == "₹1,04,000"
    assert main._format_rupees(0) == "₹0"


class _FakeDb:
    def __init__(self):
        self.inserted = False

    def execute(self, *args, **kwargs):  # any INSERT would land here
        self.inserted = True
        raise AssertionError("nothing may be written when the payment is refused")


def test_payment_more_than_due_is_refused(monkeypatch):
    monkeypatch.setattr(main, "_one", lambda db, sql, values: {"id": values["customer_id"]})
    monkeypatch.setattr(main, "_customer_row", lambda db, shop, cid: {"id": cid, "balance_paise": 84000})
    db = _FakeDb()
    with pytest.raises(main.HTTPException) as refused:
        main._create_payment_entry(db, DEMO, CUSTOMER_ID, 90000, "cash", None)
    assert refused.value.status_code == 422
    assert refused.value.detail == "Payment is more than the due amount (₹840)."
    assert not db.inserted


# --- WhatsApp reminder (port of Rashmitha's idea) ---------------------------------
import reminders


def test_whatsapp_number_prefers_whatsapp_then_phone():
    assert reminders.whatsapp_number("+91 98860 54321", "9000000000") == "9886054321"
    assert reminders.whatsapp_number(None, "98450-12345") == "9845012345"
    assert reminders.whatsapp_number("12345", None) is None


def test_whatsapp_reminder_link_uses_db_values(logged_in, monkeypatch):
    monkeypatch.setattr(
        main,
        "_customer_row",
        lambda db, shop, cid: {"id": cid, "name": "Ramesh", "phone": "9886054321", "whatsapp": None, "balance_paise": 84000},
    )
    monkeypatch.setattr(main, "_one", lambda db, sql, values: {"shop_name": "Sri Lakshmi Kirana Stores"})
    soft = client.get(f"/customers/{CUSTOMER_ID}/whatsapp?language=hi").json()
    assert soft["message"] == "Namaste Ramesh ji, Sri Lakshmi Kirana Stores mein aapka ₹840 baaki hai. Jab ho sake, de dijiye. Dhanyavaad!"
    assert soft["url"].startswith("https://wa.me/919886054321?text=Namaste%20Ramesh")
    firm = client.get(f"/customers/{CUSTOMER_ID}/whatsapp?tone=firm").json()
    assert firm["message"] == "Ramesh, ₹840 is overdue at Sri Lakshmi Kirana Stores. Please clear it this week."


def test_whatsapp_reminder_needs_a_number_and_a_due(logged_in, monkeypatch):
    monkeypatch.setattr(main, "_customer_row", lambda db, shop, cid: {"id": cid, "name": "Kiran", "phone": None, "whatsapp": None, "balance_paise": 500})
    assert client.get(f"/customers/{CUSTOMER_ID}/whatsapp").status_code == 422
    monkeypatch.setattr(main, "_customer_row", lambda db, shop, cid: {"id": cid, "name": "Kiran", "phone": "9845012345", "whatsapp": None, "balance_paise": 0})
    res = client.get(f"/customers/{CUSTOMER_ID}/whatsapp")
    assert res.status_code == 422 and "Nothing is due" in res.json()["detail"]
