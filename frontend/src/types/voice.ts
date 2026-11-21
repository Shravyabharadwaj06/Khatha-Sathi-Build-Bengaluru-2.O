/**
 * Voice API contract types. Source of truth: docs/VOICE_CONTRACT.md.
 * All money is integer paise; the UI only formats it as ₹.
 */

export type VoiceLanguage = 'hi-IN' | 'kn-IN' | 'en-IN';

export type VoiceStatus = 'draft' | 'clarify' | 'answer' | 'error';

export type VoiceIntent =
  | 'CREATE_BILL'
  | 'ADD_ITEM'
  | 'CORRECT_CUSTOMER'
  | 'RECORD_PAYMENT'
  | 'SHOW_BALANCE'
  | 'EXPLAIN_BALANCE'
  | 'SHOW_HISTORY'
  | 'SEND_REMINDER'
  | 'ADD_PRODUCT'
  | 'UNDO'
  | 'UNKNOWN';

export type PaymentMode = 'udhaar' | 'cash' | 'upi' | 'partial';

export interface CustomerRef {
  id: string;
  name: string;
  locality: string | null;
}

export interface DraftItem {
  product_id: string | null;
  name: string;
  qty: number;
  unit: string;
  unit_price_paise: number | null;
  line_total_paise: number | null;
  conversion_note: string | null;
}

export interface ProductDraft {
  name: string;
  unit: string;
  selling_price_paise: number | null;
  opening_stock: number | null;
}

export interface VoiceDraft {
  draft_id: string;
  intent: VoiceIntent;
  customer: CustomerRef | null;
  items: DraftItem[];
  total_paise: number;
  payment_mode: PaymentMode;
  paid_paise: number;
  expires_at: string;
  reverses_entry_id: string | null;
  product: ProductDraft | null;
  changes: string[];
  warnings: string[];
}

export interface ClarifyOption {
  id: string;
  label: string;
  detail: string;
}

export interface VoiceClarify {
  clarify_id: string;
  kind: 'customer' | 'product';
  question: string;
  options: ClarifyOption[];
}

export interface BalanceData {
  customer: CustomerRef;
  balance_paise: number;
  last_entry_at: string | null;
}

export interface ExplainEntry {
  entry_id: string;
  created_at: string;
  type: string;
  description: string;
  due_delta_paise: number;
}

export interface ExplainData {
  customer: CustomerRef;
  entries: ExplainEntry[];
  total_paise: number;
  balance_paise: number;
}

export interface HistoryEntry {
  entry_id: string;
  created_at: string;
  type: string;
  description: string;
  amount_paise: number;
  due_delta_paise: number;
  running_balance_paise: number;
}

export interface HistoryData {
  customer: CustomerRef;
  entries: HistoryEntry[];
  balance_paise: number;
}

export type ReminderTone = 'soft' | 'firm';

export interface ReminderVariant {
  tone: ReminderTone;
  message_text: string;
  whatsapp_url: string | null;
}

export interface ReminderData extends ReminderVariant {
  customer: CustomerRef;
  balance_paise: number;
  phone: string | null;
  alternatives: ReminderVariant[];
}

export interface ProductSummary {
  id: string;
  name: string;
  unit: string;
  selling_price_paise: number | null;
  stock_qty: number;
}

export type VoiceAnswer =
  | { kind: 'balance'; data: BalanceData }
  | { kind: 'explain'; data: ExplainData }
  | { kind: 'history'; data: HistoryData }
  | { kind: 'reminder'; data: ReminderData }
  | { kind: 'product_added'; data: { product: ProductSummary } };

export interface VoiceErrorBody {
  code: VoiceErrorCode | string;
  message: string;
}

export type VoiceErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'CLIP_TOO_LONG'
  | 'UNSUPPORTED_AUDIO'
  | 'EMPTY_AUDIO'
  | 'GNANI_BUSY'
  | 'RATE_LIMITED'
  | 'DAILY_LIMIT_REACHED'
  | 'GNANI_UNAVAILABLE'
  | 'GNANI_TIMEOUT'
  | 'DRAFT_NOT_FOUND'
  | 'DRAFT_NOT_PENDING'
  | 'DRAFT_EXPIRED'
  | 'ENTRY_NOT_FOUND'
  | 'ALREADY_REVERSED'
  | 'OUT_OF_STOCK'
  | 'NOT_UNDERSTOOD'
  | 'CUSTOMER_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'NO_OPEN_DRAFT'
  | 'NOTHING_TO_UNDO'
  | 'PAYMENT_MORE_THAN_DUE'
  | 'NOTHING_DUE'
  | 'INTERNAL'
  // frontend-only codes (never sent by the backend)
  | 'MIC_UNSUPPORTED'
  | 'MIC_DENIED'
  | 'NETWORK';

export interface VoiceResponse {
  transcript: string;
  language: VoiceLanguage;
  status: VoiceStatus;
  intent: VoiceIntent;
  draft: VoiceDraft | null;
  clarify: VoiceClarify | null;
  answer: VoiceAnswer | null;
  reply_text: string;
  error: VoiceErrorBody | null;
}

export interface VoiceConfirmResult {
  status: 'saved';
  intent: VoiceIntent;
  entry_id: string | null;
  reply_text: string;
  answer: VoiceAnswer | null;
}

export interface VoiceCancelResult {
  status: 'cancelled';
  draft_id: string;
}

export interface VoiceUsage {
  date: string;
  seconds_used: number;
  daily_limit_seconds: number;
  seconds_left: number;
  calls_today: number;
  tts_characters_today: number;
}

export interface VoiceCommandInput {
  language: VoiceLanguage;
  /** Recorded clip (WAV 16 kHz mono). Ignored if `text` is given. */
  audio?: Blob;
  /** Typed text or browser speech-recognition text. */
  text?: string;
  draftId?: string;
}
