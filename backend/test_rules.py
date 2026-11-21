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
