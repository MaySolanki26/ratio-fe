# Rentio Smart ERP prototype — demo assumptions

**These are configurable fictional demonstration defaults, not approved Rentio production policies.** Each one stands in for an unresolved business decision (OQ-xx in `RENTIO_SMART_ERP_PRODUCTION_REQUIREMENTS.md` §28). Change them in code at the listed location. Masters can also be changed in the app's M1 grids.

All parties, people, farmers, distributors, retailers, buyers, transporters, vehicles, bills and slips are **fictional**.

## Where the values live

| File | Contents |
| --- | --- |
| `clinic-ops-admin/src/domain/rentio/config.ts` (`DEMO`) | Tolerances, timers, shelf life, costing inputs, thresholds |
| `clinic-ops-admin/src/domain/rentio/data.ts` | Stages and owners, planned minutes, loss tolerances, parties, SKUs, rates |
| `clinic-ops-admin/src/domain/rentio/state.ts` | Locations, capacities, opening stores, equipment, rate cards, route v1 |
| M1 master grids (in the app) | Credit limits, capacities, fumigation dates, mappings — editable; the transactions read them |

## Units, measurement and identity

| Assumption | Demo value | Open question |
| --- | --- | --- |
| Base quantity unit | Kilogram, stored as integer grams. Money stored as integer paise; no floating-point arithmetic. | OQ-03 |
| Bag conversion | 25 kg bag = Counted basis. Bag tare 0.1 kg per bag, used only in dispatch weight reconciliation (never added to food mass). | OQ-03, BR-028 |
| Measurement basis by stage | Cleaning, Drying, Peeling, G2 and Packing: Actual. G1, Oiling and Conditioning: Carried. | OQ-04 |
| Lot identity | Purchase lot code (RT-001…). Children are `RT-001/<stage>`, `RT-001/<grade>`, `RT-001/RW1` (rework), `RT-001/HUSK-PEEL`, `RT-001/A1-PK` (packed). | OQ-04 |
| Fragment rule | Each position (lot × location) is one live fragment. Genealogy parents are history, not stock. | OQ-04 |
| Migrated opening stock | `MIG-xxxx` lots, labelled "origin unknown". No fabricated history. | EC-45 |

## Procurement and intake (M2)

| Assumption | Demo value | Open question |
| --- | --- | --- |
| Duplicate slip scope | Supplier + slip number (case-insensitive) | OQ-06 |
| Over-receipt tolerance | 2% of the declared purchase quantity | OQ-06 |
| Moisture commercial deduction | Above 10% moisture: 1% value per point. Kilograms are never reduced. | OQ-06, EC-04 |
| Independent checker | QC, Back Office (not the maker), Factory Head or Owner may accept intake. The maker can never approve. | OQ-02 |
| Bill matching tolerance | ±₹1 on amount; quantity must equal accepted kg. Otherwise it is disputed or accepted under policy. | OQ-06 |

## Route, stages and timing (M1/M4)

The route is **v1: Cleaning → G1 → Oiling → Seeping/Conditioning → Drying → Peeling → G2 → Packing → F1**. It comes from the source template and is not a validated factory route (OQ-01). Pitting and finishing are marked "not used (demo reason)" on the route page.

| Stage | Owner / backup | Planned | Loss tolerance |
| --- | --- | --- | --- |
| Cleaning | Suresh / Prakash | 240 min | 2% |
| G1 | Suresh / Sunita | 180 min | 1% |
| Oiling | Anil / Sunita | 120 min | 1% |
| Conditioning | Anil / Sunita | 480 min | 1% |
| Drying | Anil / Sunita | **360 min** (gives the 10:00 → 16:00 example) | 2% |
| Peeling | Prakash / Suresh | 300 min | 3% |
| G2 | Deepa / Sunita | 240 min | 1% |
| Packing | Deepa / Ravi | 240 min | 0.5% |

Planned durations, tolerances and capacities are illustrations, **not recipes**. The 6 h drying time and the 14:00–16:00 hold are demonstration values (OQ-01, OQ-12).

