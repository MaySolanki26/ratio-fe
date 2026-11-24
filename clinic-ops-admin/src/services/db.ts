/**
 * LOCAL-ONLY persistence. This is the prototype's stand-in for server storage:
 * a single JSON document in this browser's localStorage. It is not shared with
 * other devices or users, and it is not a security boundary.
 */
import { referralPortal, referralTags, seedClinic } from '../domain/clinic/seed';
import { prng } from '../lib/ids';
import type { Db, PersonalSettings } from './types';

export const STORAGE_KEY = 'uab.clinic-ops.db.v1';
export const SEED = 4102;
const SCHEMA_VERSION = 5; // 5: richer dashboard data (95-day history, 80 patients, aged invoices, 36 referrals)

export const defaultSettings = (): PersonalSettings => ({
  theme: 'system',
  railSkin: 'softCharcoal',
  navDensity: 'balanced',
  sidebarWidth: 240,
  sidebarCollapsed: false,
  pins: [],
  favorites: [],
  palette: 'graphite',
  themeRev: 2,
  formLayout: 'simple',
  zoom: 100,
  customPalettes: [],
  recents: [],
  defaultViews: {},
});

export function createDb(now = new Date()): Db {
  const s = seedClinic(SEED, now);
  return {
    schemaVersion: SCHEMA_VERSION,
    seed: SEED,
    seededAt: now.toISOString(),
    records: s.records,
    counters: s.counters,
    comments: s.comments,
    approvals: s.approvals,
    notifications: s.notifications,
    audit: [],
    events: [],
    views: [],
    config: { version: 1, masters: {}, customFields: {}, resourceVersions: {}, history: [], draft: null },
    idempotency: {},
    session: { userId: 'u_morgan', workspaceId: 'riverside' },
    settings: {},
    commentDrafts: {},
    formDrafts: {},
  };
}

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.schemaVersion === SCHEMA_VERSION) {
        // fields added after a browser was seeded get deterministic synthetic values (no reset needed)
        for (const rec of parsed.records.referrals ?? []) {
          if ('tags' in rec) continue;
          const r = prng([...rec.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0);
          rec.tags = referralTags(r);
          rec.portalUrl = referralPortal(r);
        }
        return parsed;
      }
    }
  } catch {
    /* storage unavailable or corrupt — fall back to a fresh seed */
  }
  return createDb();
}

let db: Db = load();
let revision = 0;
let persistError: string | null = null;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    persistError = null;
  } catch (e) {
    persistError = e instanceof Error ? e.message : 'Local storage write failed';
  }
}

function emit() {
  revision++;
  listeners.forEach((l) => l());
}

export function getDb(): Db {
  return db;
}

export function getRevision(): number {
  return revision;
}

export function getPersistError(): string | null {
  return persistError;
}

/** All writes go through commit so persistence and subscribers stay consistent. */
export function commit<T>(mutate: (d: Db) => T): T {
  const result = mutate(db);
  persist();
  emit();
  return result;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetDb() {
  const session = db.session;
  const settings = db.settings;
  db = createDb();
  db.session = session;
  db.settings = settings;
  persist();
  emit();
}

/** Replace the in-memory store (tests). */
export function __setDb(next: Db) {
  db = next;
  emit();
}

// Cross-tab sync: another tab's write replaces our copy (optimistic concurrency still applies).
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      db = JSON.parse(e.newValue) as Db;
      emit();
    } catch {
      /* ignore */
    }
  });
}
