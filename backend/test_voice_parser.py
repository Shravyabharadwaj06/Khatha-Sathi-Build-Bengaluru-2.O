"""Golden phrases for the rule-based parser (INTENT_MODE=rules). No database, no network."""
from decimal import Decimal

import pytest

from voice import parser as P
from voice_fixtures import demo_customers, demo_products

C = demo_customers()
PR = demo_products()


def run(text, draft=False):
    return P.parse(text, C, PR, has_open_draft=draft)


def item_names(parsed):
    return [(i.product.name, str(i.qty)) for i in parsed.items]


# (text, open draft?, expected intent, expected customer names, expected items [(name, qty)])
GOLDEN = [
    # bills: Kannada-English
    ("Ravi ge 2 milk add maadu", False, "CREATE_BILL", ["ravi"], [("Nandini Toned Milk 500ml", "2")]),
    ("Ramesh ge ondu akki kodi", False, "CREATE_BILL", ["ramesh"], [("Sona Masoori Rice", "1")]),
    ("Lakshmi ge eradu haalu", False, "CREATE_BILL", ["lakshmi"], [("Nandini Toned Milk 500ml", "2")]),
    ("Suresh ige mooru motte", False, "CREATE_BILL", ["suresh"], [("Eggs", "3")]),
    # bills: Hinglish
    ("Ramesh ko 2 kilo chawal aur 1 dal", False, "CREATE_BILL", ["ramesh"], [("Sona Masoori Rice", "2"), ("Toor Dal", "1")]),
    ("Ravi ko 2 Tata namak udhaar", False, "CREATE_BILL", ["ravi"], [("Tata Salt 1kg", "2")]),
    ("Lakshmi ke liye do doodh", False, "CREATE_BILL", ["lakshmi"], [("Nandini Toned Milk 500ml", "2")]),
    ("Ramesh ka bill: ek bread aur do anda", False, "CREATE_BILL", ["ramesh"], [("Modern Bread 400g", "1"), ("Eggs", "2")]),
    ("aadha kilo tomato aur 500 gram dal", False, "CREATE_BILL", [], [("Tomato", "0.5"), ("Toor Dal", "0.5")]),
    ("paav kilo dal", False, "CREATE_BILL", [], [("Toor Dal", "0.25")]),
    ("dedh kilo cheeni", False, "CREATE_BILL", [], [("Sugar", "1.5")]),
    ("dhai kilo atta", False, "CREATE_BILL", [], [("Aashirvaad Atta 5kg", "2.5")]),
    ("sava kilo onion", False, "CREATE_BILL", [], [("Onion", "1.25")]),
    ("ek dozen anda", False, "CREATE_BILL", [], [("Eggs", "12")]),
    ("2 Fortune tel cash", False, "CREATE_BILL", [], [("Fortune Sunflower Oil 1L", "2")]),
    ("Tata namak ek packet", False, "CREATE_BILL", [], [("Tata Salt 1kg", "1")]),
    # bills: English
    ("2 milk and 1 bread for Ramesh", False, "CREATE_BILL", ["ramesh"], [("Nandini Toned Milk 500ml", "2"), ("Modern Bread 400g", "1")]),
    ("three eggs cash", False, "CREATE_BILL", [], [("Eggs", "3")]),
    ("Kiran 1 curd upi", False, "CREATE_BILL", ["kiran"], [("Nandini Curd 500g", "1")]),
    # follow-ups on an open draft
    ("aur ek bread", True, "ADD_ITEM", [], [("Modern Bread 400g", "1")]),
    ("innondu haalu", True, "ADD_ITEM", [], [("Nandini Toned Milk 500ml", "1")]),
    ("also 2 eggs", True, "ADD_ITEM", [], [("Eggs", "2")]),
    ("Ravi alla, Ramesh", True, "CORRECT_CUSTOMER", ["ravi", "ramesh"], []),
    ("Ravi nahi, Ramesh", True, "CORRECT_CUSTOMER", ["ravi", "ramesh"], []),
    ("not Ravi, Lakshmi", True, "CORRECT_CUSTOMER", ["ravi", "lakshmi"], []),
    # payments
    ("Ramesh ne 200 diye", False, "RECORD_PAYMENT", ["ramesh"], []),
    ("Ramesh ne do sau diye", False, "RECORD_PAYMENT", ["ramesh"], []),
    ("Ravi 150 upi se diya", False, "RECORD_PAYMENT", ["ravi"], []),
    ("Ramesh 100 rupaayi kottidare", False, "RECORD_PAYMENT", ["ramesh"], []),
    ("Suresh paid 500", False, "RECORD_PAYMENT", ["suresh"], []),
    # balance / explain / history / reminder
    ("Ramesh ka kitna baaki hai?", False, "SHOW_BALANCE", ["ramesh"], []),
    ("Ramesh eshtu baaki?", False, "SHOW_BALANCE", ["ramesh"], []),
    ("What is Suresh's balance", False, "SHOW_BALANCE", ["suresh"], []),
    ("Ramesh ka hisaab samjhao", False, "EXPLAIN_BALANCE", ["ramesh"], []),
    ("Ramesh lekka heli", False, "EXPLAIN_BALANCE", ["ramesh"], []),
    ("explain Ramesh balance", False, "EXPLAIN_BALANCE", ["ramesh"], []),
    ("Ramesh ki history dikhao", False, "SHOW_HISTORY", ["ramesh"], []),
    ("show Lakshmi entries", False, "SHOW_HISTORY", ["lakshmi"], []),
    ("Ramesh ko reminder bhejo", False, "SEND_REMINDER", ["ramesh"], []),
    ("Suresh ge nenapisu", False, "SEND_REMINDER", ["suresh"], []),
    ("send a firm reminder to Ramesh", False, "SEND_REMINDER", ["ramesh"], []),
    # products, undo, unknown
    ("Add Tata Salt 1 kg", False, "ADD_PRODUCT", [], []),
    ("naya product Ragi 2 kg 55 rupees", False, "ADD_PRODUCT", [], []),
    ("undo", False, "UNDO", [], []),
    ("galti ho gayi, wapas karo", False, "UNDO", [], []),
    ("kuch bhi", False, "UNKNOWN", [], []),
    ("hello", False, "UNKNOWN", [], []),
]


