/** My Work — the staff landing page: assigned next actions, prefilled from the source record, one obvious next step. */
import type { ReactNode } from 'react';
import { EmptyState } from '../../components/primitives/feedback';
import { rentioRoles } from '../../domain/rentio/access';
import { computePositions } from '../../domain/rentio/engine';
import { stageIn, stageOut } from '../../domain/rentio/ops';
import { readScope } from '../../domain/rentio/scope';
import type { StageCode } from '../../domain/rentio/types';
import { alertsFor, ctaFor, myWork, type WorkItem } from '../../domain/rentio/views';
import { useR } from '../store';
import { Details, PageLink, Panel, RPage, Status } from '../ui';
import { EtaButton, HoldResumeButton, IssueButton, OutputButton, ReceiveButton, StartButton } from './StageWork';

const ORDER: WorkItem['kind'][] = ['approve', 'check', 'resume', 'eta', 'receive', 'output', 'issue', 'start', 'shipment', 'putaway', 'dispatch', 'reserve', 'deliver', 'conflict', 'sync', 'disposition', 'collection', 'payroll', 'hold', 'plan'];

export default function MyWork() {
  const { db, s, actor, now } = useR();
  const items = myWork(db, actor, now).sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const pos = computePositions(s);
  const at = (lot: string, loc: string) => pos.get(`${lot}|${loc}`) ?? 0;
  const alerts = alertsFor(db, actor, now).filter((a) => a.severity === 'critical' || a.severity === 'high').slice(0, 5);
  const role = rentioRoles.find((r) => r.id === actor.roleId)!;

  /** Do the step right here when it is a stage action; otherwise open the exact record. */
  const actionFor = (i: WorkItem, primary = false): ReactNode => {
    const v = primary ? 'primary' : 'secondary';
    const st = i.stage as StageCode | undefined;
    if (st && i.kind === 'receive') {
      const h = s.handovers.find((x) => x.id === i.sourceId);
      if (h) return <ReceiveButton h={h} variant={v} />;
    }
    if (st && (i.kind === 'output' || i.kind === 'resume' || i.kind === 'eta')) {
      const r = s.runs.find((x) => x.id === i.sourceId);
      if (r) return i.kind === 'output' ? <OutputButton run={r} variant={v} /> : i.kind === 'resume' ? <HoldResumeButton run={r} /> : <EtaButton run={r} variant={v} />;
    }
    if (st && i.kind === 'start' && s.lots[i.sourceId]) return <StartButton lot={s.lots[i.sourceId]} stage={st} qty={at(i.sourceId, stageIn(st))} variant={v} />;
    if (st && i.kind === 'issue' && s.lots[i.sourceId]) return <IssueButton lot={s.lots[i.sourceId]} stage={st} qty={at(i.sourceId, stageOut(st))} variant={v} />;
    return (
      <PageLink to={i.link}>
        <span className={primary ? 'btn btn-primary' : 'btn btn-secondary'}>
          <span className="btn-label">{i.action}</span>
        </span>
      </PageLink>
    );
  };

  const [first, ...rest] = items;
  return (
    <RPage title="My work" description="Your next actions, prefilled from the record they came from.">
      <p className="rt-intro">
        <strong>{actor.name}</strong> · {role.label} · {readScope(actor).label}
      </p>
      {first ? (
        <div className="rt-next" aria-live="polite">
          <div>
            <div className="muted">Next action{first.urgent ? ' · urgent' : ''}</div>
            <div className="rt-next-title">{first.title}</div>
            <div className="muted">
              {first.detail}
              {first.qty ? ` · ${first.qty}` : ''}
            </div>
          </div>
          {actionFor(first, true)}
        </div>
      ) : (
        <EmptyState icon="check-circle" title="You're all caught up">
          New work appears here as soon as a colleague sends, requests or escalates something to you.
        </EmptyState>
      )}
      {actor.roleId === 'owner' && (
        <p className="muted">
          Routine receiving, processing, dispatch and checks are handled by staff. Only decisions beyond their authority come here — see the <PageLink to="dashboard">owner overview</PageLink> for the whole mill.
        </p>
      )}
      {rest.length > 0 && (
        <Panel title="Also waiting for you" meta={`${rest.length}`}>
          <ul className="rt-brief">
            {rest.map((i) => (
              <li key={i.key}>
                {i.urgent ? <Status s="high" /> : <span className="rt-dot" aria-hidden="true" />}
                <div>
                  <div className="rt-brief-title">{i.title}</div>
                  <div className="rt-brief-detail">
                    {i.detail}
                    {i.qty ? ` · ${i.qty}` : ''}
                  </div>
                </div>
                {actionFor(i)}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {alerts.length > 0 && (
        <Details summary={`Problems in your area (${alerts.length})`}>
          <ul className="rt-brief">
            {alerts.map((a) => (
              <li key={a.key}>
                <Status s={a.severity} />
                <div>
                  <div className="rt-brief-title">{a.title}</div>
                  <div className="rt-brief-detail">
                    {a.owner} · {a.detail}
                  </div>
                </div>
                <PageLink to={a.link}>{ctaFor(a, actor)}</PageLink>
              </li>
            ))}
          </ul>
        </Details>
      )}
    </RPage>
  );
}
