import { useEffect, useState } from 'react';

const API = 'http://127.0.0.1:8000';

export default function Products() {
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    name: '', category: '', selling_price: '', purchase_price: '',
    stock_quantity: '', unit: 'pcs', expiry_date: '', low_stock_threshold: 5
  });
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`${API}/products`);
      if (!res.ok) throw new Error('Could not load products');
      setProducts(await res.json());
    } catch {
      setMessage('Could not connect to backend. Make sure FastAPI is running.');
    }
  };

  useEffect(() => { load(); }, []);

  const change = (e: any) => setForm({ ...form, [e.target.name]: e.target.value });

  const save = async (e: any) => {
    e.preventDefault();
    setMessage('');
    const payload = {
      ...form,
      selling_price: Number(form.selling_price),
      purchase_price: Number(form.purchase_price || 0),
      stock_quantity: Number(form.stock_quantity),
      low_stock_threshold: Number(form.low_stock_threshold || 5),
      expiry_date: form.expiry_date || null
    };

    try {
      const url = editing === null ? `${API}/products` : `${API}/products/${editing}`;
      const res = await fetch(url, {
        method: editing === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage(editing === null ? 'Product added successfully!' : 'Product updated successfully!');
      setEditing(null);
      setForm({ name: '', category: '', selling_price: '', purchase_price: '', stock_quantity: '', unit: 'pcs', expiry_date: '', low_stock_threshold: 5 });
      load();
    } catch (err: any) {
      setMessage(err.message || 'Unable to save product');
    }
  };

  const edit = (p: any) => {
    setEditing(p.id);
    setForm({
      name: p.name || '', category: p.category || '',
      selling_price: p.selling_price ?? '', purchase_price: p.purchase_price ?? '',
      stock_quantity: p.stock_quantity ?? '', unit: p.unit || 'pcs',
      expiry_date: p.expiry_date ? String(p.expiry_date).slice(0, 10) : '',
      low_stock_threshold: p.low_stock_threshold ?? 5
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main style={{ maxWidth: 1050, margin: '35px auto', padding: 24, color: '#17243b' }}>
      <button onClick={() => history.back()} style={{ padding: '10px 16px', cursor: 'pointer' }}>← Back</button>
      <h1>Product Update</h1>
      <p>Add new products or update existing stock and prices.</p>
      <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14, background: '#fff', padding: 22, borderRadius: 16 }}>
        {[
          ['name', 'Product name', 'text'],
          ['category', 'Category', 'text'],
          ['selling_price', 'Selling price (₹)', 'number'],
          ['purchase_price', 'Purchase price (₹)', 'number'],
          ['stock_quantity', 'Stock quantity', 'number'],
          ['unit', 'Unit (pcs/kg/litre)', 'text'],
          ['expiry_date', 'Expiry date', 'date'],
          ['low_stock_threshold', 'Low stock alert level', 'number']
        ].map(([name, label, type]) => (
          <label key={name} style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
            {label}
            <input name={name} type={type} value={form[name]} onChange={change} required={['name', 'selling_price', 'stock_quantity'].includes(name)} min={type === 'number' ? 0 : undefined} style={{ padding: 12, border: '1px solid #ccd3df', borderRadius: 8 }} />
          </label>
        ))}
        <button type="submit" style={{ padding: 13, background: '#f5c842', border: 0, borderRadius: 9, fontWeight: 700, cursor: 'pointer' }}>{editing === null ? 'Add Product' : 'Save Changes'}</button>
        {editing !== null && <button type="button" onClick={() => { setEditing(null); setForm({ name: '', category: '', selling_price: '', purchase_price: '', stock_quantity: '', unit: 'pcs', expiry_date: '', low_stock_threshold: 5 }); }}>Cancel Edit</button>}
      </form>
      {message && <p role="status">{message}</p>}
      <h2>Products ({products.length})</h2>
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead><tr>{['Product', 'Category', 'Selling price', 'Stock', 'Expiry', 'Action'].map(x => <th key={x} style={{ padding: 13, borderBottom: '1px solid #ddd' }}>{x}</th>)}</tr></thead>
          <tbody>
            {products.map(p => <tr key={p.id}>
              <td style={{ padding: 13 }}>{p.name}</td><td style={{ padding: 13 }}>{p.category}</td>
              <td style={{ padding: 13 }}>₹{p.selling_price}</td><td style={{ padding: 13 }}>{p.stock_quantity} {p.unit}</td>
              <td style={{ padding: 13 }}>{p.expiry_date ? String(p.expiry_date).slice(0, 10) : '—'}</td>
              <td style={{ padding: 13 }}><button onClick={() => edit(p)}>Edit</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </main>
  );
}
