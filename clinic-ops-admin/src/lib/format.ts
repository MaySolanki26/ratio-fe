import { domain } from '../domain/active';

// narrow symbol: "₹25.00" / "$25.00", never "US$25.00" — the currency code lives in the column title tooltip (owner rule 59).
// The currency is the field's own (`field.currency`) or the active project's (Rentio: INR, clinic example: USD).
const fmtCache = new Map<string, Intl.NumberFormat>();
function moneyFmt(currency: string | undefined, whole: boolean) {
  const d = domain();
  const cur = currency ?? d.currency ?? 'USD';
  const key = `${d.locale}|${cur}|${whole}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(d.locale || undefined, { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol', ...(whole ? { maximumFractionDigits: 0 } : {}) });
    fmtCache.set(key, f);
  }
  return f;
}
const num = new Intl.NumberFormat();
export const formatMoney = (n: number, currency?: string) => moneyFmt(currency, false).format(n);
/** Whole units for headline numbers (dashboard KPIs): "$12,065" */
export const formatMoneyWhole = (n: number, currency?: string) => moneyFmt(currency, true).format(n);
/** The narrow currency symbol for input affixes ("₹", "$"). */
export const currencySymbol = (currency?: string) => moneyFmt(currency, false).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '';
export const formatNumber = (n: number) => num.format(n);
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
