/**
 * CONFIGURABLE FICTIONAL DEMO DEFAULTS. Each value is documented in
 * docs/rentio/DEMO_ASSUMPTIONS.md with its open-question reference. None of these
 * is an approved Rentio production policy.
 */
export const DEMO = {
  /** OQ-06: duplicate slip identity = supplier + slip number. */
  slipScope: 'supplier+slip',
  /** OQ-06: over-receipt tolerance vs open purchase balance. */
  overReceiptPct: 2,
  /** EC-04: moisture above this % creates a COMMERCIAL deduction only (kg unchanged). */
  moistureDeductionAbovePct: 10,
  moistureDeductionPerPointPct: 1,
  /** OQ-07: shelf life for packed dal (days from packing date). */
  shelfLifeDays: 180,
  /** BR-028: empty bag tare for dispatch reconciliation. */
  bagTareG: 100,
  /** FR-040: dispatch net-weight tolerance. */
  dispatchTolerancePct: 0.5,
  /** Hours a handover may wait for receipt before it escalates. */
  handoverEscalationHours: 4,
  /** Distributor data is stale after this many hours without sync (FR-077). */
  staleDistributorHours: 24,
  /** Near-expiry warning window. */
  nearExpiryDays: 30,
  /** Fumigation interval for godowns (days). */
  fumigationIntervalDays: 30,
  /** FR-090/OQ-20: lots required for an owner-approved yield baseline. */
  baselineLotsRequired: 20,
  /** Allowed internal-use purposes for Husk/Churi (A7: configurable, none assumed). */
  internalPurposes: ['Boiler fuel (demo)', 'Cattle feed — staff welfare (demo)', 'Floor absorbent (demo)'],
  /** Payroll demo rule version. */
  payrollRule: 'PAY-DEMO-v1 (daily rate × days; OT 1.5× hourly; no statutory formulas)',
  otAfterHours: 8,
  /** Provisional costing inputs (OQ-14) — demo values, not Rentio costs. */
  oilCostRupeesPerKg: 150,
  bagCostRupees: 12,
  /** Forecast packing capacity per planned packing run (OQ-12). */
  packingKgPerRun: 2500,
  /** Owner-only threshold: approvals with exposure above this go to the owner (₹). */
  ownerExposureRupees: 50000,
};
