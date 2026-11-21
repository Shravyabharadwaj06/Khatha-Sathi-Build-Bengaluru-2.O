import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageStyles } from '../hooks/usePageStyles';
import { apiRequest } from '../services/api';
import managementCss from '../styles/management-pages.css?raw';
import { formatQty, formatRupees } from '../utils/money';

/** GET /customers/{id}/ledger: amounts are rupees (REST); converted to paise for display. */
interface LedgerEntry {
  id: string;
  transaction_type: 'sale' | 'payment' | 'reversal' | 'opening_balance' | string;
  total_amount: number;
  paid_amount: number;
  payment_method: string | null;
  transaction_date: string;
  notes: string | null;
  due_delta: number;
}

interface LedgerResponse {
  customer: { id: string; name: string; phone_number: string | null };
  outstanding_balance: number;
  transactions: LedgerEntry[];
  payments: LedgerEntry[];
}

interface BillItem {
  id: string;
  product_name: string;
  quantity: number;
  line_total: number;
}

const toPaise = (rupees: number) => Math.round(rupees * 100);

const TYPE_LABEL: Record<string, string> = {
  sale: 'Bill',
  payment: 'Payment',
  reversal: 'Undo',
  opening_balance: 'Opening balance',
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  credit: 'Udhaar',
  partial: 'Part paid',
};

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function CustomerHistory() {
  const { customerId = '' } = useParams();
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<Record<string, BillItem[] | 'loading' | string>>({});

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  usePageStyles({
    css: [managementCss],
    bodyClass: 'management-body',
    title: `CHOTU.ai | ${ledger?.customer.name ?? 'Customer'} history`,
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setLedger(await apiRequest<LedgerResponse>(`/customers/${encodeURIComponent(customerId)}/ledger`));
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load this customer.');
    } finally {
      setIsLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const balancePaise = ledger ? toPaise(ledger.outstanding_balance) : 0;
  const amountPaise = Math.round(Number(amount) * 100);
  const amountValid = Number.isFinite(amountPaise) && amountPaise > 0 && amountPaise <= balancePaise;
  const entries = ledger
    ? [...ledger.transactions, ...ledger.payments].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    : [];

  /** Step 1: check the amount and show a summary. Nothing is saved until Confirm. */
  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    if (!amountValid) {
      setMessage({
        text: amountPaise > balancePaise ? `Payment is more than the due amount (${formatRupees(balancePaise)}).` : 'Enter the amount received.',
        error: true,
      });
      return;
    }
    setConfirming(true);
  };

  /** Step 2: the only call that saves. The backend re-checks the due amount. */
  const confirm = async () => {
    if (!ledger || isSaving) return;
    setIsSaving(true);
    try {
      const result = await apiRequest<{ outstanding_balance: number }>('/payments', {
        method: 'POST',
        body: JSON.stringify({ customer_id: ledger.customer.id, amount: amountPaise / 100, payment_method: method, notes: note.trim() || null }),
      });
      setMessage({ text: `Saved. ${ledger.customer.name}'s new balance is ${formatRupees(toPaise(result.outstanding_balance))}.`, error: false });
      setAmount('');
      setNote('');
      setConfirming(false);
      await load();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Could not record the payment.', error: true });
      setConfirming(false);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleItems = async (entryId: string) => {
    if (items[entryId]) {
      setItems(({ [entryId]: _removed, ...rest }) => {
        void _removed;
        return rest;
      });
      return;
    }
    setItems((current) => ({ ...current, [entryId]: 'loading' }));
    try {
      const list = await apiRequest<BillItem[]>(`/transactions/${entryId}/items`);
      setItems((current) => ({ ...current, [entryId]: list }));
    } catch (error) {
      setItems((current) => ({ ...current, [entryId]: error instanceof Error ? error.message : 'Could not load the items.' }));
    }
  };

  return (
    <main className="management-page">
      <div className="management-shell">
        <section className="management-intro" aria-labelledby="history-page-title">
          <p className="management-eyebrow">
            <Link to="/customers" className="management-eyebrow-link">Customers</Link> / Khata
          </p>
          <h1 id="history-page-title">{ledger?.customer.name ?? (isLoading ? 'Loading…' : 'Customer')}</h1>
          <p>Every bill, payment and undo for this customer. The balance is worked out from this history.</p>
        </section>

        {loadError ? (
          <section className="management-panel">
            <p className="management-notice management-notice-error" role="alert">{loadError}</p>
            <div className="management-form-actions">
              <Link className="management-button management-button-secondary" to="/customers">Back to customers</Link>
            </div>
          </section>
        ) : (
          <div className="management-history-layout">
            <div className="management-history-side">
              <section className="management-panel" aria-labelledby="balance-title">
                <p className="management-balance-label" id="balance-title">Balance due</p>
                <p className="management-balance" aria-live="polite">{ledger ? formatRupees(balancePaise) : '—'}</p>
                {ledger?.customer.phone_number && <p className="management-notice">Phone: {ledger.customer.phone_number}</p>}
              </section>

              <section className="management-panel" aria-labelledby="payment-title">
                <div className="management-panel-heading">
                  <div>
                    <h2 id="payment-title">Record a payment</h2>
                    <p>Money received from this customer. It cannot be more than the balance due.</p>
                  </div>
                </div>
                <form className="management-form-grid management-payment-form" onSubmit={review}>
                  <div className="management-field">
                    <label htmlFor="payment-amount">Amount received (₹) <span className="management-required">*</span></label>
                    <input
                      className="management-input"
                      id="payment-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      aria-describedby="payment-amount-hint"
                      value={amount}
                      onChange={(event) => {
                        setAmount(event.currentTarget.value);
                        setConfirming(false);
                      }}
                      disabled={!ledger || balancePaise <= 0}
                      required
                    />
                    <small id="payment-amount-hint">Up to {formatRupees(balancePaise)}.</small>
                  </div>
                  <div className="management-field">
                    <label htmlFor="payment-method">Paid by</label>
                    <select
                      className="management-input"
                      id="payment-method"
                      value={method}
                      onChange={(event) => {
                        setMethod(event.currentTarget.value as 'cash' | 'upi');
                        setConfirming(false);
                      }}
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                    </select>
                  </div>
                  <div className="management-field">
                    <label htmlFor="payment-note">Note</label>
                    <input className="management-input" id="payment-note" type="text" maxLength={200} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
                  </div>
                  <div className="management-form-actions">
                    {confirming ? (
                      <>
                        <button className="management-button management-button-primary" type="button" onClick={() => void confirm()} disabled={isSaving} aria-busy={isSaving}>
                          <span className="material-symbols-outlined" aria-hidden="true">check</span>
                          {isSaving ? 'Saving…' : `Confirm ${formatRupees(amountPaise)} ${method === 'upi' ? 'UPI' : 'cash'}`}
                        </button>
                        <button className="management-button management-button-secondary" type="button" onClick={() => setConfirming(false)} disabled={isSaving}>
                          Change
                        </button>
                      </>
                    ) : (
                      <button className="management-button management-button-primary" type="submit" disabled={!ledger || balancePaise <= 0}>
                        <span className="material-symbols-outlined" aria-hidden="true">payments</span>
                        Record payment
                      </button>
                    )}
                  </div>
                </form>
                {ledger && balancePaise <= 0 && <p className="management-notice">Nothing is due from {ledger.customer.name}.</p>}
                {message && (
                  <p className={`management-notice${message.error ? ' management-notice-error' : ''}`} role={message.error ? 'alert' : 'status'}>
                    {message.text}
                  </p>
                )}
                <p className="management-notice">
                  To add a bill, use the <Link to="/assistant">AI assistant</Link>: say, for example, “{ledger?.customer.name ?? 'Ramesh'} ko 2 Tata Salt udhaar”.
                </p>
              </section>
            </div>

            <section className="management-panel management-panel-customer-list" aria-labelledby="history-title">
              <div className="management-panel-heading">
                <h2 className="management-section-title" id="history-title">
                  History <span>newest first</span>
                </h2>
                <span className="management-count" role="status">{isLoading ? 'Loading…' : `${entries.length} entries`}</span>
              </div>
              <div className="management-table-wrap">
                <table className="management-table management-table-history">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Entry</th>
                      <th scope="col" className="management-num">Amount</th>
                      <th scope="col" className="management-num">Balance change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const shown = items[entry.id];
                      const delta = toPaise(entry.due_delta);
                      return (
                        <tr key={entry.id}>
                          <td data-label="Date">{dateFormat.format(new Date(entry.transaction_date))}</td>
                          <td data-label="Entry">
                            {TYPE_LABEL[entry.transaction_type] ?? entry.transaction_type}
                            {entry.payment_method && entry.transaction_type !== 'reversal' && ` · ${METHOD_LABEL[entry.payment_method] ?? entry.payment_method}`}
                            {entry.notes && entry.transaction_type === 'payment' && ` · ${entry.notes}`}
                            {entry.transaction_type === 'sale' && (
                              <>
                                {' '}
                                <button className="management-row-action" type="button" aria-expanded={Array.isArray(shown)} onClick={() => void toggleItems(entry.id)}>
                                  {shown ? 'Hide items' : 'Items'}
                                </button>
                                {shown === 'loading' && <span role="status"> Loading…</span>}
                                {typeof shown === 'string' && shown !== 'loading' && <span role="alert"> {shown}</span>}
                                {Array.isArray(shown) && (
                                  <ul className="management-history-items">
                                    {shown.map((item) => (
                                      <li key={item.id}>
                                        {formatQty(item.quantity)} × {item.product_name}: {formatRupees(toPaise(item.line_total))}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            )}
                          </td>
                          <td data-label="Amount" className="management-num">
                            {entry.transaction_type === 'reversal' ? '—' : formatRupees(toPaise(entry.total_amount))}
                          </td>
                          <td data-label="Balance change" className="management-num">
                            {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${formatRupees(delta)}`}
                          </td>
                        </tr>
                      );
                    })}
                    {!isLoading && entries.length === 0 && (
                      <tr><td className="management-table-empty" colSpan={4}>No entries yet. Bills are added with the AI assistant.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
