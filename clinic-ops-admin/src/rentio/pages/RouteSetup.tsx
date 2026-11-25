import { Button } from '../../components/primitives/Button';
import { STAGES, stageInfo } from '../../domain/rentio/data';
import { activateRoute, setEquipment } from '../../domain/rentio/people';
import type { StageCode } from '../../domain/rentio/types';
import { useAct, useR } from '../store';
import { scopedLots } from '../../domain/rentio/scope';
import { Details, FormButton, ImplNote, Kpi, KpiRow, PageLink, Panel, RPage, Status, Table, Who, fmtDay, fmtTime, str, useCan, useFocusId } from '../ui';

/** Route completeness: every activity has an explicit disposition (demo values, pending factory walkthrough). */
const COMPLETENESS = [
  { activity: 'Cleaning / destoning / foreign-matter removal', disposition: 'Separate stage CLEAN', note: 'Rejects held in quarantine; never auto-classified as Husk/Churi' },
  { activity: 'Pitting', disposition: 'Not used', note: 'Demo reason: no pitting roller assumed installed — Factory Head to confirm at walkthrough' },
  { activity: 'Husk separation', disposition: 'Included in PEEL', note: 'Husk / Churi classified at the peeling output' },
  { activity: 'Rework (unpeeled) loop', disposition: 'PEEL → PEEL (numbered passes)', note: 'Rework is existing material, not procurement' },
  { activity: 'Final sorting / finishing', disposition: 'Included in G2', note: 'Quality × size grades A1/B1/A2/B2' },
  { activity: 'Packing release checks', disposition: 'Included in PACK', note: 'Net weight, seal and label; a failed check puts the batch on quality hold' },
];

