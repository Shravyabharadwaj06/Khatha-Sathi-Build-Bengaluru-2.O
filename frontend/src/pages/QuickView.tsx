import { useEffect, useMemo, useState } from 'react';
import { usePageStyles } from '../hooks/usePageStyles';
import quickViewCss from '../styles/quick-view.css?raw';

const API = 'http://127.0.0.1:8011';

interface Transaction {
  id: number;
  bill_number?: string | null;
  customer_id?: number | null;
  customer_name: string;
  transaction_type: string;
  payment_mode: string;
  amount: number;
  balance_after: number;
  description?: string;
  created_at?: string;
}

interface Summary {
  record_count: number;
  total_sales: number;
  cash_received: number;
  upi_received: number;
  udhaar_given: number;
  net_outstanding: number;
  udhaar_collected: number;
}

interface Customer {
  id: number;
  name: string;
  phone: string;
  outstanding_balance: number;
  balance?: number;
  age_days?: number;
  age_tag?: string;
}

const rupees = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function QuickView() {
  usePageStyles({ css: [quickViewCss], bodyClass: 'quick-view-body', title: 'CHOTU.ai | Quick View' });
  const [summary, setSummary] = useState<Summary>({ record_count: 0, total_sales: 0, cash_received: 0, upi_received: 0, udhaar_given: 0, net_outstanding: 0, udhaar_collected: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<Transaction[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [preset, setPreset] = useState('This Week');
  const [message, setMessage] = useState('');

  const loadOverview = async (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams(extra);
    if (search) params.set('search', search);
    const [overviewRes, owingRes] = await Promise.all([
      fetch(`${API}/api/quick-view/overview?${params}`),
      fetch(`${API}/api/quick-view/who-owes`),
    ]);
    if (!overviewRes.ok || !owingRes.ok) throw new Error('Quick View backend is unavailable');
    const overview = await overviewRes.json();
    const owing = await owingRes.json();
    setSummary(overview.summary);
    setTransactions(overview.transactions || []);
    setCustomers((owing.customers || []).map((c: Customer & { outstanding_balance: number }) => ({ ...c, balance: c.outstanding_balance })));
  };

  useEffect(() => { void loadOverview().catch(e => setMessage(e.message)); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadOverview().catch(e => setMessage(e.message)); }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const initials = (name: string) => name.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();

  const openLedger = async (customer: Customer) => {
    setSelectedCustomer(customer);
    setLedgerEntries([]);
    const res = await fetch(`${API}/api/quick-view/customers/${customer.id}/ledger`);
    if (!res.ok) return setMessage('Could not open customer ledger');
    const data = await res.json();
    setLedgerEntries(data.entries || []);
  };

  const download = async (path: string, filename: string) => {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) return setMessage('Could not create the report');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage(`${filename} downloaded`);
  };

  const recordPayment = async () => {
    if (!selectedCustomer) return;
    const amountText = window.prompt('Enter payment amount (₹)');
    if (!amountText) return;
    const amount = Number(amountText);
    if (!amount || amount <= 0) return setMessage('Enter a valid amount');
    const mode = window.prompt('Payment mode: cash or upi', 'upi') || 'cash';
    const res = await fetch(`${API}/api/quick-view/customers/${selectedCustomer.id}/payments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, payment_method: mode, note: 'Payment from Quick View' }),
    });
    if (!res.ok) { setMessage((await res.json()).detail || 'Payment could not be recorded'); return; }
    setMessage('Payment recorded');
    await openLedger(selectedCustomer);
    await loadOverview();
  };

  const giveUdhaar = async () => {
    if (!selectedCustomer) return;
    const amountText = window.prompt('Enter Udhaar amount (₹)');
    if (!amountText) return;
    const amount = Number(amountText);
    if (!amount || amount <= 0) return setMessage('Enter a valid amount');
    const res = await fetch(`${API}/api/transactions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_id: selectedCustomer.id, customer_name: selectedCustomer.name, transaction_type: 'udhaar', payment_mode: 'Khata', amount, description: 'Udhaar from Quick View' }),
    });
    if (!res.ok) { setMessage('Could not record Udhaar'); return; }
    setMessage('Udhaar recorded');
    await openLedger(selectedCustomer);
    await loadOverview();
  };

  const applyFilters = async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const extra: Record<string, string> = {};
    if (preset === 'Today') { extra.start_date = today; extra.end_date = today; }
    if (preset === 'Yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); const s = d.toISOString().slice(0,10); extra.start_date=s; extra.end_date=s; }
    if (preset === 'This Week') { const d = new Date(now); d.setDate(d.getDate() - d.getDay()); extra.start_date=d.toISOString().slice(0,10); extra.end_date=today; }
    if (preset === 'This Month') { extra.start_date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`; extra.end_date=today; }
    setFiltersOpen(false);
    await loadOverview(extra);
  };

  const customerMap = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  return (
    <main className="qv-page">
      <header className="qv-header">
        <div className="qv-brand"><strong>CH</strong><div><b>LAKSHMI PROVISIONS</b><span>View &amp; Reports</span></div></div>
        <div className="qv-lang"><button className="active">EN</button><button>HI</button><button>KN</button></div>
      </header>

      <div className="qv-shell">
        <div className="qv-walkthrough"><strong>1</strong><span>Interactive Walkthrough: Filter → Ledger inspect → Export</span><button onClick={() => setFiltersOpen(true)}>Demo Flow</button></div>

        <section className="qv-toolbar">
          <div className="qv-mode"><button>Simple</button><button className="active">Detailed</button></div>
          <div className="qv-sync">↻ Synced just now</div>
        </section>

        <div className="qv-dates">
          {['Today','Yesterday','This Week','This Month','Custom'].map(d => <button key={d} className={d === 'This Week' ? 'active' : ''} onClick={() => d === 'Custom' ? setFiltersOpen(true) : setPreset(d)}>{d}</button>)}
        </div>

        <section className="qv-metrics">
          <article><span>TOTAL SALES</span><strong>{rupees(summary.total_sales)}</strong><small>{summary.record_count} bills recorded</small></article>
          <article><span>CASH BOX</span><strong className="green">{rupees(summary.cash_received)}</strong><small className="green">● In Drawer</small></article>
          <article><span>UPI RECEIVED</span><strong>{rupees(summary.upi_received)}</strong><small>Soundbox confirmed</small></article>
          <article><span>UDHAAR GIVEN</span><strong className="orange">{rupees(summary.udhaar_given)}</strong><small className="orange">{customers.length} Customers</small></article>
        </section>

        <article className="qv-balance"><div><span>TOTAL SHOP UDHAAR DUE</span><strong>{rupees(summary.net_outstanding)}</strong><small>Across {customers.length} customers</small></div><b>+{rupees(summary.udhaar_collected)} <small>Recd this week</small></b></article>

        <div className="qv-actions">
          <button className="qv-who" onClick={() => document.getElementById('qv-owing')?.scrollIntoView({ behavior:'smooth' })}>⚠ Who Owes Me ({rupees(summary.net_outstanding)})</button>
          <button className="qv-export" onClick={() => download('/api/quick-view/export.xlsx', 'quick-view-report.xlsx')}>▦ Export Excel / PDF</button>
        </div>

        <div className="qv-search"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone, bill #"/><button onClick={() => setFiltersOpen(true)}>⚙ <b>3</b></button></div>

        <section className="qv-recent"><div className="qv-section-title"><h2>RECENT TRANSACTIONS <span>{summary.record_count}</span></h2><button onClick={() => download('/api/quick-view/export.csv', 'quick-view.csv')}>⇩ CSV</button></div>
          <div className="qv-list">
            {transactions.map(t => {
              const customer = t.customer_id ? customerMap.get(t.customer_id) : null;
              return <button className="qv-row" key={t.id} onClick={() => customer ? openLedger(customer) : setMessage('Walk-in transaction selected')}>
                <span className="qv-avatar">{(t.customer_name || 'WI').split(' ').map(x => x[0]).join('').slice(0,2).toUpperCase()}</span>
                <span className="qv-row-main"><b>{t.customer_name}</b><small>{t.created_at ? new Date(t.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''} • Bill #{t.bill_number || '-'} • {t.description}</small></span>
                <span className="qv-row-value"><b className={t.transaction_type === 'udhaar' ? 'orange' : 'green'}>{t.transaction_type === 'udhaar' ? '' : '+'}{rupees(t.amount)}</b><small>{t.payment_mode}</small></span>
              </button>;
            })}
          </div>
        </section>

        <section className="qv-owing" id="qv-owing"><div className="qv-section-title"><h2>WHO OWES ME</h2><button onClick={() => download('/api/quick-view/export.pdf', 'quick-view-report.pdf')}>⇩ PDF</button></div>
          {customers.map(c => <article className="qv-customer" key={c.id}><div><span className="qv-avatar">{c.name.split(' ').map(x => x[0]).join('').slice(0,2)}</span><div><b>{c.name}</b><small>Ph: {c.phone}</small></div></div><div><b className="orange">{rupees(c.outstanding_balance || c.balance || 0)}</b><button onClick={() => openLedger(c)}>View Ledger</button></div></article>)}
        </section>
      </div>

      {filtersOpen && <div className="qv-overlay" onClick={() => setFiltersOpen(false)}><aside className="qv-drawer" onClick={e => e.stopPropagation()}><div className="qv-drawer-head"><h2>Filters &amp; Date Range</h2><button onClick={() => setFiltersOpen(false)}>×</button></div>
        <label>Date Range Presets</label><div className="qv-filter-grid">{['Today','Yesterday','This Week','This Month','Last Month','Custom'].map(p => <button key={p} className={preset===p?'active':''} onClick={() => setPreset(p)}>{p}</button>)}</div>
        <label>Customer &amp; Khata Search</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or mobile"/><div className="qv-filter-actions"><button onClick={() => {setPreset('This Week');setSearch('');}} className="reset">Reset All</button><button onClick={applyFilters} className="apply">Apply Filters</button></div>
      </aside></div>}

      {selectedCustomer && <div className="qv-overlay" onClick={() => setSelectedCustomer(null)}><aside className="qv-drawer qv-ledger" onClick={e => e.stopPropagation()}><div className="qv-drawer-head"><div><h2>{selectedCustomer.name}</h2><small>{selectedCustomer.phone}</small></div><button onClick={() => setSelectedCustomer(null)}>×</button></div>
        <div className="qv-ledger-actions"><button onClick={giveUdhaar}>+ Give Udhaar</button><button onClick={recordPayment}>Got Jama</button></div>
        <div className="qv-ledger-list">{ledgerEntries.map(e => <article key={e.id}><div><b>{e.bill_number ? `Bill #${e.bill_number}` : e.description}</b><small>{e.created_at ? new Date(e.created_at).toLocaleString() : ''}</small></div><div><b className={e.transaction_type === 'udhaar' ? 'orange' : ''}>{e.transaction_type === 'udhaar' ? '+' : '-'}{rupees(e.amount)}</b><small>{e.transaction_type}</small></div></article>)}</div>
        <button className="qv-whatsapp" onClick={() => window.open(`https://wa.me/91${selectedCustomer.phone}?text=${encodeURIComponent(`Namaste ${selectedCustomer.name} ji, Lakshmi Provisions ka payment reminder hai.`)}`, '_blank')}>Send WhatsApp Reminder</button>
        <button className="qv-ledger-pdf" onClick={() => download(`/api/quick-view/customers/${selectedCustomer.id}/statement.pdf`, `statement-${selectedCustomer.name}.pdf`)}>Download Customer PDF</button>
      </aside></div>}

      {message && <div className="qv-toast" onClick={() => setMessage('')}>{message}</div>}
    </main>
  );
}
