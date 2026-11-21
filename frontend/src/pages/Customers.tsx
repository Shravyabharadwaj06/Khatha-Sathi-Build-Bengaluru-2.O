import { useEffect, useState } from 'react';

const API = 'http://127.0.0.1:8000';

export default function Customers() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const emptyForm = {
    name: '',
    phone_number: '',
    whatsapp_number: '',
    credit_score: 0
  };
  const [form, setForm] = useState<any>(emptyForm);

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

  const change = (e: any) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const save = async (e: any) => {
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
    } catch (err: any) {
      setMessage(err.message || 'Unable to save customer');
    }
  };

  const edit = (c: any) => {
    setEditing(c.id);
    setForm({
      name: c.name || '',
      phone_number: c.phone_number || '',
      whatsapp_number: c.whatsapp_number || '',
      credit_score: c.credit_score ?? 0
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openWhatsApp = async (customerId: number) => {
    try {
      const res = await fetch(`${API}/customers/${customerId}/whatsapp`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setMessage(body.detail || 'Could not create WhatsApp message');
        return;
      }

      const data = await res.json();
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setMessage('Could not connect to backend for WhatsApp');
    }
  };

  return (
    <main style={{ maxWidth: 1050, margin: '35px auto', padding: 24, color: '#17243b' }}>
      <button onClick={() => history.back()} style={{ padding: '10px 16px', cursor: 'pointer' }}>← Back</button>

      <h1>Customer Update</h1>
      <p>Add customers and manage their contact details and credit score.</p>

      <form onSubmit={save} style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
        gap: 14,
        background: '#fff',
        padding: 22,
        borderRadius: 16
      }}>
        <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
          Customer name
          <input name="name" value={form.name} onChange={change} required style={{ padding: 12, border: '1px solid #ccd3df', borderRadius: 8 }} />
        </label>

        <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
          Phone number
          <input name="phone_number" value={form.phone_number} onChange={change} style={{ padding: 12, border: '1px solid #ccd3df', borderRadius: 8 }} />
        </label>

        <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
          WhatsApp number
          <input name="whatsapp_number" value={form.whatsapp_number} onChange={change} style={{ padding: 12, border: '1px solid #ccd3df', borderRadius: 8 }} />
        </label>

        <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
          Credit score
          <input name="credit_score" type="number" min="0" value={form.credit_score} onChange={change} style={{ padding: 12, border: '1px solid #ccd3df', borderRadius: 8 }} />
        </label>

        <button type="submit" style={{
          padding: 13,
          background: '#f5c842',
          border: 0,
          borderRadius: 9,
          fontWeight: 700,
          cursor: 'pointer'
        }}>
          {editing === null ? 'Add Customer' : 'Save Changes'}
        </button>

        {editing !== null && (
          <button type="button" onClick={() => {
            setEditing(null);
            setForm(emptyForm);
          }}>
            Cancel Edit
          </button>
        )}
      </form>

      {message && <p role="status">{message}</p>}

      <h2>Customers ({customers.length})</h2>

      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr>
              {['Name', 'Phone', 'WhatsApp', 'Credit score', 'Action'].map(x =>
                <th key={x} style={{ padding: 13, borderBottom: '1px solid #ddd' }}>{x}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.id}>
                <td style={{ padding: 13 }}>{c.name}</td>
                <td style={{ padding: 13 }}>{c.phone_number || '—'}</td>
                <td style={{ padding: 13 }}>{c.whatsapp_number || '—'}</td>
                <td style={{ padding: 13 }}>{c.credit_score ?? '—'}</td>
                <td style={{ padding: 13 }}>
                  <button onClick={() => edit(c)}>Edit</button>{' '}
                  <button onClick={() => openWhatsApp(c.id)}>WhatsApp</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
