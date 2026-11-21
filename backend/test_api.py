from fastapi.testclient import TestClient
from fastapi import HTTPException
import pytest

import database
import main

client = TestClient(main.app)


def test_health_is_available_without_database():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_database_routes_fail_closed_when_not_configured(monkeypatch):
    monkeypatch.setattr(database, "SessionLocal", None)
    response = client.get("/products", headers={"Authorization": "Bearer ignored"})
    assert response.status_code == 503
    assert "DATABASE_URL" in response.json()["detail"]


def test_development_otp_uses_configured_code(monkeypatch):
    monkeypatch.setattr(main, "OTP_MODE", "dev")
    monkeypatch.setattr(main, "DEV_OTP_CODE", "123456")
    main._sent_otps.clear()
    main._verified_phones.clear()

    sent = client.post("/auth/otp/send", json={"phone": "98451 23456"})
    invalid = client.post(
        "/auth/otp/verify",
        json={"phone": "9845123456", "otp": "000000"},
    )
    verified = client.post(
        "/auth/otp/verify",
        json={"phone": "9845123456", "otp": "123456"},
    )

    assert sent.status_code == 200
    assert sent.json() == {"sent": True}
    assert invalid.json() == {"verified": False}
    assert verified.json() == {"verified": True}
    main._sent_otps.clear()
    main._verified_phones.clear()


def test_otp_is_unavailable_without_dev_configuration(monkeypatch):
    monkeypatch.setattr(main, "OTP_MODE", "")
    response = client.post("/auth/otp/send", json={"phone": "9845123456"})
    assert response.status_code == 503


def test_currency_conversion_uses_half_up_rounding():
    assert main._paise("1.005", "amount") == 101
    assert main._rupees(101) == 1.01


def test_stock_quantity_allows_zero_but_sale_quantity_does_not():
    assert main._nonnegative_quantity("0", "stock") == 0
    assert main._nonnegative_quantity("1.125", "stock") == 1.125
    assert main._quantity("1.125") == 1.125
    with pytest.raises(HTTPException, match="greater than zero"):
        main._quantity("0")


def test_sales_report_excludes_reversed_sale(monkeypatch):
    rows = [
        {
            "type": "sale",
            "amount_paise": 10000,
            "paid_paise": 2500,
            "referenced_type": None,
            "referenced_amount_paise": None,
            "referenced_paid_paise": None,
        },
        {
            "type": "reversal",
            "amount_paise": 10000,
            "paid_paise": 2500,
            "referenced_type": "sale",
            "referenced_amount_paise": 10000,
            "referenced_paid_paise": 2500,
        },
        {
            "type": "sale",
            "amount_paise": 3000,
            "paid_paise": 500,
            "referenced_type": None,
            "referenced_amount_paise": None,
            "referenced_paid_paise": None,
        },
    ]

    def fake_all(*args):
        query = args[1]
        return [{"balance_paise": 1500}] if "customer_balances" in query else rows

    monkeypatch.setattr(main, "_all", fake_all)
    result = main.sales_report(main.AuthContext("user", "shop", "user@example.com"), None)

    assert result["gross_sales"] == 30
    assert result["paid_sales"] == 5
    assert result["outstanding_from_sales"] == 15
    assert result["sale_count"] == 2


def test_dashboard_counts_active_customers_and_nets_reversals(monkeypatch):
    entries = [
        {"type": "sale", "amount_paise": 10000, "referenced_type": None, "referenced_amount_paise": None},
        {"type": "reversal", "amount_paise": 10000, "referenced_type": "sale", "referenced_amount_paise": 10000},
        {"type": "sale", "amount_paise": 3000, "referenced_type": None, "referenced_amount_paise": None},
    ]

    def fake_all(*args):
        query = args[1]
        if "customer_balances" in query:
            return [{"balance_paise": 1500}, {"balance_paise": 500}]
        return entries if "ledger_entries" in query else []

    monkeypatch.setattr(main, "_all", fake_all)

    def fake_one(*args):
        assert "archived_at is null" in args[1]
        return {"count": 1}

    monkeypatch.setattr(main, "_one", fake_one)
    result = main.get_dashboard(
        main.AuthContext("user", "shop", "user@example.com"),
        None,
    )

    assert result["total_customers"] == 1
    assert result["total_sales"] == 30
    assert result["total_outstanding"] == 20
