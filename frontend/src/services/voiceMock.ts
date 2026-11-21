/**
 * In-browser mock of the voice API (docs/VOICE_CONTRACT.md). Used when VITE_USE_MOCK_API=true.
 * It understands the demo phrases from typed/recognised TEXT, uses the same demo data as
 * supabase/seed.sql (money in paise) and never calls Gnani, so it costs no credits.
 * It follows the backend rules: nothing is saved before confirm, undo = reversal, numbers come
 * from data (never invented).
 */
import { ApiError } from './errors';
import { formatQty, formatRupees } from '../utils/money';
import type {
  CustomerRef,
  DraftItem,
  PaymentMode,
  ProductSummary,
  ReminderTone,
  ReminderVariant,
  VoiceAnswer,
  VoiceCancelResult,
  VoiceClarify,
  VoiceCommandInput,
  VoiceConfirmResult,
  VoiceDraft,
  VoiceIntent,
  VoiceLanguage,
  VoiceResponse,
  VoiceUsage,
} from '../types/voice';

const SHOP = 'Sri Lakshmi Kirana Stores';
const DAY_MS = 86_400_000;
const DRAFT_TTL_MS = 10 * 60_000;
const DELAY_MS = 450;
const fid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
const wait = <T,>(value: T, ms = DELAY_MS) => new Promise<T>((r) => setTimeout(() => r(value), ms));

// ---------------------------------------------------------------------------
// Demo data (same as supabase/seed.sql)
// ---------------------------------------------------------------------------
interface MockProduct {
  id: string;
  name: string;
  unit: string;
  price: number | null;
  stock: number;
  aliases: string[];
}

const PRODUCTS: MockProduct[] = [
  { id: fid(101), name: 'Nandini Toned Milk 500ml', unit: 'packet', price: 2700, stock: 28, aliases: ['milk', 'doodh', 'dudh', 'haalu', 'nandini'] },
  { id: fid(102), name: 'Sona Masoori Rice', unit: 'kg', price: 6200, stock: 90, aliases: ['rice', 'chawal', 'akki'] },
  { id: fid(103), name: 'Tata Salt 1kg', unit: 'packet', price: 2800, stock: 37, aliases: ['tata namak', 'tata salt', 'salt', 'namak', 'uppu'] },
  { id: fid(104), name: 'Fortune Sunflower Oil 1L', unit: 'packet', price: 16500, stock: 23, aliases: ['fortune tel', 'fortune oil', 'sunflower oil', 'oil', 'tel', 'enne'] },
  { id: fid(105), name: 'Modern Bread 400g', unit: 'packet', price: 4500, stock: 11, aliases: ['double roti', 'bread'] },
  { id: fid(106), name: 'Sugar', unit: 'kg', price: 4600, stock: 67, aliases: ['sugar', 'cheeni', 'chini', 'sakkare'] },
  { id: fid(107), name: 'Aashirvaad Atta 5kg', unit: 'packet', price: 28500, stock: 17, aliases: ['godhi hittu', 'atta', 'aata'] },
  { id: fid(108), name: 'Toor Dal', unit: 'kg', price: 16000, stock: 35.5, aliases: ['toor dal', 'togari bele', 'dal', 'daal'] },
  { id: fid(109), name: 'Eggs', unit: 'piece', price: 700, stock: 144, aliases: ['eggs', 'egg', 'anda', 'motte'] },
  { id: fid(110), name: 'Nandini Curd 500g', unit: 'packet', price: 3000, stock: 17, aliases: ['curd', 'dahi', 'mosaru'] },
  { id: fid(111), name: 'Tomato', unit: 'kg', price: 3000, stock: 3, aliases: ['tomato', 'tamatar'] },
  { id: fid(112), name: 'Onion', unit: 'kg', price: 4000, stock: 45.5, aliases: ['onion', 'pyaz', 'eerulli'] },
];

interface MockCustomer extends CustomerRef {
  phone: string | null;
}

const CUSTOMERS: MockCustomer[] = [
  { id: fid(201), name: 'Ravi', locality: 'Gandhi Nagar', phone: '9845012345' },
  { id: fid(202), name: 'Ravi', locality: null, phone: '9900112233' },
  { id: fid(203), name: 'Ramesh', locality: 'Seshadripuram', phone: '9886054321' },
  { id: fid(204), name: 'Lakshmi', locality: 'Malleshwaram', phone: '9741122334' },
  { id: fid(205), name: 'Suresh', locality: 'Majestic', phone: '9844455667' },
];

interface MockEntry {
  id: string;
  customer_id: string | null;
  type: 'sale' | 'payment' | 'reversal';
  amount: number;
  paid: number;
  due_delta: number;
  payment_mode: PaymentMode;
  description: string;
  created_at: string;
  items: DraftItem[];
  reverses: string | null;
  reversed: boolean;
}

