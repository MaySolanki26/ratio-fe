/** Period close (no back-dated postings into a closed month) and scoped audit export. */
import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { userName } from '../../domain/rentio/access';
import { auditRows, lockPeriod, reopenPeriod, toCsv } from '../../domain/rentio/control';
import { readScope } from '../../domain/rentio/scope';
import { useAct, useR } from '../store';
import { usePager } from './_uxA';
import { Details, FormButton, ImplNote, Panel, RPage, Status, str, Table, useCan, fmtTime } from '../ui';

const istMonth = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 7);
const prevMonth = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export default function PeriodClose() {
  const { s, actor, now } = useR();
  const act = useAct();
  const can = useCan();
  const [q, setQ] = useState('');
  const locks = s.periodLocks ?? [];
  const rows = auditRows(s, actor);
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || `${r.who} ${r.what} ${r.ref} ${r.id}`.toLowerCase().includes(needle));
  const download = () => {
    const csv = toCsv(shown, now);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `rentio-audit-${now.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const pager = usePager(shown, 12);
  const lockReason = can('period.lock', 'close accounting periods');
  return (
    <RPage title="Period close & audit export" description="Close a past month so nothing can be posted back into it, and export the audit trail you are allowed to see.">
      <Panel
        title="Closed months"
        actions={
          <FormButton
            label="Close a month"
            variant="primary"
            disabledReason={lockReason}
            title="Close accounting month"
            submitLabel="Close month"
            note="Postings dated inside a closed month are refused. Corrections go into the current month; reopening needs another authorized person and a reason."
            fields={[{ key: 'period', label: 'Month (YYYY-MM)', type: 'text', required: true }]}
            initial={{ period: prevMonth(istMonth(now)) }}
            onSubmit={(v, key) => act('Period: close', (ctx) => lockPeriod(ctx, str(v.period)), { key, success: () => `${str(v.period)} closed` })}
          />
        }
      >
        <Table
          rows={locks.slice().reverse()}
          rowKey={(l) => `${l.period}-${l.at}`}
          empty="No month has been closed yet."
          cols={[
            { key: 'p', label: 'Month', render: (l) => <strong>{l.period}</strong> },
            { key: 'b', label: 'Closed by', render: (l) => `${userName(l.by)} · ${fmtTime(l.at)}` },
            { key: 's', label: 'Status', render: (l) => (l.reopened ? <span title={l.reopened.reason}><Status s="reopened" /> by {userName(l.reopened.by)}</span> : <Status s="closed" />) },
            {
              key: 'a',
              label: '',
              render: (l) =>
                l.reopened ? null : (
                  <FormButton
                    label="Reopen"
                    variant="ghost"
                    disabledReason={lockReason}
                    title={`Reopen ${l.period}`}
                    submitLabel="Reopen month"
                    fields={[{ key: 'reason', label: 'Reason', type: 'textarea', required: true }]}
                    onSubmit={(v, key) => act('Period: reopen', (ctx) => reopenPeriod(ctx, l.period, str(v.reason)), { key })}
                  />
                ),
            },
          ]}
        />
      </Panel>
      <Panel
        title="Audit trail"
        meta={`${shown.length} entries · ${readScope(actor).all ? 'whole network' : 'your actions and your area'}`}
        actions={
          <>
            <input className="input" type="search" aria-label="Search audit trail" placeholder="Search person, lot, reference…" value={q} onChange={(e) => { setQ(e.target.value); pager.reset(); }} />
            <Button icon="download" onClick={download} disabledReason={shown.length ? undefined : 'Nothing to export'}>
              Export CSV
            </Button>
          </>
        }
      >
        <Table
          rows={pager.rows}
          rowKey={(r) => r.id}
          cols={[
            { key: 'at', label: 'When (IST)', render: (r) => fmtTime(r.at) },
            { key: 'who', label: 'Who', render: (r) => r.who },
            { key: 'what', label: 'What', render: (r) => r.what },
            { key: 'o', label: 'Outcome', render: (r) => (r.outcome.startsWith('blocked') ? <span className="tone-text-danger">{r.outcome}</span> : r.outcome) },
          ]}
        />
        {pager.bar}
        <p className="muted small">The export contains all {shown.length} entries matching the search. Kept in this browser for the demo — not tamper-evident; a production system keeps the audit trail on a server.</p>
      </Panel>
      <Details summary="What the export contains">
        <p className="muted">Postings (who, what, reference), blocked attempts with the reason, and every stock movement in your area with its basis. Spreadsheet formulas are neutralised. The file header carries the export time and units.</p>
      </Details>
      <ImplNote>Period lock BR-010 / EC-40 (enforced in the transaction runner for every posting); audit export FR-082 / NFR-10 scoped by scope.ts.</ImplNote>
    </RPage>
  );
}