@pytest.mark.parametrize("text,draft,intent,names,items", GOLDEN, ids=[g[0] for g in GOLDEN])
def test_golden_phrase(text, draft, intent, names, items):
    parsed = run(text, draft)
    assert parsed.intent == intent
    assert parsed.names == names
    assert item_names(parsed) == items


def test_there_are_at_least_40_golden_phrases():
    assert len(GOLDEN) >= 40


def test_payment_amounts_are_read_not_invented():
    assert run("Ramesh ne 200 diye").amount_paise == 20000
    assert run("Ramesh ne do sau diye").amount_paise == 20000
    assert run("Ramesh ne dedh sau diye").amount_paise == 15000
    assert run("Ravi 150 upi se diya").mode == "upi"
    assert run("Ramesh paid").amount_paise is None


def test_unit_conversions_are_marked():
    notes = [i.note for i in run("aadha kilo tomato aur 500 gram dal").items]
    assert notes == ["aadha kilo → 0.5 kg", "500 g → 0.5 kg"]
    assert run("2 Fortune tel cash").items[0].note == "fortune tel → Fortune Sunflower Oil 1L"
    assert run("ek dozen anda").items[0].note == "1 dozen → 12 piece"
    seer = run("ek seer cheeni").items[0]
    assert seer.qty == Decimal("0.933") and seer.note == "1 seer → 0.933 kg"


def test_bill_payment_mode_words():
    assert run("2 Fortune tel cash").mode == "cash"
    assert run("Ravi ko 2 Tata namak udhaar").mode == "udhaar"
    assert run("Kiran 1 curd upi").mode == "upi"
    assert run("Ravi ge 2 milk add maadu").mode is None  # decided later: udhaar for a named customer


def test_reminder_tone():
    assert run("send a firm reminder to Ramesh").tone == "firm"
    assert run("Ramesh ko reminder bhejo").tone == "soft"


def test_add_product_spec_has_no_invented_price():
    spec = run("Add Tata Salt 1 kg").product_spec
    assert spec == {"name": "Tata Salt", "unit": "kg", "opening_stock": "1", "price_paise": None}
    assert run("naya product Ragi 2 kg 55 rupees").product_spec["price_paise"] == 5500


def test_two_ravis_are_both_candidates():
    assert [c.id for c in P.customers_named("ravi", C)] == ["ravi-gn", "ravi-2"]


def test_detect_intent_without_shop_data():
    assert P.detect_intent("Ramesh ne 200 diye") == "RECORD_PAYMENT"
    assert P.detect_intent("add product ragi") == "ADD_PRODUCT"
    assert P.detect_intent("3 sold") == "CREATE_BILL"
    assert P.detect_intent("hello") == "UNKNOWN"


# "diya" with udhaar is credit GIVEN to the customer, the opposite of a payment ("X ne diye").
@pytest.mark.parametrize("text", ["Ramesh ko 500 rupaye udhaar diya", "Ramesh ko 500 udhar diye", "Ramesh ge 500 saala kotta"])
def test_udhaar_given_is_never_a_payment(text):
    parsed = run(text)
    assert parsed.intent != "RECORD_PAYMENT"
    assert P.is_udhaar_without_items(text)


def test_udhaar_with_items_and_diya_is_a_credit_bill():
    parsed = run("Ramesh ko 2 Tata namak udhaar diya")
    assert parsed.intent == "CREATE_BILL" and parsed.mode == "udhaar"
    assert item_names(parsed) == [("Tata Salt 1kg", "2")]


@pytest.mark.parametrize("text", ["Ramesh ne 200 rupaye diye", "Ramesh ne khata mein 200 jama kiye"])
def test_real_payments_still_parse_as_payments(text):
    parsed = run(text)
    assert parsed.intent == "RECORD_PAYMENT" and parsed.amount_paise == 20000
