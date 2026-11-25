import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { useDomain } from '../domain/active';
import { rentioDomain } from '../domain/rentio/domain';
import { __setDb, createDb } from '../services/db';
import { switchSession } from '../services/settings';

useDomain(rentioDomain);

const URLS = [
  '/',
  '/o/rentio/w/plant1/dashboard',
  '/o/rentio/w/plant1/home/my-work',
  '/o/rentio/w/plant1/masters/distributors',
  '/o/rentio/w/plant1/masters/suppliers',
  '/o/rentio/w/plant1/masters/locations',
  '/o/rentio/w/plant1/hr/employees',
  '/o/rentio/w/plant1/production/stage?stage=CLEAN',
  '/o/rentio/w/plant1/admin/access',
  '/o/rentio/w/plant1/admin/audit',
];

describe('full app shell renders Rentio routes', () => {
  it.each(['u_owner', 'u_rohit', 'u_arjun'])('as %s', (user) => {
    __setDb(createDb(new Date(), { dataset: 'completed' }));
    switchSession(user, 'plant1');
    for (const url of URLS) {
      window.history.pushState({}, '', url);
      const { container, unmount } = render(<App />);
      expect(container.textContent).toContain('Prototype');
      const m = (container.textContent ?? '').match(/.{80}(Page not found|not available).{80}/);
      expect(m?.[0] ?? '', url).toBe('');
      expect(container.textContent).not.toMatch(/Something went wrong/);
      unmount();
    }
  });

  it('a personal My Work link only works for its owner', () => {
    __setDb(createDb(new Date(), { dataset: 'start' }));
    switchSession('u_owner', 'plant1');
    window.history.pushState({}, '', '/u/u_suresh/my-work');
    const r = render(<App />);
    expect(r.container.textContent).toContain('This personal link belongs to another user');
    r.unmount();
    switchSession('u_suresh', 'plant1');
    window.history.pushState({}, '', '/u/u_suresh/my-work');
    const r2 = render(<App />);
    expect(r2.container.textContent).toContain('My work');
    r2.unmount();
  });

  it('salesman sees only mapped distributors in the master grid (row scope)', () => {
    __setDb(createDb(new Date(), { dataset: 'completed' }));
    switchSession('u_rohit', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/masters/distributors');
    const { container, unmount } = render(<App />);
    expect(container.textContent).toContain('Shree Ganesh');
    expect(container.textContent).not.toContain('Pune Pulse Point');
    unmount();
  });
});
