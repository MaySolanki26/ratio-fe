/**
 * Recall trace recipients (owner acceptance finding 7, AC-11 / FR-110): one row per physical
 * destination event — no duplicate for a by-product shipment and its matching stock move.
 */
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { useDomain } from '../domain/active';
import { ractor } from '../domain/rentio/access';
import * as C from '../domain/rentio/commerce';
import { buildRentio, rentioDomain } from '../domain/rentio/domain';
import { descendants, execute } from '../domain/rentio/engine';
import { recallRecipients } from '../domain/rentio/recall';
import { kg, sum } from '../domain/rentio/units';
import { __setDb, createDb } from '../services/db';
import { switchSession } from '../services/settings';
import type { Db } from '../services/types';

useDomain(rentioDomain);

const demo = () => {
  const r = buildRentio(new Date(), 'demo');
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
const family = (db: Db) => ['RT-001', ...descendants(db.rentio!, 'RT-001')];

describe('recall recipients — one row per physical destination event', () => {
  it('the Churi by-product sale appears once: canonical shipment row with its ledger movement as evidence', () => {
    const db = demo();
    const s = db.rentio!;
    const rows = recallRecipients(s, ractor('u_meera'), family(db));
    const churiShip = s.shipments.find((x) => x.toBuyer === 'BUY-02' && x.lines.some((l) => l.lotId.startsWith('RT-001/CHURI')))!;
    const mv = s.movements.find((m) => m.kind === 'external-dispatch' && m.ref === churiShip.id)!;
    const churi = rows.filter((r) => r.lotId.startsWith('RT-001/CHURI'));
    expect(churi).toHaveLength(1);
    expect(churi[0].id).toBe(`${churiShip.id}#0`);
    expect(churi[0].recipientId).toBe('BUY-02');
    expect(churi[0].qty).toBe(kg(100));
    expect(churi[0].movementIds).toEqual([mv.id]);
    expect(churi[0].state).toBe('dispatched-no-receipt'); // shipped-to, not "accepted"
    expect(rows.some((r) => r.id === mv.id)).toBe(false);
    // no event counted twice: each ledger movement backs at most one row
    const ids = rows.flatMap((r) => r.movementIds);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps both D01 split-stack shipment lines and the 1,000 kg retailer delivery as its own custody hop', () => {
    const db = demo();
    const s = db.rentio!;
    const rows = recallRecipients(s, ractor('u_meera'), family(db));
    const d01 = rows.filter((r) => r.kind === 'shipment' && r.recipientId === 'D01');
    expect(d01.map((r) => r.qty).sort((a, b) => a - b)).toEqual([kg(1000), kg(3000)]);
    expect(new Set(d01.map((r) => r.ref.split(' · from ')[1])).size).toBe(2); // S01 and S02
    expect(d01.every((r) => r.state === 'receipt-confirmed' && r.movementIds.length === 1)).toBe(true);
    const retail = rows.filter((r) => r.kind === 'retail-delivery');
    expect(retail).toHaveLength(1);
    expect(retail[0]).toMatchObject({ qty: kg(1000), recipientId: 'RET-001', state: 'delivery-confirmed' });
    // totals: 4,000 to D01 + 100 Churi + 1,000 retail hop — no phantom 200 kg Churi
    expect(sum(rows.filter((r) => r.lotId.startsWith('RT-001/CHURI')).map((r) => r.qty))).toBe(kg(100));
  });

  it('shipped-to and confirmed-receipt are distinct: an unreceived shipment reads "receipt pending"', () => {
    const db = demo();
    const so = execute(db, ractor('u_kiran'), { label: 't' }, (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D02', lines: [{ grade: 'A1', kg: 250 }] })).result;
    execute(db, ractor('u_kiran'), { label: 't' }, (ctx) => C.reserveOrder(ctx, so.id));
    const sh = execute(db, ractor('u_ravi'), { label: 't' }, (ctx) => C.dispatchOrder(ctx, { orderId: so.id, transporterId: 'TR-01', vehicle: 'MH12-T', driver: 'D' })).result;
    const row = recallRecipients(db.rentio!, ractor('u_meera'), family(db)).find((r) => r.id.startsWith(`${sh.id}#`))!;
    expect(row).toMatchObject({ recipientId: 'D02', state: 'shipped', stateLabel: 'Shipped — receipt pending' });
  });

  it('partner scope is preserved: a distributor sees only its own hops; no factory-side buyer rows leak', () => {
    const db = demo();
    const d01 = recallRecipients(db.rentio!, ractor('u_dinesh'), family(db));
    expect(d01.length).toBeGreaterThan(0);
    expect(d01.every((r) => r.recipientId === 'D01' || r.kind === 'retail-delivery')).toBe(true);
    expect(d01.some((r) => r.recipientId === 'BUY-02' || r.recipientId === 'D02')).toBe(false);
    expect(recallRecipients(db.rentio!, ractor('u_farah'), family(db)).some((r) => r.recipientId === 'D01' || r.recipientId === 'RET-001')).toBe(false);
  });

  it('Recall trace screen (Meera) renders the Churi sale once with its buyer name', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_meera', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/sales/returns');
    const r = render(<App />);
    const panel = r.container.querySelector('section[aria-label="Recall trace"]') as HTMLElement;
    const recipientsTable = panel.querySelectorAll('table')[1] as HTMLElement;
    const churiRows = [...recipientsTable.querySelectorAll('tbody tr')].filter((tr) => /RT-001\/CHURI/.test(tr.textContent ?? ''));
    expect(churiRows).toHaveLength(1);
    expect(within(churiRows[0] as HTMLElement).getByText(/Sagar Poultry Feeds/)).toBeInTheDocument();
    expect(churiRows[0].textContent).toMatch(/SH-\d{4} · order BO-\d{4}/);
    expect(churiRows[0].textContent).toMatch(/no receipt confirmation recorded/);
    r.unmount();
  });
});
