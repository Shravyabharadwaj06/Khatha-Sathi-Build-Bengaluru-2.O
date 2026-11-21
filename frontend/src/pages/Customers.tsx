import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { usePageStyles } from '../hooks/usePageStyles';
import managementCss from '../styles/management-pages.css?raw';

const API = 'http://127.0.0.1:8000';

interface Customer {
  id: number;
  name: string;
  phone_number: string | null;
  whatsapp_number: string | null;
  credit_score: number | null;
}

interface CustomerForm {
  name: string;
  phone_number: string;
  whatsapp_number: string;
  credit_score: string;
}

const emptyCustomerForm = (): CustomerForm => ({
  name: '',
  phone_number: '',
  whatsapp_number: '',
  credit_score: '0',
});

export default function Customers() {
  usePageStyles({ css: [managementCss], bodyClass: 'management-body', title: 'CHOTU.ai | Customer update' });

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/customers`);
      if (!res.ok) throw new Error('Could not load customers');
      setCustomers((await res.json()) as Customer[]);
    } catch {
      setMessage('Could not connect to backend. Make sure FastAPI is running.');
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
    const payload = {
      ...form,
      credit_score: Number(form.credit_score),
    };

    try {
      const url = editing === null ? `${API}/customers` : `${API}/customers/${editing}`;
      const res = await fetch(url, {
        method: editing === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Unable to save customer');
      setMessage(editing === null ? 'Customer added successfully!' : 'Customer updated successfully!');
      setEditing(null);
      setForm(emptyCustomerForm());
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save customer');
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
                      <td data-label="Action">
                        <button className="management-row-action" type="button" onClick={() => edit(customer)} aria-label={`Edit ${customer.name}`}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!isLoading && customers.length === 0 && (
                    <tr><td className="management-table-empty" colSpan={5}>No customers yet. Add your first customer here.</td></tr>
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
