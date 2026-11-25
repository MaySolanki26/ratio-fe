/** Small copy helpers for fork-C pages: keep requirement codes out of operational text. */

/** Strip leading requirement references like "BR-009: " or "FR-015 / BR-003: " from a rule sentence. */
export const plainRule = (rule: string) => rule.replace(/^(?:\s*(?:FR|BR|EC|WF|NFR|OQ|AC)-\d+[–-]?\d*\s*(?:\/|,)?\s*)+:\s*/i, '').replace(/^./, (c) => c.toUpperCase());

const DECIDERS: Record<string, string> = {
  'approve.residual': 'Factory Head',
  'approve.adjustment': 'Factory Head',
  'approve.disposal': 'Factory Head',
  'approve.regrade': 'QC or Factory Head',
  'approve.capacity': 'Factory Head',
  'approve.credit': 'Accounts',
  'approve.fefo': 'Factory Head',
  'approve.freight': 'Accounts',
  'payroll.authorize': 'Accounts (payroll hand-off)',
};
export const deciderLabel = (cap: string) => DECIDERS[cap] ?? cap;