function seedLedger(): MockEntry[] {
  const now = Date.now();
  const at = (days: number, hours: number) => new Date(now - days * DAY_MS - hours * 3_600_000).toISOString();
  const e = (n: number, cust: number, type: MockEntry['type'], amount: number, mode: PaymentMode, description: string, when: string): MockEntry => {
    const paid = type === 'payment' || mode === 'cash' || mode === 'upi' ? amount : 0;
    return {
      id: fid(n), customer_id: fid(cust), type, amount, paid, payment_mode: mode, description, created_at: when, items: [],
      due_delta: type === 'payment' ? -amount : amount - paid, reverses: null, reversed: false,
    };
  };
  return [
    e(305, 205, 'sale', 127000, 'udhaar', 'Sona Masoori Rice 10 kg, Toor Dal 2 kg, Fortune Sunflower Oil 1L 2 packet', at(52, 3)),
    e(306, 205, 'payment', 50000, 'cash', 'Cash payment', at(40, 2)),
    e(301, 201, 'sale', 28000, 'udhaar', 'Toor Dal 1 kg, Sugar 2 kg, Tata Salt 1kg 1 packet', at(12, 3)),
    e(307, 203, 'sale', 56200, 'udhaar', 'Sona Masoori Rice 5 kg, Toor Dal 1 kg, Sugar 2 kg', at(9, 2)),
    e(308, 204, 'sale', 29700, 'partial', 'Nandini Curd 500g 2 packet, Nandini Toned Milk 500ml 4 packet, Eggs 12 piece, Modern Bread 400g 1 packet', at(6, 5)),
    e(302, 201, 'payment', 10000, 'cash', 'Cash payment', at(5, 2)),
    e(309, 203, 'sale', 47800, 'udhaar', 'Fortune Sunflower Oil 1L 1 packet, Tata Salt 1kg 1 packet, Aashirvaad Atta 5kg 1 packet', at(4, 4)),
    e(310, 204, 'payment', 9700, 'cash', 'Cash payment', at(3, 2)),
    e(311, 203, 'payment', 20000, 'upi', 'UPI payment', at(2, 3)),
    e(303, 202, 'sale', 36400, 'udhaar', 'Sona Masoori Rice 5 kg, Nandini Toned Milk 500ml 2 packet', at(1, 5)),
  ].map((x) => (x.id === fid(308) ? { ...x, paid: 20000, due_delta: 9700 } : x));
}

// ---------------------------------------------------------------------------
// Mock server state (in memory; a page reload resets it)
// ---------------------------------------------------------------------------
interface StoredDraft {
  draft: VoiceDraft;
  status: 'pending' | 'confirmed' | 'cancelled';
  language: VoiceLanguage;
}

interface StoredClarify {
  transcript: string;
  language: VoiceLanguage;
  intent: VoiceIntent;
  resolve: (customer: MockCustomer) => VoiceResponse;
}

const state = {
  ledger: seedLedger(),
  drafts: new Map<string, StoredDraft>(),
  clarifies: new Map<string, StoredClarify>(),
  lastSavedEntryId: null as string | null,
  usage: { seconds: 0, calls: 0, ttsChars: 0 },
};

// ---------------------------------------------------------------------------
// Reply templates (filled with data values only)
// ---------------------------------------------------------------------------
type Lang = 'hi' | 'kn' | 'en';
const L = (language: VoiceLanguage): Lang => (language === 'kn-IN' ? 'kn' : language === 'en-IN' ? 'en' : 'hi');
const MODE_WORD: Record<Lang, Record<PaymentMode, string>> = {
  hi: { udhaar: 'udhaar', cash: 'cash', upi: 'UPI', partial: 'thoda udhaar' },
  kn: { udhaar: 'saala', cash: 'cash', upi: 'UPI', partial: 'swalpa saala' },
  en: { udhaar: 'on credit', cash: 'cash', upi: 'UPI', partial: 'part paid' },
};
const who = (c: CustomerRef | null) => (c ? `${c.name}${c.locality ? ` (${c.locality})` : ''}` : 'Cash sale');
const ASK: Record<Lang, string> = { hi: 'Confirm karein?', kn: 'Confirm maadla?', en: 'Confirm?' };

const T = {
  notUnderstood: { hi: 'Samajh nahi aaya. Phir se boliye?', kn: 'Arthavaagalilla. Innondu sala heli?', en: "Sorry, I didn't get that. Please say it again." },
  noCustomer: { hi: 'Kis customer ka? Naam boliye.', kn: 'Yaava customer? Hesaru heli.', en: 'Which customer? Please say the name.' },
  noDraft: { hi: 'Abhi koi bill khula nahi hai. Pehle bill boliye.', kn: 'Yaava bill open illa. Modalu bill heli.', en: 'There is no open bill. Say the bill first.' },
  nothingToUndo: { hi: 'Wapas karne ke liye kuch nahi hai.', kn: 'Vaapas maadalu enu illa.', en: 'There is nothing to undo.' },
  reminderReady: { hi: 'Reminder taiyaar hai. WhatsApp kholkar bhejiye.', kn: 'Reminder ready ide. WhatsApp open maadi kalisi.', en: 'Reminder is ready. Open WhatsApp to send it.' },
};

function itemsShort(items: DraftItem[]) {
  return items.map((i) => `${formatQty(i.qty)} ${i.name}`).join(', ');
}

