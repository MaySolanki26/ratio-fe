import { addDays, formatDate, todayKey } from '../../lib/dates';
import type { RecordData } from '../../metadata/types';
import { canReadResource, fieldAccess, type Actor } from '../../services/authz';
import { getResource } from '../../services/registry';
import { queryRecords } from '../../services/runtime';

/** Period tabs on the dashboard's top line (owner, 2026-11-24): 7 · 15 · 30 · 90 days · All · Custom (own from – to) */
export type Period = 'week' | 'fortnight' | 'month' | 'quarter' | 'all' | 'custom';
export type Scope = 'me' | 'clinic';
export type DashTab = 'overview' | 'scheduling' | 'patients' | 'billing';

export interface DashFilters {
  period: Period;
  compare: 'previous' | 'none';
  clinicians: string[];
  types: string[];
  /** Custom period: first and last day (YYYY-MM-DD) */
  customFrom?: string;
  customTo?: string;
}

export const DEFAULT_FILTERS: DashFilters = { period: 'month', compare: 'previous', clinicians: [], types: [] };
export const PERIOD_DAYS: Record<Exclude<Period, 'all' | 'custom'>, number> = { week: 7, fortnight: 15, month: 30, quarter: 90 };
export const PERIOD_LABEL: Record<Period, string> = { week: 'Last 7 days', fortnight: 'Last 15 days', month: 'Last 30 days', quarter: 'Last 90 days', all: 'All time', custom: 'Custom range' };
/** Short chip labels */
export const PERIOD_CHIP: Record<Period, string> = { week: '7 days', fortnight: '15 days', month: '30 days', quarter: '90 days', all: 'All', custom: 'Custom' };
export const TAB_LABEL: Record<DashTab, string> = { overview: 'Overview', scheduling: 'Scheduling', patients: 'Patients', billing: 'Billing' };

/** Visits that are (or were) going ahead */
export const ACTIVE = ['scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed'];
export const UPCOMING = ['scheduled', 'confirmed', 'checked_in', 'in_progress'];

const dayOf = (r: RecordData, key: string) => String(r[key] ?? '').slice(0, 10);
export const inRange = (r: RecordData, key: string, from: string, to: string) => {
  const d = dayOf(r, key);
  return d >= from && d <= to;
};
export const sum = (rows: RecordData[], key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
export const countIn = (rows: RecordData[], states: string[]) => rows.filter((r) => states.includes(String(r.status))).length;

/**
 * Everything the tabs need, computed once per render from local data for the chosen scope and filters.
 * Read access is checked per resource; finance numbers only when the actor may see invoice balances.
 */
export function buildDashData(actor: Actor, scope: Scope, filters: DashFilters) {
  const today = todayKey();
  const isAll = filters.period === 'all';
  const isCustom = filters.period === 'custom' && !!filters.customFrom && !!filters.customTo;
  const compare = filters.compare === 'previous' && !isAll; // "All" has no earlier period to compare with
  // the period ends today, or on the custom "to" day
  const end = isCustom ? (filters.customTo! < filters.customFrom! ? filters.customFrom! : filters.customTo!) : today;

  const can = {
    appts: canReadResource(actor, 'appointments'),
    patients: canReadResource(actor, 'patients'),
    invoices: canReadResource(actor, 'invoices'),
    referrals: canReadResource(actor, 'referrals'),
    rooms: canReadResource(actor, 'rooms'),
    staff: canReadResource(actor, 'staff'),
  };

  const allAppts = can.appts ? queryRecords(actor, 'appointments', { sort: [{ field: 'start', dir: 'asc' }] }).rows : [];
  const invAll = can.invoices ? queryRecords(actor, 'invoices', {}).rows : [];
  const patAll = can.patients ? queryRecords(actor, 'patients', {}).rows : [];
  // "All" starts on the first visit or invoice (activity — old registration dates would only add empty months)
  const earliest = [...allAppts.map((a) => String(a.start ?? '').slice(0, 10)), ...invAll.map((i) => String(i.issueDate ?? '').slice(0, 10))]
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x <= today)
    .sort()[0];
  const days = isCustom
    ? daysBetween(filters.customFrom! < end ? filters.customFrom! : end, end) + 1
    : isAll
      ? Math.max(daysBetween(earliest ?? today, today) + 1, 7)
      : PERIOD_DAYS[(filters.period === 'custom' ? 'month' : filters.period) as Exclude<Period, 'all' | 'custom'>];
  const from = addDays(end, -(days - 1));
  const prevFrom = addDays(from, -days);
  const prevTo = addDays(from, -1);
  const appts = allAppts.filter(
    (a) =>
      (scope === 'clinic' || a.clinicianId === actor.staffId) &&
      (!filters.clinicians.length || filters.clinicians.includes(String(a.clinicianId))) &&
      (!filters.types.length || filters.types.includes(String(a.appointmentType))),
  );
  const cur = appts.filter((a) => inRange(a, 'start', from, end));
  const prev = appts.filter((a) => inRange(a, 'start', prevFrom, prevTo));

  const invRes = can.invoices ? getResource('invoices') : null;
  const balanceField = invRes?.fields.find((f) => f.key === 'balance');
  const financeVisible = !!invRes && !!balanceField && ['view', 'edit'].includes(fieldAccess(actor, invRes, balanceField));
  const invoices = financeVisible ? invAll.filter((i) => i.status !== 'void' && i.status !== 'draft') : [];

  const patients = patAll;
  const referrals = can.referrals ? queryRecords(actor, 'referrals', {}).rows : [];

  /** Change vs the compared period, as StatCard expects: undefined = no badge */
  const delta = (now: number, before: number): number | null | undefined => {
    if (!compare) return undefined;
    if (!before) return now ? null : 0; // nothing to compare with → "new", never a fake +100%
    return Math.round(((now - before) / before) * 100);
  };

  /** Day buckets for trend charts: at least 14 days; weeks from 60 days, months past 200 days */
  const bucketDays = days > 200 ? 30 : days >= 60 ? 7 : 1;
  const trendDays = Math.max(days, 14);
  const bucketCount = Math.ceil(trendDays / bucketDays);
  const buckets = Array.from({ length: bucketCount }, (_, i) => {
    const last = addDays(end, -(bucketCount - 1 - i) * bucketDays);
    const start = addDays(last, -(bucketDays - 1));
    const [d, m] = formatDate(last).replace(',', '').split(' ');
    return { key: last, start, end: last, label: bucketDays === 1 ? `${d} ${m}` : bucketDays === 7 ? `Wk ${d} ${m}` : m };
  });

  return { today, days, from, to: end, prevFrom, prevTo, compare, can, appts, cur, prev, financeVisible, invoices, patients, referrals, delta, buckets, bucketDays, period: isCustom ? 'In this range' : PERIOD_LABEL[filters.period] };
}

export type DashData = ReturnType<typeof buildDashData>;

/** Whole days between two YYYY-MM-DD keys */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`)) / 86_400_000);

/** Age in years on a date */
export const ageOn = (dob: string, on: string) => {
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = on.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
};
