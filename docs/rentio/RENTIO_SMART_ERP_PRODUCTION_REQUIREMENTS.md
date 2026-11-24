# Rentio Smart ERP — Complete Production & Business Requirements

**A working specification for the owner, factory team, business analyst, developers, QA and implementation agents.**

| Field | Value |
| --- | --- |
| ID | PRD-RENTIO-001 |
| Version | 0.2.0 — owner operations and workload review |
| Status | **Draft — business validation required; not signed off** |
| Accountable owner | Rentio Owner; named module SPOCs to be assigned |
| Prepared for | Rentio and Sarvadhi Solutions |
| Updated | 24 November 2026, Asia/Kolkata |
| Scope baseline | Exactly M1–M16 from the Scope of Work, including the 14 October procurement/by-product clarifications |
| Intended use | Requirements review, estimation, workflow design, implementation backlog and acceptance testing |

**Change log**

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.2.0 | 2026-11-24 | Owner operations review | Added practical factory/godown/commercial controls and exception-led daily operation; clarified stock-boundary and quality-hold behavior; preserved M1–M16 and prior IDs. |
| 0.1.0 | 2026-11-24 | BA consolidation | Reconciled three source PDFs and available prior chat; expanded operating workflows, stock controls, scenarios and decisions. No new module added. |

> **Read first:** “Confirmed” means explicitly present in a supplied source or the current request, not proof of a signed commercial agreement. Detailed safeguards marked **P** are proposals for validation. Unknown values are deliberately left as decisions, not silently filled in. The historical three-month plan is preserved as source context, not restarted or promised by this document.

## Contents