// ---------------------------------------------------------------------------
// Text understanding (rules only, like the backend's offline fallback)
// ---------------------------------------------------------------------------
const NUMBER_WORDS: Record<string, number> = {
  ek: 1, ondu: 1, one: 1, do: 2, eradu: 2, two: 2, teen: 3, mooru: 3, three: 3, char: 4, naalku: 4, four: 4,
  paanch: 5, aidu: 5, five: 5, das: 10, hattu: 10, ten: 10,
};
const FRACTION_WORDS: Record<string, number> = {
  aadha: 0.5, adha: 0.5, ardha: 0.5, paav: 0.25, kaal: 0.25, pauna: 0.75, mukkaal: 0.75, sava: 1.25, dedh: 1.5, dhai: 2.5,
};
const UNIT_WORDS = new Set(['kg', 'kilo', 'kilogram', 'packet', 'packets', 'pack', 'litre', 'liter', 'l', 'piece', 'pieces', 'pcs', 'dozen', 'gram', 'g']);
const SUFFIXES = ['avarige', 'avara', 'ige', 'ge', 'ka', 'ki', 'ke', 'ko', 'ne', 'gu', 'ji', 'anna'];

function normalise(text: string) {
  return text.toLowerCase().replace(/[₹]/g, ' rs ').replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function findCustomerNames(words: string[]): { name: string; index: number }[] {
  const names = [...new Set(CUSTOMERS.map((c) => c.name.toLowerCase()))];
  const found: { name: string; index: number }[] = [];
  words.forEach((w, index) => {
    const candidates = [w, ...SUFFIXES.filter((s) => w.endsWith(s) && w.length > s.length + 2).map((s) => w.slice(0, -s.length))];
    const hit = candidates.find((c) => names.includes(c));
    if (hit) found.push({ name: hit, index });
  });
  return found;
}

const customersNamed = (name: string) => CUSTOMERS.filter((c) => c.name.toLowerCase() === name);

interface ParsedItem {
  product: MockProduct;
  qty: number;
  note: string | null;
}

function findItems(text: string): ParsedItem[] {
  const taken: [number, number][] = [];
  const hits: { product: MockProduct; start: number; alias: string }[] = [];
  const aliases = PRODUCTS.flatMap((p) => p.aliases.map((a) => ({ p, a }))).sort((x, y) => y.a.length - x.a.length);
  for (const { p, a } of aliases) {
    const re = new RegExp(`(^| )${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index + m[1].length;
      const end = start + a.length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      hits.push({ product: p, start, alias: a });
    }
  }
  hits.sort((x, y) => x.start - y.start);
  return hits.map(({ product, start, alias }) => {
    const before = text.slice(0, start).trim().split(' ').filter(Boolean).slice(-3);
    let qty = 1;
    let note: string | null = null;
    let unitWord: string | null = null;
    for (let i = before.length - 1; i >= 0; i--) {
      const w = before[i];
      if (UNIT_WORDS.has(w) && unitWord === null) {
        unitWord = w;
        continue;
      }
      if (/^\d+(\.\d+)?$/.test(w)) {
        qty = Number(w);
        break;
      }
      if (w in NUMBER_WORDS) {
        qty = NUMBER_WORDS[w];
        break;
      }
      if (w in FRACTION_WORDS) {
        qty = FRACTION_WORDS[w];
        note = `${w}${unitWord ? ` ${unitWord}` : ''} → ${formatQty(qty)} ${product.unit}`;
        break;
      }
      if (unitWord === null) break;
    }
    if (unitWord === 'dozen' && product.unit === 'piece') {
      note = `${formatQty(qty)} dozen → ${formatQty(qty * 12)} piece`;
      qty *= 12;
    }
    if (!note && alias.includes(' ') && !product.name.toLowerCase().startsWith(alias)) note = `${alias} → ${product.name}`;
    return { product, qty, note };
  });
}

function firstAmountPaise(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Math.round(Number(m[1]) * 100) : null;
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------
function response(base: Pick<VoiceResponse, 'transcript' | 'language' | 'intent'>, part: Partial<VoiceResponse>): VoiceResponse {
  return { status: 'error', draft: null, clarify: null, answer: null, reply_text: '', error: null, ...base, ...part };
}

function errorResponse(transcript: string, language: VoiceLanguage, intent: VoiceIntent, code: string, reply: Record<Lang, string>): VoiceResponse {
  return response({ transcript, language, intent }, {
    status: 'error',
    reply_text: reply[L(language)],
    error: { code, message: reply.en },
  });
}

function toDraftItems(items: ParsedItem[]): DraftItem[] {
  return items.map(({ product, qty, note }) => ({
    product_id: product.id,
    name: product.name,
    qty,
    unit: product.unit,
    unit_price_paise: product.price,
    line_total_paise: product.price === null ? null : Math.round(qty * product.price),
    conversion_note: note,
  }));
}

function stockWarnings(items: DraftItem[]): string[] {
  return items.flatMap((i) => {
    const p = PRODUCTS.find((x) => x.id === i.product_id);
    if (!p) return [];
    const out: string[] = [];
    if (p.price === null) out.push(`Price not set for ${p.name}`);
    if (i.qty > p.stock) out.push(`Only ${formatQty(p.stock)} ${p.unit} ${p.name} in stock`);
    return out;
  });
}

function storeDraft(language: VoiceLanguage, draft: Omit<VoiceDraft, 'draft_id' | 'expires_at'> & { draft_id?: string }): VoiceDraft {
  const full: VoiceDraft = {
    ...draft,
    draft_id: draft.draft_id ?? uuid(),
    expires_at: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
  };
  state.drafts.set(full.draft_id, { draft: full, status: 'pending', language });
  return full;
}

function billDraft(language: VoiceLanguage, intent: VoiceIntent, customer: CustomerRef | null, items: DraftItem[], mode?: PaymentMode, draftId?: string, changes: string[] = []): VoiceDraft {
  const total = items.reduce((s, i) => s + (i.line_total_paise ?? 0), 0);
  const payment_mode: PaymentMode = mode ?? (customer ? 'udhaar' : 'cash');
  return storeDraft(language, {
    draft_id: draftId,
    intent,
    customer,
    items,
    total_paise: total,
    payment_mode,
    paid_paise: payment_mode === 'udhaar' ? 0 : total,
    reverses_entry_id: null,
    product: null,
    changes,
    warnings: stockWarnings(items),
  });
}

function billReply(language: VoiceLanguage, d: VoiceDraft) {
  const l = L(language);
  return `${who(d.customer)}: ${itemsShort(d.items)}, ${formatRupees(d.total_paise)} ${MODE_WORD[l][d.payment_mode]}. ${ASK[l]}`;
}

function draftResponse(transcript: string, language: VoiceLanguage, d: VoiceDraft, reply: string): VoiceResponse {
  return response({ transcript, language, intent: d.intent }, { status: 'draft', draft: d, reply_text: reply });
}

function clarifyFor(transcript: string, language: VoiceLanguage, intent: VoiceIntent, name: string, resolve: StoredClarify['resolve']): VoiceResponse {
  const options = customersNamed(name).map((c) => ({ id: c.id, label: c.name, detail: customerDetail(c) }));
  const clarify_id = uuid();
  state.clarifies.set(clarify_id, { transcript, language, intent, resolve });
  const display = options[0]?.label ?? name;
  const details = options.map((o) => o.detail);
  const question = {
    hi: `Kaunsa ${display}? ${details.join(' ya ')}?`,
    kn: `Yaava ${display}? ${details.join(' athava ')}?`,
    en: `Which ${display}? ${details.join(' or ')}?`,
  }[L(language)];
  const clarify: VoiceClarify = { clarify_id, kind: 'customer', question, options };
  return response({ transcript, language, intent }, { status: 'clarify', clarify, reply_text: question });
}

/** "Gandhi Nagar", or the last item + when, from the ledger (never invented). */
function customerDetail(c: MockCustomer): string {
  if (c.locality) return c.locality;
  const last = state.ledger.filter((e) => e.customer_id === c.id && e.type === 'sale').at(-1);
  if (!last) return 'No locality';
  const firstItem = last.description.split(',')[0].replace(/\s+\d.*$/, '').replace('Sona Masoori ', '');
  const days = Math.floor((Date.now() - Date.parse(last.created_at)) / DAY_MS);
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  return `${firstItem}, ${when}`;
}

const balanceOf = (customerId: string) =>
  state.ledger.filter((e) => e.customer_id === customerId).reduce((s, e) => s + e.due_delta, 0);

const ref = (c: MockCustomer): CustomerRef => ({ id: c.id, name: c.name, locality: c.locality });

function answerFor(kind: 'balance' | 'explain' | 'history' | 'reminder', c: MockCustomer, language: VoiceLanguage, tone: ReminderTone): { answer: VoiceAnswer; reply: string } {
  const l = L(language);
  const entries = state.ledger.filter((e) => e.customer_id === c.id);
  const balance = balanceOf(c.id);
  if (kind === 'balance') {
    return {
      answer: { kind, data: { customer: ref(c), balance_paise: balance, last_entry_at: entries.at(-1)?.created_at ?? null } },
      reply: { hi: `${c.name} ka baaki ${formatRupees(balance)} hai.`, kn: `${c.name} avara baaki ${formatRupees(balance)}.`, en: `${c.name} owes ${formatRupees(balance)}.` }[l],
    };
  }
  if (kind === 'explain') {
    const parts = entries.filter((e) => e.due_delta !== 0);
    const total = parts.reduce((s, e) => s + e.due_delta, 0);
    if (total !== balance) throw new ApiError('Balance check failed', undefined, 'INTERNAL', 500);
    const sum = parts.map((e, i) => `${i === 0 ? '' : e.due_delta < 0 ? ' − ' : ' + '}${formatRupees(Math.abs(e.due_delta))}`).join('');
    return {
      answer: {
        kind,
        data: {
          customer: ref(c),
          entries: parts.map((e) => ({ entry_id: e.id, created_at: e.created_at, type: e.type, description: e.description, due_delta_paise: e.due_delta })),
          total_paise: total,
          balance_paise: balance,
        },
      },
      reply: { hi: `${c.name} ka hisaab: ${sum} = ${formatRupees(total)}.`, kn: `${c.name} lekka: ${sum} = ${formatRupees(total)}.`, en: `${c.name}'s account: ${sum} = ${formatRupees(total)}.` }[l],
    };
  }
  if (kind === 'history') {
    let running = 0;
    return {
      answer: {
        kind,
        data: {
          customer: ref(c),
          entries: entries.map((e) => {
            running += e.due_delta;
            return { entry_id: e.id, created_at: e.created_at, type: e.type, description: e.description, amount_paise: e.amount, due_delta_paise: e.due_delta, running_balance_paise: running };
          }),
          balance_paise: balance,
        },
      },
      reply: { hi: `${c.name} ki ${entries.length} entries. Abhi baaki ${formatRupees(balance)}.`, kn: `${c.name} avara ${entries.length} entries. Eega baaki ${formatRupees(balance)}.`, en: `${c.name}: ${entries.length} entries, ${formatRupees(balance)} due now.` }[l],
    };
  }
  const variant = (t: ReminderTone): ReminderVariant => {
    const amt = formatRupees(balance);
    const message_text = {
      hi: t === 'soft'
        ? `Namaste ${c.name} ji, ${SHOP} mein aapka ${amt} baaki hai. Jab ho sake, de dijiye. Dhanyavaad!`
        : `${c.name} ji, aapka ${amt} baaki hai. Kripya is hafte tak jama kar dijiye. - ${SHOP}`,
      kn: t === 'soft'
        ? `Namaskara ${c.name} avare, ${SHOP} nalli nimma ${amt} baaki ide. Saadhyavaadaga kodi. Dhanyavaadagalu!`
        : `${c.name} avare, nimma ${amt} baaki ide. Dayavittu ee vaara kattibidi. - ${SHOP}`,
      en: t === 'soft'
        ? `Hello ${c.name}, a friendly reminder that ${amt} is due at ${SHOP}. Please pay when you can. Thank you!`
        : `${c.name}, ${amt} is overdue at ${SHOP}. Please clear it this week.`,
    }[l];
    return { tone: t, message_text, whatsapp_url: c.phone ? `https://wa.me/91${c.phone}?text=${encodeURIComponent(message_text)}` : null };
  };
  const main = variant(tone);
  return {
    answer: { kind: 'reminder', data: { ...main, customer: ref(c), balance_paise: balance, phone: c.phone, alternatives: [variant(tone === 'soft' ? 'firm' : 'soft')] } },
    reply: T.reminderReady[l],
  };
}

function undoDraft(transcript: string, language: VoiceLanguage, entryId: string): VoiceResponse {
  const entry = state.ledger.find((e) => e.id === entryId);
  if (!entry) throw new ApiError('That entry was not found.', undefined, 'ENTRY_NOT_FOUND', 404);
  if (entry.reversed || entry.type === 'reversal') throw new ApiError('This entry is already reversed.', undefined, 'ALREADY_REVERSED', 409);
  const customer = CUSTOMERS.find((c) => c.id === entry.customer_id) ?? null;
  const d = storeDraft(language, {
    intent: 'UNDO',
    customer: customer && ref(customer),
    items: entry.items,
    total_paise: entry.amount,
    payment_mode: entry.payment_mode,
    paid_paise: entry.paid,
    reverses_entry_id: entry.id,
    product: null,
    changes: [],
    warnings: [],
  });
  const l = L(language);
  const reply = { hi: `Ye entry wapas karni hai: ${formatRupees(entry.amount)}. ${ASK.hi}`, kn: `Ee entry vaapas maadbeka: ${formatRupees(entry.amount)}. ${ASK.kn}`, en: `Reverse this entry of ${formatRupees(entry.amount)}? Confirm?` }[l];
  return draftResponse(transcript, language, d, reply);
}

// ---------------------------------------------------------------------------
// The "brain" for typed text
// ---------------------------------------------------------------------------
function understand(rawText: string, language: VoiceLanguage, draftId?: string): VoiceResponse {
  const transcript = rawText.trim();
  const text = normalise(transcript);
  const words = text.split(' ').filter(Boolean);
  const l = L(language);
  const names = findCustomerNames(words);
  const has = (re: RegExp) => re.test(text);
  const openDraft = draftId ? state.drafts.get(draftId) : undefined;
  const pendingDraft = openDraft && openDraft.status === 'pending' ? openDraft : undefined;

  // Test hooks for the error cards (mock only)
  if (has(/^test busy$/)) throw new ApiError('Chotu is busy with another request.', undefined, 'GNANI_BUSY', 429);
  if (has(/^test limit$/)) throw new ApiError("Today's voice limit is reached.", undefined, 'DAILY_LIMIT_REACHED', 429);
  if (has(/^test down$/)) throw new ApiError('Voice service is down.', undefined, 'GNANI_UNAVAILABLE', 503);
  if (has(/^test long$/)) throw new ApiError('The clip is longer than 15 seconds.', undefined, 'CLIP_TOO_LONG', 413);

  // UNDO
  if (has(/\bundo\b|galti|wapas karo|vaapas|hinde/)) {
    const id = state.lastSavedEntryId;
    const entry = id ? state.ledger.find((e) => e.id === id) : undefined;
    if (!entry || entry.reversed) return errorResponse(transcript, language, 'UNDO', 'NOTHING_TO_UNDO', T.nothingToUndo);
    return undoDraft(transcript, language, entry.id);
  }

  // CORRECT_CUSTOMER: "Ravi alla, Ramesh" / "Ravi nahi, Ramesh" / "not Ravi, Ramesh"
  if (has(/\balla\b|\bnahi\b|\bnahin\b|\bnot\b|\bwrong\b/) && names.length > 0) {
    if (!pendingDraft) return errorResponse(transcript, language, 'CORRECT_CUSTOMER', 'NO_OPEN_DRAFT', T.noDraft);
    const target = names[names.length - 1].name;
    const apply = (c: MockCustomer): VoiceResponse => {
      const old = pendingDraft.draft;
      const d = billDraft(language, 'CORRECT_CUSTOMER', ref(c), old.items, old.payment_mode === 'cash' && !old.customer ? 'udhaar' : old.payment_mode, old.draft_id, [
        `Customer: ${old.customer ? old.customer.name : 'Cash sale'} → ${c.name}`,
      ]);
      const reply = { hi: `Theek hai, ${who(d.customer)} ke naam. ${formatRupees(d.total_paise)}. ${ASK.hi}`, kn: `Sari, ${who(d.customer)} hesarige. ${formatRupees(d.total_paise)}. ${ASK.kn}`, en: `OK, changed to ${who(d.customer)}. ${formatRupees(d.total_paise)}. Confirm?` }[l];
      return draftResponse(transcript, language, d, reply);
    };
    const matches = customersNamed(target);
    return matches.length > 1 ? clarifyFor(transcript, language, 'CORRECT_CUSTOMER', target, apply) : apply(matches[0]);
  }

  // Read-only answers + reminders
  const answerKind = has(/remind|reminder|yaad dila|nenapisu/)
    ? 'reminder'
    : has(/samjha|explain|kaise|hisaab|hisab|lekka/)
      ? 'explain'
      : has(/history|itihas|timeline|purana|record/)
        ? 'history'
        : has(/baaki|baki|bakki|balance|kitna|eshtu|due/)
          ? 'balance'
          : null;
  if (answerKind) {
    const intent: VoiceIntent = { reminder: 'SEND_REMINDER', explain: 'EXPLAIN_BALANCE', history: 'SHOW_HISTORY', balance: 'SHOW_BALANCE' }[answerKind] as VoiceIntent;
    if (!names.length) return errorResponse(transcript, language, intent, 'CUSTOMER_NOT_FOUND', T.noCustomer);
    const tone: ReminderTone = has(/firm|strict|kadak|sakht/) ? 'firm' : 'soft';
    const resolve = (c: MockCustomer): VoiceResponse => {
      const { answer, reply } = answerFor(answerKind, c, language, tone);
      return response({ transcript, language, intent }, { status: 'answer', answer, reply_text: reply });
    };
    const matches = customersNamed(names[0].name);
    return matches.length > 1 ? clarifyFor(transcript, language, intent, names[0].name, resolve) : resolve(matches[0]);
  }

  // RECORD_PAYMENT: "Ramesh ne 200 diye", "Ravi paid 150 upi"
  if (has(/\bdiye\b|\bdiya\b|\bpaid\b|kotta|kottidru|jama|payment|\bmila\b/)) {
    const amount = firstAmountPaise(text);
    if (!names.length) return errorResponse(transcript, language, 'RECORD_PAYMENT', 'CUSTOMER_NOT_FOUND', T.noCustomer);
    if (!amount) return errorResponse(transcript, language, 'RECORD_PAYMENT', 'NOT_UNDERSTOOD', T.notUnderstood);
    const mode: PaymentMode = has(/upi|gpay|phonepe|paytm/) ? 'upi' : 'cash';
    const resolve = (c: MockCustomer): VoiceResponse => {
      const d = storeDraft(language, {
        intent: 'RECORD_PAYMENT', customer: ref(c), items: [], total_paise: amount, payment_mode: mode, paid_paise: amount,
        reverses_entry_id: null, product: null, changes: [], warnings: [],
      });
      const reply = { hi: `${who(d.customer)} se ${formatRupees(amount)} ${MODE_WORD.hi[mode]} mila. ${ASK.hi}`, kn: `${who(d.customer)} ${formatRupees(amount)} ${MODE_WORD.kn[mode]} kottiddare. ${ASK.kn}`, en: `${who(d.customer)} paid ${formatRupees(amount)} by ${mode}. Confirm?` }[l];
      return draftResponse(transcript, language, d, reply);
    };
    const matches = customersNamed(names[0].name);
    return matches.length > 1 ? clarifyFor(transcript, language, 'RECORD_PAYMENT', names[0].name, resolve) : resolve(matches[0]);
  }

  const items = findItems(text);

  // ADD_ITEM: follow-up on the open draft ("aur ek bread")
  if (pendingDraft && items.length && !names.length) {
    const old = pendingDraft.draft;
    const added = toDraftItems(items);
    const d = billDraft(language, 'ADD_ITEM', old.customer, [...old.items, ...added], old.payment_mode, old.draft_id, added.map((i) => `Added: ${formatQty(i.qty)} ${i.name}`));
    return draftResponse(transcript, language, d, billReply(language, d));
  }

  // ADD_PRODUCT: "Add Tata Salt 1 kg", "naya product Ragi 2 kg 55 rupees"
  if (has(/^(add|naya product|new product)\b/) && !names.length) {
    const priceMatch = text.match(/(?:rs|rupees?|rupaye)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:rs|rupees?|rupaye)/);
    const price = priceMatch ? Math.round(Number(priceMatch[1] ?? priceMatch[2]) * 100) : null;
    const rest = text
      .replace(/^(add|naya product|new product)\s*/, '')
      .replace(/(?:rs|rupees?|rupaye)\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:rs|rupees?|rupaye)/, '')
      .trim();
    const qtyUnit = rest.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|g|gram|l|litre|liter|packet|pack|piece|pcs)?\s*$/);
    const name = (qtyUnit ? rest.slice(0, qtyUnit.index) : rest).trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
    if (!name) return errorResponse(transcript, language, 'ADD_PRODUCT', 'NOT_UNDERSTOOD', T.notUnderstood);
    const unitRaw = qtyUnit?.[2] ?? 'pcs';
    const unit = unitRaw === 'kilo' ? 'kg' : unitRaw === 'liter' ? 'litre' : unitRaw === 'pack' ? 'packet' : unitRaw;
    const d = storeDraft(language, {
      intent: 'ADD_PRODUCT', customer: null, items: [], total_paise: 0, payment_mode: 'cash', paid_paise: 0, reverses_entry_id: null,
      product: { name, unit, selling_price_paise: price, opening_stock: qtyUnit ? Number(qtyUnit[1]) : null },
      changes: [],
      warnings: price === null ? [`Price not set for ${name}. You can add it later in Update products.`] : [],
    });
    const reply = {
      hi: `Naya product: ${name}. ${price === null ? 'Daam abhi nahi bataya.' : `Daam ${formatRupees(price)}.`} ${ASK.hi}`,
      kn: `Hosa product: ${name}. ${price === null ? 'Bele innoo heliilla.' : `Bele ${formatRupees(price)}.`} ${ASK.kn}`,
      en: `New product: ${name}. ${price === null ? 'No price yet.' : `Price ${formatRupees(price)}.`} Confirm?`,
    }[l];
    return draftResponse(transcript, language, d, reply);
  }

  // CREATE_BILL
  if (items.length) {
    const draftItems = toDraftItems(items);
    const mode: PaymentMode | undefined = has(/\bcash\b|nagad/) ? 'cash' : has(/\bupi\b|gpay|phonepe|paytm/) ? 'upi' : undefined;
    const build = (c: MockCustomer | null): VoiceResponse => {
      const d = billDraft(language, 'CREATE_BILL', c && ref(c), draftItems, mode);
      return draftResponse(transcript, language, d, billReply(language, d));
    };
    if (!names.length) return build(null);
    const matches = customersNamed(names[0].name);
    return matches.length > 1 ? clarifyFor(transcript, language, 'CREATE_BILL', names[0].name, build) : build(matches[0]);
  }

  return errorResponse(transcript, language, 'UNKNOWN', 'NOT_UNDERSTOOD', T.notUnderstood);
}