- Season mode multiplies planned minutes for **new** runs by a demo factor; existing runs keep their snapshot (OQ-12).
- A handover escalates after 4 h without receipt (OQ-12).
- Rework passes go back to Peeling with the pass number recorded. No maximum pass count is configured (OQ-08).

## Storage, inventory and quality (M5/M6)

| Assumption | Demo value | Open question |
| --- | --- | --- |
| Capacities | R1 60,000 kg; F1 40,000 kg (S01/S02 3,000 kg, S03–S06 2,500 kg); BYP 20,000 kg; QUAR 5,000 kg. Editable in the M1 Godowns grid. | DEP-02 |
| Shelf life | 180 days from packing date. Repack and transfer do not reset it. | OQ-07 |
| Near-expiry window | 30 days | OQ-07 |
| Fumigation interval | 30 days from the last fumigation date on the location master | OQ-16 |
| FEFO tie-break | Earliest expiry, then location ID (stack order) | OQ-11 |
| Count cutoff | Count is compared with the snapshot at submission. Difference posts only after checker approval. | OQ-11 |
| Hold propagation | A lot hold applies to all descendants. A branch can be released individually. Location holds block normal movement. A treatment hold needs QC release. | OQ-05 |
| Cleaning rejects | Held in quarantine pending QC disposition; never Husk/Churi or saleable. Counted with losses in the RT-001 "rejects + losses" line. | OQ-05 |
| Husk/Churi internal-use purposes | Boiler fuel, staff-welfare cattle feed, floor absorbent (all demo) | A7 |
| Opening stores | Oil OIL-B01 500 kg; empty 25 kg bags 1,200 | DEP-06 |

## Orders, distribution and sales (M7–M9, M12)

| Assumption | Demo value | Open question |
| --- | --- | --- |
| Factory → distributor rates | A1 ₹132, B1 ₹118, A2 ₹126, B2 ₹112, Husk ₹14, Churi ₹22 per kg | OQ-13 |
| Distributor → retailer rates | A1 ₹140, B1 ₹126 (revised to ₹128 in exception EX-3), A2 ₹134, B2 ₹120 per kg | OQ-10 |
| Rate lock | Snapshot at order acceptance. Offline orders keep the rate seen and are rejected as a conflict if the rate changed. | OQ-10 |
| Credit limits | D01 ₹15,00,000; D02 ₹9,00,000; D03 ₹8,00,000; others ₹6,00,000. Exposure = open order value − confirmed collections. | OQ-13 |
| Owner-only threshold | Credit override exposure above ₹50,000 goes to the Owner; below that Accounts decides | OQ-02 |
| Order granularity | Whole 25 kg bags | OQ-03 |
| Dispatch weight tolerance | 0.5% of net dal (vehicle gross − tare compared with net + bag tare) | OQ-03 |
| Distributor staleness | Data older than 24 h is stale (simulated last-sync hours on the master) | OQ-18 |
| Min/max stock | Min 500 kg, max 6,000 kg per distributor | FR-106 |
| Transporter rate cards | TR-01 ₹1.20/kg, TR-02 ₹1.10/kg flat. Versioned; trips keep their card. | FR-068 |
| Ownership boundary | Distributor stock is shown as network stock; legal title is not modelled | OQ-09 |
| Retailer out-for-delivery | Not modelled as a quantity bucket; deduction happens on confirmed delivery | OQ-09 |
| Collections | Retailer debt is owed to the distributor, not Rentio. Evidence is provisional until Accounts confirms. | OQ-13, BR-030 |

## Finance, HR and planning (M10, M14–M16)

