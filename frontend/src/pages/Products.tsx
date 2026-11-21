import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

const API = 'http://127.0.0.1:8000';

interface ProductRow {
  id: number | string;
  name?: string;
  category?: string | null;
  selling_price?: number | null;
  purchase_price?: number | null;
  stock_quantity?: number | null;
  unit?: string | null;
  expiry_date?: string | null;
  low_stock_threshold?: number | null;
}

type ProductForm = Record<string, string | number>;

export default function Products() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [form, setForm] = useState<ProductForm>({
    name: '', category: '', selling_price: '', purchase_price: '',
    stock_quantity: '', unit: 'pcs', expiry_date: '', low_stock_threshold: 5
  });
  const [editing, setEditing] = useState<number | string | null>(null);
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

  const change = (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [e.target.name]: e.target.value });

  const save = async (e: FormEvent) => {
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
    } catch (err) {
      setMessage((err instanceof Error && err.message) || 'Unable to save product');
    }
  };

  const edit = (p: ProductRow) => {
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
    <main style={{ color: '#17243b' }}>
      <button onClick={() => history.back()} style={{ padding: '0 16px', minHeight: 48, borderRadius: 4, cursor: 'pointer' }}>← Back</button>
      <h1 style={{ margin: '24px 0 8px' }}>Product Update</h1>
      <p style={{ margin: '0 0 24px' }}>Add new products or update existing stock and prices.</p>
      <form onSubmit={save} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 16, alignItems: 'end', background: '#fff', padding: 24, borderRadius: 8 }}>
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
          <label key={name} style={{ display: 'grid', gap: 8, fontWeight: 600 }}>
            {label}
            <input name={name} type={type} value={form[name]} onChange={change} required={['name', 'selling_price', 'stock_quantity'].includes(name)} min={type === 'number' ? 0 : undefined} style={{ padding: '0 12px', minHeight: 48, border: '1px solid #ccd3df', borderRadius: 4 }} />
          </label>
        ))}
        <button type="submit" style={{ padding: '0 16px', minHeight: 48, borderRadius: 4, background: '#f5c842', border: 0, fontWeight: 700, cursor: 'pointer' }}>{editing === null ? 'Add Product' : 'Save Changes'}</button>
        {editing !== null && <button type="button" onClick={() => { setEditing(null); setForm({ name: '', category: '', selling_price: '', purchase_price: '', stock_quantity: '', unit: 'pcs', expiry_date: '', low_stock_threshold: 5 }); }} style={{ minHeight: 48, borderRadius: 4, cursor: 'pointer' }}>Cancel Edit</button>}
      </form>
      {message && <p role="status">{message}</p>}
      <h2 style={{ margin: '40px 0 16px' }}>Products ({products.length})</h2>
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead><tr>{['Product', 'Category', 'Selling price', 'Stock', 'Expiry', 'Action'].map(x => <th key={x} style={{ padding: '12px 16px', borderBottom: '1px solid #ddd', textAlign: x === 'Selling price' || x === 'Stock' ? 'right' : 'left' }}>{x}</th>)}</tr></thead>
          <tbody>
            {products.map(p => <tr key={p.id}>
              <td style={{ padding: '12px 16px' }}>{p.name}</td><td style={{ padding: '12px 16px' }}>{p.category}</td>
              <td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>₹{p.selling_price}</td><td style={{ padding: '12px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.stock_quantity} {p.unit}</td>
              <td style={{ padding: '12px 16px' }}>{p.expiry_date ? String(p.expiry_date).slice(0, 10) : '—'}</td>
              <td style={{ padding: '8px 16px' }}><button onClick={() => edit(p)} style={{ minHeight: 48, borderRadius: 4, padding: '0 16px', cursor: 'pointer' }}>Edit</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </main>
  );
}