// ---------------------------------------------------------------------------
// Mock endpoints
// ---------------------------------------------------------------------------
function wavSeconds(blob: Blob) {
  return Math.max(0, (blob.size - 44) / 32_000);
}

async function command(input: VoiceCommandInput): Promise<VoiceResponse> {
  let text = input.text?.trim();
  if (!text && input.audio) {
    if (input.audio.size > 1_000_000 || wavSeconds(input.audio) > 15.5)
      throw new ApiError('The clip is longer than 15 seconds.', undefined, 'CLIP_TOO_LONG', 413);
    if (input.audio.size <= 44) throw new ApiError("I didn't hear anything.", undefined, 'EMPTY_AUDIO', 422);
    state.usage.seconds += wavSeconds(input.audio);
    state.usage.calls += 1;
    // The mock cannot transcribe audio: it pretends the shopkeeper asked for Ramesh's balance.
    text = 'Ramesh ka kitna baaki hai?';
  }
  if (!text) throw new ApiError('Say something or type a request.', undefined, 'BAD_REQUEST', 400);
  await wait(null);
  return understand(text, input.language, input.draftId);
}

async function choose(clarifyId: string, optionId: string): Promise<VoiceResponse> {
  await wait(null);
  const c = state.clarifies.get(clarifyId);
  const customer = CUSTOMERS.find((x) => x.id === optionId);
  if (!c || !customer) throw new ApiError('That question has expired. Please speak again.', undefined, 'DRAFT_NOT_FOUND', 404);
  state.clarifies.delete(clarifyId);
  return c.resolve(customer);
}

