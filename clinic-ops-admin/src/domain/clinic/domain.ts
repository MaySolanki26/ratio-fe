/** The original clinic example domain, kept intact as a selectable pack (its tests use it). */
import type { AppDomain } from '../active';
import { prng } from '../../lib/ids';
import type { RecordData } from '../../metadata/types';
import { clinicPack, demoUsers, organization, workspaces } from './pack';
import { referralPortal, referralTags, seedClinic } from './seed';

export const clinicDomain: AppDomain = {
  id: 'clinic',
  productName: 'Clinic Operations Admin',
  pack: clinicPack,
  users: demoUsers,
  organization,
  workspaces,
  storageKey: 'uab.clinic-ops.db.v1',
  schemaVersion: 5,
  seedNumber: 4102,
  currency: 'USD',
  locale: 'en-US',
  defaultSession: { userId: 'u_morgan', workspaceId: 'riverside' },
  banner: 'Synthetic data stored only in this browser · Roles are simulated (no real sign-in) · Nothing is sent, charged or shared.',
  seed: (now) => seedClinic(4102, now),
  upgrade(raw) {
    const parsed = raw as { records: Record<string, RecordData[]> };
    for (const rec of parsed.records.referrals ?? []) {
      if ('tags' in rec) continue;
      const r = prng([...rec.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) >>> 0);
      rec.tags = referralTags(r);
      rec.portalUrl = referralPortal(r);
    }
  },
};
