import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { EmptyState, InlineAlert } from '../../components/primitives/feedback';
import { hasCap, userName } from '../../domain/rentio/access';
import { DEMO } from '../../domain/rentio/config';
import { SAMPLE_ATTENDANCE_CSV } from '../../domain/rentio/fixtures';
import * as P from '../../domain/rentio/people';
import { fmtINR, sum } from '../../domain/rentio/units';
import { newKey, useAct, useR } from '../store';
import { ImplNote, Kpi, KpiRow, Panel, Ref, RPage, Sim, Status, Table, fmtTime, useFocusId } from '../ui';
import { HoursChart } from './_graphB';
import { PageTabs, usePageTab } from './_uxA';

const SMALL_SAMPLE = `employee,time,dir
EMP-014,2026-11-25T09:00:00+05:30,in
EMP-014,2026-11-25T17:30:00+05:30,out
EMP-016,2026-11-25T21:00:00+05:30,in
EMP-016,2026-11-26T06:00:00+05:30,out
EMP-099,2026-11-25T09:00:00+05:30,in`;

export default function Attendance() {
  const { db, s, actor } = useR();
  const run = useAct();
  const isHR = hasCap(actor, 'hr.attendance') || hasCap(actor, 'hr.payroll');
  const isAuth = hasCap(actor, 'payroll.authorize');
  const focus = useFocusId();
  const [text, setText] = useState(SMALL_SAMPLE);
  const [fileName, setFileName] = useState('biometric-2026-11-25.csv');
  const periods = [...new Set(s.punches.map((p) => p.at.slice(0, 7)))].sort().reverse();
  const [period, setPeriod] = useState(periods[0] ?? '2026-11');
  const [asked, setTab] = usePageTab(['attendance', 'import', 'payroll'] as const, isHR ? 'attendance' : 'payroll', focus && s.imports.some((i) => i.id === focus) ? 'import' : focus && s.payroll.some((r) => r.id === focus) ? 'payroll' : undefined);

  if (!isHR && !isAuth)
    return (
      <RPage title="Attendance & payroll" description="Restricted HR data">
        <EmptyState icon="lock" title="Restricted to HR">
          Attendance and payroll are visible only to HR, and payroll totals to the authorized Accounts hand-off. {actor.roleLabel} has no access — this protects employee pay data.
        </EmptyState>
      </RPage>
    );

  const att = P.attendanceFor(s.punches, period);
  const emps = db.records.employees ?? [];
  const runs = [...s.payroll].reverse();
  const pendingDraft = s.payroll.find((p) => p.period === period && p.status === 'draft');
  const tab = isHR ? asked : 'payroll';

  return (
    <RPage
      title="Attendance & payroll"
      description="Import punches, review exceptions and prepare payroll."
      intro={
        <>
          Duplicate files and repeated punches are counted once. <Sim what="Biometric device simulated by file import" /> Pay rule <Ref>{DEMO.payrollRule}</Ref> is a demo rule.
        </>
      }
    >
      <PageTabs
        label="Attendance sections"
        extra={
          <select className="input" aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {(periods.length ? periods : [period]).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        }
        value={tab}
        onChange={setTab}
        tabs={[
          ...(isHR ? [{ id: 'attendance' as const, label: 'Attendance summary' }, { id: 'import' as const, label: 'Import punches', count: s.imports.length }] : []),
          { id: 'payroll' as const, label: 'Payroll runs', count: runs.length },
        ]}
      >
      {isHR && tab === 'import' && (
        <div className="rt-split2">
          <Panel title="Import attendance file" meta="CSV: employee,time,dir">
            <div className="rt-form">
              <div className="form-field">
                <label className="field-label" htmlFor="att-file">File name</label>
                <input id="att-file" className="input" value={fileName} onChange={(e) => setFileName(e.target.value)} />
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="att-text">File contents</label>
                <textarea id="att-text" className="textarea input" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
                <span className="field-help">EMP-099 is deliberately unknown → counted as invalid, isolated for review.</span>
              </div>
              <div className="rt-row">
                <Button
                  variant="primary"
                  icon="download"
                  onClick={() => run('Import attendance file', (ctx) => P.importPunches(ctx, { fileName, text }), { key: newKey('imp'), success: (i) => `${i.id}: ${i.accepted} accepted, ${i.duplicates} duplicate, ${i.invalid} invalid` })}
                >
                  Import file
                </Button>
                <Button
                  onClick={() => {
                    setText(SAMPLE_ATTENDANCE_CSV);
                    setFileName('biometric-2026-11-01_24.csv');
                  }}
                >
                  Load full sample file
                </Button>
              </div>
              <span className="field-help">The full sample was already imported in the demo data — importing it again shows the duplicate-file block.</span>
            </div>
          </Panel>
          <Panel title="Imports" meta="Row-level outcomes">
            <Table
              rows={[...s.imports].reverse()}
              rowKey={(i) => i.id}
              focus={focus}
              empty="No imports yet."
              cols={[
                { key: 'id', label: 'Import', render: (i) => <Ref>{i.id}</Ref> },
                { key: 'f', label: 'File', render: (i) => i.fileName },
                { key: 'r', label: 'Rows', num: true, render: (i) => i.rows },
                { key: 'a', label: 'Accepted', num: true, render: (i) => i.accepted },
                { key: 'd', label: 'Duplicate', num: true, render: (i) => i.duplicates },
                { key: 'v', label: 'Invalid', num: true, render: (i) => i.invalid },
                { key: 'b', label: 'By / at', render: (i) => `${userName(i.importedBy)} · ${fmtTime(i.at)}` },
              ]}
            />
          </Panel>
        </div>
      )}

      {isHR && tab === 'attendance' && (
        <Panel
          title="Attendance summary"
          meta={`${period} · paired in/out punches; OT after 8 h (demo); night shifts count to the start day`}
        >
          <div className="rt-split2">
          <HoursChart rows={emps.filter((e) => att[e.id]).map((e) => ({ id: String(e.id), name: String(e.name), hours: att[e.id].hours, ot: att[e.id].otHours }))} />
          <Table
            rows={emps.map((e) => ({ e, a: att[e.id] }))}
            rowKey={(r) => r.e.id}
            cols={[
              { key: 'n', label: 'Employee', render: (r) => <span title={String(r.e.id)}>{String(r.e.name)}</span> },
              { key: 's', label: 'Shift', render: (r) => (r.e.shift === 'night' ? 'Night' : 'Day') },
              { key: 'd', label: 'Days', num: true, render: (r) => r.a?.days.size ?? 0 },
              { key: 'h', label: 'Hours', num: true, render: (r) => (r.a ? r.a.hours.toFixed(1) : '0') },
              { key: 'o', label: 'OT h', num: true, render: (r) => (r.a ? r.a.otHours.toFixed(1) : '0') },
              { key: 'x', label: 'Exceptions', render: (r) => (r.a?.exceptions.length ? r.a.exceptions.join('; ') : '—') },
            ]}
          />
          </div>
        </Panel>
      )}

      {tab === 'payroll' && (
      <Panel
        title="Payroll runs"
        meta="Versioned; authorization by a different user (Accounts) in Approvals"
        actions={
          hasCap(actor, 'hr.payroll') ? (
            <div className="rt-row">
              <Button variant="primary" onClick={() => run(`Draft payroll ${period}`, (ctx) => P.draftPayroll(ctx, period), { key: newKey('pay'), success: (r) => `${r.id} v${r.version} drafted` })}>
                Draft payroll for {period}
              </Button>
              {pendingDraft && (
                <Button onClick={() => run(`Submit ${pendingDraft.id} for authorization`, (ctx) => P.requestPayrollAuthorization(ctx, pendingDraft.id), { success: (a) => `${a.id} sent to Accounts` })}>
                  Submit {pendingDraft.id} for authorization
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {!hasCap(actor, 'hr.payroll') && (
          <InlineAlert tone="info" title="Authorization view">
            Accounts sees totals for the payroll hand-off only; individual pay lines remain with HR. Decide pending payroll in Home › Approvals.
          </InlineAlert>
        )}
        <Table
          rows={runs}
          rowKey={(r) => r.id}
          empty="No payroll runs yet."
          cols={[
            { key: 'id', label: 'Run', render: (r) => <Ref>{r.id}</Ref> },
            { key: 'p', label: 'Period · version', render: (r) => `${r.period} · v${r.version}${r.supersedes ? ` (revises ${r.supersedes})` : ''}` },
            { key: 's', label: 'Status', render: (r) => <Status s={r.status} /> },
            { key: 'e', label: 'Employees', num: true, render: (r) => r.lines.length },
            { key: 't', label: 'Total gross', num: true, render: (r) => fmtINR(sum(r.lines.map((l) => l.gross)), true) },
            { key: 'rv', label: 'Rule version', render: (r) => r.lines[0]?.ruleVersion ?? '—' },
            { key: 'b', label: 'Prepared / authorized', render: (r) => `${userName(r.createdBy)} / ${r.authorizedBy ? userName(r.authorizedBy) : '—'}` },
          ]}
        />
        {hasCap(actor, 'hr.payroll') && runs[0] && (
          <>
            <h3 className="rt-h3">Lines · {runs[0].id} (HR only)</h3>
            <KpiRow>
              <Kpi label="Employees paid" value={runs[0].lines.filter((l) => l.days > 0).length} />
              <Kpi label="Total OT hours" value={sum(runs[0].lines.map((l) => l.otHours)).toFixed(1)} />
            </KpiRow>
            <Table
              rows={runs[0].lines}
              rowKey={(l) => l.employeeId}
              cols={[
                { key: 'e', label: 'Employee', render: (l) => `${l.employeeId} · ${emps.find((e) => e.id === l.employeeId)?.name ?? ''}` },
                { key: 'd', label: 'Days', num: true, render: (l) => l.days },
                { key: 'h', label: 'Hours', num: true, render: (l) => l.hours },
                { key: 'o', label: 'OT h', num: true, render: (l) => l.otHours },
                { key: 'g', label: 'Gross', num: true, render: (l) => fmtINR(l.gross) },
              ]}
            />
          </>
        )}
        <p className="rt-empty">An authorized run is never edited: drafting again for the same period creates a new version that supersedes it. Bank file and PF/ESI outputs are not generated in this prototype.</p>
      </Panel>
      )}
      </PageTabs>
      <ImplNote>HR and payroll (M15): FR-083 file import with duplicate detection, FR-084 overnight shift and OT, FR-085/086 versioned payroll authorized by a different user, NFR-04 restricted pay data.</ImplNote>
    </RPage>
  );
}
