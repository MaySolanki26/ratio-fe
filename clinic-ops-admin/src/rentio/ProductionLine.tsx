/**
 * Production line — the owner overview's view of the route: every stage as a station on ONE line, in route
 * order. A station's ring is filled by its share of the busiest stage's material (one shared scale), a late or
 * paused stage gets a red/amber ring and badge, idle stations shrink to a small dot, and the line segment
 * between two stations glows where material is on its way (handover arriving at the next stage).
 * Under each busy station a thin split bar shows arriving · queued · running · on hold · ready.
 * Same figures as Stage board (routeFlow + stageFunnel) — nothing is counted separately here.
 */
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Pause } from 'lucide-react';
import { cx } from '../lib/format';
import { fmtKg, sum } from '../domain/rentio/units';
import type { FlowNode } from './graphics';

export interface StageParts {
  pendingIn: number;
  queue: number;
  running: number;
  held: number;
  output: number;
  ownerName: string;
}

const PARTS: { key: keyof Omit<StageParts, 'ownerName'>; label: string; color: string }[] = [
  { key: 'pendingIn', label: 'Arriving', color: 'var(--c-mark-5)' },
  { key: 'queue', label: 'Queued', color: 'var(--c-mark-3)' },
  { key: 'running', label: 'Running', color: 'var(--c-mark-1)' },
  { key: 'held', label: 'On hold', color: 'var(--c-dot-warning)' },
  { key: 'output', label: 'Ready to issue', color: 'var(--c-mark-2)' },
];

const stateOf = (n: FlowNode) => (n.status?.tone === 'bad' ? 'late' : n.status?.tone === 'warn' ? 'paused' : n.magnitude ? 'busy' : 'idle');

export function ProductionLine({ title, nodes, parts }: { title: string; nodes: FlowNode[]; parts: Record<string, StageParts | undefined> }) {
  const max = Math.max(1, ...nodes.map((n) => n.magnitude ?? 0));
  const used = PARTS.filter((p) => nodes.some((n) => (parts[n.key]?.[p.key] ?? 0) > 0));
  if (!nodes.length) {
    return (
      <figure className="rt-pl" aria-label={title}>
        <p className="dv-empty">No production stages in your area.</p>
      </figure>
    );
  }
  return (
    <figure className="rt-pl" aria-label={title}>
      <ol className="rt-pl-line" style={{ ['--n' as string]: nodes.length } as CSSProperties}>
        {nodes.map((n, i) => {
          const state = stateOf(n);
          const p = parts[n.key];
          const fill = Math.round(((n.magnitude ?? 0) * 100) / max);
          // the segment to the NEXT station glows when material is being handed over to it
          const flowing = i < nodes.length - 1 && (parts[nodes[i + 1].key]?.pendingIn ?? 0) > 0;
          const split = p ? PARTS.filter((x) => (p[x.key] ?? 0) > 0) : [];
          const total = p ? sum(PARTS.map((x) => p[x.key] ?? 0)) : 0;
          return (
            <li key={n.key} className={cx('rt-pl-stop', `is-${state}`, flowing && 'is-flowing')}>
              <Link to={n.to ?? '#'} className="rt-pl-hit" data-tooltip={`${n.label}: ${n.value}${split.length ? ` — ${split.map((x) => `${x.label} ${fmtKg(p![x.key])}`).join(', ')}` : ''}${n.status ? ` · ${n.status.label}` : ''}`}>
                <span className="rt-pl-node" style={{ ['--fill' as string]: `${fill}%` } as CSSProperties} aria-hidden="true">
                  <span className="rt-pl-core">
                    {state === 'late' ? <AlertTriangle size={14} strokeWidth={2.2} /> : state === 'paused' ? <Pause size={14} strokeWidth={2.2} /> : state === 'busy' && n.status?.tone === 'good' ? <Check size={14} strokeWidth={2.4} /> : state === 'idle' ? null : i + 1}
                  </span>
                </span>
                <span className="rt-pl-name">{n.label}</span>
                <span className="rt-pl-kg">{state === 'idle' ? '—' : n.value}</span>
                {state !== 'idle' && total > 0 && (
                  <span className="rt-pl-split" aria-hidden="true">
                    {split.map((x) => (
                      <span key={x.key} style={{ width: `${((p![x.key] ?? 0) * 100) / total}%`, background: x.color }} />
                    ))}
                  </span>
                )}
                <span className={cx('rt-pl-state', n.status && `is-${n.status.tone}`)}>{state === 'idle' ? (p?.ownerName.split(' ')[0] ?? 'Idle') : n.status?.label}</span>
                <span className="sr-only">
                  {n.label}: {n.value}, {n.status?.label ?? 'idle'}
                  {split.length ? ` (${split.map((x) => `${x.label} ${fmtKg(p![x.key])}`).join(', ')})` : ''}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      {used.length > 0 && (
        <ul className="rt-pl-legend" aria-label="Legend">
          {used.map((x) => (
            <li key={x.key}>
              <span style={{ background: x.color }} aria-hidden="true" />
              {x.label}
            </li>
          ))}
          <li className="rt-pl-legend-note">Ring = share of the busiest stage · glowing line = handover on its way</li>
        </ul>
      )}
    </figure>
  );
}
