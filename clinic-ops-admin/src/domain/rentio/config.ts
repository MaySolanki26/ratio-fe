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
  /** FR-103 repacking: maximum recorded loss as % of input before the repack is refused (use a count/adjustment instead). */
  repackLossTolerancePct: 1,
  /** Replenishment policy (FR-101/106/113/117, WF-12) — fictional demo parameters, not Rentio policy. */
  replenish: {
    /** Plant raw cover kept in R1 beyond open demand (kg). */
    rawMinKg: 12000,
    /** Supplier lead time (days): only purchases promised within this window reduce the need. */
    rawLeadDays: 3,
    /** Demo raw → packed dal yield used to convert finished demand into raw (%). */
    yieldPct: 75,
    /** Finished-goods minimum kept in F1 (kg) — demand above available stock creates raw need. */
    finishedMinKg: 2000,
    /** Critical stores: minimum, reorder-to level and vendor lead time (units: kg for oil, count for bags/pouches). */
    stores: [
      { lotId: 'OIL-B01', label: 'Edible oil (oiling addition)', unit: 'kg', min: 150, max: 500, leadDays: 3 },
      { lotId: 'BAGS-25-B01', label: 'Empty 25 kg PP bags', unit: 'bags', min: 300, max: 1500, leadDays: 4 },
      { lotId: 'POUCH-1-B01', label: '1 kg retail pouches', unit: 'pouches', min: 400, max: 1000, leadDays: 5 },
    ] as { lotId: string; label: string; unit: 'kg' | 'bags' | 'pouches'; min: number; max: number; leadDays: number }[],
    /** Partner reorder level = distributor minimum + lead days × daily offtake; refill up to the distributor maximum. */
    partnerLeadDays: 2,
    partnerDailyOfftakeKg: 40,
  },
};
