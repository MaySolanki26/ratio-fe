import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { domain, useDomain } from '../domain/active';
import { rentioDomain } from '../domain/rentio/domain';
import { __setDb, createDb, defaultSettings } from '../services/db';
import { getSettings } from '../services/settings';

// Owner decision (2026-11-25): Rentio's default theme is "Rentio Heritage" (the sign-in page colours).
describe('Rentio default theme', () => {
  const before = domain();
  beforeAll(() => useDomain(rentioDomain));
  afterAll(() => useDomain(before));

  const withSaved = (saved: Record<string, unknown>) => {
    const db = createDb(new Date('2026-11-24T18:00:00+05:30'));
    db.settings.u_owner = { ...defaultSettings(), ...saved } as never;
    __setDb(db);
  };

  it('a new user starts on Rentio Heritage', () => {
    __setDb(createDb(new Date('2026-11-24T18:00:00+05:30')));
    expect(getSettings('u_owner').palette).toBe('rentio');
  });

  it('a user still on the old Graphite default moves to Rentio Heritage once', () => {
    withSaved({ palette: 'graphite', themeRev: 2 });
    expect(getSettings('u_owner').palette).toBe('rentio');
  });

  it('a palette the user picked is kept', () => {
    withSaved({ palette: 'ocean', themeRev: 2 });
    expect(getSettings('u_owner').palette).toBe('ocean');
  });

  it('choosing Graphite after the move is kept', () => {
    withSaved({ palette: 'graphite', themeRev: 3 });
    expect(getSettings('u_owner').palette).toBe('graphite');
  });
});