1. [Product Information](#1-product-information)
2. [Executive Summary](#2-executive-summary)
3. [Business Context](#3-business-context)
4. [Problem Statement](#4-problem-statement)
5. [Objectives](#5-objectives)
6. [Success Metrics](#6-success-metrics)
7. [Stakeholders](#7-stakeholders)
8. [Target Users & Personas](#8-target-users--personas)
9. [User Journeys](#9-user-journeys)
10. [Scope](#10-scope-in--out)
11. [Assumptions](#11-assumptions)
12. [Constraints](#12-constraints)
13. [Dependencies](#13-dependencies)
14. [Functional Requirements — all 16 modules](#14-functional-requirements)
15. [Non-Functional Requirements](#15-non-functional-requirements)
16. [Workflows & State Machines](#16-workflows--state-machines)
17. [User Stories](#17-user-stories)
18. [Business Rules & Stock Accounting](#18-business-rules)
19. [Data Requirements](#19-data-requirements)
20. [Roles & Permissions](#20-roles--permissions)
21. [Multi-Tenancy](#21-multi-tenancy)
22. [Integrations & Compliance](#22-integrations)
23. [Business Event Contracts](#23-event-contracts)
24. [Notifications & Escalation](#24-notifications)
25. [UX / Design Contract](#25-ux--design-contract)
26. [Error Taxonomy & Edge Cases](#26-error-taxonomy--edge-cases)
27. [Risks](#27-risks)
28. [Open Questions & Conflicts](#28-open-questions)
29. [Acceptance Criteria & Go-Live](#29-acceptance-criteria)
30. [Future Roadmap](#30-future-roadmap)
31. [Appendix & Source Traceability](#31-appendix)

## 1. Product Information

Rentio Smart ERP follows raw whole toor from farmer/vendor purchase through processing, packing, factory storage, transport, distributors and retailer delivery. It also accounts for recoverable by-products, returns, consumables, staff attendance and commercial handoffs to Tally.

The operating promise is: **every quantity has an identity, a location/custodian, a condition, a responsible person and a recorded history.** Employees see their own next action; the owner sees the whole journey.

### Evidence register and interpretation

| Key | Source reviewed | Evidence available | Use |
| --- | --- | --- | --- |
| S1 | `Rentio_Smart_ERP_Scope_of_Work.pdf` | All 6 physical pages; 13 October baseline and 14 October inserted update | Authoritative M1–M16 names, boundaries, migration, delivery/support context |
| S2 | `Rentio_Smart_ERP_Requirements_Specification_.pdf` | All 13 physical pages, including three inserted update pages | Original FR-M / FR-1…FR-14 and BR-1…BR-18 requirements |
| S3 | `Rentio_Smart_ERP_Proposal.pdf` | All 6 physical pages, including procurement/by-product update | Business problems, operating journey, owner and employee views |
| S4 | Prior chat, “Create ERP page outline” | Available thread messages, including previous master-MD delivery summary and latest workflow summary | Later intent, configurable sequences, issue/receive, saved filters, central decisions, stock flags |
| S5 | Initial specification request | Full request | Comprehensive manufacturing specification, scenarios, explicit evidence/assumption separation, Markdown output |
| S6 | Owner-perspective review request | Full follow-up request | Cross-verify daily mill, godown and distribution operations; fill gaps and reduce owner/staff burden |
| E5–E6 | NIFTEM processing handbook; FSSAI hygiene requirements | Official references checked 24 November 2026; linked in §22 | Industry cross-check; not evidence of Rentio’s installed equipment or approved route |
| E1–E4 | Official regulatory references | Linked in §22, checked 24 November 2026 | Compliance context; applicability still requires Rentio Accounts/compliance validation |
| U1 | Prior `RENTIO_SMART_ERP_AGENT_MASTER_REQUIREMENTS.md` | **Full file unavailable**; earlier chat has a historical download link and summary only | Cannot verify its full text, exact 25 workflows, 38 tests or 22 decision categories; no claim of verbatim preservation |

The three PDFs were found in `/Users/maysolanki/Downloads/Rantio/`. Page references in this document mean **physical PDF page**, because inserted updates make printed page numbers inconsistent. The current project folder contained no earlier requirements file. No unrelated application specification is treated as a Rentio source.

**Evidence labels:** **C** = source-confirmed requirement; **P** = proposed detail/safeguard elaborating the request; **O** = unresolved decision. A row marked C can cite a P refinement separately in its explanation. Normative words MUST/SHOULD describe intended product behavior, not approval status. Proposed MUST requirements become release obligations only when accepted. Priority and complexity are planning proposals: Must = release essential; Should = important; Could = optional; complexity 1–5 = small through cross-domain/uncertain. IDs in this document are new stable IDs; legacy source IDs remain traceable in §31.

## 2. Executive Summary

Rentio needs one connected operating record across procurement, processing, godowns, transport and its initial 17 distributors. The owner must be able to answer “How much material is at each stage, who is responsible, when will it finish, and what can we promise customers?” without calling each employee.

The normal manufacturing route described in the prior discussion is **Purchase → Intake/weighbridge/QC → Raw godown → G1 size grading → Oiling → Seeping → Drying → Peeling/Splitting → G2 final grading → Packing → Finished godown → Dispatch → Distributor → Retailer**. This is a configurable route template, not an immutable machine sequence. Factory validation must establish exactly what “Seeping” means locally, any conditioning repetitions, optional stages and permitted reprocessing paths.

Each handover records an issue by the sender and a receipt by the receiver. Intermediate quantities may be measured, counted or carried forward; their confidence remains visible until reconciliation. The system must never present an estimate as a weighed fact. Stage timers distinguish waiting, processing and holds. Grading and reprocessing create linked child quantities so the original purchase remains traceable without counting both parent and children as current stock.

Sales reservations protect stock without physically moving it. Dispatch moves custody to In-Transit; distributor receipt settles received quantities and exceptions. Retailer delivery deducts distributor inventory once. Husk and Churi remain valuable stock with their own origin, internal use, sales and closing balance, rather than disappearing into “loss.”

The approved module structure stays at 16. Quality release, recall support, audit, approvals and planning are capabilities within those modules. Tally remains the books of record. Production readiness means reconciled stock, tested exception paths, trained users, permissions, recoverability and resolved blocking decisions—not simply completed screens.

### Owner review verdict — 0.2.0

**The original specification provides a strong core, but it was not sufficient by itself to operate the whole business with little owner intervention.** It described transaction controls more fully than daily preparation, storage handling, commercial follow-up and who resolves routine problems. This revision closes those specification gaps with explicit proposals inside M1–M16.

The owner should be able to start with six answers: **where is stock; what will finish; what can be delivered; what needs buying; what money needs follow-up; which decisions need me?** Most work should proceed through assigned staff and existing approved rules. Owner attention is reserved for delegated limits exceeded, unresolved critical risks and policy choices. Required independent checks remain in place.

The additions cover route-completeness checks, process/packing readiness, stack/bin locations, warehouse treatment holds, repacking, samples and recovered material, replenishment, purchase–receipt–bill matching, delivery evidence, payment follow-up, daily work planning and workload measures. The full review map is in §31; a short companion guide is supplied for owner review.

**Readiness judgment:** suitable as a comprehensive requirements draft for walkthrough and estimation after this review. It becomes a usable operating baseline only after the team validates the actual route, measurements, delegation, quality release and commercial ownership rules, and passes the integrated tests. No document review can verify the physical mill or prove software behavior without those checks.

## 3. Business Context

S3 describes separate Sales Trend, forms, spreadsheets, phone calls and Tally records. Rentio purchases whole toor, has 8+ processing activities, factory godowns, 17 distributor partners and its own salesmen supporting retailers. S3 cites approximately 55–60 staff and a 10–15% unpeeled reprocessing loop as context; these are not fixed headcount limits or mandatory yield assumptions.

The 14 October refresh explicitly adds farmer/vendor purchase accountability and internal/external Husk/Churi movement **inside the existing scope**. It does not authorize farmer advances, a new accounting engine, a seventeenth module or a separate delivery promise.

## 4. Problem Statement

The owner cannot reliably locate material across stages and partners from the disconnected records described in S3. Stage owners lack a shared handover and completion record, making delays and responsibility difficult to establish. Unmeasured intermediate quantities conceal whether a final packing shortage arose from processing, measurement or a missed transfer. Distributor stock ages and receipts are inconsistently visible, affecting delivery promises, disputes and expiry handling. Accounts must reconcile commercial records with Tally, while HR maintains attendance/payroll for the workforce.

The frequency and financial cost of these problems have not been measured. Establish baseline measurements during discovery; do not invent savings percentages or existing loss rates.

## 5. Objectives

| ID | Intended outcome | Verification |
| --- | --- | --- |
| OBJ-1 | Locate every accountable quantity without duplicate stock | MET-1, MET-2 |
| OBJ-2 | Make stage ownership, completion expectations and delays visible | MET-3 |
| OBJ-3 | Let each employee complete daily work with role-specific actions | MET-4 |
| OBJ-4 | Protect availability, customer promises and distributor accuracy | MET-5 |
| OBJ-5 | Reconcile procurement, by-products, dispatch and commercial records | MET-6, MET-7 |
| OBJ-6 | Operate with auditable controls and recoverable records | MET-8, MET-9 |
| OBJ-7 | Reduce owner interruptions and repeated staff entry | MET-11, MET-12, MET-13 |

## 6. Success Metrics

Targets marked P are proposed acceptance targets, not historical commitments. Baselines are unknown unless explicitly stated.

| ID | Type | Metric / target | Baseline | Timeframe / method | Basis |
| --- | --- | --- | --- | --- | --- |
| MET-1 | acceptance | 100% of stock-affecting UAT postings identify lot/traceable stock batch, quantity, unit, custody and actor | Unknown | UAT ledger inspection | C/P, S2 BR-1; stores extension P |
| MET-2 | acceptance | Zero unexplained balance difference above approved measurement precision in UAT and opening reconciliation | Unknown | Before go-live; §18 equations | C, S1 acceptance; equation refinement P |
| MET-3 | acceptance | 100% of active stage runs show owner, backup, expected finish and measured actual/elapsed time | Unknown | UAT, normal and held runs | C/P, S2 |
| MET-4 | acceptance | At least 90% of trained representative users complete their normal receive/start/output/issue task without assistance in ≤2 minutes, excluding physical work | Unknown | Observed pilot; sample size agreed at sign-off | P |
| MET-5 | acceptance | Zero overselling or duplicate deduction in concurrent, offline and delivery UAT scenarios | Unknown | Scripted scenario suite | P, supports C negative-stock rule |
| MET-6 | acceptance | Tally sync success ≥99%, with every failure visible | Unknown | S1 target; proposed measurement: unique eligible documents acknowledged within 24h / all eligible documents, over 7 consecutive pilot days | C target / P window |
| MET-7 | acceptance | Zero duplicate IRNs and zero untraceable by-product movements in UAT | Unknown | Repeated submission and balance tests | C, S1/S2 |
| MET-8 | acceptance | 100% of tested corrections retain original and reversal history | Unknown | Privilege/correction tests | C, S2 |
| MET-9 | acceptance | One full recovery rehearsal meets approved RPO/RTO | Unknown | Pre-launch restore drill | P; §15 |
| MET-10 | monitoring | Report daily: yield by route/grade, overdue stage quantity, handover age, distributor stock freshness and returns rate; no claimed improvement until baseline | Not measured | First 30 operating days; owner then sets numeric improvement targets | P measurement plan |
| MET-11 | acceptance | Zero routine, within-authority transactions require owner action in a 30-case pilot; all source-required checker actions still occur | Unknown | Role pilot with intake, production, godown, order and dispatch cases; all exceptions intentionally outside authority tested separately | P, S6 |
| MET-12 | acceptance | 100% of shared source fields in ten representative handovers populate from the linked record; independent receiver quantity/QC checks remain required | Unknown | Observe user entry and compare source/target references; no repeated typing of lot, party or order identity | P, S6 |
| MET-13 | monitoring | Proposed target: reduce owner follow-up minutes per 100 completed operating transactions by 30% within 60 operating days; preserve accuracy/exception response | First ten operating days | Staff-recorded sample of calls, chasing and approvals; count unresolved/late critical exceptions alongside time saved; target needs owner acceptance | P, S6 |

## 7. Stakeholders

| Role | Responsibility |
| --- | --- |
| Rentio Owner | Final business decisions, route/yield approval, release sign-off and exceptional approvals |
| Module SPOCs | Validate terminology, rules, master data and UAT within assigned M1–M16 |
| Factory Head | Production route, stage staffing, capacity, holds, loss and daily close |
| Stage owners and backups | Record physical activity and handovers, validate adoption |
| Back Office / store / dispatch team | Purchase, weighing evidence, inventory, trips and migration |
| Accounts | Rates/credit policy, tax applicability, Tally reconciliation and period close |
| Sales lead, salesmen and distributor representatives | Orders, receipt, retailer delivery and partner stock discipline |
| HR | Attendance, shifts, payroll rules and employee privacy |
| Sarvadhi delivery / QA team | Traceability, implementation, verification, training and support |

Named people and approval limits remain OQ-02. Separate roles may be assigned to the same trained person subject to segregation controls.

## 8. Target Users & Personas

The task-oriented split below elaborates the source roles; it does not add staffing commitments.

| Persona | Goal and pain point | Context | Simple daily actions |
| --- | --- | --- | --- |
| P1 Owner | Locate stock and resolve exceptions without repeated calls | Control Tower on web | Review summary → open exception → approve/reject with reason → assign follow-up |
| P2 Factory Head | Clear bottlenecks; avoid hidden holds and losses | Shift planning and floor review | Prioritize lots → inspect stage queues → resolve holds → review close |
| P3 Stage Owner / Backup | Accept correct quantity; prove work and handover | Desktop/tablet at assigned stage | Receive → Start → Record output/loss/by-products → Issue; Pause/Report issue when needed |
| P4 Procurement / Back Office | Connect farmer/vendor purchases to accepted raw stock | Office and gate | Select supplier → enter purchase → attach evidence → submit intake |
| P5 Weighbridge / Intake operator | Capture weights without disputes or duplication | Gate with manual slip entry | Enter gross/tare → attach slip/photo → compare → submit for check |
| P6 QC / authorized quality checker | Keep unsafe or wrong-grade stock out of sale | Intake, grading, packing and returns | Record check → release/hold/reject → submit re-grade/disposition |
| P7 Godown / inventory keeper | Know location, age and count differences | Assigned godowns/stores | Receive → put away → transfer/issue → count → close |
| P8 Packing / dispatch operator | Pack and dispatch the right reserved goods | Packing line / dispatch desk | Reconcile pack output → pick FEFO → weigh → load → dispatch |
| P9 Logistics coordinator | Settle trips and weight/freight differences | Office and delivery follow-up | Assign trip → track custody → investigate shortage → reconcile freight |
| P10 Distributor user | Receive and sell with a reliable own-stock view | Android/iOS | Receive shipment → report variance → fulfill retailer order → record outside-app sale → count |
| P11 Salesman | Take valid retailer orders despite poor connectivity | Android/iOS, mapped distributor visits | View stock/rate freshness → punch order → track delivery → log complaint/collection |
| P12 Accounts | Avoid duplicate invoices and unreconciled balances | Web, Tally reconciliation | Review credit → sync documents → fix failures → reconcile → close period |
| P13 HR | Produce explainable attendance/payroll | Web, biometric/import review | Import punches → resolve exceptions → approve attendance → run/review payroll |
| P14 Setup Administrator | Maintain access and configuration without changing history | Controlled web access | Maintain masters → submit route/rule changes → manage assignments → review access |

QC, packing, logistics and administrator are proposed permission profiles under source role configuration. A QC profile does not automatically confer commercial or stock-adjustment approval rights.

## 9. User Journeys

| Journey | Persona / job | Trigger → daily steps → outcome | Exception resolution |
| --- | --- | --- | --- |
| J1 | P1, know what needs attention | Open Control Tower → inspect stale/critical flags → drill into lot → decide approval → track action | Unknown quantities stay labelled; no blanket stock edit |
| J2 | P2, meet output target | Review due orders and queue → assign capacity/priority → watch hold/ETA → confirm shift close | Breakdown reroutes only through approved path |
| J3 | P3, move a lot through own stage | Open My Stage → accept issue → start → record outputs → issue available portion → daily close | Mismatch goes to dispute; residual stays visible |
| J4 | P4, procure raw toor | Enter farmer/vendor purchase and rate → link trucks/slips → send QC/intake → see approved received balance | Partial receipt leaves purchase open; rejected material segregated |
| J5 | P5, establish intake weight | Find linked purchase → enter slip/gross/tare → add photos → submit → checker decision | Duplicate/invalid weight blocked; reweigh is linked evidence |
| J6 | P6, release suitable material | Open inspection queue → record readings → compare approved limits → release/hold/reject | Recheck preserves original result; held stock cannot be allocated |
| J7 | P7, keep godown accurate | Accept posting → select compatible location → monitor age/capacity → count → submit discrepancy | No direct overwrite; approved adjustment/reversal only |
| J8 | P8, fulfill reservation | Select released order → verify FEFO pick → reconcile packs → check dispatch weight/documents → dispatch | Failed checks retain stock and order; no false In-Transit |
| J9 | P9, settle delivery | Assign transporter/vehicle → record dispatch → follow receipt → settle shortage/freight | Unresolved quantity stays in suspense custody, not invisible loss |
| J10 | P10, operate distributor stock | Receive shipment → record good/damaged/short quantities → deliver retailer orders → record other sales → count | Variance ticket; damage held, never sellable by default |
| J11 | P11, take retailer order | Select mapped distributor/retailer → view timestamped rates/stock → submit → see approval/reservation → track delivery | Offline order pending validation; conflicts require visible resolution |
| J12 | P12, reconcile books | Review source documents → sync → inspect acknowledgements → match balances → lock month | Failure retry uses same identity; invoice source never switches silently |
| J13 | P13, close payroll | Review punches/shifts → resolve absence/OT → approve period → calculate payroll → authorize export | Duplicate import does not duplicate hours; revisions versioned |
| J14 | P14, change a route safely | Draft configuration → validate → approve/effective-date → activate for new runs → inspect history | Active lot keeps route version; migration needs explicit decision |

## 10. Scope (In / Out)

### The preserved 16 modules

| ID | Exact baseline module | Included capability | Historical delivery grouping |
| --- | --- | --- | --- |
| M1 | Masters and Setup | Products, grades, SKUs, routes/stages, godowns, users, roles and business parties | Month 1 |
| M2 | Procurement and Intake | Farmer/vendor purchase, manual weighing, intake QC, approval and raw lot | Month 1 |
| M3 | Grading | G1 size, G2 quality × size, child lots and controlled re-grade | Month 1 |
| M4 | Production and Stage Tracking | Stage operations, issue/receive, WIP, loss, reprocessing and by-products | Month 1 |
| M5 | Factory Godown Stock | Locations, capacity, age, fumigation, transfers and counts | Month 1 |
| M6 | Inventory | Stock condition/availability, FEFO, expiry, stores, consumption and adjustment | Month 1 |
| M7 | Dispatch and In-Transit | Allocation, reservation, packing list, dispatch weighing and custody | Month 2 |
| M8 | Distributor Inventory (17) | Receipt, variance, own stock, outside-app sales and inter-distributor transfer | Month 2 |
| M9 | Salesman and CRM | Offline orders, rates, credit, advance booking, performance | Month 2 |
| M10 | Tally and Compliance | Commercial sync, invoice ownership, IRN/e-way bill controls | Month 2 |
| M11 | Returns and Complaints | Lot-linked complaint, replacement, return, QC and disposal | Month 2 |
| M12 | Logistics | Transporters, rate cards, trips, weight/freight reconciliation | Month 2 |
| M13 | Control Tower and Alerts | Owner visibility, ETA, escalation, bottlenecks and shortages | Month 3 |
| M14 | Costing and Reports | Yield, costs, profitability, purchase/by-product and performance reports | Month 3 |
| M15 | HR and Payroll | Attendance, shifts, overtime, leave, payroll and statutory outputs | Month 3 |
| M16 | Season Mode and Forecast | Seasonal calendars, handover, priority and gated seven-day forecast | Month 3 / forecast after baseline |

Cross-cutting audit, quality and recall support belong within these modules. They do not create additional modules. Detailed proposals may affect effort and must be reviewed against the contract.

**Explicitly excluded in S1:** a replacement accounting engine; hardware procurement; automatic weighbridge integration; IoT sensors; retailer app; historical data entry beyond agreed migration; Tally licence/cloud-hosting fees; app-store developer-account fees. Retailers remain business records/order destinations, not independent app users.

**Not authorized by available sources:** farmer advance/loan settlement, broker commission settlement engine, automated procurement bidding, payment gateway, machine automation or third-party manufacturing. Keep these as change requests if requested. No fixed production percentages, chemical recipes, fumigation treatment instructions or guaranteed forecast accuracy are defined here.

### Limits on the owner-review additions

S6 authorizes improving this specification. New detailed behaviors remain **P** for business validation; their inclusion is not confirmation of a new fixed-price delivery commitment. Equipment readiness is a simple task/status record within M1/M4, not a separate asset-management suite. Replenishment produces suggestions for staff approval, not automatic purchases. Financial follow-up uses Tally reconciliation, not a new payment/loan engine. No additional hardware, measurement sensor, live weather service or retailer app is assumed.

## 11. Assumptions

### Source-stated assumptions (C, S1)

- Manual weighbridge entry is supported by slip photo evidence.
- Standard yields are established using the first **20–30 lots**, then approved by the owner.
- Forecast quality is expected to improve with **2–3 months** of operating data; this is not an accuracy guarantee.
- Distributors record sales made outside the app.
- Rentio provides module decisions/inputs within **two working days** in the historical plan.

### Proposed working assumptions (P; not confirmed)

| ID | Proposal | Consequence if rejected / decision |
| --- | --- | --- |
| A1 | Kilograms are the base material quantity unit; bag/pack counts convert using versioned factors | OQ-03 determines units/precision; no guessed conversion |
| A2 | One Rentio business deployment with plant/godown/distributor access boundaries | OQ-17 determines legal-entity isolation |
| A3 | A stock fragment has one custody position; parent genealogy can span many positions | Resolves source single-location rule; OQ-04 sign-off needed |
| A4 | Authorized QC is required to release quarantined/returned material | OQ-05 names approvers and inspection criteria |
| A5 | Offline sales capture creates pending requests, not guaranteed reservations | OQ-10 confirms commitment policy |
| A6 | Browser/factory work requires connection; only salesman offline capability is confirmed | OQ-10 defines any additional offline scope |
| A7 | Internal usage purposes for Husk/Churi are configurable; no purpose is pre-assumed | Source already confirms configurability; Rentio supplies allowed purposes |
| A8 | Proposed accessibility, recovery, load and adoption targets in §6/15 will be validated during sign-off | Capacity/cost effects assessed before commitment |

## 12. Constraints

S1/S3 describe a three-month delivery baseline, app submission in week 9, UAT in weeks 10–11, go-live in week 12 and three months of bug-fix support. Actual start, elapsed progress, staffing, budget and revised dates are unknown. This document sets no new completion date.

Web is confirmed for owner, factory, back office, Accounts and HR; Android and iOS apps for salesmen/distributors; English only. A later language or platform extension requires a scope decision. Tally remains the financial books of record. Production safety and food release decisions remain with authorized Rentio personnel; the ERP records approved process rules and evidence.

## 13. Dependencies

| ID | Dependency | Type | Criticality | Owner / required before |
| --- | --- | --- | --- | --- |
| DEP-01 | Stage route, terminology, timings, capacities, measurement methods, tolerances | Internal | Blocking | Factory Head / production configuration |
| DEP-02 | Grades, pack factors, shelf life, expiry policy, godowns and 17 partner identities | Internal | Blocking | SPOCs / master activation |
| DEP-03 | Approval matrix, credit/rate policy and quality-release rules | Internal | Blocking | Owner / transaction UAT |
| DEP-04 | Tally access feasibility and invoice source decision | External/Internal | Blocking | Accounts + provider / early access proof |
| DEP-05 | Applicable tax, e-document, label, payroll and retention rule sign-off | External/Internal | Blocking for affected functions | Accounts/compliance + HR / statutory UAT |
| DEP-06 | Physical count, opening lots, open orders and opening balances | Internal | Blocking | Inventory + Accounts / cutover |
| DEP-07 | GSP credentials and messaging availability | External | High | Accounts / integration UAT |
| DEP-08 | Biometric details, attendance rules and fallback import samples | External/Internal | High | HR / payroll UAT |
| DEP-09 | App-store accounts and review | External | Blocking for baseline app go-live | Rentio + delivery lead / submission |
| DEP-10 | Representative users, training, shift coverage and module decisions | Internal | High | SPOCs / pilot |


## 14. Functional Requirements

Each row defines one testable behavior. **M / S / Cld** mean Must / Should / Could. Complexity is provisional, not an effort estimate. Criteria use **Given → When → Then**. Evidence references identify confirmed capability; any P row or explicitly proposed refinement remains subject to review. Operational detail and equations in §16/18 further constrain these requirements.


### M1 — Masters and Setup

Maintain controlled business definitions before transactions begin.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-001 | C; S2 FR-M1 | M / 2 | The system MUST permit only active quality × size × type × pack-size SKU combinations. | an inactive combination → create an order line → selection is blocked |
| FR-002 | C/P; S2 FR-M2; S4/S5 sequencing | M / 4 | The system MUST maintain versioned configurable routes with ordered stages, permitted branches/rework, stage owner/backup, capacity, duration, seasonal factor, loss tolerance and measurement method. Version locking is proposed. | a route version used by an active lot → activate a revised route → the active lot retains its original route |
| FR-003 | C; S2 FR-M3–M7; S1 update | M / 3 | The system MUST maintain scoped godowns, suppliers/farmers/vendors, optional brokers, distributors, mapped salesmen, retailers, transporters, by-product types and buyers. | a farmer-linked purchase → inspect its party record → farmer identity and optional broker link are retained |
| FR-004 | C/P; S2 FR-M6 | M / 3 | The system MUST apply approved, effective-dated tolerances and configurable approval rules. Effective dating is proposed. | a new tolerance effective tomorrow → inspect today’s transaction → today’s applicable rule is shown |
| FR-005 | P; S5 adoption/audit | S / 2 | The system SHOULD deactivate referenced masters without deleting transaction history. | a referenced grade → deactivate it → historic lots retain the original grade description |
| FR-092 | P; S6 owner review | M / 3 | The system MUST require each approved route to declare how applicable cleaning/destoning or other foreign-matter removal, pitting, husk separation, final sorting and finishing are handled, including “not used” or “included in another stage” with a reason. | a route copied from the source template → validate completeness → each activity has an explicit disposition before activation |
| FR-093 | P; S6 owner review | M / 3 | The system MUST maintain the equipment/line and measuring-instrument readiness rules required by a route, with responsible user, due checks and evidence where applicable. | an instrument required for a release measurement has an overdue approved check → attempt release → the configured block and accountable resolver appear |


### M2 — Procurement and Intake

Purchase to accepted raw stock; payment settlement extensions remain undecided.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-006 | C; S2 FR-1.1,1.6–1.9 | M / 3 | The system MUST record purchase supplier/category, optional broker, rate, bill reference, declared quantity and raw-toor type. | a valid purchase → save → its commercial terms and supplier are available to intake |
| FR-007 | P; S5 edge cases | M / 3 | The system MUST track partial truck receipts against the same purchase without duplicating ordered quantity. | a 10,000 kg purchase with 6,000 kg accepted → receive another 4,000 kg → total acceptance is 10,000 kg with two linked receipts |
| FR-008 | C; S2 FR-1.2–1.3 | M / 3 | The system MUST calculate net intake weight from manual gross minus tare with slip/truck references and evidence. | gross 15,000 kg and tare 5,000 kg → submit → net is 10,000 kg and slip/photo remain linked |
| FR-009 | C/P; S2 FR-1.3 | M / 3 | The system MUST block a duplicate weighbridge slip within the approved uniqueness scope. Scope remains OQ-06. | an existing slip identity → resubmit intake → no second receipt is posted |
| FR-010 | C; S2 FR-1.4 | M / 3 | The system MUST record intake moisture, foreign matter and damage against approved deduction rules. | a completed inspection → apply approved deductions → physical accepted quantity and commercial deduction are separately visible |
| FR-011 | C; S2 FR-1.5,1.7–1.8; BR-3/4 | M / 4 | The system MUST post approved accepted raw material to a selected compatible raw godown with a unique Lot ID. | an intake awaiting checker → attempt stock allocation → none is available; approval posts accepted stock once |
| FR-012 | P; S5 scenarios | M / 3 | The system MUST retain rejected and quarantined receipt quantities with physical custody and disposition. | a partially rejected truck → complete inspection → accepted stock alone is available; rejected balance remains traceable |
| FR-094 | P; S6 owner review | M / 3 | The system MUST reconcile supplier bill lines with approved purchase terms and accepted receipts before marking them ready for Accounts. | purchase 1,000 kg, accepted 980 kg and billed 1,000 kg → match → the 20 kg difference remains disputed or explicitly accepted under policy; stock stays 980 kg |
| FR-095 | P; S6 owner review | S / 2 | The system SHOULD track promised receipt dates and remaining supply against open purchases. | an open purchase is overdue → review supply plan → remaining quantity and supplier follow-up owner appear without counting it as received stock |


### M3 — Grading

G1 separates size; G2 determines sellable quality × size after the configured process.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-013 | C; S2 FR-2.1 | M / 3 | The system MUST record G1 size and G2 quality × size output categories. | a G2 run → enter outputs in two categories → each quantity is identified by its category |
| FR-014 | C; S2 FR-2.2–2.3 | M / 4 | The system MUST create linked child quantities for grading outputs while consuming only the processed input portion. | 1,000 kg input → post 600 kg grade A, 350 kg grade B and 50 kg loss → children total 950 kg; input is not still counted as 1,000 kg live stock |
| FR-015 | C; S2 FR-2.4 | M / 3 | The system MUST require reason and approval for re-grade or downgrade. | a downgrade without authorization → submit → original classification remains until approval |
| FR-016 | P; S5 safeguards | M / 3 | The system MUST block release of a grading run with an unexplained material-balance difference. | 1,000 kg input with 950 kg accounted → close without explanation → close is blocked |


### M4 — Production and Stage Tracking

Every stage has a queue, responsibility, quantities, timers and a closed handover.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-017 | C/P; S2 FR-3.2 | M / 3 | The system MUST show quantity basis as Actual, Counted or Carried; conversions and confidence details are proposed in §18. | an unweighed transfer → carry source quantity → receiving screen labels it Carried, not Actual |
| FR-018 | C/P; S2 FR-3.3; S4/S5 | M / 4 | The system MUST record sender issue and receiver acceptance as separate linked actions with a pending-custody balance. | 600 kg issued → receiver accepts 590 kg → 10 kg remains an unresolved variance, not vanished stock |
| FR-019 | C/P; S2 FR-3.6; S5 timing | M / 4 | The system MUST record start, pause, reasoned hold, resume and completion timestamps per stage run. | a breakdown pause → resume → active time excludes hold; elapsed time includes it |
| FR-020 | C/P; S2 FR-3.1,3.4,3.10–3.11 | M / 4 | The system MUST reconcile output, Husk/Churi/other classified by-products, loss and residual input per run. Added-material treatment is proposed in §18. | a balanced run → post → each material category has a distinct quantity and origin |
| FR-021 | C; S2 FR-3.4 | M / 4 | The system MUST track unpeeled/rework material as linked child quantities with repeated process passes. | an unpeeled output → issue for a second pass → origin and pass history remain visible without new procurement intake |
| FR-022 | C; S2 FR-3.5 | M / 3 | The system MUST record oil consumption against the production lot. | oil issued to a lot → confirm consumption → oil inventory decreases by the consumed quantity once |
| FR-023 | C/P; S2 FR-3.7 | M / 4 | The system MUST reconcile packing actual quantity against carried expectations without automatically distributing a gap across stages. | a packing shortfall → reconcile → gap is reported for investigation; earlier stage weights remain unchanged |
| FR-024 | C; S2 FR-3.9 | M / 3 | The system MUST support stage-owner daily close with unresolved quantity and handover exceptions. | a day with pending issues → close review → pending references remain visible to supervisor |
| FR-025 | P; S5 configurable stages | M / 3 | The system MUST prevent stage skipping outside the lot’s approved route or an approved deviation. | a lot due for drying → issue directly to packing without an allowed transition → action is blocked |
| FR-096 | P; S6 owner review | M / 3 | The system MUST check the approved run-readiness checklist before starting a dependent process. | a required cleaning/changeover or quality-release check is incomplete → start run → start is blocked with the missing check and responsible role |
| FR-097 | P; S6 owner review | S / 3 | The system SHOULD record a basic breakdown/maintenance task through assigned repair, completion and authorized return to service. | a machine is marked unavailable → close a repair note without required release → dependent run remains blocked and capacity stays unavailable |
| FR-098 | P; S6 owner review | M / 3 | The system MUST apply the approved packing-release checks for net quantity, seal integrity and correct batch/grade/label. | a packed batch fails an applicable check → release to dispatch → batch remains held until evidenced resolution |


### M5 — Factory Godown Stock

One inventory ledger, presented by storage location; no separate godown totals to maintain manually.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-026 | C; S2 FR-4.1–4.2,4.8 | M / 3 | The system MUST display each godown’s quantity by lot, SKU/category, batch, expiry, condition and by-product type where relevant. | a returned lot placed in quarantine → view godown → quantity appears as held, not saleable |
| FR-027 | C; S2 FR-4.3 | M / 3 | The system MUST record approved godown-to-godown transfers. | 100 kg transferred → destination accepts → source decreases and destination increases by 100 kg with one transfer reference |
| FR-028 | C; S2 FR-4.4 | M / 3 | The system MUST require approval before capacity is exceeded. | a receipt exceeds configured compatible capacity → submit put-away → approval is requested before final placement |
| FR-029 | C; S2 FR-4.5–4.6 | M / 2 | The system MUST maintain fumigation due dates/logs and storage-age alerts. | a due fumigation date → scheduled evaluation → responsible staff see an alert linked to the godown |
| FR-030 | C/P; S2 FR-4.7 | M / 4 | The system MUST compare physical count with a defined stock snapshot and post only approved differences. Snapshot/count-cutoff handling is proposed. | 100 kg snapshot, 98 kg count and 5 kg later issue → approve count → adjustment is -2 kg, not -7 kg |
| FR-099 | P; S6 owner review | M / 3 | The system MUST locate stock at the configured godown and bin/stack/silo level with bag counts and quantity basis where applicable. | one lot occupies two stacks → pick part from stack B → B decreases, A stays unchanged and godown total reconciles |
| FR-100 | P; S6 owner review | M / 3 | The system MUST enforce location-specific holds for treatment, pest incidents or other approved storage restrictions until authorized release. | a stack is under an active treatment hold → reserve/pick from it → normal movement is blocked; unaffected released stacks remain eligible |


### M6 — Inventory

Lot-based quantity, independent condition and reservation; usable for raw, WIP, finished goods, by-products and stores.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-031 | C/P; S2 FR-5.1–5.2 | M / 4 | The system MUST distinguish physical custody, material condition and reserved quantity as separate stock dimensions. | 100 kg factory good stock including 30 kg reserved → owner total → physical total is 100 kg and available is 70 kg |
| FR-032 | C; S2 FR-5.3 | M / 3 | The system MUST allocate eligible stock by FEFO with approval for overrides. | two released batches with different expiry → allocate → nearer expiry is selected unless approved override exists |
| FR-033 | C/P; S2 FR-5.4 | M / 3 | The system MUST derive expiry from the approved manufacturing-date and shelf-life rule and block expired-stock sale. Date definition remains OQ-07. | a batch reaches expiry boundary → allocate → allocation is blocked and existing reservations are flagged |
| FR-034 | C; S2 FR-5.5 | M / 3 | The system MUST maintain stores quantities for packaging, oil, spares and electrical items. | packaging issued for packing → post consumption → stores balance and lot/run usage reference are visible |
| FR-035 | C; S2 FR-5.6; BR-2 | M / 4 | The system MUST reject any posting that would create negative available physical stock. | two users attempt to issue the last 100 kg → both submit 80 kg → at most one succeeds; final quantity is nonnegative |
| FR-036 | C; S2 FR-5.7–5.9 | M / 3 | The system MUST record authorized Husk/Churi internal consumption by origin, quantity, location, date, responsible user and configured purpose. | 200 kg available → consume 40 kg internally → closing quantity is 160 kg with approved purpose, not assumed fuel use |
| FR-037 | C/P; S2 BR-2/3; S5 | M / 4 | The system MUST correct stock using linked approved reversal/reposting, preserving downstream traceability. | a consumed lot receipt needs reversal → request correction → downstream effects are identified before approval; history is retained |
| FR-038 | P; S5 audit/control | M / 3 | The system MUST record quality hold/release independently from stock quantity. | a released lot becomes held → inspect totals → physical quantity is unchanged while allocation becomes zero |
| FR-101 | P; S6 owner review | S / 3 | The system SHOULD suggest replenishment for raw material and critical stores from approved demand, usable stock, open supply and lead-time rules. | packaging is short but raw dal is sufficient → review suggestions → packaging need appears with its calculation; no purchase or receipt is automatically posted |
| FR-102 | P; S6 owner review | M / 3 | The system MUST account for quality samples, spill recovery and rejected cleaning material by distinct controlled movements. | 2 kg is removed for a retained sample → post → production-available quantity reduces 2 kg and sample custody remains traceable; disposal later deducts it once |
| FR-103 | P; S6 owner review | M / 4 | The system MUST handle approved repacking as a quantity-conserving transformation retaining origin and expiry constraints. | 200 kg is repacked with 1 kg recorded loss → complete → new packs total 199 kg, old packs are consumed and no automatic shelf-life extension occurs |


### M7 — Dispatch and In-Transit

Reservations do not move stock; dispatch does.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-039 | C/P; S2 FR-7.1; S5 reservations | M / 4 | The system MUST reserve eligible physical quantities against an approved order and release unfulfilled reservations on authorized cancellation. | 70 kg available → reserve 50 kg → physical stays 70 kg and available becomes 20 kg |
| FR-040 | C; S2 FR-7.1–7.2 | M / 3 | The system MUST validate packing-list quantity against dispatch weighbridge evidence and applicable tolerance. | dispatch variance exceeds tolerance → release vehicle → dispatch remains on hold pending approval |
| FR-041 | C; S2 FR-7.3 | M / 4 | The system MUST transfer dispatched quantity from source custody to In-Transit once. | a 500 kg dispatch submitted twice → inspect ledger → exactly 500 kg moves into transit |
| FR-042 | P; S5 partial fulfillment | M / 4 | The system MUST track partial order fulfillment and partial shipment balances at line level. | 100 kg ordered, 60 kg dispatched → view order → 40 kg remains pending without re-reserving the dispatched 60 kg |
| FR-043 | C; S2 FR-7.9 | M / 3 | The system MUST support external Husk/Churi orders and outward dispatch by buyer, type, quantity, agreed rate and origin-linked stock. | 30 kg by-product dispatched → inspect origin stock → 30 kg is deducted once with commercial reference |
| FR-104 | P; S6 owner review | M / 3 | The system MUST distinguish vehicle tare, packaging tare, net commodity weight and gross cargo weight in dispatch reconciliation. | 100 bags contain 2,500 kg dal and 50 kg packaging → compare to 2,550 kg cargo weight → commodity remains 2,500 kg; packaging is not treated as dal gain or variance |
| FR-105 | P; S6 owner review | M / 3 | The system MUST apply approved customer acceptance constraints, including any minimum remaining shelf life at expected receipt, when allocating batches. | the earliest-expiring batch fails the customer’s approved shelf-life condition → allocate → it is ineligible and the next eligible FEFO batch or shortage is shown |


### M8 — Distributor Inventory (17)

Partners see their own stock, receipts, fulfillment and exceptions.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-044 | C/P; S2 FR-7.4 | M / 4 | The system MUST capture good received, physically damaged, short and excess shipment quantities with evidence and locked submission. Excess treatment is specified in §18. | 100 kg shipped; 92 good, 5 damaged, 3 missing → submit receipt → 92 available, 5 held and 3 unresolved are recorded |
| FR-045 | C; S2 FR-7.5 | M / 3 | The system MUST create a dispute for any receipt variance and escalate overdue receipt. | a short receipt → submit → a linked dispute identifies accountable unresolved quantity |
| FR-046 | C; S2 FR-7.6 | M / 3 | The system MUST show distributor SKU/batch/expiry quantities, min/max exceptions and stock age. | a user assigned to distributor A → inspect stock → only A-authorized quantities are visible |
| FR-047 | C/P; S2 FR-7.7; S1 assumptions | M / 4 | The system MUST deduct distributor stock at retailer delivery and for separately recorded outside-app sales, with duplicate prevention. | an app order already delivered → record its external reference again → no second stock deduction occurs |
| FR-048 | C; S2 FR-7.8 | M / 4 | The system MUST route distributor-to-distributor transfers through In-Transit. | A issues 40 kg to B → before B receipt → A has 40 kg less, transit has 40 kg and B has no additional available stock |
| FR-049 | C/P; S1 risk/count; S5 | M / 3 | The system MUST record distributor physical counts with approved corrections. | a count differs from ledger → submit → no silent overwrite occurs |
| FR-106 | P; S6 owner review | S / 3 | The system SHOULD propose partner replenishment using reliable stock/sales and approved min/max or demand rules. | a stale distributor update implies a shortage → review proposal → stale data is highlighted and confirmation is required before an order or transfer is accepted |


### M9 — Salesman and CRM

Separate factory-to-distributor sales from distributor-to-retailer fulfillment.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-050 | C; S2 FR-8.1 | M / 3 | The system MUST restrict salesman visibility to mapped distributors and authorized retailer relationships. | a salesman requests an unmapped distributor → open its record → access is denied |
| FR-051 | C; S2 FR-8.2 | M / 3 | The system MUST retain the applicable rate snapshot when an order is accepted under the approved rate-validity policy. | an accepted order at rate R → publish a new rate → accepted order remains at R unless an approved amendment is made |
| FR-052 | C/P; S2 FR-8.1; S5 | M / 4 | The system MUST capture offline salesman orders with visible pending synchronization and revalidation. | two offline orders compete for one remaining quantity → sync → only eligible quantity is reserved; conflict is shown on the other order |
| FR-053 | C; S2 FR-8.3–8.4 | M / 4 | The system MUST validate credit policy before approval and enforce owner-controlled backorder permission. | an order exceeds approved credit → approve without override → approval is blocked |
| FR-054 | C/P; S2 FR-8.5 | M / 4 | The system MUST distinguish advance demand against projected output from reservation against existing physical stock. | an advance booking exceeds current stock → record approved demand → no physical stock or hard reservation is fabricated |
| FR-055 | C; S2 FR-8.6 | M / 3 | The system MUST report salesman orders, collections and complaints within access scope. | a collection with reference → submit for Accounts handling → performance report shows its status without creating a second financial ledger |
| FR-056 | P; S5 order scenarios | M / 3 | The system MUST version approved order amendments affecting quantity, rate, distributor or requested delivery. | a dispatched order → reduce quantity below already dispatched → amendment is blocked and return/credit workflow is offered |
| FR-107 | P; S6 owner review | M / 3 | The system MUST maintain one assigned follow-up for an accepted delivery promise that becomes at risk. | a production delay threatens three accepted orders → evaluate impact → each order shows its original promise, revised estimate and responsible follow-up; dates do not silently change |
| FR-108 | P; S6 owner review | M / 3 | The system MUST record permitted collection follow-up against the correct debtor, creditor and commercial document. | a salesman records collection evidence → submit → status is provisional pending Accounts/Tally confirmation, with no unauthorized credit-limit release |


### M10 — Tally and Compliance

One operational record, one financial source of truth, one invoice-generation owner.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-057 | C; S2 FR-11.1–11.2,11.6 | M / 4 | The system MUST exchange approved purchases, sales including by-products, freight and receipts with Tally while retrieving ledgers/outstandings. | an eligible source sale → successful sync → one acknowledged financial reference is linked |
| FR-058 | C/P; S2 FR-11.3 | M / 4 | The system MUST expose synchronization state, retry history and failures without duplicating documents. | an acknowledgement is lost → retry same source document → reconciliation discovers or creates only one matching entry |
| FR-059 | C; S2 FR-11.4–11.5; BR-14 | M / 4 | The system MUST enforce one designated IRN source per invoice with source lock and external-status lookup before generation/retry. | an IRN already exists in Tally → request ERP generation → existing IRN is linked; second generation is blocked |
| FR-060 | C/P; S2 FR-11.5 | M / 3 | The system MUST restrict e-document cancellation to the authorized source and applicable current cancellation conditions. | a cancellation is outside the permitted window → submit → cancellation is blocked and an Accounts exception is raised |
| FR-061 | P; S5 compliance | M / 3 | The system MUST hold required document/label/rule versions for applicable products and transaction types before commercial release. | a shipment needing an approved compliance document → dispatch without it → release is blocked with the missing requirement named |
| FR-062 | P; S5 compliance/audit | M / 3 | The system MUST retain a traceable recall case linking affected lot descendants, stock positions, recipients and disposition. | a recalled parent lot has packed children at two distributors → open recall → both branches and blocked current stock are listed |
| FR-109 | P; S6 owner review | M / 4 | The system MUST reconcile supplier/customer due and settlement status to acknowledged Tally records with a last-updated time. | receipt evidence or a screenshot is entered without confirmed settlement → refresh balances → the invoice is not marked financially settled and stale balances remain labelled |


### M11 — Returns and Complaints

Replacement, return receipt, disposal and financial correction are separate linked outcomes.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-063 | C; S2 FR-9.1 | M / 3 | The system MUST record categorized complaints linked to retailer, distributor, order/dispatch and known lot. | a complaint with unknown lot → save → case remains flagged for identification rather than assigning a guessed lot |
| FR-064 | C; S2 FR-9.2–9.3 | M / 4 | The system MUST receive returned goods into designated held stock pending QC disposition. | a return received → inspect available stock → saleable quantity does not increase before release |
| FR-065 | C/P; S2 FR-9.1 | M / 3 | The system MUST link a replacement order to the complaint without automatically treating it as a physical return. | a replacement is approved while damaged stock stays at retailer → fulfill → no factory return stock is invented |
| FR-066 | C; S2 FR-9.2; BR-3/4 | M / 3 | The system MUST require approval and photo/video proof for disposal. | a local disposal request lacking proof → submit → stock remains held until required evidence and approval exist |
| FR-067 | C/P; S2 FR-9.3 | M / 4 | The system MUST route returned goods to approved re-grade, reprocess, release or disposal with origin history. | a return is reprocessed → inspect child genealogy → original sale, return and new pass are linked |
| FR-110 | P; S6 owner review | M / 4 | The system MUST propagate an authorized safety/quality hold to identified descendant stock and affected reservations according to the hold’s stated scope. | an origin is held after splitting/repacking → assess descendants → affected live quantities are unavailable; shipped recipients are listed for action; release of one branch does not release all branches |
| FR-111 | P; S6 owner review | S / 3 | The system SHOULD link recurring quality/receipt complaints to a corrective action with owner, due date and effectiveness review. | three cases are linked to one recurring cause → close one complaint → corrective action stays open until its separate review is complete |


### M12 — Logistics

Shipment custody and freight are reconciled separately.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-068 | C; S2 FR-10.1 | M / 2 | The system MUST maintain effective transporter rate cards. | a completed trip → revise current rate card → historic freight basis stays unchanged |
| FR-069 | C; S2 FR-10.2 | M / 3 | The system MUST link each trip to truck, driver, lots and weight with reasoned vehicle changes. | a truck changes during transit → record change → prior and new custody details remain visible |
| FR-070 | C; S2 FR-10.3 | M / 3 | The system MUST place out-of-tolerance delivery variance on hold. | receipt variance above approved tolerance → settle delivery → supervisor resolution is required |
| FR-071 | C; S2 FR-10.4 | M / 3 | The system MUST reconcile freight bills to trip/rate/approved variances before Accounts export. | a freight bill exceeds calculated charge → approve without exception → mismatch is shown for resolution |
| FR-112 | P; S6 owner review | M / 3 | The system MUST record shipment-level delivery proof and residual custody for failed, refused or partial delivery stops. | one truck serves two distributors and one refuses delivery → record stop results → only accepted lines settle; refused quantity remains accountable in transit or an authorized return |


### M13 — Control Tower and Alerts

The owner can drill from a total to its constituent lots, transactions and decisions.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-072 | C; S2 FR-12.4; S3 p4 | M / 4 | The system MUST show intake, stage WIP, godowns, transit, distributor stock, pending orders and by-products with drill-through. | a stage total is selected → open detail → displayed lot quantities reconcile to the total under the same filters |
| FR-073 | C/P; S2 FR-6.1–6.3; S5 | M / 4 | The system MUST show baseline expected finish, revised forecast, actual duration, status and accountable owner per lot/stage. | a hold shifts forecast → inspect lot → original expected finish remains visible beside revised forecast |
| FR-074 | C/P; S2 FR-6.4–6.5 | M / 4 | The system MUST show grade/SKU shortage separately for physical availability and time-phased projected supply. | one production lot supplies two order forecasts → view shortage → that supply is counted only once |
| FR-075 | C; S2 FR-12.1–12.3,12.5–12.6 | M / 4 | The system MUST provide assigned alerts, timed escalation and an approval inbox for configured exceptions. | a handover expires without receipt → evaluate timer → correct owner/backup/escalation sees the linked exception |
| FR-076 | C/P; S4; S5 | S / 3 | The system SHOULD preserve authorized saved filters, stock flags and a central decision register linked to affected records. Detailed sharing/expiry rules are proposed. | an owner records a dated decision → open affected lot → decision, approver and effective scope are visible |
| FR-077 | P; S5 visibility | M / 3 | The system MUST display stock/forecast freshness and quantity confidence beside operational totals. | a distributor has not synchronized → owner opens map → last update and stale flag remain visible |
| FR-113 | P; S6 owner review | M / 3 | The system MUST show an owner action brief ranked by urgency, impact and delegated authority. | normal work plus critical exceptions exist → open brief → unresolved critical items and owner-only decisions appear first with full-list access and data freshness |
| FR-114 | P; S6 owner review | M / 3 | The system MUST route routine tasks and approvals to the lowest authorized responsible role with a valid independent checker where required. | an intake is within an authorized checker’s limits → approve → no owner action is required; self-approval and unapproved limits remain blocked |
| FR-115 | P; S6 owner review | S / 3 | The system SHOULD group related alerts into an incident with one lead action owner and visible child exceptions. | one breakdown creates stage delay and several order risks → review incident → one incident coordinates work; all affected orders and their unresolved obligations remain visible |
| FR-116 | P; S6 owner review | M / 3 | The system MUST prefill a daily-close summary from recorded movements, open runs, pending transfers and exceptions for accountable staff confirmation. | shift ends with one unresolved handover → review close → the exception is carried forward without retyping stock totals or falsely completing work |
| FR-119 | P; S6 owner review | M / 3 | The system MUST provide a role-based My Work queue with source-prefilled tasks and an explicit next responsible person. | a stage owner completes an issue → open receiver queue → the same reference and known values appear; receiver confirms independently instead of recreating the transaction |


### M14 — Costing and Reports

Operational costing supports decisions; it does not replace financial books.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-078 | C; S1 M14; S2 FR-3.8 | M / 4 | The system MUST report lot yield with separate saleable, rework, by-product and loss quantities using approved denominators. | a rework pass completes → view root yield → the original intake is not counted again as new input |
| FR-079 | C/P; S1 M14 | M / 4 | The system MUST calculate lot/grade cost from approved cost-allocation rules and show missing inputs. Allocation method remains OQ-14. | freight is not yet final → inspect margin → cost/margin is labelled provisional |
| FR-080 | C; S1 update; S2 FR-1.9,5.7 | M / 3 | The system MUST reconcile procurement and by-product opening, generation, internal use, external issue, corrections and closing quantities. | a by-product period report → drill into closing → all movements reconcile by type/location/origin |
| FR-081 | C; S1 M14; S2 FR-8.6 | M / 3 | The system MUST report distributor/salesman performance by authorized scope and period. | a supervisor changes report period → view metrics → underlying order/delivery basis is identified |
| FR-082 | P; S5 audit | S / 2 | The system SHOULD export authorized reports with filters, units, as-of time and quantity confidence. | a filtered stock report → export → totals match the displayed as-of view |
| FR-117 | P; S6 owner review | S / 3 | The system SHOULD compare supplier accepted quantity, quality deductions and delivery reliability using reconciled source records. | a supplier has an unpaid disputed invoice → run comparison → physical quality/delivery evidence stays separate from the unresolved financial result |


### M15 — HR and Payroll

Attendance and payroll remain role-restricted even for broad operations users.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-083 | C; S2 FR-14.1 | M / 3 | The system MUST import biometric attendance with a file-import fallback and duplicate detection. | the same attendance file imported twice → inspect hours → hours are counted once |
| FR-084 | C; S2 FR-14.2 | M / 3 | The system MUST apply approved shift, late-mark, overtime and leave rules to attendance. | an overnight shift crosses midnight → calculate → hours belong to one configured shift rather than two full shifts |
| FR-085 | C/P; S2 FR-14.2 | M / 4 | The system MUST produce versioned payroll, applicable PF/ESI outputs and bank-file output from approved HR rules. Statutory formulas are not supplied. | approved attendance period → run payroll → each payment traces to rule version and attendance; unauthorized user sees no salary data |
| FR-086 | P; S5 auditing | M / 3 | The system MUST require an authorized revision for already approved payroll. | a closed payroll period → edit hours → original run stays intact and a revision workflow is required |


### M16 — Season Mode and Forecast

Seasonal urgency changes planning and staffing without hiding real delays.

| ID | Evidence | Priority / complexity | Required behavior | Acceptance: Given → When → Then |
| --- | --- | --- | --- | --- |
| FR-087 | C; S2 FR-13.1 | M / 3 | The system MUST support season calendars, 24/7 shifts and shorter approved escalation timers. | season mode activates → inspect new task timer → seasonal rule is applied and recorded |
| FR-088 | C/P; S2 FR-13.1; S5 | M / 3 | The system MUST record shift handover of active runs, physical quantities, holds and pending receipts. | a new owner takes over → accept handover → unresolved work remains linked to the prior shift history |
| FR-089 | C; S2 FR-13.2 | M / 3 | The system MUST compare daily targets with actual outputs and priority lots. | a priority changes → inspect plan → due work is reordered without changing historical timestamps |
| FR-090 | C/P; S2 FR-3.8,6.5; S1 | M / 4 | The system MUST gate the seven-day forecast on an owner-approved yield baseline drawn from the first 20–30 suitable lots. Sample-selection detail is proposed. | no approved baseline → open forecast → “Baseline pending” appears rather than an authoritative prediction |
| FR-091 | P; S5 projected availability | S / 4 | The system SHOULD show forecast assumptions, confidence and capacity/hold constraints. | a bottleneck capacity falls → recalculate → forecast shifts and impacted orders are identified |
| FR-118 | P; S6 owner review | M / 4 | The system MUST check a proposed daily plan against available raw stock, packaging, released equipment, staffing and storage capacity required for that work. | packing bags or released equipment are unavailable → commit the plan → shortage is assigned visibly; impossible output is not shown as a firm promise |


### Control Tower information contract

**C from S3; P detail:** the default owner view MUST expose an as-of timestamp and access/plant filters. It MUST show the following without requiring users to combine unrelated totals:

| View | Minimum information | Owner action |
| --- | --- | --- |
| Today | Intake accepted/pending, production completed, dispatch, returns and unresolved reconciliation | Compare with target; open source documents |
| Production funnel | Queue kg, active kg, held kg, lots, owner/backup, oldest wait, next ETA, capacity/load | Open stage; inspect bottleneck; assign permitted action |
| Lot journey | Root purchase, splits, every pass, stage transitions, basis, timestamps, by-products and recipient trail | Investigate one material branch or whole origin |
| Godowns | Lot/SKU/grade, good/held/expired, reserved/available, capacity, age and fumigation due | Plan transfer/count; approve exception |
| Grade board | Available / Low / Short by approved thresholds; physical and projected shown separately | Review allocation; change priority with reason |
| Distributor map/list | All 17 initial partners, stock/age, open receipts, disputes and last update | Follow up on stale data or shortage |
| Orders | Pending demand, hard reservations, advance bookings, credit holds, promised date and supply risk | Decide backorder, allocation or customer follow-up |
| Exceptions | Severity, quantity/value exposure if known, age, assigned action, next escalation and approvals | Acknowledge, assign, approve/reject or resolve |
| By-products | Husk/Churi generation, stock, consumption, external dispatch and mismatch | Inspect balances or approve adjustment |
| Decisions | Open business decisions and approved exceptions, affected scope and effective dates | Record decision once; retain superseded history |

A green status MUST NOT imply measured accuracy when underlying stock is Carried. Saved filters MUST NOT grant access beyond user permissions. Acknowledging an alert MUST NOT change stock, approve a transaction or resolve the underlying fault.


### Cross-module audit and approval contract

**C audit intent; P operational detail:** each committed stock, order, inspection, approval, rate, route, payroll and access change MUST retain who acted, their effective role/scope, physical event time, recorded time, affected document/revision, before/after values or explicit quantity movement, reason, evidence references and approval/reversal links. Failed protected actions and negative-stock attempts MUST be available for authorized investigation. A shared login cannot establish individual accountability; named user identities are required for accountable actions.

Draft edits MAY be revised before submission under policy, but submitted evidence and reviewed values MUST remain traceable. Approval lifecycle: **Draft → Submitted → Assigned → Approved / Rejected / Returned for Correction → Applied / Superseded**. A rejection requires a reason. Material edits after submission create a new review revision; the old approval cannot authorize the new values. Approval expiry/delegation limits require OQ-02, not an invented timer.

Approvals MUST show the exact breached rule, quantity/value exposure if known, evidence, proposed consequence and maker identity. Stock is affected only at the defined approved posting, not merely when a notification is acknowledged. If approval succeeds but posting fails, show **Approved / Posting Pending or Failed** with one retryable reference; do not claim stock changed. If a maker or approver leaves, history remains and open work is explicitly reassigned.

Month-end/daily close SHOULD report unresolved receipts, unbalanced runs, pending approvals, unsynchronized commercial documents and count exceptions. Whether any unresolved item blocks close is a configured Accounts/Factory Head policy; closing a period MUST NOT automatically resolve its exceptions. Audit export access and retention follow the same privacy/scope rules as the originating records. Audit records MUST NOT be editable or deletable through ordinary business-user actions.

### Order-balance and shortage checks

**P precision for M7/M9/M13:** for each order line, show ordered quantity, approved cancellation, delivered quantity, dispatched-not-yet-delivered quantity, open hard reservation and unallocated remaining quantity. Those mutually exclusive fulfillment buckets MUST reconcile to the current order quantity. Partial returns are tracked separately as returned quantity and financial outcome; they do not automatically undo original fulfilled history.

For a delivery horizon, the planning view SHOULD compare eligible uncommitted physical stock plus eligible projected receipts/production **available by that horizon** against unfulfilled demand not already covered by hard reservations. Alternatively a gross-supply/gross-demand view can include reservations on both sides; the selected method MUST be labelled and MUST NOT subtract reservations twice. Already dispatched supply, duplicate parent/child forecasts and the same production yield promised to two orders cannot count as separate free supply. Show excess/backlog by SKU/grade and date; do not net incompatible grades or pack sizes without an approved substitution/conversion rule.

## 15. Non-Functional Requirements

C targets come from S2; P targets require feasibility and business validation. These define observable service quality, not a technology choice.

| ID | Category | Measurable requirement | Verification | Basis |
| --- | --- | --- | --- | --- |
| NFR-01 | Performance | Dashboard MUST load in under 3 seconds under the agreed production load; proposed percentile is 95th | Timed end-to-end pilot/load sessions; count stale/failed views separately | C time / P percentile |
| NFR-02 | Availability | Service MUST achieve 99.5% monthly availability; maintenance/exclusion treatment requires agreement | Monthly successful-transaction probes; proposed denominator all calendar minutes | C target / P method |
| NFR-03 | Security | 100% of protected actions MUST enforce role plus location/partner scope; privileged sessions SHOULD require an additional authentication factor | Positive/negative permission tests for every role; privileged-access review | C access / P additional factor |
| NFR-04 | Privacy | 100% of payroll/contact exports MUST be permission-checked and audit-recorded; no salary data in general operations reports | Data-access/export tests; approved retention schedule verification | C/P |
| NFR-05 | Data protection | Records MUST be protected during transfer and storage; a backup MUST run daily | Configuration/evidence inspection and restore rehearsal | C; S2 security |
| NFR-06 | Recovery | Proposed maximum data-loss window 24 hours; proposed recovery time ≤8 hours | Timed restore of representative production backup, then ledger reconciliation | P; owner to approve |
| NFR-07 | Integrity | Zero duplicate quantity or financial effects across retry, concurrent issue and reconnect tests | Fault/concurrency UAT and ledger comparison | P elaborating C controls |
| NFR-08 | Capacity | Proposed test profile: 100 concurrent users, 1 million stock movements, 17 distributors, two plants and 20 godowns | Representative load tests meeting NFR-01 and inventory invariants; final profile OQ-18 | P; not a confirmed workload |
| NFR-09 | Accessibility | Core receive/order/approval tasks SHOULD meet WCAG 2.2 AA criteria adopted for the project | Keyboard, contrast, screen-reader and touch review against agreed checklist | P |
| NFR-10 | Observability | 100% of committed stock/approval/master/role changes MUST have actor, event time, recorded time, before/after or movement detail and reference | Compare postings to audit extracts; simulate failure; verify alert ownership | C/P |
| NFR-11 | Offline behavior | Salesman app MUST preserve each queued order through application restart and synchronize with one visible final outcome per request | Disconnect/restart/reconnect test on both supported mobile platforms | C capability / P test |
| NFR-12 | Freshness | Proposed online operational views MUST reflect committed movements within 60 seconds; overdue data MUST be marked stale | Compare posting timestamp with view refresh; disconnect distributor and verify stale marker | P |
| NFR-13 | Audit retention | 100% of records subject to an active retention/legal-hold rule MUST be retained until its end; actual periods OQ-16 | Configured-policy test with synthetic expired and held records | P; no statutory period assumed |

## 16. Workflows & State Machines

### WF-01 — Configurable manufacturing route

**Trigger:** approved raw quantity is released for production. **Business route template:**

```text
Farmer / Vendor Purchase
  → Truck Intake + Manual Weighbridge + QC + Checker
  → Raw Godown
  → G1 Size Grading
  → Oiling → Seeping / Conditioning → Drying
  → Peeling / Splitting
  → G2 Quality × Size Grading
  → Packing + Actual Reconciliation
  → Finished Godown
  → Reservation → Dispatch → In-Transit
  → Distributor Receipt → Retailer Delivery

At configured output stages:
  ├─ Saleable / next-stage material → permitted next stage
  ├─ Unpeeled / rework → linked child → approved repeat route
  ├─ Husk / Churi → by-product location → internal use OR external sale
  └─ Loss / damage → reason + evidence + approval when required

Returned goods → Returns / Quarantine → QC
  → approved release OR re-grade OR reprocess OR disposal
```

**P configuration contract:** route approval MUST validate permitted input/output material, location compatibility, stage ownership, measurement basis, capacity unit, standard time basis, allowed transitions, quality gates and rework exit conditions. Normal-route cycles MUST be rejected; explicitly authorized rework loops MUST create numbered passes with configured escalation for repeat passes. Parallel processing requires split fragments and a recorded join; it MUST NOT duplicate parent stock. Lot merge/blending is blocked until OQ-08 defines a permitted policy and genealogy test.

Each run MUST keep a snapshot/reference of its route, tolerance, time and yield-rule versions. Master changes affect new runs unless an authorized active-run change records the prior plan, revised plan, reason, remaining quantity and affected orders. Deleting a stage MUST NOT break history.

### Stage-by-stage operating detail

The source sequence below comes from S3/S4. FR-092 requires an actual factory walkthrough to add applicable preparation, separation and finishing activities or explicitly include them within named stages. The source diagram is not proof of a complete installed process. Precise machine settings and process conditions are OQ-01. Screen fields and checkpoints are P elaborations of the requested complete workflow.

| Activity | Inputs and employee records | Outputs / stock effect | Completion condition / exception |
| --- | --- | --- | --- |
| Procurement | Supplier/farmer, optional broker, type, rate, quantity, bill | Purchase demand/expected receipt; no physical stock yet | Purchase approved per configured policy; partial/cancelled balance visible |
| Intake / weighing | Truck, slip, gross/tare/net, photos, moisture/foreign matter/damage | Accepted raw lot; held/rejected quantity separately | Checker approves; bill/weight mismatch cannot silently change stock |
| Raw storage | Lot, net accepted kg, godown and condition | Raw stock in known custody | Capacity/type compatibility; release for G1 only from eligible stock |
| Cleaning / foreign-matter removal, where applicable | Raw material, cleaning method and recovered/rejected quantities | Cleaned material plus separately classified rejects | Configure before dependent processing; never classify stones/contaminated sweepings automatically as saleable Husk/Churi |
| Pitting / additional separation or finishing, where applicable | Route-specific input, method and required records | Approved forward material, classified recoverables/rejects | Place at the validated position in the actual route; “not used” requires the route owner’s reason |
| G1 size grading | Received material, measured/carried basis, operator and size outputs | Size child lots, classified recoverables and loss | Material balance; above-tolerance loss requires approval |
| Oiling | Received child lot, run/shift, oil issued/consumed, added mass where measured | Conditioned WIP plus oil-use record | Duration/recipe targets configured by Factory Head; no invented oil ratio |
| Seeping / conditioning | Received WIP, start, planned holding time, any measured added water | Conditioned WIP with accountable elapsed time | Hold/dwell definition approved; no assumed water dosage or soak duration |
| Drying | Input, start, weather/machine hold, finish readings if required | Dried WIP; measured evaporation/loss category | Recorded basis distinguishes actual moisture loss from balancing estimate |
| Peeling / splitting | Input, equipment/run, accepted product, unpeeled, broken, husk/churi | Forward WIP, rework child and recoverable streams | Each output classified once; repeated passes stay linked |
| G2 final grading | Processed input; quality and size outputs; QC decision | Final-grade bulk child lots and permitted rework/by-products | No saleable release for held/unapproved grade |
| Packing | Bulk lot, approved SKU, pack count/weight, material consumed, manufacture/expiry rule | Packed batch, remaining bulk, packing loss and reconciliation gap | Actual packed weight reconciled; label/expiry and grade rules pass |
| Finished storage | Packed batch, lot ancestry, good/held condition, bin/godown | Factory stock; reservation remains an overlay | FEFO, capacity, storage age and fumigation controls |
| Dispatch / distribution | Approved demand, reservation, picked batch, loading/weight/trip/documents | Factory custody decreases; In-Transit increases | Evidence and required commercial documents pass; recipient accepts separately |

### WF-02 — Intake lifecycle

| From | Trigger / condition | To | Quantity effect |
| --- | --- | --- | --- |
| Purchase Draft | Submit valid purchase | Purchase Pending Approval / Open under policy | None |
| Purchase Open | Link truck/weighbridge/QC | Intake Under Inspection | Received custody recorded under traceable intake/temporary hold identity; no available stock |
| Under Inspection | Variance or QC uncertainty | Intake On Hold | Held quantity visible |
| Under Inspection / On Hold | Authorized checker accepts eligible portion | Partially Accepted / Accepted | Accepted raw stock posted once |
| Under Inspection / On Hold | Reject quantity | Rejected Pending Disposition | Quantity remains in accountable custody until return/disposal |
| Purchase Open / Partially Received | Remaining ordered quantity received or explicitly cancelled | Purchase Closed | No fabricated receipt for cancelled balance |

Failure/compensation: duplicate slip blocks posting; missing evidence leaves draft/hold. Corrections after posting use reversal; after consumption require a controlled chain correction. Supplier return is an outward transaction, not deletion of intake. Commercial deduction does not reduce kilograms unless material physically leaves or is separately classified.

### WF-03 — Stage run lifecycle

| From | Trigger / condition | To |
| --- | --- | --- |
| Planned | Eligible lot portion received, route checks pass | Ready / Queued |
| Ready | Assigned owner starts | Running |
| Running | Report reasoned weather/machine/quality hold | On Hold |
| On Hold | Authorized resume with remaining work | Running |
| Running | Partial output posted | Running with reduced residual input |
| Running | All input accounted; required QC/reconciliation complete | Completed |
| Completed | Available output issued | Partially Issued / Fully Issued |
| Completed / Fully Issued | Daily review approved under policy | Closed |

Failure/compensation: posting is all-or-none across the affected balance and linked output movements. An imbalance remains a draft exception; supervisor approval never legitimizes unexplained disappearing material. Required loss approval can authorize an explicit loss posting. A closed run can only be corrected through a traceable authorized revision, not edited in place.

### WF-04 — Issue / receive handover

| From | Trigger / condition | To | Responsibility |
| --- | --- | --- | --- |
| Draft Issue | Sender confirms available quantity and destination | Issued / Awaiting Receipt | Sender until custody handoff; configured transfer custodian thereafter |
| Awaiting Receipt | Receiver accepts full good quantity | Received | Receiver for accepted material |
| Awaiting Receipt | Receiver accepts part or records mismatch | Partially Received / Disputed | Receiver for accepted portion; transfer custodian for remainder |
| Disputed | Approved reweigh, located stock, return or loss posting | Settled / Returned / Loss Settled | Approver resolves each residual quantity |
| Draft Issue | Sender cancels | Cancelled | No posting |
| Issued | Physical movement did not occur; approved cancellation/reversal | Reversed | Restores source once, only if no conflicting receipt/use |

The receiver MUST NOT edit the sender’s measurement. Transfers awaiting receipt MUST appear in a custody bucket or clearly identified pending transfer, not both source available and destination available. Rejecting receipt does not put physically departed material back into source stock automatically.

### WF-05 — Order, allocation and delivery

**Factory-to-distributor:** Punched → Credit/Approval Pending → Approved → Partly/Fully Reserved → Picked/Packed → Partly/Fully Dispatched → In-Transit → Partly/Fully Received → Closed.

**Distributor-to-retailer:** Punched → Validated/Approved → Reserved → Out for Delivery if recorded → Delivered → Closed. The source scope’s single order lifecycle is retained conceptually, but two fulfillment legs MUST remain distinguishable. A retailer order does not deduct factory and distributor stock simultaneously.

Transitions MUST check line balances, rate version, credit, permissions, eligible batch and required evidence. Factory dispatch consumes its matching reservation. Retailer delivery consumes distributor reservation and physical stock once. The proposed retailer Out-for-Delivery step is an operational status with source custody until delivery; adding a separate retailer-transit quantity ledger requires OQ-09 approval.

Failure/compensation: rejected offline sync stays visible as rejected/pending correction, never silently repriced or lost. Before dispatch, cancellation releases residual reservations. After dispatch, cancellation follows return/reverse-logistics and commercial correction; delivered records are not deleted. Part returns never reopen the full original order quantity automatically. A reservation cannot exceed physical eligible stock; an advance promise is distinct forecast demand.

### WF-06 — Return / complaint / recall

Complaint Open → Triaged → Pending Approval → Approved / Rejected → Replacement and/or Return / Local Disposal → Evidence/QC/Financial Review → Resolved → Closed.

Return Authorized → Return In-Transit → Received Held → Inspected → Released / Regraded / Reprocessed / Disposed. Return authorization alone creates no physical receipt. A replacement is a new linked fulfillment, not a stock credit. Financial credit/debit status is independent of physical disposition. Case closure requires required actions and evidence; unresolved financial action remains visible.

**P recall:** Suspected issue → Authorized recall case → Identify root and descendants/recipients → Hold undispatched affected stock → Record notices/actions → Recover/inspect/dispose → Reconcile affected quantities → Authorized closure. Legal reporting remains with the designated compliance owner; ERP tracking does not itself file a regulator notice. Missing downstream lot identification is a traceability exception requiring investigation, not a guessed match.

### WF-07 — By-product generation to use/sale

Generation Draft → Balanced Stage Posting → Available / Held By-Product Stock → Reserved if applicable → Internal Consumption **or** External Dispatch → Receipt/Commercial Sync where applicable → Reconciled.

Husk/Churi origin, quantity and classification MUST remain visible. Rework classified as unpeeled MUST NOT also appear as by-product until an approved reclassification consumes the prior stock category. Internal consumption needs an authorized purpose; external sale needs buyer, agreed rate and the approved invoice/tax treatment. Failed invoice sync does not restore physically dispatched stock. Sale cancellation after movement requires actual return/correction, not deletion.

### WF-08 — Physical count / adjustment

Count Planned → Snapshot/Cutoff → Count Entered → Discrepancy Review → Checker Approved / Recount → Adjustment Posted → Closed.

A blind count is proposed where appropriate. Simultaneous receipts/issues MUST either be held for the count or reconciled against the count cutoff; the selected method is OQ-11. Quantity adjustment, grade change and custody transfer are different transaction types. Failure retains original count and makes no partial adjustment.

### WF-09 — Tally / e-document lifecycle

Source Document Draft → Approved → Queued → Sending → Acknowledged / Retry Pending / Requires Accounts Action → Reconciled. Financial sync status MUST NOT overwrite physical delivery status.

Invoice Draft → Source Assigned → Statutory Validation → IRN Pending → IRN Confirmed / Status Unknown / Failed → Locked → Cancelled only when externally confirmed and permitted. A timeout means **Status Unknown**, not proof of failure. Query existing status before retry. Source migration for an invoice requires reconciliation and authorization; the original source history persists.

### WF-10 — HR payroll lifecycle

Punch Imported → Attendance Exception Review → Approved Attendance → Payroll Draft → Reviewed → Authorized → Bank Output / Financial Handoff → Period Closed. Rejected punches and manual corrections remain traceable. An import retry cannot duplicate hours; revised salary rules do not silently change an authorized prior payroll.

### WF-11 — Prepare, run and close the operating day

**P; FR-096, FR-116, FR-118–119.** Before the shift, the Factory Head reviews pending customer promises, eligible raw lots, route capacity, packaging, staff, machine/line release and storage space. Proposed plan states are **Draft → Readiness Check → Ready / Blocked → Released → Running → Reviewed / Carried Forward**. The plan identifies quantities, due times and the owner of each constraint. Updating the plan records what changed and which promises are affected; it does not move stock or automatically place a purchase.

During the shift, staff work from **My Work**. Routine acceptance, measured outputs and issues update stock/ETA automatically from the transaction. The owner sees only decisions outside delegated authority and critical unresolved risks. Before shift end, the system assembles a closing summary; the supervisor confirms outstanding physical quantities, handovers, holds and responsible next-shift users. Closing the summary does not complete an unfinished run.

Failure/compensation: a missing bag supply, line release or absent operator marks the affected work blocked and creates a specific task. Other eligible work can proceed. A broken machine remains unavailable until the configured return-to-service check is satisfied. Changing a completion forecast never replaces the original customer promise without the authorized order workflow.

### WF-12 — Replenishment and purchase/bill follow-up

**P; FR-094–095, FR-101, FR-106, FR-109.** Shortage signal → Suggested quantity/date → Procurement or Sales review → Approved purchase/order/transfer → Promised delivery → Partial/complete receipt → Purchase/accepted-receipt/bill match → Accounts pending dispute or financial acceptance → Tally settlement reference.

A suggestion has no stock or cash effect. Its calculation shows demand horizon, eligible stock, existing reservations, reliable open supply and lead time; do not count the same supply twice. Packing material and oil requirements are derived from approved usage factors; spares/electricals use approved minimum stock or identified maintenance need. If factors/lead times are missing, say “planning input needed.”

Failure/compensation: supplier delay updates the supply risk, not physical receipts. Overbilling or rate/tax mismatch is assigned to Procurement/Accounts; quantity remains based on accepted physical receipt. A bill dispute does not automatically stop production of otherwise released purchased stock unless an approved commercial hold policy applies. Payment status is accepted from the reconciled financial source, never inferred from intake or an uploaded screenshot.

### WF-13 — Store, protect, pick and repack

**P; FR-099–105.** Approved receipt → Identified bin/stack/silo → Released / Location Hold → Eligible FEFO pick → Physical issue. A godown aggregate is calculated from its locations; it is not extra stock. A label or printable locator uses the existing phone/printer capabilities when available; no hardware purchase is implied.

Treatment/incident status: **Scheduled → Area Isolated → Work Recorded → Awaiting Authorized Release → Released / Continued Hold**. Record affected locations/lots and evidence under the approved procedure. Reaching a calendar time alone never proves food or area release. Authorized containment transfers can move held stock while keeping its hold; ordinary sale/use remains blocked.

Repacking status: **Requested → Authorized → Source Packs Issued → Repack Recorded → QC Released / Held → Completed**. Consume the source material/pack identities; create linked output packs; record packing material used, unused returns and damaged packaging. Net food mass is conserved with classified losses. New pack identity does not create a newer food-manufacture date or extend shelf life by default. Blending remains a separate unresolved policy under OQ-08.

Failure/compensation: stock in a closed/treatment area cannot be picked as normal stock; software cannot assume physical access is safe. A short pick records what remains/missing without creating saleable supply. Repack miscounts or failed seals keep the batch held. An aborted repack returns only verified unconsumed material through recorded movements.

### WF-14 — Delivery and money follow-up

**P; FR-107–109, FR-112.** Dispatch → Assigned stop/recipient → Accepted / Partly Accepted / Refused → Proof Recorded → Residual Custody Settled. Each stop references its own shipment lines. A vehicle’s trip closing cannot silently close every delivery. Actual retailer delivery remains the original distributor stock-deduction trigger; goods out for delivery stay protected by their order commitment until accepted or physically returned.

Collection: **Follow-up Due → Promise to Pay / Evidence Captured → Accounts Review → Financial Source Confirmed / Rejected → Reconciled**. Cash collected but not deposited, cheque pending clearance, unidentified receipt and bank-confirmed receipt are distinct business statuses where the approved collection mode applies. Responsible custody, acknowledgment and deposit reference are recorded for handled cash. ERP does not execute bank payments. A bounced/reversed settlement must be reconciled and refresh credit exposure once.

Debtor/creditor identity follows the sales leg: retailer debt to a distributor is not automatically Rentio’s receivable. Any collection on a partner’s behalf requires explicit authority and a reconciliation owner. Failed proof/settlement leaves a visible task; it cannot manufacture delivery or payment success.

### Expected, actual and escalation timing contract (P detail; C timing intent)

- Record **queued-at, received-at, started-at, paused/resumed-at, output-posted-at, completed-at, issued-at and accepted-at**, where relevant. Keep physical event time and system recorded time; late entry requires a reason. Timers run from the defined business event, not the time someone later types it.
- **Elapsed stage time = completion time − receipt/queue entry time. Active process time = sum of Running intervals. Queue time = start − ready time. Hold time = sum of On Hold intervals. Handover time = final accepted time − issued time.** Open intervals show elapsed-to-now, never a false completed duration.
- Source formula **lot expected finish = start + standard duration × season factor** is retained. Unit and meaning of season factor must be configured; no numeric factor is assumed. Proposed stage clearing duration is **remaining compatible quantity / effective capacity per working day**, scheduled on the relevant working calendar. Do not add this duration twice to the same work.
- Display **baseline expected finish**, **current forecast finish**, **actual finish** and **variance against baseline** separately. Remaining-route completion includes queue/load, approved holds and downstream capacity using a documented method; OQ-12 selects the planning policy. Missing capacity produces “ETA unavailable—capacity needed,” not zero-time completion.
- A hold may change forecast and operational escalation rules; it MUST NOT erase baseline lateness. Define approved working-time versus calendar-time treatment per route. Record 24/7 shifts explicitly. Paused process timers and receipt/food-safety timers need separate rules.
- Status precedence proposal: **On Hold** while an active hold exists; otherwise **Delayed** if deadline passed; **At Risk** if forecast misses baseline or configured buffer is breached; else **On Track**. Also show late flag on held work. Color is supplemental to status text.
- Escalation intervals and At Risk buffers remain unfilled business parameters. Acknowledgement records who is acting; resolution records what fixed the cause. Reassignment, backup activation and overdue owner escalation all remain auditable.

## 17. User Stories


- **US-001 — P1:** As this persona, I want to see stock and exceptions in one view, so that I can decide without calling every stage. Traces to M13, FR-072–FR-077; detailed capabilities are in that module’s remaining requirements.


- **US-002 — P2:** As this persona, I want to see bottleneck load and held lots, so that I can prioritize the shift. Traces to M13, FR-073–FR-075; detailed capabilities are in that module’s remaining requirements.


- **US-003 — P3:** As this persona, I want to receive and issue traceable lot quantities, so that I can accept responsibility for only what I receive. Traces to M4, FR-018–FR-025; detailed capabilities are in that module’s remaining requirements.


- **US-004 — P4:** As this persona, I want to link each truck to its farmer/vendor purchase, so that I can reconcile ordered and accepted quantities. Traces to M2, FR-006–FR-012; detailed capabilities are in that module’s remaining requirements.


- **US-005 — P5:** As this persona, I want to enter weights with slip proof, so that I can resolve weight disputes from evidence. Traces to M2, FR-008–FR-011; detailed capabilities are in that module’s remaining requirements.


- **US-006 — P6:** As this persona, I want to hold or release inspected material, so that I can prevent unsuitable stock from entering sale. Traces to M6, FR-038, FR-064, FR-067; detailed capabilities are in that module’s remaining requirements.


- **US-007 — P7:** As this persona, I want to count and transfer lot-level godown stock, so that I can reconcile custody without overwriting history. Traces to M5, FR-026–FR-030; detailed capabilities are in that module’s remaining requirements.


- **US-008 — P8:** As this persona, I want to pick eligible reserved batches, so that I can dispatch the correct quantity once. Traces to M7, FR-039–FR-042; detailed capabilities are in that module’s remaining requirements.


- **US-009 — P9:** As this persona, I want to track trip and receipt variances, so that I can settle custody and freight. Traces to M12, FR-069–FR-071; detailed capabilities are in that module’s remaining requirements.


- **US-010 — P10:** As this persona, I want to receive and maintain my own distributor stock, so that I can fulfill retailer orders with current availability. Traces to M8, FR-044–FR-049; detailed capabilities are in that module’s remaining requirements.


- **US-011 — P11:** As this persona, I want to capture orders offline with visible sync status, so that I can continue visits without promising unavailable stock. Traces to M9, FR-050–FR-056; detailed capabilities are in that module’s remaining requirements.


- **US-012 — P12:** As this persona, I want to reconcile source documents with Tally acknowledgements, so that I can avoid duplicate books and IRNs. Traces to M10, FR-057–FR-060; detailed capabilities are in that module’s remaining requirements.


- **US-013 — P13:** As this persona, I want to calculate payroll from approved attendance, so that I can explain each employee payment. Traces to M15, FR-083–FR-086; detailed capabilities are in that module’s remaining requirements.


- **US-014 — P14:** As this persona, I want to version configuration and assignments, so that I can change future operations while preserving history. Traces to M1, FR-002–FR-005; detailed capabilities are in that module’s remaining requirements.


## 18. Business Rules

### Enforceable control register

C refers to the original rule; proposed reconciliations are explicit. No business approver can waive quantity conservation by making an unexplained difference disappear.

| Rule | Domain / evidence | Rule | Enforcement point |
| --- | --- | --- | --- |
| BR-001 | Identity; C S2 BR-1 | Every manufacturing/distribution stock movement MUST identify Lot ID; stores MUST use a traceable item/batch or linked consumption reference (P extension) | Every stock posting |
| BR-002 | History; C S2 BR-2 | Stock MUST change only through transactions; posted transactions MUST NOT be deleted | Post/correct/reverse |
| BR-003 | Approval; C S2 BR-3 | Weighbridge, adjustments, disposal and grade changes MUST use maker-checker | Approval; same-user approval denied (P explicit interpretation) |
| BR-004 | Evidence; C S2 BR-4 | Weighbridge, variance, damage and disposal MUST retain required photo proof | Submission/release |
| BR-005 | Balance; C S2 BR-5; P refinement | Accounted input MUST equal all outputs including additions, by-products, rework, loss and residual as defined below | Run output/close, M3/M4 |
| BR-006 | Allocation; C S2 BR-6 | FEFO override MUST require approval | Reservation/pick/delivery |
| BR-007 | Quantity; C S2 BR-7,BR-18 | Negative stock and use above available quantity MUST be blocked | Every reserve/issue/consume |
| BR-008 | Rate; C S2 BR-8 | Accepted order rate MUST stay locked except authorized versioned amendment | Order acceptance/amendment |
| BR-009 | Credit; C S2 BR-9 | Configured credit limit MUST be enforced | Approval/dispatch checkpoint under approved policy |
| BR-010 | Period; C S2 BR-10 | Closed months MUST be locked; correction requires permitted reopening or current-period adjustment | Post/backdate/correct |
| BR-011 | Ownership; C S2 BR-11 | Every active stage MUST have an owner and backup | Route activation/run start |
| BR-012 | Location; C S2 BR-12; P clarification | One live stock fragment MUST have exactly one custody position; root-lot descendants MAY span positions | Split/transfer/post; OQ-04 |
| BR-013 | Capacity; C S2 BR-13 | Godown capacity excess MUST require approval | Put-away/transfer approval |
| BR-014 | Invoice; C S2 BR-14 | One invoice MUST have one designated IRN source and no duplicate IRN | Generation/retry/import |
| BR-015 | Access; C S2 BR-15 | Salesman MUST see only mapped distributor data | Every view/action/export |
| BR-016 | By-product; C S2 BR-16 | Each by-product movement MUST identify type, location, quantity, reason and origin where applicable | Generation/use/dispatch/correction |
| BR-017 | By-product; C S2 BR-17 | By-product closing stock MUST reconcile under the movement equation below | Daily/period reconciliation |
| BR-018 | Correction; C S2 BR-18 | By-product corrections MUST follow authorized stock-adjustment control | Adjustment approval |
| BR-019 | Reservation; P | Reservation MUST NOT create or remove physical stock | Reserve/release/dispatch |
| BR-020 | Confidence; C/P S2 FR-3.2 | Carried/Counted quantities MUST retain their basis; later weighing MUST NOT rewrite earlier measurements | Handover/packing reconciliation |
| BR-021 | Route; P S5 | Existing runs MUST retain route/rule versions unless an approved change explicitly migrates remaining work | Master activation/active-run change |
| BR-022 | Return; C/P S2 FR-9.3 | Returned or damaged stock MUST remain unavailable until authorized release | Return/receipt/allocation |
| BR-023 | Retry; P | Repeating one accepted command MUST NOT repeat its business effect | Every stock/approval/import/financial submission |
| BR-024 | Approval; P | An approval MUST reference the reviewed values; material changes MUST invalidate the prior approval | Approve/amend |
| BR-025 | Forecast; C/P | Projected quantity MUST NOT be presented as existing physical inventory | Advance booking/control tower |
| BR-026 | Readiness; P | Dependent work MUST respect approved equipment/line, quality and location release gates | Run start/pick/release; FR-093, FR-096–100 |
| BR-027 | Warehouse; P | Location balances MUST sum to their godown without duplicate parent totals | Put-away/count/pick; FR-099 |
| BR-028 | Measurements; P | Net food mass MUST exclude packaging and vehicle tare; uncertain basis stays labelled | Packing/dispatch; FR-098, FR-104 |
| BR-029 | Repack; P | Repacking MUST preserve origin and approved dating constraints | Repack release; FR-103 |
| BR-030 | Finance; P | Collection evidence MUST NOT independently settle financial debt or restore credit | Order/settlement review; FR-108–109 |
| BR-031 | Delegation; P | Routine work MUST use approved delegated authority without bypassing independent checking | Task/approval routing; FR-114, FR-119 |
| BR-032 | Containment; P | Origin and location holds MUST independently block affected eligible stock until each is authorized for release | Reserve/pick/run; FR-100, FR-110 |


### Physical quantity, availability and condition are different

**P reconciliation model to resolve source overlaps:** represent material type/category, lot/fragment, physical custody, condition and reserved quantity independently. “Reserved,” “Quarantine,” “Returned” and “Expired” must not be added as if each were an independent warehouse. A returned lot can be physically at the factory and quarantined; it is counted once.

For one item/lot/location at a specified cutoff:

```text
Closing physical = Opening physical + posted inward + authorized positive adjustments
                 - posted outward - authorized negative adjustments

Eligible physical = physical quantity meeting release, expiry and condition rules
Available-to-reserve = Eligible physical - valid hard reservations on eligible physical

Company-owned stock = factory custody + internal transfer custody + owned external transit
                    + owned distributor/other custody (only if applicable)
```

Distributor stock sold to a partner may no longer be Rentio-owned. The operational network dashboard MUST label network stock separately from legal ownership/financial inventory. OQ-09 decides transfer of title/consignment; no ownership model is presumed.

The source stage formula “Opening + In − Out − Loss − By-products” is usable **only when Out means forwarded main/rework product excluding separately deducted loss/by-products**. In a general movement ledger where by-product/loss are already outgoing entries, MUST NOT deduct them again.

When held/expired status invalidates reserved eligibility, the affected reservation MUST become **Supply At Risk / Suspended** and be excluded from both usable supply and valid reserved supply. The customer commitment remains visible and cannot be silently cancelled. Only verified eligible replacements can be reallocated. Releasing a hold does not create a second reservation or release a separate location hold.

### Material conservation at a transformation

```text
Input taken into this run + measured added material
  = forward product + rework/unpeeled output + recoverable by-products
  + classified process loss + unprocessed residual input
```

Each term MUST appear once. Oil or water retained in the product can add mass; drying can remove moisture. Record additions and evaporation/loss by approved categories and measurement basis. This is a proposed necessary refinement to the source “Input = Output + Loss”; OQ-04 confirms how measurements support it. Do not force a moisture-normalized yield without an approved laboratory/measurement method.

- Product, rework, broken grade, Husk and Churi MUST have one classification for each quantity. Whether “broken” is a sellable grade or by-product is OQ-08.
- Partial processing leaves the unprocessed portion in the input bucket. Output posting MUST reduce only consumed input and MUST NOT leave the same quantity live in both parent and child.
- Root-lot genealogy has historical input plus live descendants; a genealogy parent is not an additional stock balance. Root traceability can span many stages after splits.
- Proposed merges/blends require each contributing origin and quantity, resulting lot identity, approved rules and descendant recall behavior. Until agreed, block merge rather than lose traceability.
- Quantity precision and rounding tolerance are configured by measurement method; no hidden “balancing loss.” Every difference outside precision MUST become explicit loss, found stock, disputed quantity or a correction with required evidence/approval.

**Illustration only, not Rentio yield targets:** a 1,000 kg portion plus 5 kg oil produces 800 kg forward product, 100 kg unpeeled rework, 70 kg husk, 15 kg churi and 20 kg loss. Accounted total is 1,005 kg. The 100 kg rework may later produce additional product; it is not a second 100 kg procurement. A final root yield uses original input once and discloses additions and mass basis.

### Pending handover and receipt settlement

- Issue of 600 kg: source physical/custody decreases 600 kg; pending-transfer custody increases 600 kg. Receipt of 590 kg: pending decreases 590 kg; receiver good/held stock increases as classified. Remaining 10 kg stays pending/disputed until evidence-based settlement.
- For 100 kg shipped with **92 good + 5 damaged physically received + 3 missing**, transit resolves 97 kg into 92 available and 5 held; 3 remains unresolved transit/dispute custody until located, returned or approved loss settlement. A receipt may be operationally submitted/locked while its dispute remains open.
- If 103 kg is physically found against 100 kg dispatched, account for expected 100 kg plus 3 kg **unidentified excess held pending investigation**. Do not let shipment transit become negative or invent a source lot. Approval establishes the true source, measurement correction or found-stock transaction.
- Wrong grade/lot delivered: physically receive into held unidentified/misclassified stock, preserve dispatch identity, then resolve with controlled reclassification/return. Never silently change the dispatched lot to make the receipt match.

### Packing, samples and warehouse measurements

**P; FR-099, FR-102–105.** Keep **bag/pack count**, **nominal declared quantity**, **actual net food weight**, **packaging tare** and **gross cargo weight** distinct. Count × nominal pack weight is Counted quantity unless an actual measurement supports it. Truck gross minus vehicle tare yields cargo weight; subtract separately evidenced packaging/other non-food load where needed before comparing with net food weight. A returned empty bag is packaging stock where relevant, not returned dal.

A retained sample remains held sample stock; destructive testing or disposal is a recorded outward quantity. Floor sweepings, cleaning rejects and recovered spills require QC disposition and cannot automatically replenish saleable stock or by-products. Unused packaging/oil returned from a run is separately recorded from consumed quantities. Location/batch age, original manufacture date and expiry remain intact after transfers and routine repacking.

### By-product stock equation

```text
Closing by-product stock
 = Opening + generation + external inward + transfers in + approved positive corrections
 - internal consumption - external dispatch - transfers out
 - disposal/other approved outward - approved negative corrections
```

At all-location total, transfers in/out cancel. “Sold” is commercial status; stock reduces on physical issue/dispatch, not again when invoice is raised or payment received. Opening by-products with unknown historic origin MUST be explicitly labelled migrated/unknown-origin rather than assigned a fictional manufacturing lot.

### Network reconciliation and yield

The S1 acceptance equation is a useful summary, but omits downstream sales, disposal and additions and can double-count by-products across locations. Use the following proposed closed-boundary reconciliation instead, with boundaries and opening cutoff stated:

```text
Opening network physical + actual external physical receipts + measured process additions
 + approved found-stock corrections
 = Closing network physical (raw + WIP + finished + by-products + held + transit)
 + external physical deliveries outside the tracked network
 + internal consumption leaving the tracked material boundary
 + approved process/transit loss + disposal
 + approved negative corrections
```

For this physical boundary, external receipts include physically received material awaiting QC and physically present rejected material; these are held/unapproved custody, not saleable accepted procurement. Use a traceable provisional receipt identity and record the measurement basis. Acceptance changes eligibility/classification without adding the same receipt again. Supplier returns are external outward movements. Commercial accepted-purchase reporting remains separate. If an additional material such as oil is already tracked inside the chosen inventory boundary, its use is an internal conversion, not a second external addition; additions apply only when crossing that report’s stated boundary. An excess quantity already recorded as unidentified physical receipt MUST NOT be added again when its origin is resolved; use reclassification/correction of identity. A found-stock correction is used only for a previously unrecorded physical quantity, with its own evidence and approval.

Internal stage/godown/distributor transfers cancel. Returns from outside the boundary are external receipts; internal network returns are transfers. Closing stock includes by-products once, wherever they sit; cumulative generation MUST NOT also be added to closing. The network boundary, distributor ownership and retailer Out-for-Delivery treatment require OQ-09 sign-off.

Yield reports MUST distinguish stage-pass yield from root cumulative yield, gross received from net accepted input, provisional carried figures from final actual figures, and dry/wet basis if an approved normalization exists. Owner approval of a standard yield MUST identify sample lots, exclusions, route/grade and effective date. An observed 10–15% rework context does not authorize automatically posting 10–15% rework on every lot.


## 19. Data Requirements

These are business information requirements, not a storage design. **R** = required for the relevant confirmed transaction; **D** = conditional on workflow/configuration. Data-minimization and retention detail are P safeguards.

| Entity / accountable owner | Meaningful fields | Requiredness / constraints | Sensitivity |
| --- | --- | --- | --- |
| Product / SKU — Master SPOC | Type, quality, size, pack unit/weight, shelf life, active status, effective version | R: identity and active combination; D: shelf life/date rule before sellable batch release | Internal; rates confidential |
| Stage / Route — Factory Head | Sequence, stage code, allowed transitions, material classes, owner/backup, capacity+unit/calendar, duration+unit, factor, measurement method, thresholds | R before route activation; rework paths explicit; zero/missing capacity cannot yield a valid ETA | Internal |
| Location / Godown — Inventory lead | Plant, location, allowed stock types, capacity+unit, owner, fumigation schedule | R: identity/type; D: capacity/unit where enforced | Internal |
| Business Party — Back Office / Sales | Farmer/vendor category, name, available identifying/contact details, broker, distributor/retailer/buyer mapping, tax/credit details if applicable | R: unique party identity; D: applicable tax/credit fields; no invented mandatory farmer identifier | PII/contact; commercial confidential |
| Purchase / Intake — Procurement | Supplier, optional broker, declared quantity/rate/bill, truck links, gross/tare/net, accepted/rejected/held, deductions, checker | R per M2; quantity and value deductions separate; multiple receipts allowed | Commercial confidential; driver/contact PII |
| Evidence / Inspection — QC | Slip/bill/photo/video, inspection readings+unit, inspector, result, reason, attachment time/version | R where required; D per approved QC checklist; replacing evidence retains history | Internal/confidential; possible PII |
| Lot / Fragment / Batch — Factory Head | Root origin(s), child identity, material class, grade/SKU, route version, production date/expiry rule, quantity basis and current positions | R: traceability and units; no duplicated current parent stock; origin unknown flagged only under controlled migration/excess | Internal |
| Stage Run — Stage Owner | Lot portions, pass number, machine if used, planned/actual timestamps, hold reasons, inputs/additions/outputs/loss, residual, daily close | R for posting; expected and actual time never overwrite each other | Internal |
| Quantity Measurement — Measuring user | Numeric quantity, unit, method, Actual/Counted/Carried, count/conversion where relevant, measured-at, recorded-at, evidence, source reference | R per movement; counted conversion/version retained | Internal |
| Stock Movement / Reservation — Inventory | Source/destination custody, lot/item, condition, quantity/unit, cause document, business date, actor, approval, reversal link; reservation order line/expiry if applicable | R per posting; hard reservations limited to eligible stock; negative stock prohibited | Internal; value confidential |
| Order / Rate / Credit — Sales + Accounts | Fulfillment leg, party, retailer, requested/promised dates, lines, rate snapshot, tax basis if applicable, reservation, delivered/cancelled/returned balance, exposure | R per order; stale offline terms explicitly resolved | Commercial confidential; party PII |
| Trip / Receipt / Dispute — Logistics | Vehicle/driver/transporter, shipment lots, weight evidence, good/damaged/short/excess receipt, recipient, unresolved qty, settlement | R for relevant dispatch/receipt; submitted receipt locked | Confidential; driver PII |
| By-product Use/Sale — Inventory / Accounts | Type, origin, location, internal purpose or buyer, qty, rate if sold, date/user, approval and commercial reference | R: physical identity/movement; D: rate/tax for sale | Internal/commercial confidential |
| Complaint / Return / Recall — QC + Sales | Reporter, category, root/child lot if known, order/recipient, evidence, authorization, return receipt, disposition, replacement and credit links | R: case identity/status/owner; unknown lot explicitly unresolved | Confidential; reporter PII |
| Alert / Approval / Decision — Responsible SPOC | Trigger, affected records, severity, threshold version, due/escalation times, approver, decision/reason, action evidence, resolution | R: ownership and audit; no retroactive approval of different values | Internal/confidential |
| Cost / Sync Document — Accounts | Cost component/basis, allocation version, provisional flag, source document identity, designated owner, external references, attempts/response, reconciliation | R per calculation/exchange; Tally remains financial record | Commercial confidential |
| Employee / Attendance / Payroll — HR | Employee identifier, device mapping, shift, punches, corrections, leave/OT, rule versions, approved run, bank/statutory data if applicable | R: employee and approved work/pay rules; collect sensitive details only where required | Restricted PII/payroll/bank |
| Audit / Access Assignment — Administrator / Auditor | Actor, effective role/scope, event+recorded time, object/reference, old/new values or movement, reason, approval, correlation, denied sensitive actions | R for protected changes; audit not editable by transaction users | Restricted internal/PII |

**P additions for owner-review workflows:** location records include bin/stack identity, physical restrictions and release evidence (Inventory/QC owner); equipment/instrument records include identity, permitted use, check due date and unavailable/released status (Factory Head owner); purchase matching includes accepted receipt references, billed quantity/rate, dispute and acknowledged financial link (Procurement/Accounts owner). Daily plans/tasks include work reference, responsible role, due time, prerequisites and close/handover result (Factory Head owner). Collection records include debtor, creditor, evidence, collector/custodian if applicable, Accounts acknowledgment and reconciled financial status (Accounts owner; restricted commercial/PII). Store only business-required evidence; bank/payment details are not visible to general factory users. All are required only when their workflow applies; a “not applicable” readiness item needs an approved reason.

**P data-quality rules:** use one consistent business-time display with explicit timezone, preserve original event times from offline work, distinguish missing values from zero, retain units beside every quantity, and never use a free-text name as the only unique business identity. Required attachments must be accessible to authorized reviewers before approval; broken evidence links are exceptions.

## 20. Roles & Permissions

This matrix is a proposed implementation of the confirmed role-based access and maker-checker intent. **Own** means assigned stage/location/distributor only; **Create** does not mean Approve. All unlisted permissions default to denied until the owner approves them. Auditors receive read-only access through a configured profile, not implicit administrator privileges.

| Capability | Owner | Factory Head | Stage Owner | Back Office / stock/dispatch profiles | QC profile | Accounts | Salesman | Distributor | HR | Setup Admin |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| View operational network | All authorized | Factory scope | Own stage | Assigned scope | QC scope | Commercial scope | Mapped only | Own only | Attendance staffing only | Setup only |
| Configure masters/routes | Approve policy | Propose production | No | Propose assigned | Propose QC | Propose financial | No | No | Propose HR | Maintain approved setup |
| Create purchase/intake | No default | Review | No | Create assigned | Inspect only | Review commercial | No | No | No | No |
| Approve intake/weight variance | Assigned, not own | Assigned, not own | No | Checker profile only, not own | Quality decision only | Value decision if assigned | No | No | No | No |
| Receive/start/output/issue stage | No default | Assigned backup only | Own | No | QC actions only | No | No | No | No | No |
| Stock adjustment/grade/disposal | Approve assigned | Approve assigned | Request | Request/create | Recommend/release as assigned | Financial review only | No | Own request only | No | No |
| Reserve/pick/dispatch | Policy approval | View/authorize assigned | No | Assigned actions | Release gate only | Credit/documents gate | Submit order only | Own retail fulfillment | No | No |
| Record distributor receipt/sale/count | View | View | No | Support under explicit scope | Inspect returns | Reconcile | Assigned order/complaint | Own only | No | No |
| Rates/credit/financial sync | Policy approval | No default | No | View assigned | No | Maintain/approve per policy | Authorized rates, no change | Own permitted prices | No | No |
| Payroll and bank output | Explicit restricted role | No | No | No | No | Authorized financial handoff only | No | No | Create/review assigned | No |
| Grant roles/access | Approve | No | No | No | No | No | No | No | Employee status request | Execute approved grants |
| Audit/export | Authorized scope | Factory scope | Own history | Assigned scope | QC scope | Finance scope | Own/mapped limited | Own limited | HR scope | Access/config history |

**P safeguards:** a user MUST NOT approve their own protected transaction, including when they hold multiple roles. Missing approver/backup routes to an explicit exception owner; it does not auto-approve. Role changes apply to future actions; audit retains the historical acting scope. Disabled staff lose access while their records remain. Distributor A and salesman A cannot access B by search, direct record link, export, saved filter or notification. A setup administrator has no default right to salary values or stock correction.

New owner-review actions use existing profiles: Factory Head approves daily plans and authorized return to service; stage staff record tasks; QC authorizes quality/affected-food release; the store keeper locates/counts stock and records treatment evidence; Procurement resolves bill/receipt quantity issues; Accounts alone confirms financial settlement; Sales/logistics own delivery follow-up. Each permission is limited by assigned scope and OQ-02. Recording a maintenance task does not confer food-release authority.

The emergency-access procedure, alternate approvers, monetary/quantity limits and owner self-approval policy are OQ-02. A title such as “Owner” does not remove statutory or audit obligations.

## 21. Multi-Tenancy

**Unresolved, OQ-17.** The sources describe one Rentio ERP and future additional plants/pulse types, not a multi-customer software service. Working proposal A2 is one business deployment with explicit plant/location/partner boundaries. Do not assume distributors are separate software tenants or that all plants share a legal entity. Each business record MUST identify its organizational scope; master sharing, intercompany sales and financial consolidation require an explicit decision before design. No cross-client sharing is authorized.

## 22. Integrations

Tally is named because it is an explicit business constraint in the supplied scope. This specification does not choose an implementation stack.

| Integration | Direction / business content | Failure and recovery behavior | Evidence |
| --- | --- | --- | --- |
| Tally on Cloud | Approved purchases, sales/by-product sales, freight, receipts out; ledgers/outstanding balances in | Pending/error queue; authorized retry/status lookup; matching source identity; reconcile counts/values | C S2 FR-11; no public exposure of Tally access |
| E-invoice / e-way bill | Approved generation through selected ERP/GSP or Tally route; status/cancellation in | Unknown status queried before retry; duplicate prevention; source ownership preserved; no false success | C S2 FR-11.4–11.5 |
| Messaging | In-app plus configured WhatsApp or SMS alert delivery | Proposed retry/delivery status; in-app exception remains visible on channel failure; no private payroll content in general alerts | C channel / P failure detail |
| Biometric / attendance file | Punch records into HR | File fallback; duplicate/invalid employee mapping isolated for review | C S2 FR-14.1 |
| Sales Trend / legacy records | Agreed open-order migration | Reconciliation of source IDs and quantities; no duplicate live orders | C S1 migration |
| Bank/payroll output | Approved payroll export | Restricted authorization; version/check totals; failed output does not mark payment made | C output / P safeguard |

### Compliance applicability and controlled release

**Confirmed scope:** Tally, e-invoice/e-way bill, invoice source protection, PF/ESI payroll capability, records/evidence and period locking. **Proposed operational compliance detail:** license/document reminders, approved label fields, recall case support and configurable retention. Accounts/compliance must confirm the applicable legal entity, registrations, product classifications, tax treatment, thresholds, jurisdiction and effective dates. No tax rates, GST applicability, payroll contribution formulas, label exemptions or retention periods are invented here.

| Area | Required product behavior / evidence | Owner and unresolved details |
| --- | --- | --- |
| Food quality and traceability | Retain approved inspection results; trace root/child lots to recipients; block held/expired lots; support withdrawal/recall status and disposition | QC/compliance; test limits, license coverage and reporting procedure OQ-05/16 |
| Retail/wholesale pack labeling | Use approved label version with applicable product, net quantity, batch/date, manufacturer/packer and price/other declarations; block unapproved version where required | Compliance; SKU/package exemptions and exact declarations OQ-16 |
| Tax invoices and movement | Record applicable GST/HSN/unit/document data; apply approved invoice source and statutory status gates | Accounts; applicability/thresholds/classifications OQ-13 |
| IRN / e-way bill cancellation | Preserve request time, source, permitted reason and external confirmation; enforce current applicable restrictions | Accounts; cancellation does not automatically reverse physical stock |
| Payroll | Apply approved current PF/ESI and other applicable payroll rules, versioned for the relevant period | HR/Accounts; coverage, eligibility and calculation OQ-15 |
| Weighing / storage evidence | Retain slip identity, dates, required verification references and fumigation logs; flag missing/due records | Operations/compliance; specific instrument/storage obligations OQ-16 |
| Privacy and retention | Restrict personal/payroll data and exports; retain records according to approved schedule/legal holds | Owner/HR/Accounts; schedule and lawful access OQ-16 |

**Official references checked 24 November 2026:**

- **E1 — [FSSAI food recall overview](https://fssai.gov.in/food-law/food-recall):** establishes the food-recall context. The lot/recipient trace and recall-case controls above are proposed product responses, not a claim that the ERP itself satisfies all reporting duties.
- **E2 — [Department of Consumer Affairs legal metrology resources](https://consumeraffairs.gov.in/pages/legal-metrology-act/):** reference set for applicable packaged-commodity requirements; approved label rules must be validated for Rentio’s pack types.
- **E3 — [GSTN FAQs](https://www.gstn.org.in/faqs-category-details)** and **[authorized IRP cancellation guidance](https://einvoice6.gst.gov.in/content/irn-cancellation-all-about-e-invoice-cancellation-in-detail/):** the source PDF’s 24-hour IRN cancellation window is consistent with this guidance. Treat external cancellation confirmation and current eligibility as required; an expired window must go to Accounts for the applicable correction procedure.
- **E4 — [NIC e-way bill FAQs](https://docs.ewaybillgst.gov.in/html/ewb_qna.html):** describes cancellation within 24 hours of generation and the restriction on an already verified bill. Keep e-way bill and IRN cancellation states separate; do not copy one status to the other.

- **E5 — [NIFTEM PMFME Handbook for Red Gram Processing](https://niftem.ac.in/newsite/pmfme/wp-content/uploads/2022/07/redgramwriteup.pdf), processing chapter, physical pp9–13:** describes cleaning and other milling activities including pitting, conditioning, separation and finishing. This supports checking the completeness of Rentio’s configured route. It does not establish which equipment Rentio owns; no published dosage, timing or yield is adopted as a Rentio rule.
- **E6 — [FSSAI hygiene requirements](https://fssai.gov.in/inspection/hygiene-requirements):** identifies documented food-safety management and Schedule 4 hygiene requirements for manufacturing, processing, packaging, storage and distribution. The proposed readiness, records and release tasks are the BA’s application of that context; the actual checklist and critical gates must be approved for Rentio’s operation.

These references validate control areas and the cited cancellation context only. Final applicability review is a launch dependency; this document does not certify legal compliance or authorize a regulatory submission.

## 23. Event Contracts

Business events below describe cross-module observable outcomes, not a software messaging architecture. All are P elaborations. A repeated event MUST NOT produce a repeated quantity/approval/invoice effect. Each event MUST identify event ID, original document/revision, organizational scope, actor, event/recorded time and relevant quantity/unit/lot references.

| Event | Accountable producer | Dependent business views/actions | Consistency requirement |
| --- | --- | --- | --- |
| Intake Accepted | M2 | M5/M6 stock; M14 procurement; M10 commercial queue | Approval and accepted raw posting reconcile |
| Stage Output Posted | M3/M4 | M6 output/by-product stock; M13 ETA; M14 yield | Input reduction and outputs have one complete posting outcome |
| Stock Issued / Received | M4/M5/M7/M8 | Source/destination custody, pending list, alerts | Accepted quantity cannot exceed linked outstanding amount without separate excess handling |
| Reservation Created / Released | M7/M9 | Availability and order balance | No physical quantity effect |
| Shipment Dispatched | M7/M12 | Transit, order, logistics, commercial eligibility | One source deduction; one transit creation |
| Retailer Delivery Confirmed | M8/M9 | Distributor deduction and performance | One fulfillment deduction per source line/action |
| Return Received / Disposed | M11 | Held/returned stock and complaint/cost records | Physical receipt/disposition distinct from credit/replacement |
| Document Acknowledged | M10 | Commercial sync status and reconciliation | Physical stock unaffected by repeated acknowledgement |
| Hold / Priority / Baseline Changed | M4/M13/M16 | ETA, risk, forecast and impacted order list | Original timing/rule history retained |
| Period Closed | Accounts / HR | Locked transactional period | No backdated unauthorized modification |

## 24. Notifications

C alert families are preserved from S2 FR-12.1; audience/timer mechanics are P details. No unapproved numeric timer is embedded.

| Trigger family | Initial accountable audience | Escalation / resolution evidence |
| --- | --- | --- |
| Stage delay, idle stage, bottleneck, breakdown, weather hold | Stage owner + backup; Factory Head | Escalate by configured age/severity to Factory Head/Owner; linked action/hold resolution |
| Pending or mismatched handover, reconciliation gap, abnormal loss, high reprocessing, daily close missed | Sender/receiver or stage owner | Supervisor investigation; quantity settlement or completed close |
| Low raw stock, category shortage, over-capacity/godown full | Inventory + production planning | Owner decision or confirmed supply/capacity action |
| Fumigation due, aged stock, near expiry/expired | Godown/distributor owner + QC | Logged treatment/review or disposition; shelf life never extended without approved policy |
| Pending distributor receipt, delivery variance | Distributor + logistics | Receipt/dispute resolution, not acknowledgement alone |
| Credit breach, IRN or sync failure | Accounts + responsible order owner | Approved credit outcome or reconciled external status |
| By-product mismatch / negative-stock attempt | Inventory + authorized supervisor | Identified movement correction; denied attempt remains audited |
| Forecast baseline pending / stale partner data (P) | Factory Head / partner supervisor | Approved baseline or refreshed verified data |

**P alert lifecycle:** Open → Acknowledged / Assigned → Action in Progress → Resolved → Closed; Reopened if condition recurs. Acknowledgement can stop repetitive reminders to that recipient under configured policy, consistent with S2’s “repeat until acknowledged”; escalation of an unresolved condition can continue under its separate timer. Suppression/snooze requires reason, expiry and visibility to supervisors. Dedupe by condition/record prevents alert floods without hiding repeated occurrences. Changing a threshold does not erase historical alerts.

Channels MUST respect role/scope and avoid revealing sensitive commercial/payroll values to unrelated users. Each alert shows what happened, affected lot/quantity, deadline, named action owner and a direct permitted action. Missing assignee or delivery failure creates a supervisor exception.

## 25. UX / Design Contract

**C intent from S3; P measurable detail:** factory screens center on **Receive → Start → Record Output/Loss → Issue**, plus a visible Report Issue/Hold action. Employees MUST NOT navigate the entire ERP to perform their assigned action. Prefill stage, user, source lot and eligible quantity from the linked task; users confirm rather than retype known data. Confirmation shows quantity/unit, source, destination, condition, basis and irreversible posting consequence. Success returns a transaction reference and the next permitted action.

| Screen / flow | Default | Empty | Loading | Error / conflict | Success |
| --- | --- | --- | --- | --- | --- |
| My Stage | Assigned queue/active/held work, owner, quantity, ETA; only valid next actions | Explain no pending work; show permitted receipt/search | Retain context; prevent repeat posting | Preserve entries; identify quantity/route/hold rule and required resolver | Reference, new balances, next action |
| Receive / Issue | Source reference, outstanding amount, basis, destination and evidence | No eligible source; explain why | Show pending submission state | Show mismatch without editing sender record; retry using same request identity | Posted/partial/pending state and residual |
| Output / Packing | Input, residual, product/rework/by-product/loss fields, balance preview | No started eligible run; link prerequisite | Keep values while validating | Explicit unaccounted difference or expired approval; no auto-balanced loss | Child identities, balance and confidence |
| Godown / Distributor stock | Scoped quantity, condition, reservation, expiry and update time | Distinguish zero stock from unavailable/stale data | Show last as-of time as stale if retained | No fake zero on failed load; retry | Updated movement drill-through |
| Sales order / Offline queue | Mapped distributor, rate/stock timestamp, pending requests | Explain missing mapping or no active SKU | Queued/pending sync clearly distinct from accepted | Field/rate/credit/quantity conflicts show resolution; no silent reprice | Accepted rate/order state or clear rejection |
| Owner Control Tower | Reconciled totals, stale flags, priorities, approval queue | Identify missing opening/baseline/config, not “all clear” | Label cached totals and last refresh | Partial-source failure identifies missing source; totals not falsely complete | Drill-through returns same filter/cutoff |
| Approval inbox | Requested values, rule breached, evidence, submitter, before/after | No pending approvals | Prevent duplicate decision | Changed values invalidate stale approval; self-approval denied | Approver/time/reason/reference displayed |
| Complaint / Return | Origin/order/lot, evidence, physical and commercial states | No cases or required missing identity stated | Preserve draft/evidence progress | Unknown lot, missing proof or disposition shown specifically | Case and linked follow-up statuses |
| Sync / HR restricted work | Own authorized queues/runs, source references and revisions | Explain setup/import prerequisites | Show job progress without claiming completion | Row-specific import/sync issue; valid and failed subsets explicitly identified | Reconciled counts/run version and next review |

Required fields MUST be marked in plain English. Quantity MUST always show unit and basis. Status MUST be readable without color alone. The app MUST show separate “Saved draft,” “Queued offline,” “Submitted,” “Approved” and “Posted” states. Searching/scanning lot identities may be added as a convenience (P); scanning hardware is not assumed. Critical instructions and error text must not expose internal implementation detail.

Training MUST cover role-based task cards and one exception per task. Proposed pilot acceptance is MET-4. Staff should practice with representative receipts, stage splits, shortage and return examples before real cutover. Printed/manual fallback forms should carry unique reconciliation references; their use and later entry approval are OQ-19.

### Daily-work simplification contract — less chasing and re-entry

**P; FR-113–116, FR-119.** The owner’s home view starts with a compact prioritized list: **Decisions for me, Deliveries at risk, Production blocked, Stock/quality risks, Money follow-up**. Show critical issues even if they exceed the suggested five-item focus; keep a visible total and access to all work. Include what happened, affected quantity/value when known, assigned action owner, deadline and next action. A healthy day should show that delegated work is progressing, not create approvals to fill a dashboard.

| Work | System prepares | Person confirms | Owner involvement |
| --- | --- | --- | --- |
| Receive material | Source lot/document, expected quantity, unit and destination | Independent received quantity/basis and visible exceptions | Only delegated limits exceeded or unresolved critical issue |
| Process output | Known input, route, categories and balance calculation | Actual observation, classified output/loss and required evidence | Exceptional loss/decision under approved authority |
| Normal stock transfer | Linked sender details and receiving task | Sender issue and receiver acceptance | No routine intervention unless source approval policy requires owner |
| Reorder | Suggested quantity/date with reason and existing supply | Buyer approves or revises commercial action | Threshold/policy exception only |
| Daily close | Posted totals and outstanding work | Supervisor confirms physical responsibility and unresolved items | Review exceptions; no daily retyping of totals |
| Order/delivery follow-up | Changed ETA, affected promises and assigned tasks | Sales/logistics record actual outcome and agreed changes | Material escalation or allocation decision |
| Financial follow-up | Tally-linked due items and stale/disputed status | Accounts confirms settlement/reconciliation | Cash/credit policy exception or unresolved exposure |

“Enter once” applies to shared identity, rates and source information; independent receiving, measurement and QC observations still require real confirmation. Reusable templates MUST NOT pre-mark measurements, inspections, repair work or delivery as done. No invented readings, auto-balanced loss or automatic quality release are allowed.

Staff receive only their assigned-stage/location/partner work. Pick lists and lot locators can be printed or viewed on current devices; barcode scanning is optional convenience. Keep a no-scan lookup path. Quick quantity/count entry and a one-tap structured issue reason minimize typing. Bulk confirmation is permitted only for genuinely identical authorized actions with each affected record visible; required evidence/checks stay per record.

Normal notifications are grouped into a shift/day summary under the approved policy. Critical food/stock/financial exceptions notify the responsible role promptly. Related alerts share a coordinating incident without hiding child problems. Owner escalation occurs because of severity, deadline or authority, not simply because the owner has access to everything. This specifies product behavior; no recurring notification automation is created by this document.

## 26. Error Taxonomy & Edge Cases

| Error class | User-facing behavior | Quantity / recovery behavior |
| --- | --- | --- |
| Validation | Name missing/invalid field and permitted value/unit | No quantity posting; retain draft |
| Business rule | State violated stock/credit/route/approval rule and next responsible role | No unauthorized effect; no endless automatic retry |
| Permission | Explain action is unavailable; avoid exposing protected data | No mutation; audit sensitive denial |
| Conflict | Show latest stock/document version and changed values | Revalidate before accepting; do not overwrite others |
| Connectivity / unknown outcome | Show queued or outcome-unknown state with request reference | Check existing status before retry; never ask user to create duplicate |
| External service | Identify pending document and responsible support/Accounts action | Physical status stays truthful; controlled replay |
| Unexpected system failure | Preserve work where possible and provide support reference | No partial balance effect; operator can verify outcome |

### Scenario register

All expected treatments below are P elaborations unless the referenced source rule is C. Each scenario MUST be tested when its relevant capability is accepted into the baseline.

| ID | Scenario | Expected treatment / check | Modules |
| --- | --- | --- | --- |
| EC-01 | Same slip reused; slip number repeats next year/vendor | Duplicate blocked within approved identity scope; legitimate reuse resolved using OQ-06 policy, not deletion | M2 |
| EC-02 | Tare exceeds gross; zero/negative weight | Block invalid receipt; require corrected evidence | M2 |
| EC-03 | Supplier bill weight differs from scale | Preserve both; configured variance approval; no hidden overwrite | M2 |
| EC-04 | QC deduction is money rather than removed matter | Keep value deduction separate from physical quantity | M2/M14 |
| EC-05 | Purchase arrives in three trucks; one partly rejected | Per-truck acceptance; ordered/open balance reconciles; rejected custody tracked | M2 |
| EC-06 | Entire intake rejected after physical unloading | Held/rejected balance remains visible until approved outward disposition | M2/M6 |
| EC-07 | One stage issues a partial lot while remainder runs | Split only issued/processed quantity; remaining input/WIP stays live once | M3/M4 |
| EC-08 | Sender/receiver weights differ | Accept evidenced portion; disputed residual retained; both readings preserved | M4 |
| EC-09 | Receiver rejects after vehicle left source | Pending/return custody; no automatic source replenishment | M4/M12 |
| EC-10 | No intermediate scales | Carried/Counted basis; disclose uncertainty; packing gap investigated | M4/M14 |
| EC-11 | Added oil or water causes apparent output gain | Record measured additions separately; do not force negative loss | M4 |
| EC-12 | Drying removes moisture | Classified loss/evaporation with basis; no fabricated precise stage attribution | M4 |
| EC-13 | Repeated unpeeled loops | Child/pass ancestry; repeat threshold alert; root input counted once | M3/M4 |
| EC-14 | Broken material treated as both grade and by-product | One approved classification per quantity; controlled reclassification | M3/M6 |
| EC-15 | Mixed lots accidentally merged | Hold and investigate; block unapproved blending; origins not discarded | M4/M6 |
| EC-16 | Route changed during active run | Existing version retained; authorized migration records remaining work and reason | M1/M4 |
| EC-17 | Weather/machine hold crosses shifts/weekend | Keep real elapsed, active and hold time; update forecast and handover; late flag remains | M4/M16 |
| EC-18 | Stage owner absent or disabled | Assigned backup/approved reassignment; historical accountability preserved | M1/M4 |
| EC-19 | Output posted above tolerance or unbalanced | Required approval for explicit loss; unexplained balance cannot close | M3/M4 |
| EC-20 | Finished packing weighs less than carried stages | Record final actual; keep historical readings; explicit reconciliation case | M4/M14 |
| EC-21 | Godown full/wrong stock type | Enforce compatible placement and capacity approval; physical arrival remains held/pending | M5 |
| EC-22 | Count taken during stock movements | Apply agreed snapshot/cutoff method; movements not mistaken for shrinkage | M5/M6 |
| EC-23 | Two users reserve/issue last balance concurrently | Accept only available portion/action; block overselling | M6/M7/M9 |
| EC-24 | Reserved batch expires or is recalled before dispatch | Block pick; flag affected order; reallocate only eligible stock | M6/M7/M11 |
| EC-25 | FEFO conflicts with quality hold/customer grade | Exclude ineligible batches before FEFO; authorized grade substitution decision | M6/M7 |
| EC-26 | Order reduced/cancelled after partial dispatch | Release only undelivered unissued reservation; shipped quantity follows return/credit | M7/M9/M11 |
| EC-27 | Offline rate expires, mapping revoked or credit exhausted | Server-side business revalidation on sync; pending conflict visible; no silent price promise | M9 |
| EC-28 | Retry after app restart/timeout | Same request resolves to one posted outcome; no double order/deduction | M7/M8/M9 |
| EC-29 | Distributor receives short/damaged/excess/wrong grade | Good/held/unresolved buckets; locked receipt and dispute; no negative transit | M8 |
| EC-30 | Distributor records outside-app sale already delivered in app | Cross-reference identity; block second deduction or route to review | M8 |
| EC-31 | Distributor A sends to B; B partly accepts | Transit and residual dispute; A/B cannot both show full available stock | M8 |
| EC-32 | Vehicle breakdown and truck replacement mid-trip | Reason and custody/e-document update; original trip history preserved | M12/M10 |
| EC-33 | Local disposal approved without goods returning | Deduct actual local held stock after proof; no factory receipt | M11 |
| EC-34 | Replacement sent before financial credit completes | Separate fulfillment and credit statuses; no second original-sale deduction | M11/M10 |
| EC-35 | Return has unknown lot or doubtful origin | Held unidentified receipt; investigate before release; retain payer/party claim | M11 |
| EC-36 | By-product internal use plus external sale exceed available | Reject excess; no automatic stock increase | M6/M7 |
| EC-37 | Tally timeout after document actually created | Lookup/reconcile source reference; retry cannot duplicate financial entry | M10 |
| EC-38 | IRN generated in Tally while ERP retries | Pull/query existing IRN; source lock; one IRN and locked invoice | M10 |
| EC-39 | Cancellation outside window or verified e-way bill | Block prohibited cancellation; Accounts handles permitted correction; stock unchanged unless physical transaction | M10 |
| EC-40 | Correction requested in closed month | Reopen with authorization or current-period correction; original unchanged | M6/M10 |
| EC-41 | Fumigation/storage-age/expiry alert acknowledged but unresolved | Acknowledgement logged; open risk/next escalation still visible | M5/M13 |
| EC-42 | Forecast baseline absent or highly variable | Disable authoritative forecast; show sample/uncertainty and pending approval | M16 |
| EC-43 | Payroll duplicate import or overnight/overtime conflict | Deduplicate punches; assign configured shift; approved correction with version | M15 |
| EC-44 | Approver is maker under another role | Deny self-approval; route to alternate, no automatic bypass | All |
| EC-45 | Opening stock lacks old lot/batch/expiry evidence | Controlled migration identifier, unknown flags and release decision; no invented dates | M6/M8 |
| EC-46 | Opening order already partly delivered in legacy system | Migrate only outstanding obligations with reconciled delivered quantity | M9 |
| EC-47 | Backup restore replays queued integration requests | Reconcile business identities/status before dispatching retries | M10/all |
| EC-48 | Source evidence is lost/replaced; malicious export link | Preserve evidence revisions; missing evidence flagged; export access enforced | All |
| EC-49 | Distributor app not updated for days | Show last update and stale status; no claim of live availability | M8/M13 |
| EC-50 | Recall involves rework and several child grades | Trace every descendant and recipient; hold affected available stock; reconcile recovered/outstanding | M3/M11 |
| EC-51 | Route lacks cleaning/separation disposition | Activation requires validated stage/sub-operation or an approved not-applicable reason; no invented equipment | M1/M4 |
| EC-52 | Line check overdue or machine repaired but unreleased | Dependent work stays blocked; available alternative uses approved route/resource; owner need not do technician/QC work | M1/M4/M16 |
| EC-53 | Treatment holds one stack in a shared godown | Only affected locations/stock blocked under stated containment scope; unrelated released stock remains eligible | M5/M6 |
| EC-54 | Packing tare creates apparent dispatch shortage | Compare like-for-like net/gross; retain evidence and no false dal loss | M4/M7/M12 |
| EC-55 | Repack, QC sample and recovered sweepings handled on same day | Each has distinct origin/condition/movement; no default shelf-life reset or automatic saleable recovery | M4/M6 |
| EC-56 | Supplier bills ordered quantity above accepted quantity | Show matching dispute; accepted stock unchanged; payment-ready status requires policy resolution | M2/M10 |
| EC-57 | Owner unavailable during a normal shift | Configured independent checkers and staff complete routine work; only outside-authority actions await escalation | M13/all |
| EC-58 | Cash evidence supplied but deposit missing or cheque bounces | Provisional collection/custody task stays visible; financial reconciliation refreshes exposure once | M9/M10 |
| EC-59 | Parent safety hold after child reservation and repacking | Affected descendants held, reservations marked at risk; no negative availability or unaffected-branch release by accident | M6/M11 |
| EC-60 | Enough bulk dal but no approved packaging supply or staff | Daily plan flags unavailable prerequisite; no firm packing commitment from raw stock alone | M6/M16 |
| EC-61 | One delivery stop refuses while other stops accept | Trip and individual shipment statuses remain separate; refused quantity traceable | M8/M12 |
| EC-62 | Unapproved truck unload and later QC acceptance | Physical receipt enters held custody once; acceptance changes classification only; network conservation holds | M2/M6 |

## 27. Risks

| Risk | Likelihood / impact | Mitigation / accountable owner |
| --- | --- | --- |
| Sixteen modules in historical three-month plan | High / High (source risk) | Validate actual plan, prioritize controls, weekly demonstrations and change control; delivery lead |
| Missing measurement causes false precision | High / High | Visible basis, actual packing reconciliation, approved measurement plan; Factory Head |
| Root lot single-location rule conflicts with splits | High / High until resolved | Adopt fragment-versus-genealogy distinction only after OQ-04 sign-off; owner/BA |
| Distributor activity not entered promptly | Medium / High | Outside-app sale capture, freshness flags, count discipline; sales lead |
| Tally access or duplicate invoice source | Medium / High | Early feasibility test, source lock, status lookup and reconciliation; Accounts |
| Food quality/label/statutory rules not approved | Unknown / High | Applicability checklist and release dependency; QC/Accounts |
| Forecast treated as guaranteed stock | Medium / High | Baseline gating, confidence, separate hard/soft commitments; planning owner |
| App-store review delays baseline launch | Medium / High (source risk) | Preserve early submission milestone; review release dependency, do not assume exemption; delivery lead |
| Process screens require too much typing | Medium / High | Prefill, My Work, observed role pilot and task cards; SPOCs |
| Go-live during peak season / incomplete opening count | Medium / High | Agreed cutover, full physical count, reconciliation and fallback rehearsal; owner |
| Cost/yield numbers treated as financial truth | Medium / High | Provisional flags, approved denominators/allocation, Tally reconciliation; Accounts |

## 28. Open Questions

No business sign-off is inferred. “Needed by” identifies a dependency gate because no current delivery dates were supplied. Proposed restrictive handling applies until the owner decides; it is not a permanent business rule.

| ID | Decision / conflict | Decision owner | Needed by | Draft handling |
| --- | --- | --- | --- | --- |
| OQ-01 | Validate exact manufacturing sequence; meaning of “Seeping”; optional/parallel stages, cleaning/foreign-matter removal, pitting, separation/finishing, recipes and repeated conditioning | Factory Head + stage SPOCs | Route sign-off | Use source route as a template only; no invented temperatures/durations |
| OQ-02 | Named SPOCs, role profiles, checker matrix, delegated owner thresholds, limits, alternates, emergency/self-approval policy | Owner | Permission/approval design | Deny self-approval; no implicit admin transaction rights |
| OQ-03 | Base units, weight precision, counted factors, measurement methods, tare policy | Factory Head + inventory | Master configuration | No guessed unit conversion or tolerance |
| OQ-04 | **CONFLICT:** one lot in one place vs grading/rework splits; input=output+loss vs by-products/oil/water; source summary balance omits sold/disposed stock | Owner + Factory Head + Accounts | Ledger design sign-off — blocking | Proposed §18 fragment/accounting equations; no unexplained balancing adjustments |
| OQ-05 | QC limits, sampling/retest, line/equipment/area readiness, instrument checks, packing checks, hold propagation and returned food disposition | QC/Factory Head | Quality gate UAT | Hold uncertain stock; no auto-release |
| OQ-06 | Duplicate slip identity scope; purchase approval, bill/weight variances, supplier deductions, promised receipt dates, purchase–receipt–bill matching and over-receipt tolerances | Procurement + Accounts | Intake UAT | Block duplicate identity; variances reviewed; no new farmer-payment engine |
| OQ-07 | Manufacturing-date definition, shelf life by grade/pack, expiry boundary, returns/repack dating and customer minimum remaining shelf life | QC + owner | Batch/expiry UAT | Missing expiry policy blocks affected sellable release; no shelf-life reset on return |
| OQ-08 | Broken/unpeeled product classification, permitted merges/blends, maximum rework/pass policy | Factory Head + QC | Grading/rework UAT | Keep categories distinct; unapproved merge blocked |
| OQ-09 | Distributor ownership/title/consignment; two sales legs, retailer delivery/transit treatment, transfers and boundary for reconciliation | Owner + Accounts + Sales | Distribution design — blocking | Network quantity and financial ownership separate; no double deduction |
| OQ-10 | Offline price-lock moment, stale-price/stock/credit policy, advance commitment and partial/backorder handling; any distributor offline scope | Sales + owner | Mobile UAT | Pending offline orders revalidated, no guaranteed reservation |
| OQ-11 | Reservation expiry/release priority, FEFO tie-breaks/substitution, count cutoff/freeze, opening WIP/transit/reservations, bin/stack granularity, samples and recovered-material accounting | Inventory + Sales | Inventory/cutover UAT | No expiry timer invented; protect valid reservations; reconcile count cutoff |
| OQ-12 | Capacity unit, queue/ETA method, shift calendars, season factors, hold treatment, status buffers, daily-plan material/staffing readiness and escalation intervals | Factory Head + owner | Planning/alert UAT | Missing settings reported; no fabricated ETA |
| OQ-13 | Invoice source ownership, tax/HSN for dal and Husk/Churi, GSP, Tally mapping, credit exposure/checkpoint, receipt/collection/deposit authority and debtor/creditor settlement ownership | Accounts | Financial integration design — blocking | One source; no hardcoded rates or assumed exemptions |
| OQ-14 | Cost allocation, by-product credits, rework cost, freight/overhead treatment, valuation and margin basis | Accounts + owner | Costing UAT | Operational costing provisional; no second books |
| OQ-15 | Pay rules, biometric formats, shifts, overtime/leave, payroll approvals, PF/ESI applicability, bank output and Tally handoff | HR + Accounts | Payroll UAT | No invented statutory formula |
| OQ-16 | Applicable food/label/weights/privacy obligations, licenses, recall reporting, evidence retention, disposal and fumigation controls | Compliance + QC + Accounts/HR | Compliance release gate | Approved applicability checklist required |
| OQ-17 | Legal entities/plants, shared masters, intercompany transfers and tenant isolation | Owner + Accounts | Organizational/access design | One-deployment assumption only; strict scope |
| OQ-18 | Production load, availability definition, freshness, recovery, accessibility and training acceptance targets | Owner + delivery lead | NFR sign-off | Proposed §6/15 values clearly labelled |
| OQ-19 | Current milestone dates, migration cutoff/freeze, downtime/fallback forms, go/no-go, rollback and support ownership | Owner + delivery lead | Cutover rehearsal | Historical plan not re-promised |
| OQ-20 | Select first 20–30 eligible lots, yield segmentation/exclusions, forecast release and confidence policy | Owner + Factory Head | Baseline/forecast activation | Forecast remains disabled until approved |
| OQ-21 | Exact prior master-MD rules and any decisions absent from accessible chat/PDFs | Rentio SPOC | Final baseline reconciliation | Full MD unavailable; U1 not treated as read or superseded silently |
| OQ-22 | Owner brief, My Work queues, grouped alerts, sharing/retention of filters/flags/decisions, recurring-complaint review and workload targets | Owner + Sales + Accounts | Detailed workflow sign-off | Linked proposed controls only; no unverified prior wording |

Decision records MUST include ID, answer, approver, date, affected requirements, effective scope and any effort/change impact. Superseded decisions remain readable. Unresolved blocking decisions prevent approval of affected functions, while unrelated review can proceed.

## 29. Acceptance Criteria

### End-to-end release tests

These are integrated go/no-go checks, not substitutes for every FR-level criterion or the EC scenario suite. Tests use approved route/rule versions, representative roles and reconciled fixtures. “Given / When / Then” results must be recorded with evidence and defect references.

| ID | Given | When | Then / required result |
| --- | --- | --- | --- |
| AC-01 | A farmer/vendor purchase with bill, truck and intake QC | Checker accepts a partial receipt | Purchase-to-slip-to-approved raw lot/godown traces correctly; remaining purchase and held/rejected quantities reconcile (M1/M2) |
| AC-02 | A configured route and one raw lot | G1 splits, oiling/conditioning/drying and peeling/G2 complete with rework | All stage quantities, additions, children, loss and by-products balance; no live parent/child duplication (M3/M4/M6) |
| AC-03 | Partially issued output and absent primary owner | Backup receives part and raises mismatch | Correct roles, pending residual custody, timestamps and escalation appear (M1/M4/M13) |
| AC-04 | An unweighed carried run and final packing actual | Packing discovers a gap | Quantity basis and discrepancy retained; no hidden stage rewrite; controlled resolution (M4/M14) |
| AC-05 | Husk/Churi generated from a known lot | Internal consumption and external buyer dispatch occur | Type/location/origin closing quantities reconcile; invoice/receipt handoff is traceable (M4/M6/M7/M10/M14) |
| AC-06 | Factory good, held and near-expiry batches | Two users concurrently reserve/pick/dispatch | FEFO/eligibility and availability hold; no negative stock or duplicate movements (M5/M6/M7) |
| AC-07 | Shipment with good, damaged, short and excess test variants | Distributor submits each receipt | Locked receipts, held/unresolved positions and dispute settlement preserve quantity (M8/M12) |
| AC-08 | Distributor stock and app/outside-app retail sales | Delivery, external sale and cross-distributor transfer complete | One deduction per physical outcome; transfer residual sits in transit; scoped totals reconcile (M8/M9) |
| AC-09 | Offline mobile orders with expired rate/changed credit/competing stock | Apps restart then synchronize | Each request has one visible outcome; conflicts require resolution; no invented availability (M9) |
| AC-10 | Complaint for a known sold batch | Return/replacement/local disposal paths complete | Physical, quality, replacement and credit states remain separate; proof and approvals retained (M11) |
| AC-11 | A parent lot with rework and several recipients | Recall is opened | Every descendant and affected recipient/current stock is identified or explicitly unresolved; stock holds enforced (M11/M13, proposed recall detail) |
| AC-12 | Tally timeout and concurrent existing IRN | Same source document retries | One financial document/IRN; source locks, status lookup, failure queue and cancellation restrictions verified (M10) |
| AC-13 | Due alerts, held work, season calendar and missing yield baseline | Timers/season/forecast evaluate | All configured alerts fire to correct roles; baseline ETA retained; forecast gated; later owner-approved baseline enables seven-day output (M13/M16) |
| AC-14 | Approved costing rules and incomplete late freight | Reports run before/after final cost | Yield denominators and provisional/final margin basis disclosed; no financial-book replacement (M14) |
| AC-15 | Duplicate punches, overnight shift and approved pay rules | Payroll is calculated and revised | No duplicate hours; authorized versioned results and restricted bank/statutory outputs (M15) |
| AC-16 | Opening stock/counts, open orders and Tally balances | Cutover rehearsal finishes | All agreed locations/partners and required stock conditions reconcile; missing origin/expiry is explicitly controlled (M1/M5/M6/M8/M9/M10) |
| AC-17 | Read/write attempts for every persona and two partner scopes | Direct access/export/self-approval tests run | All unauthorized attempts denied; audit complete, no salary/partner leakage (cross-cutting) |
| AC-18 | Representative operational data and queued integrations | Recovery rehearsal restores service | Approved RPO/RTO achieved; balances reconcile; replay causes no duplicate effect (cross-cutting) |
| AC-19 | Trained role representatives and agreed workload | Adoption/load/freshness checks run | Approved MET/NFR targets pass with recorded results; unresolved target gaps are visible |
| AC-20 | All accepted requirements, EC tests and statutory cases | Go/no-go review occurs | Zero unresolved critical quantity, access, food-release or invoice-duplication defects; accountable reviewers sign results; any lesser defect has explicit acceptance/plan |
| AC-21 | Approved routine delegation and a 30-case operating-day fixture | Owner takes no routine action during the pilot | Staff complete all within-authority work with required independent checks; critical/out-of-authority exceptions remain visible (FR-114, FR-116, FR-119; MET-11/12) |
| AC-22 | Valid route plus missing readiness, bags or staffing in separate cases | Production plan is released and runs attempted | Each unavailable prerequisite blocks only affected work, names its resolver and updates impacted promises (FR-092–093, FR-096–098, FR-118) |
| AC-23 | Two stacks, an area treatment hold, repacking, samples and pack tare | Store/pick/repack/dispatch transactions execute | Eligible locations only used; net food and sample balances reconcile; no shelf-life extension or packaging mass added as dal (FR-099–105) |
| AC-24 | Purchase/receipt/bill mismatch plus provisional and reversed collections | Commercial follow-up and Tally reconciliation run | Source quantities and debtor/creditor identity remain correct; no financial settlement or credit release from evidence alone (FR-094–095, FR-108–109) |
| AC-25 | Split/repacked lot on quality hold, multi-stop trip and delayed orders | Containment, receipt and incident workflows run | Descendants and reservations handled correctly; each delivery settled once; one coordinated incident retains all child follow-ups (FR-107, FR-110–112, FR-115) |
| AC-26 | Reliable and stale partner stock plus open supply and known critical-store demand | Replenishment/reporting and owner brief are reviewed | Suggestions show calculation/freshness without automatic purchase; owner sees critical items and scoped supplier metrics (FR-101, FR-106, FR-113, FR-117) |
| AC-27 | Unapproved/rejected external receipts and oil stocked inside the chosen boundary | Physical reconciliation runs through acceptance and conversion | Receipt and oil are counted once; acceptance/internal addition do not inflate total physical stock (§18 revised boundary) |

### Migration and cutover checklist

**Confirmed migration:** products and business-party/employee masters; factory and 17-distributor opening SKU/batch stock; Sales Trend open orders; Tally opening balances. Full physical count is a source requirement.

**P completeness checks:** additionally account for raw/WIP stage positions, by-products, stores, held/returned/expired stock, In-Transit, existing reservations, partial fulfillment, open disputes and unpaid/unsynced documents where present. Do not assume these are zero. Unknown historic origin or expiry requires an approved identification/release policy, not fabricated source history.

1. Confirm ownership, cutoff date/time, movement freeze or controlled bridge procedure, responsible persons and approved migration boundaries.
2. Map legacy identities; preserve source references; deduplicate masters/orders; validate units, grades and permitted locations.
3. Count physical stock and reconcile outstanding truck/distributor receipts. Import opening quantities as approved opening transactions; no historic stage events invented.
4. Reconcile physical/available/reserved values separately. Match order remaining balances and commercial open balances with Accounts.
5. Test full route, by-product, return, offline and financial cases with actual role representatives; resolve blocking decisions and defects.
6. Rehearse backup recovery, access reset, fallback capture and replay. Cutover rollback must consider real physical movements; it cannot simply discard them.
7. Obtain owner, Factory Head, Accounts, HR and relevant SPOC sign-off. Validate baseline app-store availability as required by S1; no silent waiver.
8. At go-live, record opening approval and support contacts; reconcile daily in the initial stabilization period. Activate forecast only after its separate baseline gate.

**Historical milestones retained for reference:** requirements week 1; prototype week 2; production/inventory demo week 4; distribution/apps/Tally demo week 8; store submission week 9; UAT weeks 10–11; go-live/training week 12. Updated dates and achievable commitments require OQ-19. S1 specifies three months of bug-fix support; new functionality follows impact/cost/timeline change approval.

## 30. Future Roadmap

No additional module is silently authorized. Automatic weighbridge integration is explicitly future scope. IoT, retailer app, additional languages, farmer financial-settlement engine or advanced optimization require separate business decisions/change requests. Additional plants/distributors/pulse types are supported by the baseline’s configurability intent, but each rollout still requires validated masters, access and capacity.

Seven-day forecast activation after yield baseline is **existing M16 scope**, not a new future module. Support and acceptance of remaining 16-module capabilities must not be deferred merely because forecast starts later.

## 31. Appendix

### Owner-review gap register and implementation priority

All additions are P recommendations from S6; M priority identifies a proposed operating-release requirement when the activity applies. S priority can be planned after the essential controls without removing any agreed module.

| Review finding | Why an owner would care | Resolution / existing modules | Priority |
| --- | --- | --- | --- |
| Route lacked explicit preparation/separation completeness | Material can be tracked yet important actual work omitted | FR-092, M1/M4; validate actual route | Before route approval |
| Readiness and return-to-service were too implicit | Delayed/unsafe work may appear ready in the plan | FR-093, FR-096–098, FR-118; M1/M4/M16 | Release controls first; extended maintenance tasks Should |
| Godown totals did not fully explain physical finding/picking | Staff still need phone calls to locate bags | FR-099–100; M5/M6 | Before stock pilot |
| Samples/repack/packaging tare needed precise treatment | Apparent losses or duplicated output can distort stock | FR-102–105; M6/M7 | Before relevant handling/dispatch |
| Purchasing showed receipt but not full bill follow-up | Owner/Accounts chase unresolved supplier differences | FR-094–095, FR-109; M2/M10 | Matching before financial pilot; ETA Should |
| Raw/store/partner shortages lacked action suggestions | Avoidable stoppages and follow-up calls | FR-101, FR-106; M6/M8 | Should; staff-approved suggestions |
| Payment evidence and financial settlement needed separation | Incorrect debt/credit view and untracked collections | FR-108–109; M9/M10 | Before authorized collection workflow |
| Promise, delivery proof and recurring issue follow-up needed ownership | Owner repeatedly chases staff/customer responses | FR-107, FR-111–112; M9/M11/M12 | Delivery controls first; recurrence review Should |
| Quality hold needed descendant/reservation behavior | Held stock could remain promised or saleable through a child lot | FR-110; M6/M11 | Before traceability pilot |
| Approval and reporting could make the owner the bottleneck | ERP adds clerical work instead of reducing it | FR-113–116, FR-119; M13; MET-11–13 | Core adoption requirement; grouping Should |
| Supplier comparisons needed evidence and provisional status | Wrong supplier decisions from partial records | FR-117; M14 | Should |
| Physical boundary mixed accepted receipts and held arrivals | Reconciliation could falsely show stock gain after QC | Revised §18; EC-62, AC-27 | Before ledger sign-off |

**Five decisions for the owner; preparation belongs to staff:** (1) approve actual route/measurement approach prepared by Factory Head; (2) approve delegated limits and backup roles; (3) approve customer/partner ownership, promise and credit policy prepared by Accounts/Sales; (4) approve QC/warehouse release policy prepared by the responsible specialist; (5) approve cutover and measurable workload targets after a representative operating-day pilot. The detailed OQs stay assigned to their module SPOCs; the owner does not need to answer every setup field personally.

### Legacy-to-current traceability

This mapping preserves original source identifiers without renumbering them as if they were the same document. Some source sections combine several modules; the current FR list splits them into independently testable outcomes.

| Source reference | Current home | Details retained |
| --- | --- | --- |
| S1 M1–M16, physical pp1–3 | §10 and §14, M1–M16 | Exact names/numbering; procurement and by-products remain inside scope |
| S2 FR-M1–M7, pp1,3 | M1 | SKU, stages/owners/capacity, godowns, roles/parties/tolerances, farmer/vendor |
| S2 FR-1.1–1.9, pp1–3 | M2 | Purchase, weighing/photo, QC, approval, Lot ID and purchase traceability |
| S2 FR-2.1–2.4, p2 | M3 | G1/G2, balance, child lots and approved downgrade |
| S2 FR-3.1–3.11, pp2,4–5 | M4/M14/M16 | Stage quantity/basis, handover, rework, oil, holds, packing gap, baseline, close and by-products |
| S2 FR-4.1–4.8, pp4–5 | M5 | Godowns, capacity/transfer, fumigation, age/count and by-product storage |
| S2 FR-5.1–5.9, pp5–6 | M6 | Stock states, FEFO/expiry, stores, negative-stock block and by-product use |
| S2 FR-6.1–6.5, p6 | M13/M16 | ETA, status, shortage, bottleneck and gated forecast |
| S2 FR-7.1–7.9, pp7,9 | M7/M8 | Reservation/dispatch, transit, receipt/dispute, retail deduction, partner transfers and by-product sale |
| S2 FR-8.1–8.6, pp7–8 | M9/M14 | Offline scoped orders, rates, credit, advance booking and performance |
| S2 FR-9.1–9.3, p8 | M11 | Complaint, replacement, local disposal, returns and disposition |
| S2 FR-10.1–10.4, p8 | M12 | Rate cards, trips/vehicle change, variance hold and freight |
| S2 FR-11.1–11.6, pp9–10 | M10 | Tally sync, queues, source lock, IRN/e-way bill and by-product invoices |
| S2 FR-12.1–12.6, pp9–10 | M13 | Full alert set, escalation, channels, owner views and approvals |
| S2 FR-13.1–13.2, p11 | M16 | Season, 24/7 shifts/handover, lot priority and daily target |
| S2 FR-14.1–14.2, p11 | M15 | Biometric/file import, attendance/payroll/PF/ESI/bank output |
| S2 BR-1–BR-18, pp9,11–12 | §18 BR-001–018 | Original rules with explicit proposed reconciliations, not silent overrides |
| S2 NFRs, p12 | §15 | Access/audit/protection/backups, 99.5%, dashboard <3s, platforms/English/offline and extension intent |
| S3 pp1–5 | §2–4, §8–10, §14 | Business context, stage route, owner/factory/mobile views and initial scale |
| S1 pp4–6 | §10–13, §27–30 | Exclusions, migration, responsibilities, assumptions, acceptance, milestones/support |
| S4 prior chat summary | M1/M4/M13 and §28 | Configurable sequencing, issue/receive, saved filters, central decisions and flags; U1 full text unavailable |
| S5 initial request | All sections | Comprehensive production behaviors, timing/audit, clear evidence labels and agent-ready Markdown |
| S6 owner-review request; E5/E6 industry context | FR-092–119, WF-11–14, BR-026–032, EC-51–62, AC-21–27 | Practical operations, quality/storage/commercial gaps and reduced daily workload; proposals mapped within M1–M16 |

### Source reconciliation notes

1. The requirements PDF calls itself “90+ requirements across 15 areas”; the Scope of Work defines **16 business modules**. Areas are not module IDs; M1–M16 from S1 control the module register.
2. The requirements PDF’s cover lists 15 business rules, but its inserted update adds BR-16–18. All **18 original rules** are retained in §18.
3. “One lot sits in one stage/godown” conflicts with source child lots. §18 proposes one position per **live fragment**, many positions per root genealogy. This requires explicit decision OQ-04.
4. The stage/run/network equations are clarified to avoid double-deducting by-products or ignoring additions, sales and disposal. These are proposed accounting refinements; do not implement conflicting formulas simultaneously.
5. Stock states in S2 mix custody, condition and reservation. The separate-dimension presentation in §18 is proposed to keep totals reconciled while preserving all original business states.
6. Rate lock at order time and offline live rates need OQ-10: the draft protects accepted prices and visibly resolves offline conflicts, without promising stale availability.
7. Historical three-month delivery/support context remains; this expanded detail is not evidence of a new signed estimate or launch date.
8. The prior agent master was reported as roughly 15,000 words, 25 workflows and 38 UAT scenarios. Its full content was unavailable; those counts are not imported as verified coverage. Reconcile U1 before declaring this a complete replacement for every prior decision.

### Glossary

| Term | Meaning |
| --- | --- |
| Toor / tur / pigeon pea | Raw pulse being processed into toor dal; product terminology to match Rentio masters |
| G1 / G2 | Initial size grading / final quality × size grading |
| Seeping | Local process label present in prior route; precise conditioning/soaking meaning requires Factory Head validation |
| Lot / root lot | Origin batch associated with accepted intake; root identity anchors genealogy |
| Child / fragment | Quantity branch from split/grading/rework; has traceable origin and one live custody position |
| Batch | Packed/sellable grouping with grade/SKU, manufacture/expiry policy and source ancestry |
| WIP | Material undergoing or waiting between processing activities |
| Actual | Directly measured quantity with recorded method/evidence |
| Counted | Quantity from count and approved conversion; conversion and count remain visible |
| Carried | Quantity inherited/estimated from prior position, not independently weighed |
| Husk / Churi | Distinct recoverable by-product types; use purpose configured by Rentio |
| Unpeeled / rework | Recoverable material awaiting another approved production pass; not automatically loss |
| FEFO | First Expiry, First Out among eligible released batches |
| Reserved | Physical eligible stock committed to a specific demand; not additional physical inventory |
| Advance booking | Demand planned against future supply, separate from existing-stock reservation |
| In-Transit | Accountable quantity issued from one custody point and not yet settled at the next |
| Quarantine / held | Physically present but unavailable for ordinary allocation pending decision |
| Maker-checker | One user proposes/enters; another authorized user reviews/approves protected action |
| ETA | Expected completion/clearing time under an identified rule/calendar and assumptions |
| SPOC | Rentio’s single point of contact for a module’s inputs and decisions |
| IRN / GSP | Invoice Reference Number / GST Suvidha Provider |
| Reversal | Linked compensating transaction preserving the original posted record |
| Network stock | Operational material across tracked participants; not necessarily all Rentio-owned inventory |
| RPO / RTO | Maximum acceptable data-loss window / time to restore usable service |
| UAT | User acceptance testing by accountable business representatives |

### Agent / delivery-team handoff

Read this specification and the sources before designing. Start with the M1–M16 traceability list, resolve blocking OQs, validate §18 with worked ledgers, and turn accepted FR/EC/AC identifiers into the implementation and QA backlog. Preserve evidence labels and decisions. Do not silently fill missing tolerances, durations, statutory formulas, recipes, credit/rate policy or costing methods. Do not implement proposed details as already approved business rules. Retain stable IDs when refining requirements; record changed meaning in the change log. Produce downstream technical/design specifications separately after business validation.

Version 0.2.0 contains 119 functional requirements, 62 edge-case scenarios and 27 integrated acceptance tests across the same 16 modules. Use the owner-review gap register to prioritize the additions; do not require staff to read the full specification for daily work. Create role task cards from §25 and validate them in the pilot.

**Document completion is not business approval.** The next review should resolve OQ-01–13 first for production and distribution, then HR/compliance/cutover dependencies, and reconcile the unavailable prior master if it becomes accessible.

