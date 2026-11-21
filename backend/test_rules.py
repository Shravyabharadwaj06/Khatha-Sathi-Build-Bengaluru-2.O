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