export default function RouteSetup() {
  const { s, actor } = useR();
  const focus = useFocusId();
  const run = useAct();
  const can = useCan();
  const routeReason = can('route.manage', 'activate route versions');
  const eqReason = can('plan.manage', 'change equipment readiness');
  const lotsOnOld = scopedLots(s, actor).filter((l) => l.routeVersion && l.routeVersion < s.route.version).length;
  const stageRows = s.route.stages.map((code, i) => ({ i, ...stageInfo(code) }));

  return (
    <RPage
      title="Process route & machines"
      description="The order of processing stages, who owns each stage, and which machines are ready."
      intro="A new route applies to new lots; lots already in progress keep their route."
    >
      <KpiRow>
        <Kpi label="Active route version" value={`v${s.route.version}`} note={`${s.route.stages.length} stages`} />
        <Kpi label="Lots on earlier versions" value={lotsOnOld} note="keep their original route" />
        <Kpi label="Equipment released" value={`${s.equipment.filter((e) => e.status === 'released').length}/${s.equipment.length}`} tone={s.equipment.some((e) => e.status !== 'released') ? 'warning' : 'success'} />
      </KpiRow>

      <Panel
        title={`Route v${s.route.version}`}
        meta="Purchase → Intake/QC → R1 → stages → F1"
        actions={
          <FormButton
            label="Activate new route version"
            icon="plus"
            disabledReason={routeReason}
            title="Activate a new route version"
            submitLabel="Activate version"
            note="Tick the stages used, in the standard order. Packing must stay last. Lots already in progress keep their current route."
            initial={{ ...Object.fromEntries(STAGES.map((x) => [x.code, s.route.stages.includes(x.code)])), change: '' }}
            fields={[
              ...STAGES.map((x) => ({ key: x.code, label: x.label, type: 'checkbox' as const })),
              { key: 'change', label: 'Reason for change', type: 'textarea', required: true },
            ]}
            onSubmit={(v, key) => {
              const stages = STAGES.filter((x) => !!v[x.code]).map((x) => x.code) as StageCode[];
              return run('Activate route version', (ctx) => activateRoute(ctx, { stages, change: str(v.change) }), { key, success: (ver) => `Route v${ver} active` });
            }}
          />
        }
      >
        <Table
          cols={[
            { key: 'i', label: '#', render: (r) => r.i + 1 },
            { key: 'label', label: 'Stage', render: (r) => <strong>{r.label}</strong> },
            { key: 'owner', label: 'Owner', render: (r) => <Who id={r.owner} /> },
            { key: 'backup', label: 'Backup', render: (r) => <Who id={r.backup} /> },
            { key: 'min', label: 'Planned', num: true, render: (r) => `${r.plannedMinutes} min` },
            { key: 'tol', label: 'Loss allowed (demo)', num: true, render: (r) => `${r.tolerancePct}%` },
          ]}
          rows={stageRows}
          rowKey={(r) => r.code}
        />
      </Panel>

      <Details summary="Is every activity covered? (cleaning, pitting, husk separation, finishing)">
          <Table
            cols={[
              { key: 'a', label: 'Activity', render: (r) => r.activity },
              { key: 'd', label: 'Disposition', render: (r) => <strong>{r.disposition}</strong> },
              { key: 'n', label: 'Note', render: (r) => <span className="muted">{r.note}</span> },
            ]}
            rows={COMPLETENESS}
            rowKey={(r) => r.activity}
          />
      </Details>
      <Details summary={`Route history (${s.route.history.length} version${s.route.history.length === 1 ? '' : 's'})`}>
          <Table
            cols={[
              { key: 'v', label: 'Version', render: (r) => `v${r.version}` },
              { key: 'at', label: 'Activated', render: (r) => fmtTime(r.at) },
              { key: 'by', label: 'By', render: (r) => <Who id={r.by} /> },
              { key: 'c', label: 'Change', render: (r) => r.change },
            ]}
            rows={[...s.route.history].reverse()}
            rowKey={(r) => String(r.version)}
          />
      </Details>

      <Panel title="Machines & instruments" meta="An unavailable machine stops new runs at its stage">
        <Table
          cols={[
            { key: 'l', label: 'Machine', render: (e) => e.label },
            { key: 'st', label: 'Stage', render: (e) => stageInfo(e.stage).label },
            { key: 's', label: 'Status', render: (e) => <Status s={e.status} /> },
            { key: 'due', label: 'Check due', render: (e) => fmtDay(`${e.checkDue}T00:00:00+05:30`) },
            { key: 'n', label: 'Note', render: (e) => e.note ?? '—' },
            {
              key: 'act',
              label: 'Action',
              render: (e) =>
                e.status === 'released' ? (
                  <FormButton
                    label="Mark unavailable"
                    disabledReason={eqReason}
                    title={`Mark ${e.label} unavailable`}
                    submitLabel="Mark unavailable"
                    fields={[{ key: 'note', label: 'Reason (breakdown, overdue check…)', type: 'text', required: true }]}
                    onSubmit={(v, key) => run(`Equipment ${e.id} unavailable`, (ctx) => setEquipment(ctx, { id: e.id, status: 'unavailable', note: str(v.note) }), { key })}
                  />
                ) : (
                  <Button disabledReason={eqReason} onClick={() => run(`Release ${e.id} to service`, (ctx) => setEquipment(ctx, { id: e.id, status: 'released' }))}>
                    Release to service
                  </Button>
                ),
            },
          ]}
          rows={s.equipment}
          rowKey={(e) => e.id}
          focus={focus}
        />
      </Panel>

      <Panel title="Master lists">
        <div className="rt-row">
          <PageLink to="masters/skus">SKUs</PageLink>·<PageLink to="masters/suppliers">Suppliers & farmers</PageLink>·<PageLink to="masters/distributors">Distributors (17)</PageLink>·
          <PageLink to="masters/retailers">Retailers</PageLink>·<PageLink to="masters/buyers">By-product buyers</PageLink>·<PageLink to="masters/transporters">Transporters</PageLink>·
          <PageLink to="masters/locations">Godowns & stacks</PageLink>·<PageLink to="hr/employees">Employees</PageLink>
        </div>
      </Panel>

      <ImplNote>Masters and setup (M1). Versioned route, lots keep their version (FR-002, BR-021); completeness dispositions FR-092 (pitting "not used" is a demo reason, OQ-01); equipment readiness blocks run start (FR-093, FR-096). Durations, tolerances and measurement basis per stage are demo defaults (OQ-01, OQ-03) — basis: {STAGES.map((x) => `${x.code} ${x.basis}`).join(', ')}.</ImplNote>
    </RPage>
  );
}
