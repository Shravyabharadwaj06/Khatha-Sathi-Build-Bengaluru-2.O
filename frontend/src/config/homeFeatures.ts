import illustration1 from '../assets/illustration-1.png';
import illustration2 from '../assets/illustration-2.png';
import illustration3 from '../assets/illustration-3.png';
import illustration4 from '../assets/illustration-4.png';
import illustration5 from '../assets/illustration-5.png';
import illustration6 from '../assets/illustration-6.png';

export interface HomeFeature {
  /** Card label; also the toast text, exactly as in the Stitch data-action attribute. */
  label: string;
  image: string;
  alt: string;
  loading: 'eager' | 'lazy';
  /**
   * TODO: set when the inner screen is designed and built. While undefined the card
   * keeps the original behaviour (1800 ms toast with the label).
   */
  route?: string;
}

/** Order, labels, images, alt text and loading attrs are verbatim from design-reference/home_page_files/home_page.html. */
export const HOME_FEATURES: HomeFeature[] = [
  { label: 'Quick View', image: illustration1, alt: 'Shop owner using a phone in his store', loading: 'eager' }, // TODO route: '/quick-view'
  { label: 'Update products', image: illustration2, alt: 'Shop owner updating products on a phone', loading: 'lazy' }, // TODO route: '/products'
  { label: 'Customer update', image: illustration3, alt: 'Shop owner speaking with a customer', loading: 'lazy' }, // TODO route: '/customers'
  { label: 'AI assistant', image: illustration4, alt: 'Shop owner and young customer in a store', loading: 'lazy' }, // TODO route: '/assistant'
  { label: 'Analytics dashboard', image: illustration5, alt: 'Shop owner checking information on a tablet', loading: 'lazy' }, // TODO route: '/analytics'
  { label: 'Report an issue', image: illustration6, alt: 'Small business owner using a phone at the counter', loading: 'lazy' }, // TODO route: '/support'
];
