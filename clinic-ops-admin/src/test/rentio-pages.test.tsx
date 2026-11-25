import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../components/primitives/feedback';
import { useDomain } from '../domain/active';
import { rentioDomain } from '../domain/rentio/domain';
import { __setDb, createDb, getDb } from '../services/db';
import { switchSession } from '../services/settings';
import { RENTIO_PAGES, RentioDashboard } from '../rentio/pages';

useDomain(rentioDomain);

const ROLES = ['u_owner', 'u_fhead', 'u_suresh', 'u_kiran', 'u_meera', 'u_ravi', 'u_dinesh', 'u_rohit', 'u_neha', 'u_pooja', 'u_arjun'];

function mount(path: string, Page: () => JSX.Element) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/o/rentio/w/plant1/${path}`]}>
        <div id="topbar-title" />
        <Page />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe.each(['start', 'completed'] as const)('every Rentio screen renders (%s data set)', (dataset) => {
  beforeAll(() => {
    __setDb(createDb(new Date(), { dataset }));
  });
  for (const [path, Page] of Object.entries(RENTIO_PAGES)) {
    it(`${path} renders for every role`, () => {
      for (const u of ROLES) {
        switchSession(u, 'plant1');
        const { unmount, container } = mount(path, Page as () => JSX.Element);
        expect(container.textContent?.length).toBeGreaterThan(0);
        // U1: requirement codes stay inside "Implementation details", never in normal operational copy
        if (path !== 'home/decisions' && path !== 'presenter/journey') {
          const copy = container.cloneNode(true) as HTMLElement;
          copy.querySelectorAll('.rt-impl').forEach((n) => n.remove());
          expect(copy.textContent ?? '', `${path} as ${u}`).not.toMatch(/\b(FR|BR|EC|OQ|WF|NFR|AC)-\d{2,3}\b/);
        }
        unmount();
      }
    });
  }
  it('owner overview leads with decisions; the presenter trace shows the derived RT-001 balance', () => {
    switchSession('u_owner', 'plant1');
    const r = mount('dashboard', RentioDashboard);
    expect(screen.getByText('Needs your decision')).toBeInTheDocument();
    r.unmount();
    mount('presenter/journey', RENTIO_PAGES['presenter/journey'] as () => JSX.Element);
    if (dataset === 'completed') expect(screen.getAllByText(/10,020 kg/).length).toBeGreaterThan(0);
    expect(getDb().rentio!.dataset).toBe(dataset);
  });
});

describe('store adapter (commitDraft)', () => {
  it('a failed browser-store write leaves live state unchanged and reports the failure', async () => {
    const { act } = await import('../rentio/store');
    const { __failNextWrites, getPersistError } = await import('../services/db');
    __setDb(createDb(new Date(), { dataset: 'completed' }));
    switchSession('u_ravi', 'plant1');
    const before = JSON.stringify(getDb().rentio);
    __failNextWrites(1);
    const r = act('use husk', (ctx) => ctx.s.movements.length);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('persist_failed');
    expect(getPersistError()).toMatch(/Simulated storage failure/);
    expect(JSON.stringify(getDb().rentio)).toBe(before);
  });

  it('blocked attempts are logged for investigation without changing stock', async () => {
    const { act } = await import('../rentio/store');
    const O = await import('../domain/rentio/ops');
    __setDb(createDb(new Date(), { dataset: 'completed' }));
    switchSession('u_ravi', 'plant1');
    const moves = getDb().rentio!.movements.length;
    const r = act('over-issue', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S03', to: 'F1-S06', kg: 5000 }));
    expect(r.code).toBe('negative_stock');
    expect(getDb().rentio!.movements.length).toBe(moves);
    expect(getDb().rentio!.failures[0].code).toBe('negative_stock');
    expect(getDb().audit[0].action).toBe('rentio.denied');
  });

  it('Rentio uses its own versioned storage key and never writes the clinic key', () => {
    switchSession('u_owner', 'plant1');
    expect(localStorage.getItem('rentio.erp.db.v1')).toBeTruthy();
    expect(localStorage.getItem('uab.clinic-ops.db.v1')).toBeNull();
  });
});

describe('older stored data is preserved on a data-version change', () => {
  it('copies the previous version to a backup key before seeding', async () => {
    localStorage.setItem('rentio.erp.db.v1', JSON.stringify({ schemaVersion: 101, marker: 'old-review-data' }));
    vi.resetModules();
    const db = await import('../services/db');
    expect(db.getDb().schemaVersion).not.toBe(101);
    expect(JSON.parse(localStorage.getItem('rentio.erp.db.v1.backup.v101')!).marker).toBe('old-review-data');
  });
});
