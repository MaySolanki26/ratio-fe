import { Button } from '../../components/primitives/Button';
import { byproductDispatch } from '../../domain/rentio/commerce';
import { DEMO } from '../../domain/rentio/config';
import { DEMO_RATES } from '../../domain/rentio/data';
import { internalUse } from '../../domain/rentio/ops';
import { scopedMovements, scopedStockRows } from '../../domain/rentio/scope';
import { fmtKg, sum } from '../../domain/rentio/units';
import { InlineAlert } from '../../components/primitives/feedback';
import { Condition } from './Inventory';
import { ByproductGraphics } from './_graphA';
import { byproductReconciliation } from '../../domain/rentio/views';
import { newKey, useAct, useR } from '../store';
import { Details, FormButton, ImplNote, LotLink, Panel, Qty, RPage, Status, Table, Who, fmtTime, num, str, useCan, useFocusId } from '../ui';

export default function Byproducts() {
  const { s, db, now, actor } = useR();
  const focus = useFocusId();
  const run = useAct();
  const can = useCan();
  const rec = byproductReconciliation(s);
  const rows = scopedStockRows(s, actor, now).filter((r) => r.lot.material === 'HUSK' || r.lot.material === 'CHURI');
  const posOpts = rows.filter((r) => r.available > 0).map((r) => ({ value: `${r.lotId}@${r.loc}`, label: `${r.lot.material === 'HUSK' ? 'Husk' : 'Churi'} · ${r.lotId} · ${r.location?.label ?? r.loc} — ${fmtKg(r.available)} available` }));
  const buyers = (db.records.buyers ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.type})` }));
  const useReason = can('byproduct.use', 'record by-product internal use');
  const sellReason = can('byproduct.sell', 'dispatch by-products');
  const lotSet = new Set(rows.map((r) => r.lotId));
  const history = scopedMovements(s, actor).filter((m) => (m.kind === 'internal-use' || m.kind === 'external-dispatch' || m.kind === 'produce') && s.lots[m.lotId] && ['HUSK', 'CHURI'].includes(s.lots[m.lotId].material)).reverse();
  const first = rows.find((r) => r.available > 0);

  return (
    <RPage
      title="Husk & Churi"
      description="Husk and Churi generated from production, used internally or sold, with their origin lot."
      actions={
        <div className="rt-headrow">
          <p className="rt-intro">Husk and Churi are stock with their own origin — not loss.</p>
          <div className="rt-row rt-headrow-actions">
            <FormButton
              label="Record internal use"
              disabledReason={useReason}
              title="By-product internal consumption"
              submitLabel="Post internal use"
              initial={{ pos: first ? `${first.lotId}@${first.loc}` : '', purpose: DEMO.internalPurposes[0] }}
              fields={[
                { key: 'pos', label: 'Lot @ location', type: 'select', required: true, options: posOpts },
                { key: 'kg', label: 'Quantity used', type: 'number', unit: 'kg', required: true },
                { key: 'purpose', label: 'Authorized purpose', type: 'select', required: true, options: DEMO.internalPurposes.map((p) => ({ value: p, label: p })) },
              ]}
              onSubmit={(v, key) => {
                const [lotId, loc] = str(v.pos).split('@');
                return run('By-product internal use', (ctx) => internalUse(ctx, { lotId, loc, kg: num(v.kg), purpose: str(v.purpose) }), { key, success: (ref) => `Internal use ${ref} posted` });
              }}
            />
            <FormButton
              label="Dispatch to buyer"
              variant="primary"
              disabledReason={sellReason}
              title="External by-product dispatch"
              submitLabel="Dispatch"
              note="Stock reduces once, on physical dispatch. The sale is queued for Tally (simulated)."
              initial={{ pos: first ? `${first.lotId}@${first.loc}` : '' }}
              fields={[
                { key: 'buyerId', label: 'Buyer', type: 'select', required: true, options: buyers },
                { key: 'pos', label: 'Lot @ location', type: 'select', required: true, options: posOpts },
                { key: 'kg', label: 'Quantity', type: 'number', unit: 'kg', required: true },
                { key: 'rate', label: 'Agreed rate', type: 'number', unit: '₹/kg', required: true, help: `Demo reference: Husk ₹${DEMO_RATES.HUSK}, Churi ₹${DEMO_RATES.CHURI}` },
              ]}
              onSubmit={(v, key) => {
                const [lotId, loc] = str(v.pos).split('@');
                return run('By-product external dispatch', (ctx) => byproductDispatch(ctx, { buyerId: str(v.buyerId), lotId, loc, kg: num(v.kg), ratePerKg: num(v.rate) }), { key, success: (o) => `Dispatched under ${o.id}` });
              }}
            />
            <Button
              disabledReason={useReason ?? (first ? undefined : 'No by-product stock to test with')}
              onClick={() => first && run('Over-use attempt (demo)', (ctx) => internalUse(ctx, { lotId: first.lotId, loc: first.loc, kg: first.qty / 1000 + 50, purpose: DEMO.internalPurposes[0] }), { key: newKey('overuse') })}
            >
              Try to use more than available
            </Button>
          </div>
        </div>
      }
    >
      {focus && !rows.some((r) => r.lotId === focus || `${r.lotId}|${r.loc}` === focus) && <InlineAlert tone="warning">That record is not in your area or no longer open.</InlineAlert>}
      <ByproductGraphics s={s} />

      <Panel title="By-product stock by origin" meta={`${lotSet.size} lot(s) · total ${fmtKg(sum(rows.map((r) => r.qty)))}`}>
        <Table
          cols={[
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
            { key: 't', label: 'Type', render: (r) => r.lot.material },
            { key: 'root', label: 'Origin root', render: (r) => r.lot.rootId },
            { key: 'loc', label: 'Location', render: (r) => r.location?.label ?? r.loc },
            { key: 'p', label: 'Quantity', num: true, render: (r) => <Qty g={r.qty} /> },
            { key: 'h', label: 'Condition', render: (r) => <Condition r={r} /> },
            { key: 'a', label: 'Available to sell', num: true, render: (r) => (r.sellable ? <Qty g={r.available} strong /> : '—') },
          ]}
          rows={rows}
          rowKey={(r) => `${r.lotId}|${r.loc}`}
          rowClass={(r) => (r.held ? 'is-held' : undefined)}
          focus={focus ? rows.filter((r) => r.lotId === focus || `${r.lotId}|${r.loc}` === focus).map((r) => `${r.lotId}|${r.loc}`)[0] : undefined}
          empty="No Husk or Churi in stock."
        />
        <Details summary="Reconciliation: opening + generated − used − sold = closing">
          <Table
            cols={[
              { key: 't', label: 'Type', render: (r) => (r.type === 'HUSK' ? 'Husk' : 'Churi') },
              { key: 'o', label: 'Opening', num: true, render: (r) => <Qty g={r.opening} /> },
              { key: 'g', label: '+ Generation', num: true, render: (r) => <Qty g={r.generation} /> },
              { key: 'a', label: '± Adjustments', num: true, render: (r) => <Qty g={r.adjust} /> },
              { key: 'i', label: '− Internal use', num: true, render: (r) => <Qty g={r.internal} /> },
              { key: 'e', label: '− External dispatch', num: true, render: (r) => <Qty g={r.external} /> },
              { key: 'd', label: '− Disposal', num: true, render: (r) => <Qty g={r.disposal} /> },
              { key: 'eq', label: '= Equation', num: true, render: (r) => <Qty g={r.equation} strong /> },
              { key: 'c', label: 'Ledger closing', num: true, render: (r) => <Qty g={r.closing} strong /> },
              { key: 'ok', label: 'Result', render: (r) => <Status s={r.reconciled ? 'reconciled' : 'mismatch'} /> },
            ]}
            rows={rec}
            rowKey={(r) => r.type}
          />
        </Details>
        <Details summary={`Movement history (${history.length})`}>
          <Table
            cols={[
              { key: 'at', label: 'When', render: (m) => fmtTime(m.at) },
              { key: 'lot', label: 'Lot', render: (m) => <LotLink id={m.lotId} /> },
              { key: 'k', label: 'Movement', render: (m) => (m.kind === 'produce' ? 'generation' : m.kind) },
              { key: 'q', label: 'Qty', num: true, render: (m) => <Qty g={m.qty} /> },
              { key: 'n', label: 'Purpose / buyer', render: (m) => m.note ?? m.ref },
              { key: 'by', label: 'By', render: (m) => <Who id={m.actorId} /> },
            ]}
            rows={history}
            rowKey={(m) => m.id}
            empty="No movements yet."
          />
        </Details>
      </Panel>


      <ImplNote>Inventory by-products (M6). Equation per BR-017; internal-use purposes are configurable demo values (A7, FR-036); external dispatch FR-043 queues a simulated Tally document. Visibility follows scope.ts.</ImplNote>
    </RPage>
  );
}
