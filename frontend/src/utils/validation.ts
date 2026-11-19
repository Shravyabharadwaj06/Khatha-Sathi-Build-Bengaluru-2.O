export const digitsOnly = (v: string) => v.replace(/\D/g, '');
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
/** Indian mobile: 10 digits, starting 6–9 (spaces allowed, as in the "98765 43210" placeholder). */
export const isIndianMobile = (v: string) => /^[6-9]\d{9}$/.test(v.replace(/\s/g, ''));
export const isTenDigits = (v: string) => /^\d{10}$/.test(v.replace(/\s/g, ''));
export const isOtp = (v: string) => /^\d{6}$/.test(v.trim());