async function confirm(draftId: string): Promise<VoiceConfirmResult> {
  await wait(null);
  const stored = state.drafts.get(draftId);
  if (!stored) throw new ApiError('That draft was not found.', undefined, 'DRAFT_NOT_FOUND', 404);
  if (stored.status !== 'pending') throw new ApiError('This draft is already saved or cancelled.', undefined, 'DRAFT_NOT_PENDING', 409);
  const d = stored.draft;
  if (Date.now() > Date.parse(d.expires_at)) throw new ApiError('This draft expired. Please speak again.', undefined, 'DRAFT_EXPIRED', 410);
  const l = L(stored.language);

  if (d.intent === 'ADD_PRODUCT' && d.product) {
    const product: MockProduct = {
      id: uuid(), name: d.product.name, unit: d.product.unit, price: d.product.selling_price_paise,
      stock: d.product.opening_stock ?? 0, aliases: [d.product.name.toLowerCase()],
    };
    PRODUCTS.push(product);
    stored.status = 'confirmed';
    const summary: ProductSummary = { id: product.id, name: product.name, unit: product.unit, selling_price_paise: product.price, stock_qty: product.stock };
    return {
      status: 'saved', intent: d.intent, entry_id: null, answer: { kind: 'product_added', data: { product: summary } },
      reply_text: { hi: `${product.name} jod diya.`, kn: `${product.name} serisalaayitu.`, en: `${product.name} added.` }[l],
    };
  }

  for (const item of d.items) {
    const p = PRODUCTS.find((x) => x.id === item.product_id);
    if (d.intent !== 'UNDO' && p && item.qty > p.stock)
      throw new ApiError(`Only ${formatQty(p.stock)} ${p.unit} ${p.name} in stock.`, undefined, 'OUT_OF_STOCK', 409);
  }

  let entry: MockEntry;
  const description = d.items.map((i) => `${i.name} ${formatQty(i.qty)} ${i.unit}`).join(', ');
  if (d.intent === 'UNDO' && d.reverses_entry_id) {
    const original = state.ledger.find((e) => e.id === d.reverses_entry_id);
    if (!original || original.reversed) throw new ApiError('This entry is already reversed.', undefined, 'ALREADY_REVERSED', 409);
    original.reversed = true;
    for (const item of original.items) {
      const p = PRODUCTS.find((x) => x.id === item.product_id);
      if (p && original.type === 'sale') p.stock += item.qty;
    }
    entry = {
      id: uuid(), customer_id: original.customer_id, type: 'reversal', amount: original.amount, paid: original.paid, due_delta: -original.due_delta,
      payment_mode: original.payment_mode, description: `Reversal: ${original.description}`, created_at: new Date().toISOString(), items: [],
      reverses: original.id, reversed: false,
    };
  } else if (d.intent === 'RECORD_PAYMENT') {
    entry = {
      id: uuid(), customer_id: d.customer?.id ?? null, type: 'payment', amount: d.total_paise, paid: d.total_paise, due_delta: -d.total_paise,
      payment_mode: d.payment_mode, description: `${d.payment_mode === 'upi' ? 'UPI' : 'Cash'} payment`, created_at: new Date().toISOString(),
      items: [], reverses: null, reversed: false,
    };
  } else {
    for (const item of d.items) {
      const p = PRODUCTS.find((x) => x.id === item.product_id);
      if (p) p.stock -= item.qty;
    }
    entry = {
      id: uuid(), customer_id: d.customer?.id ?? null, type: 'sale', amount: d.total_paise, paid: d.paid_paise,
      due_delta: d.customer ? d.total_paise - d.paid_paise : 0, payment_mode: d.payment_mode, description, created_at: new Date().toISOString(),
      items: d.items, reverses: null, reversed: false,
    };
  }
  state.ledger.push(entry);
  stored.status = 'confirmed';
  if (entry.type !== 'reversal') state.lastSavedEntryId = entry.id;

  const balance = entry.customer_id ? balanceOf(entry.customer_id) : null;
  const name = d.customer ? who(d.customer) : null;
  const reply =
    balance === null || !name
      ? { hi: 'Save ho gaya.', kn: 'Save aaytu.', en: 'Saved.' }[l]
      : {
          hi: `Save ho gaya. ${name} ka naya baaki ${formatRupees(balance)}.`,
          kn: `Save aaytu. ${name} avara hosa baaki ${formatRupees(balance)}.`,
          en: `Saved. ${name} now owes ${formatRupees(balance)}.`,
        }[l];
  return { status: 'saved', intent: d.intent, entry_id: entry.id, reply_text: reply, answer: null };
}

