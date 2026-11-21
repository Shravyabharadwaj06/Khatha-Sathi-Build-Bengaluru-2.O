import type { ReactNode } from 'react';
import type { Card } from './assistantState';
import type { PaymentMode, ReminderTone, VoiceAnswer, VoiceDraft } from '../../types/voice';
import { formatQty, formatRupees } from '../../utils/money';

const Icon = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined va-icon" aria-hidden="true">
    {name}
  </span>
);

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const customerLabel = (c: { name: string; locality: string | null } | null) => (c ? `${c.name}${c.locality ? ` · ${c.locality}` : ''}` : 'Cash sale (walk-in)');

const MODE_LABEL: Record<PaymentMode, string> = { udhaar: 'Udhaar', cash: 'Cash', upi: 'UPI', partial: 'Part paid' };

function ModeChip({ mode, paid }: { mode: PaymentMode; paid: number }) {
  const credit = mode === 'udhaar' || mode === 'partial';
  return (
    <span className={`va-chip ${credit ? 'va-chip-peach' : 'va-chip-blue'}`} data-testid="mode-chip">
      {MODE_LABEL[mode]}
      {mode === 'partial' ? ` · paid ${formatRupees(paid)}` : ''}
    </span>
  );
}

function CardShell({ icon, title, tone = 'white', aside, children, testId }: { icon: string; title: string; tone?: 'white' | 'blue' | 'peach' | 'lav' | 'error'; aside?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <article className={`va-card va-card-${tone}`} data-testid={testId}>
      <header className="va-card-head">
        <h2>
          <Icon name={icon} />
          <span>{title}</span>
        </h2>
        {aside}
      </header>
      <div className="va-card-body">{children}</div>
    </article>
  );
}

// ---------------------------------------------------------------------------

export function HeardCard({ text, onRetry, disabled }: { text: string; onRetry: () => void; disabled: boolean }) {
  return (
    <article className="va-heard" data-testid="card-heard">
      <Icon name="hearing" />
      <p className="va-eyebrow">I heard</p>
      <p className="va-transcript">“{text}”</p>
      <button type="button" className="va-link" onClick={onRetry} disabled={disabled}>
        Not right? Speak again
      </button>
    </article>
  );
}

