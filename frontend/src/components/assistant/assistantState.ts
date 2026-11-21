/**
 * AI assistant state machine.
 *   idle → recording → sending → (clarify) → confirming → saving → saved
 * plus `error`. Everything the feed shows is a list of cards (newest last).
 */
import type {
  ReminderTone,
  VoiceAnswer,
  VoiceClarify,
  VoiceConfirmResult,
  VoiceDraft,
  VoiceLanguage,
  VoiceResponse,
} from '../../types/voice';

export type Phase = 'idle' | 'recording' | 'sending' | 'clarify' | 'confirming' | 'saving' | 'saved' | 'error';

export type DraftCardState = 'open' | 'saving' | 'saved' | 'cancelled' | 'replaced' | 'expired';

/** available → pending (asking) → offered (reversal draft shown) → reversed; or none (nothing to undo). */
export type UndoState = 'available' | 'pending' | 'offered' | 'reversed' | 'none';

export type Card =
  | { id: string; kind: 'heard'; text: string; language: VoiceLanguage }
  | { id: string; kind: 'clarify'; clarify: VoiceClarify; reply: string; chosen: string | null; open: boolean }
  | { id: string; kind: 'draft'; draft: VoiceDraft; reply: string; state: DraftCardState }
  | { id: string; kind: 'saved'; result: VoiceConfirmResult; draft: VoiceDraft; undo: UndoState }
  | { id: string; kind: 'answer'; answer: VoiceAnswer; reply: string; tone: ReminderTone }
  | { id: string; kind: 'cancelled' }
  | { id: string; kind: 'error'; code: string; message: string; reply: string | null };

export interface AssistantState {
  phase: Phase;
  cards: Card[];
  /** The open draft, sent as draft_id with follow-ups ("aur ek bread", "Ravi alla, Ramesh"). */
  activeDraftId: string | null;
  secondsLeft: number;
  partialText: string;
}

export type Action =
  | { type: 'RECORD_START'; seconds: number }
  | { type: 'TICK'; secondsLeft: number }
  | { type: 'PARTIAL'; text: string }
  | { type: 'SEND_START' }
  | { type: 'RECORD_ABORT' }
  | { type: 'RESPONSE'; response: VoiceResponse; showHeard: boolean; clarifyCardId?: string; chosenLabel?: string }
  | { type: 'CONFIRM_START'; cardId: string }
  | { type: 'CONFIRM_DONE'; cardId: string; result: VoiceConfirmResult }
  | { type: 'CONFIRM_FAILED'; cardId: string; code: string; message: string; expired: boolean }
  | { type: 'CANCEL_DONE'; cardId: string }
  | { type: 'UNDO_START'; cardId: string }
  | { type: 'UNDO_FAILED'; cardId: string; code: string; message: string }
  | { type: 'DRAFT_EXPIRED'; cardId: string }
  | { type: 'SET_TONE'; cardId: string; tone: ReminderTone }
  | { type: 'ERROR'; code: string; message: string }
  | { type: 'DISMISS_ERRORS' };

export const initialState: AssistantState = { phase: 'idle', cards: [], activeDraftId: null, secondsLeft: 0, partialText: '' };

let counter = 0;
const nextId = () => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Close any open draft/clarify cards: they are superseded by the newer card. */
function closeOpen(cards: Card[]): Card[] {
  return cards.map((c) => {
    if (c.kind === 'draft' && c.state === 'open') return { ...c, state: 'replaced' };
    if (c.kind === 'clarify' && c.open) return { ...c, open: false };
    return c;
  });
}

/** Update the saved card of the entry a reversal draft points to. */
function setUndo(cards: Card[], entryId: string | null | undefined, undo: UndoState): Card[] {
  if (!entryId) return cards;
  return cards.map((c) => (c.kind === 'saved' && c.result.entry_id === entryId ? { ...c, undo } : c));
}

function phaseAfter(response: VoiceResponse): Phase {
  switch (response.status) {
    case 'draft':
      return 'confirming';
    case 'clarify':
      return 'clarify';
    case 'answer':
      return 'idle';
    default:
      return 'error';
  }
}

