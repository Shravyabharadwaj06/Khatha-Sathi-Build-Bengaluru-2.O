import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

const API = 'http://127.0.0.1:8000';

interface CustomerRow {
  id: number | string;
  name?: string;
  phone_number?: string | null;
  whatsapp_number?: string | null;
  credit_score?: number | null;
}

type CustomerForm = Record<string, string | number>;

export default function Customers() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [editing, setEditing] = useState<number | string | null>(null);
  const [message, setMessage] = useState('');
  const emptyForm = {
    name: '',
    phone_number: '',
    whatsapp_number: '',
    credit_score: 0
  };
  const [form, setForm] = useState<CustomerForm>(emptyForm);

  const load = async () => {
    try {
      const res = await fetch(`${API}/customers`);
      if (!res.ok) throw new Error();
      setCustomers(await res.json());
    } catch {
      setMessage('Could not connect to backend. Make sure FastAPI is running.');
    }
  };

  useEffect(() => { load(); }, []);

  const change = (e: ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage('');

    const payload = {
      ...form,
      credit_score: Number(form.credit_score)
    };

    try {
      const url = editing === null
        ? `${API}/customers`
        : `${API}/customers/${editing}`;

      const res = await fetch(url, {
        method: editing === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(await res.text());

      setMessage(editing === null ? 'Customer added successfully!' : 'Customer updated successfully!');
      setEditing(null);
      setForm(emptyForm);
      await load();
    } catch (err) {
      setMessage((err instanceof Error && err.message) || 'Unable to save customer');
    }
  };

  const edit = (c: CustomerRow) => {
    setEditing(c.id);
    setForm({
      name: c.name || '',
      phone_number: c.phone_number || '',
      whatsapp_number: c.whatsapp_number || '',
      credit_score: c.credit_score ?? 0
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main style={{ color: '#17243b' }}>
      <button onClick={() => history.back()} style={{ padding: '0 16px', minHeight: 48, borderRadius: 4, cursor: 'pointer' }}>← Back</button>

      <h1 style={{ margin: '24px 0 8px' }}>Customer Update</h1>
      <p style={{ margin: '0 0 24px' }}>Add customers and manage their contact details and credit score.</p>

      <form onSubmit={save} style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
        gap: 16,
        alignItems: 'end',
        background: '#fff',
        padding: 24,
        borderRadius: 8
      }}>
        <label style={{ display: 'grid', gap: 8, fontWeight: 600 }}>
          Customer name
          <input name="name" value={form.name} onChange={change} required style={{ padding: '0 12px', minHeight: 48, border: '1px solid #ccd3df', borderRadius: 4 }} />
        </label>

        <label style={{ display: 'grid', gap: 8, fontWeight: 600 }}>
          Phone number
          <input name="phone_number" value={form.phone_number} onChange={change} style={{ padding: '0 12px', minHeight: 48, border: '1px solid #ccd3df', borderRadius: 4 }} />
        </label>

        <label style={{ display: 'grid', gap: 8, fontWeight: 600 }}>
          WhatsApp number
          <input name="whatsapp_number" value={form.whatsapp_number} onChange={change} style={{ padding: '0 12px', minHeight: 48, border: '1px solid #ccd3df', borderRadius: 4 }} />
        </label>

        <label style={{ display: 'grid', gap: 8, fontWeight: 600 }}>
          Credit score
          <input name="credit_score" type="number" min="0" value={form.credit_score} onChange={change} style={{ padding: '0 12px', minHeight: 48, border: '1px solid #ccd3df', borderRadius: 4 }} />
        </label>

        <button type="submit" style={{
          padding: '0 16px',
          minHeight: 48,
          background: '#f5c842',
          border: 0,
          borderRadius: 4,
          fontWeight: 700,
          cursor: 'pointer'
        }}>
          {editing === null ? 'Add Customer' : 'Save Changes'}
        </button>

        {editing !== null && (
          <button type="button" onClick={() => {
            setEditing(null);
            setForm(emptyForm);
          }} style={{ minHeight: 48, borderRadius: 4, cursor: 'pointer' }}>
            Cancel Edit
          </button>
        )}
      </form>

      {message && <p role="status">{message}</p>}

      <h2 style={{ margin: '40px 0 16px' }}>Customers ({customers.length})</h2>

      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr>
              {['Name', 'Phone', 'WhatsApp', 'Credit score', 'Action'].map(x =>
                <th key={x} style={{ padding: '12px 16px', borderBottom: '1px solid #ddd', textAlign: x === 'Credit score' ? 'right' : 'left' }}>{x}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.id}>
                <td style={{ padding: '12px 16px' }}>{c.name}</td>
                <td style={{ padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}>{c.phone_number || '—'}</td>
                <td style={{ padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}>{c.whatsapp_number || '—'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.credit_score ?? '—'}</td>
                <td style={{ padding: '8px 16px' }}>
                  <button onClick={() => edit(c)} style={{ minHeight: 48, borderRadius: 4, padding: '0 16px', cursor: 'pointer' }}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
