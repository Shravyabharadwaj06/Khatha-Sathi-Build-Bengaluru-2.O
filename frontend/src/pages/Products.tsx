import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { usePageStyles } from '../hooks/usePageStyles';
import { apiRequest } from '../services/api';
import managementCss from '../styles/management-pages.css?raw';

interface Product {
  id: string;
  name: string;
  category: string | null;
  selling_price: number | null;
  purchase_price: number | null;
  stock_quantity: number;
  unit: string | null;
  expiry_date: string | null;
  low_stock_threshold: number;
}

interface ProductForm {
  name: string;
  category: string;
  selling_price: string;
  purchase_price: string;
  stock_quantity: string;
  unit: string;
  expiry_date: string;
  low_stock_threshold: string;
}

const emptyProductForm = (): ProductForm => ({
  name: '',
  category: '',
  selling_price: '',
  purchase_price: '',
  stock_quantity: '',
  unit: 'pcs',
  expiry_date: '',
  low_stock_threshold: '5',
});

const productFields = [
  { name: 'name', label: 'Product name', type: 'text', required: true },
  { name: 'category', label: 'Category', type: 'text', required: false },
  { name: 'selling_price', label: 'Selling price (₹)', type: 'number', required: true },
  { name: 'purchase_price', label: 'Purchase price (₹)', type: 'number', required: false },
  { name: 'stock_quantity', label: 'Stock quantity', type: 'number', required: true },
  { name: 'unit', label: 'Unit (pcs/kg/litre)', type: 'text', required: false },
  { name: 'expiry_date', label: 'Expiry date', type: 'date', required: false },
  { name: 'low_stock_threshold', label: 'Low stock alert level', type: 'number', required: false },
] as const;

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export default function Products() {
  usePageStyles({ css: [managementCss], bodyClass: 'management-body', title: 'CHOTU.ai | Product update' });

  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyProductForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setProducts(await apiRequest<Product[]>('/products'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load products.');
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
      selling_price: Number(form.selling_price),
      purchase_price: Number(form.purchase_price || 0),
      stock_quantity: Number(form.stock_quantity),
      low_stock_threshold: Number(form.low_stock_threshold || 5),
      expiry_date: form.expiry_date || null,
    };

    try {
      const path = editing === null ? '/products' : `/products/${editing}`;
      await apiRequest<Product>(path, {
        method: editing === null ? 'POST' : 'PUT',
        body: JSON.stringify(payload),
      });
      setMessage(editing === null ? 'Product added successfully!' : 'Product updated successfully!');
      setEditing(null);
      setForm(emptyProductForm());
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save product.');
    } finally {
      setIsSaving(false);
    }
  };

  const edit = (product: Product) => {
    setEditing(product.id);
    setForm({
      name: product.name || '',
      category: product.category || '',
      selling_price: String(product.selling_price ?? ''),
      purchase_price: String(product.purchase_price ?? ''),
      stock_quantity: String(product.stock_quantity ?? ''),
      unit: product.unit || 'pcs',
      expiry_date: product.expiry_date ? String(product.expiry_date).slice(0, 10) : '',
      low_stock_threshold: String(product.low_stock_threshold ?? 5),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(emptyProductForm());
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

        <section className="management-intro" aria-labelledby="products-page-title">
          <p className="management-eyebrow">Inventory / Counter stock</p>
          <h1 id="products-page-title">Product update &amp; stock entry</h1>
          <p>Add kirana items or update stock, selling prices, and expiry dates. Changes are saved to your inventory.</p>
        </section>

        <section className="management-panel" aria-labelledby="product-form-title">
          <div className="management-panel-heading">
            <div>
              <h2 id="product-form-title">{editing === null ? 'Add a product' : 'Edit product'}</h2>
              <p>Enter product details. Fields marked with * are required.</p>
            </div>
            <span className="management-count" aria-label={`${products.length} products in inventory`}>
              {products.length} products
            </span>
          </div>

          <form onSubmit={save}>
            <div className="management-form-grid">
              {productFields.map((field) => (
                <div className="management-field" key={field.name}>
                  <label htmlFor={`product-${field.name}`}>
                    {field.label}
                    {field.required && <span className="management-required"> *</span>}
                  </label>
                  <input
                    className="management-input"
                    id={`product-${field.name}`}
                    name={field.name}
                    type={field.type}
                    value={form[field.name]}
                    onChange={change}
                    required={field.required}
                    min={field.type === 'number' ? 0 : undefined}
                    step={field.type === 'number' ? 'any' : undefined}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>
            <div className="management-form-actions">
              <button className="management-button management-button-primary" type="submit" disabled={isSaving} aria-busy={isSaving}>
                <span className="material-symbols-outlined" aria-hidden="true">{editing === null ? 'add' : 'save'}</span>
                {isSaving ? 'Saving…' : editing === null ? 'Add product' : 'Save changes'}
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

        <section className="management-panel" aria-labelledby="products-list-title">
          <div className="management-panel-heading">
            <div>
              <h2 className="management-section-title" id="products-list-title">
                Products <span>{products.length} registered items</span>
              </h2>
            </div>
            <span className="management-count" role="status">
              {isLoading ? 'Loading…' : `${products.length} total`}
            </span>
          </div>

          <div className="management-table-wrap">
            <table className="management-table management-table-products">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Category</th>
                  <th scope="col">Selling price</th>
                  <th scope="col">Purchase price</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Expiry</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td data-label="Product">{product.name}</td>
                    <td data-label="Category">
                      {product.category ? <span className="management-category">{product.category}</span> : '—'}
                    </td>
                    <td className="management-price" data-label="Selling price">
                      {product.selling_price == null ? '—' : currency.format(product.selling_price)}
                    </td>
                    <td className="management-price" data-label="Purchase price">
                      {product.purchase_price == null ? '—' : currency.format(product.purchase_price)}
                    </td>
                    <td data-label="Stock">
                      {product.stock_quantity} {product.unit || 'pcs'}
                      {product.stock_quantity <= product.low_stock_threshold && (
                        <span className="management-stock-low">Low stock</span>
                      )}
                    </td>
                    <td data-label="Expiry">
                      {product.expiry_date ? String(product.expiry_date).slice(0, 10) : '—'}
                    </td>
                    <td data-label="Action">
                      <button className="management-row-action" type="button" onClick={() => edit(product)} aria-label={`Edit ${product.name}`}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {!isLoading && products.length === 0 && (
                  <tr><td className="management-table-empty" colSpan={7}>No products yet. Add your first product above.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