export function reducer(state: AssistantState, action: Action): AssistantState {
  switch (action.type) {
    case 'RECORD_START':
      return { ...state, phase: 'recording', secondsLeft: action.seconds, partialText: '' };
    case 'TICK':
      return { ...state, secondsLeft: action.secondsLeft };
    case 'PARTIAL':
      return { ...state, partialText: action.text };
    case 'SEND_START':
      return { ...state, phase: 'sending', partialText: '' };
    case 'RECORD_ABORT':
      return { ...state, phase: state.activeDraftId ? 'confirming' : 'idle', partialText: '' };

    case 'RESPONSE': {
      const r = action.response;
      let cards = state.cards;
      if (action.clarifyCardId)
        cards = cards.map((c) => (c.id === action.clarifyCardId && c.kind === 'clarify' ? { ...c, open: false, chosen: action.chosenLabel ?? null } : c));
      const added: Card[] = [];
      if (action.showHeard && r.transcript) added.push({ id: nextId(), kind: 'heard', text: r.transcript, language: r.language });
      let activeDraftId = state.activeDraftId;
      if (r.status === 'draft' && r.draft) {
        cards = closeOpen(cards);
        if (r.draft.intent === 'UNDO') cards = setUndo(cards, r.draft.reverses_entry_id, 'offered');
        added.push({ id: nextId(), kind: 'draft', draft: r.draft, reply: r.reply_text, state: 'open' });
        activeDraftId = r.draft.draft_id;
      } else if (r.status === 'clarify' && r.clarify) {
        cards = cards.map((c) => (c.kind === 'clarify' && c.open ? { ...c, open: false } : c));
        added.push({ id: nextId(), kind: 'clarify', clarify: r.clarify, reply: r.reply_text, chosen: null, open: true });
      } else if (r.status === 'answer' && r.answer) {
        const tone = r.answer.kind === 'reminder' ? r.answer.data.tone : 'soft';
        added.push({ id: nextId(), kind: 'answer', answer: r.answer, reply: r.reply_text, tone });
      } else {
        added.push({ id: nextId(), kind: 'error', code: r.error?.code ?? 'NOT_UNDERSTOOD', message: r.error?.message ?? '', reply: r.reply_text || null });
      }
      // An answer or error keeps an open bill open (the shopkeeper can still confirm it).
      const phase = r.status === 'answer' || r.status === 'error' ? (activeDraftId ? 'confirming' : phaseAfter(r)) : phaseAfter(r);
      return { ...state, cards: [...cards, ...added], activeDraftId, phase, partialText: '' };
    }

    case 'CONFIRM_START':
      return {
        ...state,
        phase: 'saving',
        cards: state.cards.map((c) => (c.id === action.cardId && c.kind === 'draft' ? { ...c, state: 'saving' } : c)),
      };
    case 'CONFIRM_DONE': {
      const card = state.cards.find((c) => c.id === action.cardId);
      if (!card || card.kind !== 'draft') return state;
      const canUndo = !!action.result.entry_id && card.draft.intent !== 'UNDO';
      const cards = card.draft.intent === 'UNDO' ? setUndo(state.cards, card.draft.reverses_entry_id, 'reversed') : state.cards;
      return {
        ...state,
        phase: 'saved',
        activeDraftId: null,
        cards: [
          ...cards.map((c) => (c.id === action.cardId && c.kind === 'draft' ? { ...c, state: 'saved' as const } : c)),
          { id: nextId(), kind: 'saved', result: action.result, draft: card.draft, undo: canUndo ? 'available' : 'none' },
        ],
      };
    }
    case 'CONFIRM_FAILED':
      return {
        ...state,
        phase: 'error',
        activeDraftId: action.expired ? null : state.activeDraftId,
        cards: [
          ...state.cards.map((c) =>
            c.id === action.cardId && c.kind === 'draft' ? { ...c, state: action.expired ? ('expired' as const) : ('open' as const) } : c,
          ),
          { id: nextId(), kind: 'error', code: action.code, message: action.message, reply: null },
        ],
      };
    case 'CANCEL_DONE': {
      const card = state.cards.find((c) => c.id === action.cardId);
      const cards = card?.kind === 'draft' && card.draft.intent === 'UNDO' ? setUndo(state.cards, card.draft.reverses_entry_id, 'available') : state.cards;
      return {
        ...state,
        phase: 'idle',
        activeDraftId: null,
        cards: [
          ...cards.map((c) => (c.id === action.cardId && c.kind === 'draft' ? { ...c, state: 'cancelled' as const } : c)),
          { id: nextId(), kind: 'cancelled' },
        ],
      };
    }
    case 'UNDO_START':
      return { ...state, phase: 'sending', cards: state.cards.map((c) => (c.id === action.cardId && c.kind === 'saved' ? { ...c, undo: 'pending' } : c)) };
    case 'UNDO_FAILED':
      return {
        ...state,
        phase: 'error',
        cards: [
          ...state.cards.map((c) => (c.id === action.cardId && c.kind === 'saved' ? { ...c, undo: 'available' as const } : c)),
          { id: nextId(), kind: 'error', code: action.code, message: action.message, reply: null },
        ],
      };
    case 'DRAFT_EXPIRED':
      return {
        ...state,
        phase: state.phase === 'confirming' ? 'idle' : state.phase,
        activeDraftId: state.cards.some((c) => c.id === action.cardId && c.kind === 'draft' && c.draft.draft_id === state.activeDraftId)
          ? null
          : state.activeDraftId,
        cards: state.cards.map((c) => (c.id === action.cardId && c.kind === 'draft' && c.state === 'open' ? { ...c, state: 'expired' } : c)),
      };
    case 'SET_TONE':
      return { ...state, cards: state.cards.map((c) => (c.id === action.cardId && c.kind === 'answer' ? { ...c, tone: action.tone } : c)) };
    case 'ERROR':
      return {
        ...state,
        phase: 'error',
        partialText: '',
        cards: [...state.cards, { id: nextId(), kind: 'error', code: action.code, message: action.message, reply: null }],
      };
    case 'DISMISS_ERRORS':
      return { ...state, phase: state.activeDraftId ? 'confirming' : 'idle' };
    default:
      return state;
  }
}
