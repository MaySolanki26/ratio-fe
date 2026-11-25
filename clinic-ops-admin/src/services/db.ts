/**
 * LOCAL-ONLY persistence. This is the prototype's stand-in for server storage:
 * a single JSON document in this browser's localStorage. It is not shared with
 * other devices or users, and it is not a security boundary.
 */
import '../domain/default';
import { domain } from '../domain/active';
import type { Db, PersonalSettings } from './types';

/** Storage key of the active domain (Rentio: `rentio.erp.db.v1`; clinic keeps `uab.clinic-ops.db.v1`). */
export const storageKey = () => domain().storageKey;

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

export function createDb(now = new Date(), opts?: Record<string, unknown>): Db {
  const dom = domain();
  const s = dom.seed(now, opts);
  return {
    schemaVersion: dom.schemaVersion,
    seed: dom.seedNumber,
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
    session: { ...dom.defaultSession },
    settings: {},
    commentDrafts: {},
    formDrafts: {},
    ...(s.extra ?? {}),
  };
}

function load(): Db {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as Db;
      if (parsed.schemaVersion === domain().schemaVersion) {
        // fields added after a browser was seeded get deterministic values (no reset needed)
        domain().upgrade?.(parsed);
        return parsed;
      }
      // Different data version: keep the old data under a backup key before seeding — never discard it silently.
      const backupKey = `${storageKey()}.backup.v${parsed.schemaVersion}`;
      if (!localStorage.getItem(backupKey)) localStorage.setItem(backupKey, raw);
    }
  } catch {
    /* storage unavailable or corrupt — fall back to a fresh seed */
  }
  const fresh = createDb();
  // save the seeded data set immediately so a refresh shows the same data (relative fixture times included)
  try {
    localStorage.setItem(storageKey(), JSON.stringify(fresh));
  } catch {
    /* surfaced on the next write */
  }
  return fresh;
}

let db: Db = load();
let revision = 0;
let persistError: string | null = null;
const listeners = new Set<() => void>();

/** Test hook: make the next N storage writes fail (simulates a full or blocked browser store). */
let failWrites = 0;
export function __failNextWrites(n: number) {
  failWrites = n;
}

function write(value: Db) {
  if (failWrites > 0) {
    failWrites--;
    throw new Error('Simulated storage failure');
  }
  localStorage.setItem(storageKey(), JSON.stringify(value));
}

function persist() {
  try {
    write(db);
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

/**
 * Validated, all-or-nothing commit for multi-record business transactions.
 * The mutation runs on a deep copy; if it throws, or the browser store refuses
 * the write, the live state is untouched and the error propagates to the caller.
 */
export function commitDraft<T>(mutate: (draft: Db) => T): T {
  const draft = structuredClone(db);
  const result = mutate(draft);
  try {
    write(draft);
    persistError = null;
  } catch (e) {
    persistError = e instanceof Error ? e.message : 'Local storage write failed';
    emit();
    throw new PersistError(persistError);
  }
  db = draft;
  emit();
  return result;
}

export class PersistError extends Error {
  code = 'persist_failed' as const;
  constructor(detail: string) {
    super(`Not saved: the browser could not store this change (${detail}). Nothing was posted; try again.`);
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetDb(opts?: Record<string, unknown>) {
  const session = db.session;
  const settings = db.settings;
  db = createDb(new Date(), opts);
  db.session = session;
  db.settings = settings;
  persist();
  emit();
}

/** Backup: the complete local data set of the active domain as JSON (presenter tools). */
export function exportDb(): string {
  return JSON.stringify({ storageKey: storageKey(), exportedAt: new Date().toISOString(), db }, null, 0);
}

/** Restore a backup made by exportDb. Validated before anything is replaced; failure changes nothing. */
export function importDb(text: string) {
  let parsed: { storageKey?: string; db?: Db };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Rentio backup (not valid JSON).');
  }
  const next = parsed.db;
  if (parsed.storageKey !== storageKey() || !next || next.schemaVersion !== domain().schemaVersion) throw new Error(`This backup is for a different app or data version (${parsed.storageKey ?? 'unknown'}, v${next?.schemaVersion ?? '?'}).`);
  write(next);
  db = next;
  persistError = null;
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
    if (e.key !== storageKey() || !e.newValue) return;
    try {
      db = JSON.parse(e.newValue) as Db;
      emit();
    } catch {
      /* ignore */
    }
  });
}
