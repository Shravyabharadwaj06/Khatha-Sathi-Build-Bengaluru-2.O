from sqlalchemy import Column, Float, Integer, String, Date, ForeignKey, Text

from database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    category = Column(String, nullable=True)
    selling_price = Column(Float, nullable=False)
    purchase_price = Column(Float, nullable=True)
    stock_quantity = Column(Float, nullable=False, default=0)
    unit = Column(String, nullable=True, default="pcs")
    expiry_date = Column(Date, nullable=True)
    low_stock_threshold = Column(Float, nullable=False, default=5)


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    phone_number = Column(String, nullable=True)
    whatsapp_number = Column(String, nullable=True)
    outstanding_balance = Column(Float, nullable=False, default=0)
    credit_score = Column(Float, nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    transaction_type = Column(String, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    total_amount = Column(Float, nullable=False, default=0)
    paid_amount = Column(Float, nullable=False, default=0)
    payment_method = Column(String, nullable=True)
    transaction_date = Column(String, nullable=True)
    status = Column(String, nullable=True)
    notes = Column(Text, nullable=True)


class TransactionItem(Base):
    __tablename__ = "transaction_items"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    product_name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    unit_price = Column(Float, nullable=False)
    line_total = Column(Float, nullable=False)


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    amount = Column(Float, nullable=False)
    payment_method = Column(String, nullable=False, default="cash")
    payment_date = Column(String, nullable=False)
    notes = Column(Text, nullable=True)


class AppUser(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True, index=True)
    phone = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    city = Column(String, nullable=True)
    business_domain = Column(String, nullable=True)
