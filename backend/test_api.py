from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_product_create_list_update_delete():
    created = client.post("/products", json={
        "name": "Rice",
        "category": "Grocery",
        "selling_price": 60,
        "purchase_price": 50,
        "stock_quantity": 20,
        "unit": "kg",
        "expiry_date": None,
        "low_stock_threshold": 5,
    })
    assert created.status_code == 200
    product_id = created.json()["id"]

    listed = client.get("/products")
    assert listed.status_code == 200
    assert any(item["id"] == product_id for item in listed.json())

    updated = client.put(f"/products/{product_id}", json={"stock_quantity": 15})
    assert updated.status_code == 200
    assert updated.json()["stock_quantity"] == 15

    deleted = client.delete(f"/products/{product_id}")
    assert deleted.status_code == 200


def test_customer_create_update_delete():
    created = client.post("/customers", json={
        "name": "Test Customer",
        "phone_number": "9876543210",
        "whatsapp_number": "9876543210",
        "credit_score": 75,
    })
    assert created.status_code == 200
    customer_id = created.json()["id"]

    updated = client.put(f"/customers/{customer_id}", json={"credit_score": 80})
    assert updated.status_code == 200
    assert updated.json()["credit_score"] == 80

    deleted = client.delete(f"/customers/{customer_id}")
    assert deleted.status_code == 200


def test_signup_login_me_logout():
    signup = client.post("/auth/signup", json={
        "email": "shop@example.com",
        "name": "Demo Shop",
        "phone": "9876543210",
        "password": "123456",
        "city": "Bengaluru",
        "businessDomain": "Grocery",
    })
    assert signup.status_code == 200
    token = signup.json()["token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "shop@example.com"

    logout = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout.status_code == 200
