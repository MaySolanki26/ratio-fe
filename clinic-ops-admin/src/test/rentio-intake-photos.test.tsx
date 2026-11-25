/**
 * M2 truck intake: the slip evidence is an uploaded photo (not a typed reference). The photo is required,
 * saved on the intake with its file name kept as evidence, survives refresh, and the checker sees it.
 */
import { act as rtlAct, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { useDomain } from '../domain/active';
import { rentioDomain } from '../domain/rentio/domain';
import { ractor } from '../domain/rentio/access';
import { execute } from '../domain/rentio/engine';
import { recordIntake } from '../domain/rentio/ops';
import { __setDb, createDb, getDb, storageKey } from '../services/db';
import { switchSession } from '../services/settings';
import type { Db } from '../services/types';

useDomain(rentioDomain);

const WS = '/o/rentio/w/plant1';

beforeEach(() => {
  cleanup();
  localStorage.clear();
  const db = createDb(new Date(), { dataset: 'demo' });
  localStorage.setItem(storageKey(), JSON.stringify(db));
  __setDb(db);
});

const as = (user: string, page: string) => {
  cleanup();
  switchSession(user, 'plant1');
  window.history.pushState({}, '', `${WS}/${page}`);
  return render(<App />);
};
const dialog = () => screen.getByRole('dialog');
const set = (label: RegExp, value: string) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } });
const png = (name: string) => new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });

describe('truck intake photo evidence', () => {
  it('requires a slip photo, stores it on the intake and shows it to the checker after refresh', async () => {
    const before = getDb().rentio!.intakes.length;
    as('u_kiran', 'procurement/intake');
    fireEvent.click(screen.getAllByRole('button', { name: 'Record truck' })[0]);
    set(/Truck number/, 'MH12-ZZ-0001');
    set(/Weighbridge slip no/, 'WB-99001');
    set(/^Gross/, '1200');
    set(/^Tare/, '1000');
    // no text box for a reference any more — an image picker instead
    expect(within(dialog()).queryByPlaceholderText(/slip-WB/)).toBeNull();
    const picker = within(dialog()).getByLabelText(/Weighbridge slip \/ truck photos/) as HTMLInputElement;
    expect(picker.type).toBe('file');
    expect(picker.accept).toBe('image/*');

    // submitting without a photo is refused and posts nothing
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Submit for checker' }));
    expect(within(dialog()).getByText(/Required: .*Weighbridge slip \/ truck photos/)).toBeInTheDocument();
    expect(getDb().rentio!.intakes).toHaveLength(before);

    // a non-image is rejected; the image is added as a removable thumbnail
    await rtlAct(async () => void fireEvent.change(picker, { target: { files: [png('slip-WB-99001.png'), new File(['x'], 'notes.txt', { type: 'text/plain' })] } }));
    await waitFor(() => expect(within(dialog()).getByRole('button', { name: 'View photo slip-WB-99001.png' })).toBeInTheDocument());
    expect(within(dialog()).getByText(/Only image files can be attached/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Remove photo slip-WB-99001.png' })).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Submit for checker' }));
    const intakes = getDb().rentio!.intakes;
    expect(intakes).toHaveLength(before + 1);
    const rec = intakes[intakes.length - 1];
    expect(rec.evidence).toEqual(['slip-WB-99001.png']);
    expect(rec.photos).toHaveLength(1);
    expect(rec.photos![0].dataUrl).toMatch(/^data:image\//);

    // refresh: the photo is still there and the independent checker sees it in the decision form
    __setDb(JSON.parse(localStorage.getItem(storageKey())!) as Db);
    expect(getDb().rentio!.intakes.find((i) => i.id === rec.id)!.photos).toHaveLength(1);
    as('u_meera', `procurement/intake?focus=${rec.id}`);
    const row = screen.getAllByRole('row').find((r) => r.textContent!.includes('MH12-ZZ-0001'))!;
    expect(within(row).getByRole('button', { name: 'View photo slip-WB-99001.png' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Check intake' }));
    expect(within(dialog()).getByText(/Slip \/ truck photos from the gate/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'View photo slip-WB-99001.png' })).toBeInTheDocument();
  });

  it('the service refuses an intake whose only "photo" is not an image, and posts nothing', () => {
    const db = getDb();
    const before = JSON.stringify(db.rentio!.intakes);
    const purchase = db.rentio!.purchases.find((p) => p.status !== 'closed' && p.status !== 'cancelled')!;
    const now = new Date().toISOString();
    expect(() =>
      execute(db, ractor('u_kiran'), { label: 'Record truck intake', at: now, now }, (ctx) =>
        recordIntake(ctx, { purchaseId: purchase.id, truck: 'X1', slip: 'WB-1', grossKg: 1200, tareKg: 1000, photos: [{ name: 'evil.html', dataUrl: 'data:text/html,<b>' }] }),
      ),
    ).toThrow(/Attach the weighbridge slip photo/);
    expect(JSON.stringify(getDb().rentio!.intakes)).toBe(before);
  });
});
