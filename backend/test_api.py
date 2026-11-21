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


def test_placeholder_env_values_are_reported_by_name(monkeypatch):
    # backend/.env copied from .env.example without filling it in (the "database not working" root cause).
    monkeypatch.setenv("SUPABASE_URL", "https://<project-ref>.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "<sb_publishable_...>")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://postgres.<project-ref>:<password>@aws-<N>-x.pooler.supabase.com:5432/postgres")
    monkeypatch.setenv("OTP_MODE", "dev")
    monkeypatch.setenv("DEV_OTP_CODE", "<six-digit-code>")
    problems = main.config_problems()
    assert "SUPABASE_URL still has the .env.example placeholder" in problems
    assert "SUPABASE_PUBLISHABLE_KEY still has the .env.example placeholder" in problems
    assert "SUPABASE_SERVICE_ROLE_KEY is empty" in problems
    assert "DATABASE_URL still has the .env.example placeholder" in problems
    assert "DEV_OTP_CODE must be six digits when OTP_MODE=dev" in problems

    # Email login reaches Supabase Auth first: a placeholder key is a clear 503, not a generic 502.
    class _NoDb:
        def close(self):
            pass

    monkeypatch.setattr(database, "SessionLocal", _NoDb)
    response = client.post("/auth/login", json={"method": "email", "identifier": "a@b.co", "password": "x"})
    assert response.status_code == 503
    assert "SUPABASE_PUBLISHABLE_KEY" in response.json()["detail"]
    assert "placeholder" in response.json()["detail"]


def test_placeholder_database_url_fails_closed_with_a_clear_message(monkeypatch):
    import importlib

    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://postgres.<project-ref>:<password>@aws-<N>-x.pooler.supabase.com:5432/postgres")
    try:
        importlib.reload(database)
        assert database.SessionLocal is None
        assert "placeholders" in database.DATABASE_CONFIG_ERROR
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert "placeholders" in response.json()["detail"]
    finally:
        monkeypatch.delenv("DATABASE_URL")
        importlib.reload(database)


def test_name_pasted_twice_is_reported(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "SUPABASE_URL=https://abcdefghijklmnop.supabase.co")
    assert "SUPABASE_URL has its name pasted twice (SUPABASE_URL=SUPABASE_URL=...)" in main.config_problems()


def test_real_looking_values_are_not_flagged(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_example")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://postgres.abc:pw@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres")
    monkeypatch.setenv("OTP_MODE", "dev")
    monkeypatch.setenv("DEV_OTP_CODE", "123456")
    assert main.config_problems() == []


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
