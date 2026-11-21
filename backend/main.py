import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import Customer, Product, Transaction

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Khatha Sathi API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginInput(BaseModel):
    method: str
    identifier: str
    password: str


class SignupInput(BaseModel):
    email: str
    name: str
    phone: str
    password: str
    city: str
    businessDomain: str
    otp: Optional[str] = None


class VoiceInput(BaseModel):
    text: str


_users: dict[str, dict] = {}
_tokens: dict[str, str] = {}
_otps: dict[str, str] = {}


def password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


@app.get("/")
def root():
    return {"message": "Khatha Sathi API is running"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/auth/otp/send")
def send_otp(payload: dict):
    phone = str(payload.get("phone", "")).strip()
    if len(phone) != 10:
        raise HTTPException(status_code=400, detail="Enter a valid 10-digit phone number")
    _otps[phone] = "123456"
    return {"sent": True}


@app.post("/auth/otp/verify")
def verify_otp(payload: dict):
    phone = str(payload.get("phone", "")).strip()
    otp = str(payload.get("otp", "")).strip()
    return {"verified": _otps.get(phone) == otp and len(otp) == 6}


@app.post("/auth/signup")
def signup(payload: SignupInput):
    email = payload.email.strip().lower()
    if any(user["email"] == email for user in _users.values()):
        raise HTTPException(status_code=409, detail="An account with this email already exists.", headers={"X-Error-Field": "email"})
    if any(user["phone"] == payload.phone for user in _users.values()):
        raise HTTPException(status_code=409, detail="An account with this phone number already exists.", headers={"X-Error-Field": "phone"})

    user_id = str(len(_users) + 1)
    user = {
        "id": user_id,
        "name": payload.name,
        "email": email,
        "phone": payload.phone,
        "city": payload.city,
        "businessDomain": payload.businessDomain,
        "password_hash": password_hash(payload.password),
    }
    _users[user_id] = user
    token = secrets.token_urlsafe(24)
    _tokens[token] = user_id
    return {"token": token, "user": public_user(user)}


@app.post("/auth/login")
def login(payload: LoginInput):
    identifier = payload.identifier.strip().lower()
    for user in _users.values():
        matches = user["phone"] == identifier if payload.method == "phone" else user["email"] == identifier
        if matches and user["password_hash"] == password_hash(payload.password):
            token = secrets.token_urlsafe(24)
            _tokens[token] = user["id"]
            return {"token": token, "user": public_user(user)}
    raise HTTPException(status_code=401, detail="Incorrect login details or password / PIN.", headers={"X-Error-Field": "password"})


def current_user(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not logged in")
    token = authorization.split(" ", 1)[1]
    user_id = _tokens.get(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return _users[user_id]


def public_user(user: dict):
    return {key: value for key, value in user.items() if key != "password_hash"}


@app.post("/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        _tokens.pop(authorization.split(" ", 1)[1], None)
    return {"message": "Logged out"}


@app.get("/auth/me")
def auth_me(user=Depends(current_user)):
    return public_user(user)


@app.get("/products")
def get_products(db: Session = Depends(get_db)):
    return db.query(Product).order_by(Product.name).all()


@app.post("/products")
def add_product(payload: dict, db: Session = Depends(get_db)):
    name = str(payload.get("name") or payload.get("product_name") or "").strip()
    selling_price = payload.get("selling_price")
    if not name:
        raise HTTPException(status_code=422, detail="Product name is required")
    if selling_price is None:
        raise HTTPException(status_code=422, detail="Selling price is required")

    product = Product(
        name=name,
        category=payload.get("category"),
        selling_price=float(selling_price),
        purchase_price=float(payload.get("purchase_price") or 0),
        stock_quantity=float(payload.get("stock_quantity") or 0),
        unit=payload.get("unit") or "pcs",
        expiry_date=parse_date(payload.get("expiry_date")),
        low_stock_threshold=float(payload.get("low_stock_threshold") or 5),
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@app.put("/products/{product_id}")
def update_product(product_id: int, payload: dict, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    updates = dict(payload)
    if "name" not in updates and "product_name" in updates:
        updates["name"] = updates.pop("product_name")
    if "expiry_date" in updates:
        updates["expiry_date"] = parse_date(updates["expiry_date"])

    allowed = {"name", "category", "selling_price", "purchase_price", "stock_quantity", "unit", "expiry_date", "low_stock_threshold"}
    for key, value in updates.items():
        if key in allowed:
            setattr(product, key, value)

    db.commit()
    db.refresh(product)
    return product


@app.delete("/products/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    db.delete(product)
    db.commit()
    return {"message": "Product deleted successfully"}


@app.get("/customers")
def get_customers(db: Session = Depends(get_db)):
    return db.query(Customer).order_by(Customer.name).all()


@app.post("/customers")
def add_customer(payload: dict, db: Session = Depends(get_db)):
    name = str(payload.get("name") or payload.get("customer_name") or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Customer name is required")
    customer = Customer(
        name=name,
        phone_number=payload.get("phone_number"),
        whatsapp_number=payload.get("whatsapp_number"),
        outstanding_balance=float(payload.get("outstanding_balance") or 0),
        credit_score=float(payload["credit_score"]) if payload.get("credit_score") not in (None, "") else None,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@app.put("/customers/{customer_id}")
def update_customer(customer_id: int, payload: dict, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    updates = dict(payload)
    if "name" not in updates and "customer_name" in updates:
        updates["name"] = updates.pop("customer_name")

    allowed = {"name", "phone_number", "whatsapp_number", "outstanding_balance", "credit_score"}
    for key, value in updates.items():
        if key in allowed:
            setattr(customer, key, value)

    db.commit()
    db.refresh(customer)
    return customer


@app.delete("/customers/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    db.delete(customer)
    db.commit()
    return {"message": "Customer deleted successfully"}


@app.get("/transactions")
def get_transactions(db: Session = Depends(get_db)):
    return db.query(Transaction).order_by(Transaction.id.desc()).limit(100).all()


@app.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    products = db.query(Product).all()
    customers = db.query(Customer).all()
    transactions = db.query(Transaction).all()

    return {
        "total_products": len(products),
        "total_customers": len(customers),
        "total_transactions": len(transactions),
        "total_sales": sum(t.total_amount for t in transactions if t.transaction_type == "sale"),
        "total_stock": sum(p.stock_quantity for p in products),
        "total_outstanding": sum(c.outstanding_balance for c in customers),
        "low_stock_count": sum(p.stock_quantity <= p.low_stock_threshold for p in products),
        "low_stock_products": [p for p in products if p.stock_quantity <= p.low_stock_threshold],
    }


@app.post("/voice/process")
def process_voice(payload: VoiceInput):
    text = payload.text.strip()
    return {
        "recognized_text": text,
        "message": "Voice command received. Transaction processing is ready for implementation.",
    }


def parse_date(value):
    if not value:
        return None
    if isinstance(value, str):
        return datetime.strptime(value, "%Y-%m-%d").date()
    return value
