import illustration1 from '../assets/illustration-1.png';
import illustration2 from '../assets/illustration-2.png';
import illustration3 from '../assets/illustration-3.png';
import illustration4 from '../assets/illustration-4.png';
import illustration5 from '../assets/illustration-5.png';
import illustration6 from '../assets/illustration-6.png';

export interface HomeFeature {
  label: string;
  image: string;
  alt: string;
  loading: 'eager' | 'lazy';
  route?: string;
}

export const HOME_FEATURES: HomeFeature[] = [
  { label: 'Quick View', image: illustration1, alt: 'Shop owner using a phone in his store', loading: 'eager' },
  { label: 'Update products', image: illustration2, alt: 'Shop owner updating products on a phone', loading: 'lazy', route: '/products' },
  { label: 'Customer update', image: illustration3, alt: 'Shop owner speaking with a customer', loading: 'lazy', route: '/customers' },
  { label: 'AI assistant', image: illustration4, alt: 'Shop owner and young customer in a store', loading: 'lazy' },
  { label: 'Analytics dashboard', image: illustration5, alt: 'Shop owner checking information on a tablet', loading: 'lazy' },
  { label: 'Report an issue', image: illustration6, alt: 'Small business owner using a phone at the counter', loading: 'lazy', route: '/report-issue' },
];
