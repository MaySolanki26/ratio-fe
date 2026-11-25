/**
 * UI ↔ Rentio domain adapter. Every button calls `act`, which runs ONE business
 * command through the domain services on a draft copy and persists it only if
 * the command and the browser store write both succeed (commitDraft).
 */
import { useCallback } from 'react';
import { useToast } from '../components/primitives/feedback';
import { ractor, type RActor } from '../domain/rentio/access';
import { type Ctx, execute, RError } from '../domain/rentio/engine';
import { runScenarioStep } from '../domain/rentio/scenario';
import type { RentioState } from '../domain/rentio/types';
import { commit, commitDraft, getDb, PersistError } from '../services/db';
import { useRevision } from '../services/hooks';
import { refreshClock, useClock } from './clock';
import type { Db } from '../services/types';

export interface ActResult<T> {
  ok: boolean;
  result?: T;
  duplicate?: boolean;
  txId?: string;
  error?: string;
  code?: string;
}

/** Requirement IDs belong in implementation notes, not in messages staff read. */
export const plain = (msg: string) =>
  msg
    .replace(/\s*\((?:see )?(?:FR|BR|EC|OQ|WF|NFR|AC)-[\w.–-]+(?:[,/ ]+(?:FR|BR|EC|OQ|WF|NFR|AC)-[\w.–-]+)*\)/g, '')
    .replace(/^(?:(?:FR|BR|EC|OQ|WF|NFR|AC)-[\w.–-]+(?:\s*\/\s*)?)+:\s*/, '');

const LOGGED = ['forbidden', 'scope', 'negative_stock', 'self_approval', 'duplicate', 'business_rule'];

/** Failed protected attempts stay visible for investigation (§14 audit contract). */
function logFailure(actor: RActor, label: string, code: string, reason: string) {
  try {
    commit((d) => {
      const s = d.rentio;
      if (!s) return;
      s.failures.unshift({ id: `FAIL-${Date.now().toString(36)}`, at: new Date().toISOString(), actorId: actor.id, action: label, reason, code });
      if (s.failures.length > 300) s.failures.length = 300;
      d.audit.unshift({ id: `aud_f_${Date.now().toString(36)}`, at: new Date().toISOString(), workspaceId: d.session.workspaceId, actorId: actor.id, actorRole: actor.roleLabel, actorType: 'user', action: 'rentio.denied', summary: `BLOCKED ${label}: ${reason}`, correlationId: code });
    });
  } catch {
    /* logging must never mask the original error */
  }
}

export function act<T>(label: string, fn: (ctx: Ctx) => T, opts: { key?: string; at?: string; ref?: string; as?: string } = {}): ActResult<T> {
  const actor = ractor(opts.as ?? getDb().session.userId);
  try {
    let out!: ReturnType<typeof execute<T>>;
    commitDraft((draft) => {
      out = execute(draft, actor, { label, key: opts.key, at: opts.at, ref: opts.ref }, fn);
    });
    refreshClock();
    return { ok: true, result: out.result, duplicate: out.duplicate, txId: out.txId };
  } catch (e) {
    const code = e instanceof RError ? e.code : e instanceof PersistError ? e.code : 'error';
    const error = plain(e instanceof Error ? e.message : String(e));
    if (LOGGED.includes(code) && code !== 'duplicate') logFailure(actor, label, code, error);
    return { ok: false, code, error };
  }
}

/** Run the next RT-001 step atomically (all of the step's transactions or none). */
export function runStep(): ActResult<string> {
  try {
    let title = '';
    commitDraft((d) => {
      title = runScenarioStep(d).title;
    });
    refreshClock();
    return { ok: true, result: title };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: e instanceof RError ? e.code : 'error' };
  }
}

export function useR() {
  useRevision();
  // shared refreshing clock: timers, lateness and escalation advance while the screen is open
  const nowMs = useClock();
  const db = getDb() as Db;
  const s = db.rentio as RentioState;
  const actor = ractor(db.session.userId);
  return { db, s, actor, now: new Date(nowMs).toISOString() };
}

/** Hook: run an action and report the outcome (posted / already posted / blocked) as a toast. */
export function useAct() {
  const toast = useToast();
  return useCallback(
    <T,>(label: string, fn: (ctx: Ctx) => T, opts: { key?: string; at?: string; ref?: string; success?: (r: T) => string } = {}): ActResult<T> => {
      const r = act(label, fn, opts);
      if (r.ok && r.duplicate) toast(`Already posted (${r.txId}) — repeated submission had no second effect.`, 'info');
      else if (r.ok) toast(`${opts.success ? opts.success(r.result as T) : label} · ${r.txId}`, 'success');
      else toast(r.error ?? 'Action failed', 'danger');
      return r;
    },
    [toast],
  );
}

/** Stable idempotency key for one rendered form submission. */
export const newKey = (prefix: string) => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`;
