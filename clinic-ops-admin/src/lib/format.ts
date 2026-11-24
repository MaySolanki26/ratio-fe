// narrow symbol: "$25.00", never "US$25.00" — the currency code lives in the column title tooltip (owner rule 59)
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' });
const num = new Intl.NumberFormat();
export const formatMoney = (n: number) => money.format(n);
const moneyWhole = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
/** Whole dollars for headline numbers (dashboard KPIs): "$12,065" */
export const formatMoneyWhole = (n: number) => moneyWhole.format(n);
export const formatNumber = (n: number) => num.format(n);
export const pct = (n: number) => `${Math.round(n * 100)}%`;
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