export function ClarifyCard({ card, onChoose, disabled }: { card: Extract<Card, { kind: 'clarify' }>; onChoose: (optionId: string, label: string) => void; disabled: boolean }) {
  return (
    <CardShell icon="help" title="Which one?" testId="card-clarify">
      <p className="va-question">{card.clarify.question}</p>
      {card.open ? (
        <div className="va-options">
          {card.clarify.options.map((o) => (
            <button key={o.id} type="button" className="va-btn va-btn-outline va-option" disabled={disabled} onClick={() => onChoose(o.id, `${o.label} – ${o.detail}`)}>
              <strong>{o.label}</strong>
              <span>{o.detail}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="va-muted">{card.chosen ? `You chose: ${card.chosen}` : 'Answered'}</p>
      )}
    </CardShell>
  );
}

function draftTitle(d: VoiceDraft) {
  switch (d.intent) {
    case 'RECORD_PAYMENT':
      return { icon: 'payments', title: 'Payment' };
    case 'ADD_PRODUCT':
      return { icon: 'add_box', title: 'New product' };
    case 'UNDO':
      return { icon: 'undo', title: 'Undo (reversal)' };
    default:
      return { icon: 'receipt_long', title: 'Bill' };
  }
}

function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function DraftCard({
  card,
  now,
  busy,
  onConfirm,
  onEdit,
  onCancel,
}: {
  card: Extract<Card, { kind: 'draft' }>;
  now: number;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const d = card.draft;
  const { icon, title } = draftTitle(d);
  const open = card.state === 'open' || card.state === 'saving';
  const msLeft = Date.parse(d.expires_at) - now;
  const statusText: Record<string, string> = {
    saved: 'Saved',
    cancelled: 'Cancelled',
    replaced: 'Updated below',
    expired: 'Expired. Speak again to make a new one.',
  };
  return (
    <CardShell
      icon={icon}
      title={title}
      tone={d.intent === 'UNDO' ? 'peach' : 'white'}
      testId="card-draft"
      aside={d.intent === 'ADD_PRODUCT' ? undefined : <ModeChip mode={d.payment_mode} paid={d.paid_paise} />}
    >
      {d.intent !== 'ADD_PRODUCT' && (
        <p className="va-customer" data-testid="draft-customer">
          <Icon name="person" />
          {customerLabel(d.customer)}
        </p>
      )}
      {d.intent === 'UNDO' && <p className="va-note">This adds a reversal entry. The original entry is kept in the khata.</p>}

      {d.product && (
        <dl className="va-rows">
          <div className="va-row">
            <dt>Name</dt>
            <dd>{d.product.name}</dd>
          </div>
          <div className="va-row">
            <dt>Unit</dt>
            <dd>{d.product.unit}</dd>
          </div>
          <div className="va-row">
            <dt>Selling price</dt>
            <dd data-testid="product-price">{d.product.selling_price_paise === null ? 'Not set' : formatRupees(d.product.selling_price_paise)}</dd>
          </div>
          {d.product.opening_stock !== null && (
            <div className="va-row">
              <dt>Opening stock</dt>
              <dd>
                {formatQty(d.product.opening_stock)} {d.product.unit}
              </dd>
            </div>
          )}
        </dl>
      )}

      {d.items.length > 0 && (
        <ul className="va-items" aria-label="Items">
          {d.items.map((item, i) => (
            <li key={`${item.product_id ?? item.name}-${i}`} className="va-item">
              <div className="va-item-main">
                <span className="va-item-name">{item.name}</span>
                <span className="va-item-qty">
                  {formatQty(item.qty)} {item.unit}
                  {item.unit_price_paise !== null ? ` × ${formatRupees(item.unit_price_paise)}` : ''}
                </span>
                {item.conversion_note && <span className="va-item-note">{item.conversion_note}</span>}
              </div>
              <span className="va-money">{item.line_total_paise === null ? 'No price' : formatRupees(item.line_total_paise)}</span>
            </li>
          ))}
        </ul>
      )}

      {d.intent !== 'ADD_PRODUCT' && (
        <p className="va-total">
          <span>{d.intent === 'RECORD_PAYMENT' ? 'Amount received' : d.intent === 'UNDO' ? 'Amount reversed' : 'Total'}</span>
          <strong data-testid="draft-total">{formatRupees(d.total_paise)}</strong>
        </p>
      )}

      {d.changes.length > 0 && (
        <ul className="va-changes" data-testid="draft-changes">
          {d.changes.map((c) => (
            <li key={c}>
              <Icon name="edit" />
              {c}
            </li>
          ))}
        </ul>
      )}
      {d.warnings.length > 0 && (
        <ul className="va-warnings" data-testid="draft-warnings">
          {d.warnings.map((w) => (
            <li key={w}>
              <Icon name="warning" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {card.reply && open && <p className="va-reply">{card.reply}</p>}

      {open ? (
        <>
          <p className="va-expiry" aria-live="off">
            Waiting for you to confirm · expires in <span data-testid="draft-expiry">{countdown(msLeft)}</span>
          </p>
          <div className="va-actions">
            <button type="button" className="va-btn va-btn-primary va-btn-wide" onClick={onConfirm} disabled={busy} data-testid="confirm">
              <Icon name="check" />
              {card.state === 'saving' ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" className="va-btn va-btn-outline" onClick={onEdit} disabled={busy} data-testid="edit">
              <Icon name="mic" />
              Edit
            </button>
            <button type="button" className="va-btn va-btn-outline" onClick={onCancel} disabled={busy} data-testid="cancel">
              <Icon name="close" />
              Cancel
            </button>
          </div>
        </>
      ) : (
        <p className="va-muted" data-testid="draft-state">
          {statusText[card.state]}
        </p>
      )}
    </CardShell>
  );
}

export function SavedCard({ card, onUndo, busy }: { card: Extract<Card, { kind: 'saved' }>; onUndo: () => void; busy: boolean }) {
  const d = card.draft;
  const product = card.result.answer?.kind === 'product_added' ? card.result.answer.data.product : null;
  const summary = product
    ? `${product.name} · ${product.selling_price_paise === null ? 'price not set' : formatRupees(product.selling_price_paise)}`
    : d.intent === 'UNDO'
      ? `Reversal of ${formatRupees(d.total_paise)} · ${customerLabel(d.customer)}`
      : `${customerLabel(d.customer)} · ${formatRupees(d.total_paise)} ${d.intent === 'RECORD_PAYMENT' ? 'received' : MODE_LABEL[d.payment_mode].toLowerCase()}`;
  return (
    <CardShell icon="check_circle" title="Saved ✅" tone="blue" testId="card-saved">
      <p className="va-strong">{summary}</p>
      {card.result.reply_text && <p className="va-reply">{card.result.reply_text}</p>}
      {card.undo === 'available' && (
        <button type="button" className="va-btn va-btn-outline" onClick={onUndo} disabled={busy} data-testid="undo">
          <Icon name="undo" />
          Undo
        </button>
      )}
      {card.undo === 'pending' && <p className="va-muted">Preparing the undo…</p>}
      {card.undo === 'offered' && <p className="va-muted">Confirm the reversal below to undo this.</p>}
      {card.undo === 'reversed' && (
        <p className="va-muted" data-testid="reversed">
          Reversed. Both entries stay in the khata.
        </p>
      )}
    </CardShell>
  );
}

function SignedMoney({ paise }: { paise: number }) {
  return <span className={`va-money ${paise < 0 ? 'va-minus' : ''}`}>{paise < 0 ? `− ${formatRupees(-paise)}` : `+ ${formatRupees(paise)}`}</span>;
}

export function AnswerCard({ card, onTone }: { card: Extract<Card, { kind: 'answer' }>; onTone: (tone: ReminderTone) => void }) {
  const a: VoiceAnswer = card.answer;
  if (a.kind === 'balance') {
    const due = a.data.balance_paise;
    return (
      <CardShell icon="account_balance_wallet" title="Balance" tone={due > 0 ? 'peach' : 'blue'} testId="card-balance">
        <p className="va-customer">
          <Icon name="person" />
          {customerLabel(a.data.customer)}
        </p>
        <p className="va-big" data-testid="balance-amount">
          {formatRupees(Math.abs(due))}
        </p>
        <p className="va-muted">
          {due > 0 ? 'to collect (udhaar)' : due < 0 ? 'paid in advance' : 'Nothing due'}
          {a.data.last_entry_at ? ` · last entry ${shortDate(a.data.last_entry_at)}` : ''}
        </p>
      </CardShell>
    );
  }
  if (a.kind === 'explain') {
    const sum = a.data.entries.map((e, i) => `${i === 0 ? (e.due_delta_paise < 0 ? '− ' : '') : e.due_delta_paise < 0 ? ' − ' : ' + '}${formatRupees(Math.abs(e.due_delta_paise))}`).join('');
    const matches = a.data.total_paise === a.data.balance_paise;
    return (
      <CardShell icon="calculate" title="How the balance adds up" testId="card-explain">
        <p className="va-customer">
          <Icon name="person" />
          {customerLabel(a.data.customer)}
        </p>
        <ul className="va-ledger">
          {a.data.entries.map((e) => (
            <li key={e.entry_id} className="va-ledger-row">
              <span className="va-date">{shortDate(e.created_at)}</span>
              <span className="va-desc">
                <strong>{e.type === 'payment' ? 'Payment' : e.type === 'reversal' ? 'Reversal' : 'Udhaar'}</strong> {e.description}
              </span>
              <SignedMoney paise={e.due_delta_paise} />
            </li>
          ))}
        </ul>
        <p className="va-sum" data-testid="explain-sum">
          {sum} = <strong>{formatRupees(a.data.total_paise)}</strong>
        </p>
        <p className={matches ? 'va-ok' : 'va-bad'}>{matches ? 'Matches the balance ✓' : 'Does not match the balance. Please check.'}</p>
      </CardShell>
    );
  }
  if (a.kind === 'history') {
    return (
      <CardShell icon="history" title="Khata history" testId="card-history">
        <p className="va-customer">
          <Icon name="person" />
          {customerLabel(a.data.customer)}
        </p>
        <ol className="va-timeline">
          {a.data.entries.map((e) => (
            <li key={e.entry_id} className="va-ledger-row">
              <span className="va-date">{shortDate(e.created_at)}</span>
              <span className="va-desc">{e.description}</span>
              <span className="va-col">
                <SignedMoney paise={e.due_delta_paise} />
                <span className="va-running">bal {formatRupees(e.running_balance_paise)}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="va-total">
          <span>Balance now</span>
          <strong>{formatRupees(a.data.balance_paise)}</strong>
        </p>
      </CardShell>
    );
  }
  if (a.kind === 'reminder') {
    const variants = [a.data, ...a.data.alternatives];
    const current = variants.find((v) => v.tone === card.tone) ?? a.data;
    return (
      <CardShell icon="chat" title="Payment reminder" tone="white" testId="card-reminder" aside={<span className="va-chip va-chip-peach">{formatRupees(a.data.balance_paise)} due</span>}>
        <p className="va-customer">
          <Icon name="person" />
          {customerLabel(a.data.customer)}
        </p>
        <div className="va-segment" role="group" aria-label="Reminder tone">
          {(['soft', 'firm'] as const).map((t) => (
            <button key={t} type="button" className="va-segment-btn" aria-pressed={card.tone === t} onClick={() => onTone(t)} data-testid={`tone-${t}`}>
              {t === 'soft' ? 'Soft' : 'Firm'}
            </button>
          ))}
        </div>
        <blockquote className="va-message" data-testid="reminder-text">
          {current.message_text}
        </blockquote>
        {current.whatsapp_url ? (
          <a className="va-btn va-btn-accent va-btn-wide" href={current.whatsapp_url} target="_blank" rel="noopener noreferrer" data-testid="whatsapp">
            <Icon name="send" />
            Open WhatsApp
          </a>
        ) : (
          <p className="va-muted">No phone number saved for {a.data.customer.name}.</p>
        )}
        <p className="va-muted">Nothing is sent automatically. You press Send in WhatsApp.</p>
      </CardShell>
    );
  }
  const p = a.data.product;
  return (
    <CardShell icon="inventory_2" title="Product added" tone="blue" testId="card-product">
      <p className="va-strong">{p.name}</p>
      <p className="va-muted">
        {formatQty(p.stock_qty)} {p.unit} in stock · {p.selling_price_paise === null ? 'price not set' : formatRupees(p.selling_price_paise)}
      </p>
    </CardShell>
  );
}

export function CancelledCard() {
  return (
    <CardShell icon="block" title="Cancelled" testId="card-cancelled">
      <p className="va-muted">Nothing was saved.</p>
    </CardShell>
  );
}

const ERROR_COPY: Record<string, { title: string; help: string; offerFallback?: boolean; retry?: boolean; examples?: boolean }> = {
  GNANI_BUSY: { title: 'Chotu is busy', help: 'Chotu is busy, try again in a second.', retry: true },
  RATE_LIMITED: { title: 'Too many requests', help: 'Slow down a little, then try again.', retry: true },
  DAILY_LIMIT_REACHED: { title: "Today's voice limit is reached", help: 'Type your request, or use the browser voice instead.', offerFallback: true },
  GNANI_UNAVAILABLE: { title: 'Voice service is down', help: 'Use the browser voice or type instead.', offerFallback: true },
  GNANI_TIMEOUT: { title: 'Voice service is slow', help: 'Try again, or use the browser voice or typing.', offerFallback: true, retry: true },
  UNSUPPORTED_AUDIO: { title: 'Could not use this recording', help: 'Use the browser voice or type instead.', offerFallback: true },
  MIC_UNSUPPORTED: { title: 'Microphone not available', help: 'This phone or browser cannot record here. Use the browser voice or type.', offerFallback: true },
  MIC_DENIED: { title: 'Microphone is blocked', help: 'Allow the microphone in your browser settings, or type instead.', offerFallback: true },
  NETWORK: { title: 'No connection', help: 'Check the internet and try again.', retry: true },
  CLIP_TOO_LONG: { title: 'Too long', help: 'Keep it under 15 seconds.' },
  EMPTY_AUDIO: { title: "I didn't hear anything", help: 'Hold the phone a little closer and speak again.' },
  NOT_UNDERSTOOD: { title: "I didn't understand", help: 'Try saying it like one of these:', examples: true },
  CUSTOMER_NOT_FOUND: { title: 'Which customer?', help: 'Say the customer name too.' },
  PRODUCT_NOT_FOUND: { title: 'Product not found', help: 'Say the product name again, or add it first.' },
  NO_OPEN_DRAFT: { title: 'No open bill', help: 'Say the bill first, then change it.' },
  NOTHING_TO_UNDO: { title: 'Nothing to undo', help: 'There is no saved entry to undo.' },
  PAYMENT_MORE_THAN_DUE: { title: 'More than the due amount', help: 'Check the amount and say it again.' },
  NOTHING_DUE: { title: 'Nothing is due', help: 'This customer has no pending amount.' },
  DRAFT_EXPIRED: { title: 'This draft expired', help: 'Nothing was saved. Speak again to make a new one.' },
  DRAFT_NOT_FOUND: { title: 'Draft not found', help: 'Nothing was saved. Speak again.' },
  DRAFT_NOT_PENDING: { title: 'Already done', help: 'This draft was already saved or cancelled.' },
  ALREADY_REVERSED: { title: 'Already reversed', help: 'This entry was already undone.' },
  ENTRY_NOT_FOUND: { title: 'Entry not found', help: 'That entry could not be found.' },
  OUT_OF_STOCK: { title: 'Not enough stock', help: 'Change the quantity and try again.' },
  UNAUTHORIZED: { title: 'Please log in again', help: 'Your session has ended.' },
};

export function ErrorCard({
  card,
  canBrowserVoice,
  examples,
  onRetry,
  onBrowserVoice,
  onType,
  onExample,
  onLogin,
  busy,
}: {
  card: Extract<Card, { kind: 'error' }>;
  canBrowserVoice: boolean;
  examples: string[];
  onRetry: (() => void) | null;
  onBrowserVoice: () => void;
  onType: () => void;
  onExample: (text: string) => void;
  onLogin: () => void;
  busy: boolean;
}) {
  const copy = ERROR_COPY[card.code] ?? { title: 'Something went wrong', help: card.message || 'Please try again.', retry: true };
  return (
    <CardShell icon="error" title={copy.title} tone="error" testId={`card-error-${card.code}`}>
      <p>{card.reply ?? copy.help}</p>
      {card.reply && card.reply !== copy.help && <p className="va-muted">{copy.help}</p>}
      {copy.examples && (
        <div className="va-chips">
          {examples.slice(0, 3).map((e) => (
            <button key={e} type="button" className="va-chip va-chip-lav va-chip-btn" onClick={() => onExample(e)} disabled={busy}>
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="va-actions">
        {copy.retry && onRetry && (
          <button type="button" className="va-btn va-btn-outline" onClick={onRetry} disabled={busy} data-testid="retry">
            <Icon name="refresh" />
            Try again
          </button>
        )}
        {copy.offerFallback && canBrowserVoice && (
          <button type="button" className="va-btn va-btn-outline" onClick={onBrowserVoice} disabled={busy} data-testid="use-browser-voice">
            <Icon name="record_voice_over" />
            Use browser voice
          </button>
        )}
        {copy.offerFallback && (
          <button type="button" className="va-btn va-btn-outline" onClick={onType} disabled={busy} data-testid="type-instead">
            <Icon name="keyboard" />
            Type instead
          </button>
        )}
        {card.code === 'UNAUTHORIZED' && (
          <button type="button" className="va-btn va-btn-primary" onClick={onLogin}>
            Log in
          </button>
        )}
      </div>
    </CardShell>
  );
}