async function cancel(draftId: string): Promise<VoiceCancelResult> {
  await wait(null, 200);
  const stored = state.drafts.get(draftId);
  if (!stored) throw new ApiError('That draft was not found.', undefined, 'DRAFT_NOT_FOUND', 404);
  if (stored.status === 'pending') stored.status = 'cancelled';
  return { status: 'cancelled', draft_id: draftId };
}

async function undo(entryId: string, language: VoiceLanguage): Promise<VoiceResponse> {
  await wait(null);
  return undoDraft('', language, entryId);
}

async function speak(text: string): Promise<Blob> {
  state.usage.ttsChars += text.length;
  // No server voice in mock mode: the screen falls back to the browser's speechSynthesis.
  throw new ApiError('Mock mode has no server voice.', undefined, 'GNANI_UNAVAILABLE', 503);
}

async function usage(): Promise<VoiceUsage> {
  const limit = 600;
  const used = Math.round(state.usage.seconds * 10) / 10;
  return wait({
    date: new Date().toISOString().slice(0, 10),
    seconds_used: used,
    daily_limit_seconds: limit,
    seconds_left: Math.max(0, limit - used),
    calls_today: state.usage.calls,
    tts_characters_today: state.usage.ttsChars,
  }, 150);
}

export const voiceMock = { command, choose, confirm, cancel, undo, speak, usage };
