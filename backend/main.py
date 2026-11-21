import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import AppUser, Customer, Payment, Product, Transaction, TransactionItem
from schemas import PaymentCreate, TransactionCreate, VoiceCommandInput

def migrate_existing_sqlite_schema():
    """Add columns introduced after the first local database was created."""
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        table_names = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }

        if "transactions" in table_names:
            columns = {
                row[1]
                for row in connection.exec_driver_sql("PRAGMA table_info(transactions)").fetchall()
            }
            additions = {
                "customer_id": "INTEGER",
                "paid_amount": "REAL NOT NULL DEFAULT 0",
                "notes": "TEXT",
            }
            for column_name, column_type in additions.items():
                if column_name not in columns:
                    connection.exec_driver_sql(
                        f"ALTER TABLE transactions ADD COLUMN {column_name} {column_type}"
                    )


migrate_existing_sqlite_schema()
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Khatha Sathi API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ],
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
def signup(payload: SignupInput, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if db.query(AppUser).filter(AppUser.email == email).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists.", headers={"X-Error-Field": "email"})
    if db.query(AppUser).filter(AppUser.phone == payload.phone).first():
        raise HTTPException(status_code=409, detail="An account with this phone number already exists.", headers={"X-Error-Field": "phone"})

    user = AppUser(
        name=payload.name,
        email=email,
        phone=payload.phone,
        password_hash=password_hash(payload.password),
        city=payload.city,
        business_domain=payload.businessDomain,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = secrets.token_urlsafe(24)
    _tokens[token] = str(user.id)
    return {"token": token, "user": public_app_user(user)}


@app.post("/auth/login")
def login(payload: LoginInput, db: Session = Depends(get_db)):
    identifier = payload.identifier.strip().lower()
    if payload.method == "phone":
        user = db.query(AppUser).filter(AppUser.phone == identifier).first()
    else:
        user = db.query(AppUser).filter(AppUser.email == identifier).first()

    if not user or user.password_hash != password_hash(payload.password):
        raise HTTPException(status_code=401, detail="Incorrect login details or password / PIN.", headers={"X-Error-Field": "password"})

    token = secrets.token_urlsafe(24)
    _tokens[token] = str(user.id)
    return {"token": token, "user": public_app_user(user)}


def current_user(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not logged in")
    token = authorization.split(" ", 1)[1]
    user_id = _tokens.get(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = db.query(AppUser).filter(AppUser.id == int(user_id)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


def public_app_user(user: AppUser):
    return {
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "city": user.city or "",
        "businessDomain": user.business_domain or "",
    }


@app.post("/auth/logout")
def logout(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        _tokens.pop(authorization.split(" ", 1)[1], None)
    return {"message": "Logged out"}


@app.get("/auth/me")
def auth_me(user=Depends(current_user)):
    return public_app_user(user)


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


@app.get("/transactions/{transaction_id}/items")
def get_transaction_items(transaction_id: int, db: Session = Depends(get_db)):
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return db.query(TransactionItem).filter(TransactionItem.transaction_id == transaction_id).all()


@app.post("/transactions")
def create_transaction(payload: TransactionCreate, db: Session = Depends(get_db)):
    transaction_type = payload.transaction_type.strip().lower()
    if transaction_type not in {"sale", "purchase", "payment"}:
        raise HTTPException(status_code=422, detail="transaction_type must be sale, purchase, or payment")
    if not payload.items:
        raise HTTPException(status_code=422, detail="At least one item is required")

    customer = None
    if payload.customer_id is not None:
        customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

    total_amount = 0.0
    prepared_items = []

    for item in payload.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")

        if transaction_type == "sale" and product.stock_quantity < item.quantity:
            raise HTTPException(status_code=409, detail=f"Insufficient stock for {product.name}")

        unit_price = product.selling_price if transaction_type == "sale" else (product.purchase_price or 0)
        line_total = round(unit_price * item.quantity, 2)
        total_amount += line_total
        prepared_items.append((product, item.quantity, unit_price, line_total))

    paid_amount = payload.paid_amount if payload.paid_amount is not None else total_amount
    paid_amount = round(min(paid_amount, total_amount), 2)

    transaction = Transaction(
        transaction_type=transaction_type,
        customer_id=payload.customer_id,
        total_amount=round(total_amount, 2),
        paid_amount=paid_amount,
        payment_method=payload.payment_method,
        transaction_date=datetime.now(timezone.utc).isoformat(),
        status="paid" if paid_amount >= total_amount else "partial",
        notes=payload.notes,
    )
    db.add(transaction)
    db.flush()

    for product, quantity, unit_price, line_total in prepared_items:
        db.add(TransactionItem(
            transaction_id=transaction.id,
            product_id=product.id,
            product_name=product.name,
            quantity=quantity,
            unit_price=unit_price,
            line_total=line_total,
        ))
        if transaction_type == "sale":
            product.stock_quantity -= quantity
        elif transaction_type == "purchase":
            product.stock_quantity += quantity

    unpaid_amount = round(total_amount - paid_amount, 2)
    if transaction_type == "sale" and customer and unpaid_amount > 0:
        customer.outstanding_balance = round(customer.outstanding_balance + unpaid_amount, 2)

    db.commit()
    db.refresh(transaction)
    return {
        "message": "Transaction created successfully",
        "transaction": transaction,
        "items": db.query(TransactionItem).filter(TransactionItem.transaction_id == transaction.id).all(),
        "outstanding_change": unpaid_amount if transaction_type == "sale" else 0,
    }


@app.post("/payments")
def create_payment(payload: PaymentCreate, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    if payload.amount > customer.outstanding_balance:
        raise HTTPException(status_code=422, detail="Payment cannot exceed outstanding balance")

    payment = Payment(
        customer_id=payload.customer_id,
        amount=payload.amount,
        payment_method=payload.payment_method,
        payment_date=datetime.now(timezone.utc).isoformat(),
        notes=payload.notes,
    )
    customer.outstanding_balance = round(customer.outstanding_balance - payload.amount, 2)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    db.refresh(customer)

    return {
        "message": "Payment recorded successfully",
        "payment": payment,
        "outstanding_balance": customer.outstanding_balance,
    }


@app.get("/payments")
def get_payments(customer_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Payment)
    if customer_id is not None:
        query = query.filter(Payment.customer_id == customer_id)
    return query.order_by(Payment.id.desc()).limit(100).all()


@app.get("/customers/{customer_id}/ledger")
def get_customer_ledger(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    transactions = db.query(Transaction).filter(Transaction.customer_id == customer_id).order_by(Transaction.id.desc()).all()
    payments = db.query(Payment).filter(Payment.customer_id == customer_id).order_by(Payment.id.desc()).all()
    return {
        "customer": customer,
        "outstanding_balance": customer.outstanding_balance,
        "transactions": transactions,
        "payments": payments,
    }


@app.get("/reports/stock")
def stock_report(db: Session = Depends(get_db)):
    products = db.query(Product).all()
    return {
        "total_stock_value_at_selling_price": round(sum(p.stock_quantity * p.selling_price for p in products), 2),
        "total_stock_value_at_purchase_price": round(sum(p.stock_quantity * (p.purchase_price or 0) for p in products), 2),
        "low_stock_products": [p for p in products if p.stock_quantity <= p.low_stock_threshold],
        "out_of_stock_products": [p for p in products if p.stock_quantity <= 0],
    }


@app.get("/reports/sales")
def sales_report(db: Session = Depends(get_db)):
    sales = db.query(Transaction).filter(Transaction.transaction_type == "sale").all()
    gross_sales = round(sum(t.total_amount for t in sales), 2)
    paid_sales = round(sum(t.paid_amount for t in sales), 2)
    outstanding_from_sales = round(gross_sales - paid_sales, 2)

    purchase_transactions = db.query(Transaction).filter(Transaction.transaction_type == "purchase").all()
    gross_purchases = round(sum(t.total_amount for t in purchase_transactions), 2)

    return {
        "gross_sales": gross_sales,
        "paid_sales": paid_sales,
        "outstanding_from_sales": outstanding_from_sales,
        "gross_purchases": gross_purchases,
        "estimated_profit": round(gross_sales - gross_purchases, 2),
        "sale_count": len(sales),
        "purchase_count": len(purchase_transactions),
    }


@app.get("/search")
def global_search(q: str, db: Session = Depends(get_db)):
    term = q.strip().lower()
    if not term:
        return {"products": [], "customers": []}

    products = db.query(Product).filter(func.lower(Product.name).contains(term)).limit(20).all()
    customers = db.query(Customer).filter(func.lower(Customer.name).contains(term)).limit(20).all()
    return {"products": products, "customers": customers}


@app.post("/voice/process")
def process_voice(payload: VoiceCommandInput, db: Session = Depends(get_db)):
    text = payload.text.strip()
    normalized = text.lower()

    if "add product" in normalized or "create product" in normalized:
        return {"recognized_text": text, "intent": "add_product", "action_required": True, "message": "Product creation request recognized."}
    if "add customer" in normalized or "create customer" in normalized:
        return {"recognized_text": text, "intent": "add_customer", "action_required": True, "message": "Customer creation request recognized."}
    if "payment" in normalized or "received" in normalized:
        return {"recognized_text": text, "intent": "payment", "action_required": True, "message": "Payment request recognized."}
    if "sold" in normalized or "sale" in normalized:
        return {"recognized_text": text, "intent": "sale", "action_required": True, "message": "Sale request recognized."}
    if "purchase" in normalized or "stock in" in normalized:
        return {"recognized_text": text, "intent": "purchase", "action_required": True, "message": "Purchase request recognized."}

    return {"recognized_text": text, "intent": "unknown", "action_required": False, "message": "Command could not be understood. Please say add product, sale, purchase, or payment."}


@app.delete("/transactions/{transaction_id}")
def delete_transaction(transaction_id: int, db: Session = Depends(get_db)):
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    items = db.query(TransactionItem).filter(TransactionItem.transaction_id == transaction_id).all()
    for item in items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if product:
            if transaction.transaction_type == "sale":
                product.stock_quantity += item.quantity
            elif transaction.transaction_type == "purchase":
                product.stock_quantity -= item.quantity

        db.delete(item)

    if transaction.transaction_type == "sale" and transaction.customer_id:
        customer = db.query(Customer).filter(Customer.id == transaction.customer_id).first()
        if customer:
            outstanding_change = transaction.total_amount - transaction.paid_amount
            customer.outstanding_balance = max(0, customer.outstanding_balance - outstanding_change)

    db.delete(transaction)
    db.commit()
    return {"message": "Transaction deleted successfully"}


@app.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db)):
    products = db.query(Product).all()
    customers = db.query(Customer).all()
    transactions = db.query(Transaction).all()

    return {
        "total_products": len(products),
        "total_customers": len(customers),
        "total_transactions": len(transactions),
        "total_sales": round(sum(
            transaction.total_amount
            for transaction in transactions
            if transaction.transaction_type == "sale"
        ), 2),
        "total_stock": sum(product.stock_quantity for product in products),
        "total_outstanding": round(sum(
            customer.outstanding_balance for customer in customers
        ), 2),
        "low_stock_count": sum(
            product.stock_quantity <= product.low_stock_threshold
            for product in products
        ),
        "low_stock_products": [
            product for product in products
            if product.stock_quantity <= product.low_stock_threshold
        ],
    }


def parse_date(value):
    if not value:
        return None
    if isinstance(value, str):
        return datetime.strptime(value, "%Y-%m-%d").date()
    return value

@app.get("/whatsapp/chat-link")
def whatsapp_chat_link(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    phone_number = customer.phone_number or ""
    whatsapp_number = customer.whatsapp_number or ""

    if not whatsapp_number:
        raise HTTPException(status_code=400, detail="WhatsApp number is not available for this customer")

    # Create a click-to-chat link for WhatsApp
    chat_link = f"https://wa.me/{quote(whatsapp_number)}"

    return {"chat_link": chat_link}

@app.get("/customers/{customer_id}/whatsapp")
def create_whatsapp_link(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    number = "".join(character for character in (customer.whatsapp_number or "") if character.isdigit())
    if not number:
        raise HTTPException(status_code=422, detail="Customer has no valid WhatsApp number")
    if len(number) == 10:
        number = "91" + number

    message = (
        f"Hello {customer.name}, your outstanding balance is "
        f"Rs. {customer.outstanding_balance:.2f}. Thank you."
    )

    return {"url": f"https://wa.me/{number}?text={quote(message)}"}
