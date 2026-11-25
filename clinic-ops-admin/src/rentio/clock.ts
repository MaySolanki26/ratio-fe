/**
 * One shared, refreshing clock for every Rentio screen. Status, elapsed time,
 * lateness and alert escalation advance while a screen stays open — no user
 * action needed. This is the wall clock; data freshness (seed/sync time) is
 * shown separately by the screens that need it.
 */
import { useSyncExternalStore } from 'react';

export const CLOCK_TICK_MS = 30_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick() {
  now = Date.now();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) {
    timer = setInterval(tick, CLOCK_TICK_MS);
    // first subscriber after an idle period: bring the clock up to date right away
    if (Date.now() - now > 1000) queueMicrotask(tick);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time as epoch ms; re-renders subscribers every tick. */
export function useClock(): number {
  return useSyncExternalStore(subscribe, () => now, () => now);
}

/** Force an immediate tick (tests, and after a posting so "now" is never older than the data). */
export function refreshClock() {
  tick();
}

export const clockNow = () => now;
