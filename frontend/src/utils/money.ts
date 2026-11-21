/** Integer paise → "₹840" or "₹54.50" (Indian digit grouping). Display only, never for maths. */
export function formatRupees(paise: number): string {
  const sign = paise < 0 ? '−' : '';
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const rest = abs % 100;
  const whole = rupees.toLocaleString('en-IN');
  return `${sign}₹${whole}${rest ? `.${String(rest).padStart(2, '0')}` : ''}`;
}

/** 2 → "2", 0.5 → "0.5", 1.25 → "1.25" */
export function formatQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}
