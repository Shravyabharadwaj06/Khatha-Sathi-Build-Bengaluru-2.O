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
    import uuid

    email = f"shop-{uuid.uuid4().hex}@example.com"
    phone = str(uuid.uuid4().int)[-10:]
    signup = client.post("/auth/signup", json={
        "email": email,
        "name": "Demo Shop",
        "phone": phone,
        "password": "123456",
        "city": "Bengaluru",
        "businessDomain": "Grocery",
    })
    assert signup.status_code == 200
    token = signup.json()["token"]

    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == email

    logout = client.post("/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout.status_code == 200


def test_profile_update_persists_to_auth_me():
    import uuid

    phone = str(uuid.uuid4().int)[-10:]
    signup = client.post("/auth/signup", json={
        "email": f"profile-{uuid.uuid4().hex}@example.com",
        "name": "Profile Owner",
        "phone": phone,
        "password": "12345678",
        "city": "Bengaluru",
        "businessDomain": "Grocery",
    })
    token = signup.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    updated = client.put("/auth/profile", headers=headers, json={
        "shopName": "Lakshmi Stores",
        "ownerName": "Lakshmi",
        "phone": phone,
        "businessDomain": "Grocery",
        "gstNumber": "29AAAAA0000A1Z5",
        "fssaiNumber": "",
        "address": "Main Bazaar Road",
        "avatarUrl": "",
        "primaryLanguage": "Kannada",
        "secondaryLanguage": "Hindi",
        "spokenReplies": True,
        "voiceSpeed": "Normal",
        "voiceVolume": 80,
        "dailyLedgerPdf": True,
        "lowStockAlert": True,
        "paymentReminder": True,
    })

    assert updated.status_code == 200
    assert updated.json()["name"] == "Lakshmi"
    assert updated.json()["shopName"] == "Lakshmi Stores"
    assert updated.json()["gstNumber"] == "29AAAAA0000A1Z5"
    assert client.get("/auth/me", headers=headers).json()["address"] == "Main Bazaar Road"


def test_support_report_upload_and_listing_require_authentication():
    import json
    import uuid

    signup = client.post("/auth/signup", json={
        "email": f"report-{uuid.uuid4().hex}@example.com",
        "name": "Report Owner",
        "phone": str(uuid.uuid4().int)[-10:],
        "password": "12345678",
        "city": "Bengaluru",
        "businessDomain": "Grocery",
    })
    headers = {"Authorization": f"Bearer {signup.json()['token']}"}

    created = client.post(
        "/support/reports",
        headers=headers,
        data={
            "categories": json.dumps(["voice", "stock"]),
            "description": "Kannada voice entry did not save.",
            "contactAllowed": "true",
        },
        files=[("attachments", ("stock.png", b"sample-image", "image/png"))],
    )

    assert created.status_code == 200
    assert created.json()["categories"] == ["voice", "stock"]
    assert created.json()["attachments"] == [{"name": "stock.png", "type": "image/png", "size": 12}]
    listed = client.get("/support/reports", headers=headers)
    assert listed.status_code == 200
    assert listed.json()[0]["reference"] == created.json()["reference"]
    assert client.get("/support/reports").status_code == 401

    other_signup = client.post("/auth/signup", json={
        "email": f"other-{uuid.uuid4().hex}@example.com",
        "name": "Other Owner",
        "phone": str(uuid.uuid4().int)[-10:],
        "password": "12345678",
        "city": "Bengaluru",
        "businessDomain": "Grocery",
    })
    other_headers = {"Authorization": f"Bearer {other_signup.json()['token']}"}
    assert client.get("/support/reports", headers=other_headers).json() == []


def test_sale_purchase_payment_and_delete():
    product = client.post("/products", json={
        "name": "Sugar",
        "selling_price": 50,
        "purchase_price": 40,
        "stock_quantity": 10,
        "low_stock_threshold": 2,
    }).json()

    customer = client.post("/customers", json={
        "name": "Ledger Customer",
        "phone_number": "9000000001",
        "credit_score": 70,
    }).json()

    sale = client.post("/transactions", json={
        "transaction_type": "sale",
        "customer_id": customer["id"],
        "items": [{"product_id": product["id"], "quantity": 3}],
        "payment_method": "cash",
        "paid_amount": 100,
    })
    assert sale.status_code == 200
    assert sale.json()["transaction"]["total_amount"] == 150

    sugar = next(item for item in client.get("/products").json() if item["id"] == product["id"])
    assert sugar["stock_quantity"] == 7

    ledger = client.get(f"/customers/{customer['id']}/ledger")
    assert ledger.status_code == 200
    assert ledger.json()["outstanding_balance"] == 50

    payment = client.post("/payments", json={
        "customer_id": customer["id"],
        "amount": 50,
        "payment_method": "upi",
    })
    assert payment.status_code == 200
    assert payment.json()["outstanding_balance"] == 0

    purchase = client.post("/transactions", json={
        "transaction_type": "purchase",
        "items": [{"product_id": product["id"], "quantity": 5}],
        "payment_method": "cash",
    })
    assert purchase.status_code == 200

    sugar = next(item for item in client.get("/products").json() if item["id"] == product["id"])
    assert sugar["stock_quantity"] == 12


def test_reports_search_and_voice():
    assert client.get("/dashboard").status_code == 200
    assert client.get("/reports/sales").status_code == 200
    assert client.get("/reports/stock").status_code == 200
    assert client.get("/search", params={"q": "Sugar"}).status_code == 200

    voice = client.post("/voice/process", json={"text": "I sold 2 kg sugar"})
    assert voice.status_code == 200
    assert voice.json()["intent"] == "sale"
