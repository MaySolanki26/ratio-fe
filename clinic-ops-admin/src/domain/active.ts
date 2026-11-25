/**
 * Active domain pack. The shell, registry, authorization and persistence read the
 * current business domain from here instead of importing one pack directly.
 *
 * Rentio Smart ERP is the default domain. The original clinic pack remains
 * available (its tests select it explicitly) and keeps its own storage key.
 */
import type { DomainPack, ModuleDefinition, RecordData } from '../metadata/types';
import type { AppNotification, Approval, Comment } from '../services/types';

export interface DemoUser {
  id: string;
  name: string;
  roleId: string;
  /** Linked staff record per workspace (for "own" row scope). */
  staffIds: Record<string, string>;
  initials: string;
  /** Short job description shown in the role switcher. */
  title?: string;
  /** Data scope for domain services (stages, locations, distributors…). */
  scope?: Record<string, string[]>;
}

export interface Organization {
  id: string;
  slug: string;
  name: string;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  timezoneLabel: string;
}

export interface SeedResult {
  records: Record<string, RecordData[]>;
  counters: Record<string, number>;
  comments: Comment[];
  approvals: Approval[];
  notifications: AppNotification[];
  /** Extra domain state stored on the Db (e.g. the Rentio ledger). */
  extra?: Record<string, unknown>;
}

export interface AppDomain {
  id: string;
  productName: string;
  pack: DomainPack;
  users: DemoUser[];
  organization: Organization;
  workspaces: Workspace[];
  storageKey: string;
  schemaVersion: number;
  seedNumber: number;
  currency: string;
  locale: string;
  defaultSession: { userId: string; workspaceId: string };
  /** Colour palette every new user starts with (a PRESET_PALETTES id). Missing = Graphite Black. */
  defaultPalette?: string;
  seed(now: Date, opts?: Record<string, unknown>): SeedResult;
  /** Prototype banner text (full, shown in Help › What is real). */
  banner: string;
  /** Short persistent notice (one line, also on phones). */
  bannerShort?: string;
  /** Called after loading a stored Db of the right version (backfill new fields). */
  upgrade?(db: unknown): void;
}

let current: AppDomain | null = null;

export function registerDefaultDomain(d: AppDomain) {
  if (!current) current = d;
}

/** Switch the active domain (tests; the app selects Rentio at start-up). */
export function useDomain(d: AppDomain) {
  current = d;
}

export function domain(): AppDomain {
  if (!current) throw new Error('No domain pack registered');
  return current;
}

export const modules = (): ModuleDefinition[] => domain().pack.modules;
export const demoUsers = (): DemoUser[] => domain().users;
export const organization = (): Organization => domain().organization;
export const workspaces = (): Workspace[] => domain().workspaces;
