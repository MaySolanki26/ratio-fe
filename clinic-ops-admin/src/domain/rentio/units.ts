/**
 * Units and rounding. Quantities are stored as INTEGER GRAMS and money as INTEGER
 * PAISE, so sums and differences never drift. Conversions round half away from zero
 * at the input boundary only (A1: kilograms are the base display unit).
 */
export type Grams = number;
export type Paise = number;

const round = (n: number) => (n < 0 ? -Math.round(-n) : Math.round(n));

/** kg → integer grams (precision 1 g). */
export const kg = (n: number): Grams => round(n * 1000);
export const toKg = (g: Grams): number => g / 1000;
/** ₹ → integer paise. */
export const rupees = (n: number): Paise => round(n * 100);
export const toRupees = (p: Paise): number => p / 100;

const kgFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 });
const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/** "4,500 kg" — unit always shown. */
export const fmtKg = (g: Grams) => (Number.isFinite(g) ? `${kgFmt.format(toKg(g))} kg` : '— kg');
export const fmtKgNum = (g: Grams) => kgFmt.format(toKg(g));
export const fmtINR = (p: Paise, whole = false) => (whole ? inrWhole : inrFmt).format(toRupees(p));

/** value of `qty` grams at `ratePerKg` paise/kg, rounded to the paisa. */
export const valueOf = (qty: Grams, ratePerKg: Paise): Paise => round((qty * ratePerKg) / 1000);

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Hours between two ISO times, to one decimal. */
export const hoursBetween = (a: string, b: string) => Math.round(((Date.parse(b) - Date.parse(a)) / 3_600_000) * 10) / 10;
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const fmtDuration = (ms: number) => {
  const neg = ms < 0;
  const m = Math.round(Math.abs(ms) / MIN);
  const h = Math.floor(m / 60);
  const r = m % 60;
  const s = h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`;
  return neg ? `−${s}` : s;
};
