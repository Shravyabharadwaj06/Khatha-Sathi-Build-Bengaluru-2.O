from datetime import date
from decimal import Decimal
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request bodies for products, customers and OTP.
# They describe exactly the fields the endpoints read. Numbers arrive as JSON
# numbers or form strings ("12.50", "" for empty); main.py converts them to
# paise / quantities with Decimal, so no float money is ever used.
# Unknown keys are ignored so older frontends keep working.
# ---------------------------------------------------------------------------
NumberLike = Optional[Union[Decimal, str]]


class _Body(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class ProductCreate(_Body):
    name: Optional[str] = Field(default=None, max_length=120)
    product_name: Optional[str] = Field(default=None, max_length=120)  # old field name
    category: Optional[str] = Field(default=None, max_length=60)
    selling_price: NumberLike = None
    purchase_price: NumberLike = None
    stock_quantity: NumberLike = None
    unit: Optional[str] = Field(default=None, max_length=20)
    expiry_date: Optional[Union[date, str]] = None
    low_stock_threshold: NumberLike = None


class ProductUpdate(ProductCreate):
    pass


class CustomerCreate(_Body):
    name: Optional[str] = Field(default=None, max_length=120)
    customer_name: Optional[str] = Field(default=None, max_length=120)  # old field name
    phone_number: Optional[str] = Field(default=None, max_length=20)
    whatsapp_number: Optional[str] = Field(default=None, max_length=20)
    credit_score: NumberLike = None
    # Opening balance from the paper khata, accepted ONLY when the customer is created.
    outstanding_balance: NumberLike = None


class CustomerUpdate(CustomerCreate):
    pass


class OtpSendInput(_Body):
    phone: str = Field(min_length=1, max_length=20)


class OtpVerifyInput(_Body):
    phone: str = Field(min_length=1, max_length=20)
    otp: str = Field(min_length=1, max_length=10)


class TransactionItemInput(BaseModel):
    product_id: str
    quantity: Decimal = Field(gt=0)


class TransactionCreate(BaseModel):
    transaction_type: str
    customer_id: Optional[str] = None
    items: list[TransactionItemInput]
    payment_method: str = "cash"
    paid_amount: Optional[Decimal] = Field(default=None, ge=0)
    notes: Optional[str] = None


class PaymentCreate(BaseModel):
    customer_id: str
    amount: Decimal = Field(gt=0)
    payment_method: str = "cash"
    notes: Optional[str] = None


class VoiceCommandInput(BaseModel):
    text: str = Field(min_length=1)


class ProfileInput(BaseModel):
    shopName: str = Field(min_length=1)
    ownerName: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    businessDomain: str = Field(min_length=1)
    gstNumber: str = ""
    fssaiNumber: str = ""
    address: str = Field(min_length=1)
    avatarUrl: str = ""
    primaryLanguage: str
    secondaryLanguage: str
    spokenReplies: bool
    voiceSpeed: Literal["Slow", "Normal", "Fast"]
    voiceVolume: int = Field(ge=0, le=100)
    dailyLedgerPdf: bool
    lowStockAlert: bool
    paymentReminder: bool
