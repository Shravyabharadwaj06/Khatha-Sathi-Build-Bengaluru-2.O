import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { usePageStyles } from '../hooks/usePageStyles';
import { apiRequest } from '../services/api';
import managementCss from '../styles/management-pages.css?raw';
import { formatRupees } from '../utils/money';

interface Customer {
  id: string;
  name: string;
  phone_number: string | null;
  whatsapp_number: string | null;
  credit_score: number | null;
  /** Rupees, computed by the backend from the ledger (never edited directly). */
  outstanding_balance: number;
}

interface CustomerForm {
  name: string;
  phone_number: string;
  whatsapp_number: string;
  credit_score: string;
  /** Opening balance from the paper khata (rupees). Only sent when the customer is added. */
  opening_balance: string;
}

const toPaise = (rupees: number) => Math.round(rupees * 100);

const emptyCustomerForm = (): CustomerForm => ({
  name: '',
  phone_number: '',
  whatsapp_number: '',
  credit_score: '0',
  opening_balance: '',
});

export default function Customers() {
  usePageStyles({ css: [managementCss], bodyClass: 'management-body', title: 'CHOTU.ai | Customer update' });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const editingCustomer = editing === null ? null : customers.find((c) => c.id === editing) ?? null;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setCustomers(await apiRequest<Customer[]>('/customers'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load customers.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.currentTarget;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving) return;
    setMessage('');
    setIsSaving(true);
    const { opening_balance, ...details } = form;
    // A balance changes only through bills, payments or undo; the opening balance is sent once, when adding.
    const payload = {
      ...details,
      credit_score: Number(form.credit_score),
      ...(editing === null && opening_balance.trim() !== '' ? { outstanding_balance: Number(opening_balance) } : {}),
    };

    try {
      const path = editing === null ? '/customers' : `/customers/${editing}`;
      await apiRequest<Customer>(path, {
        method: editing === null ? 'POST' : 'PUT',
        body: JSON.stringify(payload),
      });
      setMessage(editing === null ? 'Customer added successfully!' : 'Customer updated successfully!');
      setEditing(null);
      setForm(emptyCustomerForm());
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save customer.');
    } finally {
      setIsSaving(false);
    }
  };

  const edit = (customer: Customer) => {
    setEditing(customer.id);
    setForm({
      name: customer.name || '',
      phone_number: customer.phone_number || '',
      whatsapp_number: customer.whatsapp_number || '',
      credit_score: String(customer.credit_score ?? 0),
      opening_balance: '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(emptyCustomerForm());
  };

  return (
    <main className="management-page">
      <div className="management-shell">
        <header className="management-topbar">
          <a className="management-brand" href="/home" aria-label="CHOTU.ai home">
            CHOTU<span>.ai</span>
          </a>
          <button className="management-back" type="button" onClick={() => history.back()}>
            <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
            Back
          </button>
        </header>

        <section className="management-intro" aria-labelledby="customers-page-title">
          <p className="management-eyebrow">Customers / Khata directory</p>
          <h1 id="customers-page-title">Customer update</h1>
          <p>Add customers and manage their contact details and credit score.</p>
        </section>

        <div className="management-form-layout">
          <section className="management-panel" aria-labelledby="customer-form-title">
            <div className="management-panel-heading">
              <div>
                <h2 id="customer-form-title">{editing === null ? 'Add a customer' : 'Edit customer'}</h2>
                <p>Customer details stay connected to their khata record.</p>
              </div>
            </div>

            <form onSubmit={save} className="management-form-grid management-customer-form">
              <div className="management-field">
                <label htmlFor="customer-name">Customer name <span className="management-required">*</span></label>
                <input
                  className="management-input"
                  id="customer-name"
                  name="name"
                  type="text"
                  value={form.name}
                  onChange={change}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="management-field">
                <label htmlFor="customer-phone">Phone number</label>
                <input
                  className="management-input"
                  id="customer-phone"
                  name="phone_number"
                  type="tel"
                  inputMode="tel"
                  value={form.phone_number}
                  onChange={change}
                  autoComplete="tel"
                />
              </div>
              <div className="management-field">
                <label htmlFor="customer-whatsapp">WhatsApp number</label>
                <input
                  className="management-input"
                  id="customer-whatsapp"
                  name="whatsapp_number"
                  type="tel"
                  inputMode="tel"
                  value={form.whatsapp_number}
                  onChange={change}
                  autoComplete="tel"
                />
              </div>
              <div className="management-field">
                <label htmlFor="customer-credit-score">Credit score</label>
                <input
                  className="management-input"
                  id="customer-credit-score"
                  name="credit_score"
                  type="number"
                  min="0"
                  step="any"
                  value={form.credit_score}
                  onChange={change}
                />
              </div>
              {editing === null ? (
                <div className="management-field">
                  <label htmlFor="customer-opening-balance">Opening balance (₹)</label>
                  <input
                    className="management-input"
                    id="customer-opening-balance"
                    name="opening_balance"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.opening_balance}
                    onChange={change}
                    aria-describedby="customer-opening-balance-hint"
                  />
                  <small id="customer-opening-balance-hint">From your paper khata. Can only be entered once, when adding.</small>
                </div>
              ) : (
                <div className="management-field">
                  <label htmlFor="customer-balance">Current balance (₹)</label>
                  <input
                    className="management-input"
                    id="customer-balance"
                    type="text"
                    value={editingCustomer ? formatRupees(toPaise(editingCustomer.outstanding_balance)) : '—'}
                    readOnly
                    aria-readonly="true"
                    aria-describedby="customer-balance-hint"
                  />
                  <small id="customer-balance-hint">Changes only through bills, payments or undo.</small>
                </div>
              )}
              <div className="management-form-actions">
                <button className="management-button management-button-primary" type="submit" disabled={isSaving} aria-busy={isSaving}>
                  <span className="material-symbols-outlined" aria-hidden="true">{editing === null ? 'person_add' : 'save'}</span>
                  {isSaving ? 'Saving…' : editing === null ? 'Add customer' : 'Save changes'}
                </button>
                {editing !== null && (
                  <button className="management-button management-button-secondary" type="button" onClick={cancelEdit}>
                    Cancel edit
                  </button>
                )}
              </div>
            </form>
            {message && <p className="management-notice" role="status">{message}</p>}
          </section>

          <section className="management-panel management-panel-customer-list" aria-labelledby="customers-list-title">
            <div className="management-panel-heading">
              <h2 className="management-section-title" id="customers-list-title">
                Registered customers <span>{customers.length} in directory</span>
              </h2>
              <span className="management-count" role="status">
                {isLoading ? 'Loading…' : `${customers.length} total`}
              </span>
            </div>

            <div className="management-table-wrap">
              <table className="management-table management-table-customers">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Phone</th>
                    <th scope="col">WhatsApp</th>
                    <th scope="col">Credit score</th>
                    <th scope="col" className="management-num">Due</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td data-label="Name">{customer.name}</td>
                      <td data-label="Phone">{customer.phone_number || '—'}</td>
                      <td data-label="WhatsApp">{customer.whatsapp_number || '—'}</td>
                      <td data-label="Credit score">{customer.credit_score ?? '—'}</td>
                      <td data-label="Due" className="management-num">{formatRupees(toPaise(customer.outstanding_balance ?? 0))}</td>
                      <td data-label="Action">
                        <button className="management-row-action" type="button" onClick={() => edit(customer)} aria-label={`Edit ${customer.name}`}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!isLoading && customers.length === 0 && (
                    <tr><td className="management-table-empty" colSpan={6}>No customers yet. Add your first customer here.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