| Assumption | Demo value | Open question |
| --- | --- | --- |
| Tally | Fully simulated in-browser. Sources: purchase on intake acceptance, sale on dispatch, by-product sale, freight on matched bill, receipt on confirmed collection. | DEP-04 |
| IRN | Simulated `IRN-SIM-xxxxx`. Owner is ERP unless Tally already generated one. No GST/HSN values. | OQ-13 |
| Messaging | Simulated WhatsApp/SMS log only | DEP-07 |
| Costing | Provisional: raw at purchase rate; oil ₹150/kg (demo); bags ₹12/bag (demo); freight from bills, otherwise rate-card estimate | OQ-14 |
| Payroll rule | `PAY-DEMO-v1`: daily rate × days present; OT above 8 h at 1.5× hourly (daily/8). **No PF/ESI formulas.** Pays are fictional. | OQ-15 |
| Shifts | Day 09:00–17:30; night 21:00–06:00 (an overnight shift belongs to its start date) | OQ-15 |
| Attendance file | CSV `employee,time,dir`. Whole-file hash plus per-punch dedupe. | DEP-08 |
| Forecast baseline | Needs 20 lots. The prototype allows a labelled **demo override** so the gated view can be shown. | OQ-20 |
| Packing capacity for forecast | 2,500 kg per planned packing run | OQ-12 |

## Roles and delegation (OQ-02)

| Role | User | Data scope |
| --- | --- | --- |
| Owner | Vikram Mehta | All |
| Factory Head | Sunita Rao | All stages, as backup |
| Stage owners | Suresh (Cleaning, G1), Anil (Oiling, Conditioning, Drying), Prakash (Peeling), Deepa (G2, Packing) | Own stages |
| Back Office | Kiran Shah | Factory scope |
| QC | Meera Iyer | Factory scope |
| Godown/Dispatch | Ravi Patil | Factory scope |
| Distributors | Dinesh (D01), Farah (D02) | Own distributor |
| Salesman | Rohit Verma | D01–D03 |
| Accounts | Neha Joshi | All |
| HR | Pooja Desai | HR only |
| Administrator | Arjun Menon | Setup only |

Self-approval is always refused, even when a user holds the capability. Approval routing goes to any user holding the required capability, except credit overrides above the owner threshold.

## Scenario dates

RT-001 events are dated 16–24 Nov 2026 IST. The recent exception events (RT-002 cleaning, offline orders, complaint, Tally primer, attendance import) are placed **relative to when the data set is built**, so they are never in the future.

## Added in review round 1

| Assumption | Demo value | Open question |
| --- | --- | --- |
| Read scope per role | Owner and Accounts: whole network. Back Office and QC: plant, transit and distributors. Factory Head and Godown: plant and transit. Stage owners: own stages. Distributor: own distributor. Salesman: mapped distributors. HR and Admin: no stock. Missing scope means nothing visible. | OQ-02 |
| Page access | Explicit allow-list per page (`PAGE_ACCESS` in `access.ts`) | OQ-02 |
| Escalation windows | Handover 4 h · run 2 h after planned finish · approval 8 h · intake check 2 h · reservation at risk 12 h · hold/dispute 24 h · shipment/Tally/offline 24–48 h. Past due → Factory Head (or Accounts/Back Office lead); past 2× → Owner. Season mode caps the window at the season escalation hours. | OQ-12, OQ-22 |
| Owner decisions | Only approvals beyond delegated authority (credit override over ₹50,000). Escalations appear as risks, not decisions. | OQ-02 |
| Overdue ETA | No forecast is shown ("ETA needs update") until a named stage owner or planner records a revised time with a reason | OQ-12 |
| Shared clock refresh | Every 30 s, and after each posting | NFR-12 |
| Period lock | Owner or Accounts may close a past month (IST). Reopening needs a different authorized person and a reason. | BR-010 |
| Retained samples | QC moves a sample to held "QC retained samples" custody; testing or disposal deducts it once | OQ-11 |
| Excess at distributor receipt | Held as `UNID-EXC-<shipment>` at the distributor's held location, with a receipt dispute | §18 |
| Demo snapshot (default data set) | RT-001 completed. RT-003: 3,000 kg from fictional Farmer Gita Bai — cleaned (30 kg rejects) and G1 done, issued to Oiling for Anil to receive (≈6 kg oil in the walkthrough). RT-004: 5,000 kg accepted raw in R1. The recent exception events are relative to the build time. | — |
