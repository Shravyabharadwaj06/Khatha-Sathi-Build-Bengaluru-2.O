from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class ProductBase(BaseModel):
    name: str = Field(min_length=1)
    category: Optional[str] = None
    selling_price: float = Field(ge=0)
    purchase_price: Optional[float] = Field(default=0, ge=0)
    stock_quantity: float = Field(default=0, ge=0)
    unit: Optional[str] = "pcs"
    expiry_date: Optional[date] = None
    low_stock_threshold: float = Field(default=5, ge=0)


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    category: Optional[str] = None
    selling_price: Optional[float] = Field(default=None, ge=0)
    purchase_price: Optional[float] = Field(default=None, ge=0)
    stock_quantity: Optional[float] = Field(default=None, ge=0)
    unit: Optional[str] = None
    expiry_date: Optional[date] = None
    low_stock_threshold: Optional[float] = Field(default=None, ge=0)


class CustomerBase(BaseModel):
    name: str = Field(min_length=1)
    phone_number: Optional[str] = None
    whatsapp_number: Optional[str] = None
    outstanding_balance: float = Field(default=0, ge=0)
    credit_score: Optional[float] = Field(default=0, ge=0)


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    phone_number: Optional[str] = None
    whatsapp_number: Optional[str] = None
    outstanding_balance: Optional[float] = Field(default=None, ge=0)
    credit_score: Optional[float] = Field(default=None, ge=0)


class TransactionItemInput(BaseModel):
    product_id: int
    quantity: float = Field(gt=0)


class TransactionCreate(BaseModel):
    transaction_type: str
    customer_id: Optional[int] = None
    items: list[TransactionItemInput]
    payment_method: str = "cash"
    paid_amount: Optional[float] = Field(default=None, ge=0)
    notes: Optional[str] = None


class PaymentCreate(BaseModel):
    customer_id: int
    amount: float = Field(gt=0)
    payment_method: str = "cash"
    notes: Optional[str] = None


class VoiceCommandInput(BaseModel):
    text: str = Field(min_length=1)
