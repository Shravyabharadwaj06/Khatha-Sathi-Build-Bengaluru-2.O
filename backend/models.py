from sqlalchemy import Column, Float, Integer, String, Date

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
    total_amount = Column(Float, nullable=False, default=0)
    payment_method = Column(String, nullable=True)
    transaction_date = Column(String, nullable=True)
    status = Column(String, nullable=True)
