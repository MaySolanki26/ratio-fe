/** Graphical views: present on the dashboard and every flow page, scoped, and drawn from the same figures. */
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../components/primitives/feedback';
import { useDomain } from '../domain/active';
import { ractor } from '../domain/rentio/access';
import { rentioDomain } from '../domain/rentio/domain';
import { kg } from '../domain/rentio/units';
import { lotOutcome, routeFlow, stockFlow } from '../rentio/flows';
import { RENTIO_PAGES, RentioDashboard } from '../rentio/pages';
import { __setDb, createDb, getDb } from '../services/db';
import { switchSession } from '../services/settings';

useDomain(rentioDomain);

const mount = (path: string, Page: () => JSX.Element) =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/o/rentio/w/plant1/${path}`]}>
        <div id="topbar-title" />
        <Page />
      </MemoryRouter>
    </ToastProvider>,
  );

const FLOW_PAGES: [string, string][] = [
  ['u_fhead', 'production/stages'],
  ['u_anil', 'production/stage'],
  ['u_owner', 'finance/reports'],
  ['u_owner', 'presenter/journey'],
  ['u_ravi', 'stock/godowns'],
  ['u_ravi', 'stock/inventory'],
  ['u_ravi', 'stock/byproducts'],
  ['u_meera', 'stock/holds'],
  ['u_kiran', 'procurement/intake'],
  ['u_fhead', 'masters/route'],
  ['u_fhead', 'production/grading'],
  ['u_fhead', 'production/handovers'],
  ['u_fhead', 'production/close'],
  ['u_kiran', 'distribution/orders'],
  ['u_dinesh', 'distribution/distributors'],
  ['u_kiran', 'distribution/logistics'],
  ['u_rohit', 'sales/salesman'],
  ['u_meera', 'sales/returns'],
  ['u_neha', 'finance/tally'],
  ['u_pooja', 'hr/attendance'],
  ['u_fhead', 'planning/season'],
  ['u_owner', 'home/alerts'],
  ['u_owner', 'home/approvals'],
];

describe('dashboard and every flow page have graphical views', () => {
  it('owner overview: stock flow, production route, grade/delivery charts and run timeline (exceptions-by-area moved to Alerts)', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_owner', 'plant1');
    const r = mount('dashboard', RentioDashboard);
    const names = [...r.container.querySelectorAll('figure')].map((f) => f.getAttribute('aria-label'));
    for (const n of ['Where the stock is now', 'Production route — material at each stage', 'Factory finished stock by grade', 'Delivery outcome by distributor', 'Runs in progress — planned vs actual']) expect(names).toContain(n);
    r.unmount();
  });

  it.each(FLOW_PAGES)('%s sees graphics on %s', (user, path) => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession(user, 'plant1');
    const r = mount(path, RENTIO_PAGES[path] as () => JSX.Element);
    expect(r.container.querySelectorAll('figure.rt-viz, figure.rt-chart').length, path).toBeGreaterThan(0);
    r.unmount();
  });

  it('stacked graphics never draw a part wider than the scale (exclusive parts, zero baseline)', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_owner', 'plant1');
    const r = mount('dashboard', RentioDashboard);
    for (const track of r.container.querySelectorAll('.rt-viz .rt-chart-track')) {
      const total = [...track.querySelectorAll<HTMLElement>('.rt-chart-seg')].reduce((a, s) => a + parseFloat(s.style.width || '0'), 0);
      expect(total).toBeLessThanOrEqual(100.5);
    }
    r.unmount();
  });
});

describe('graphics use the same scoped figures', () => {
  it('RT-001 share strip accounts for exactly 10,020 kg', () => {
    const db = createDb(new Date(), { dataset: 'demo' });
    const o = lotOutcome(db.rentio!, 'RT-001');
    expect(o.total).toBe(kg(10020));
    expect(Object.values(o.values).reduce((a, b) => a + b, 0)).toBe(kg(10020));
    expect(o.values.factory).toBe(kg(4500));
    expect(o.values.distributor).toBe(kg(3000));
    expect(o.values.retail).toBe(kg(1000));
    expect(o.values.rejectLoss).toBe(kg(395));
  });

  it('flows are scoped: D01 sees no factory steps; a stage owner sees only own stages', () => {
    const db = createDb(new Date(), { dataset: 'demo' });
    const now = new Date().toISOString();
    expect(stockFlow(db.rentio!, ractor('u_dinesh'), now, '').map((n) => n.key)).toEqual(['transit', 'dist']);
    expect(routeFlow(db.rentio!, ractor('u_anil'), now, '').map((n) => n.key)).toEqual(['OIL', 'COND', 'DRY']);
    expect(stockFlow(db.rentio!, ractor('u_pooja'), now, '').every((n) => n.value === '0 kg')).toBe(true);
  });

  it('D01 distributor graphics show nothing about D02', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_dinesh', 'plant1');
    const r = mount('distribution/distributors', RENTIO_PAGES['distribution/distributors'] as () => JSX.Element);
    const text = [...r.container.querySelectorAll('figure')].map((f) => f.textContent).join(' ');
    expect(text).not.toMatch(/D02|Konkan/);
    expect(getDb().rentio).toBeTruthy();
    r.unmount();
  });
});
