# Rentio Smart ERP — Codex Project Instructions

## Objective

Build a working local Rentio Smart ERP prototype using this existing boilerplate.

The user has accepted the requirements direction. Implement the prototype, including connected transactions and role-specific daily work. Do not stop after producing a plan, dashboard or static screens.

## Existing project

- Project root: this folder.
- Runnable application: `clinic-ops-admin/`.
- Existing stack: React 18, TypeScript, Vite, React Router and Vitest.
- Existing application uses metadata-driven resources, shared components, local persistence, simulated permissions, approvals and audit history.
- Current clinic content is example domain content to replace in the Rentio experience.
- Preserve and reuse the existing shell, design tokens, tables, forms, filters, inspector, dialogs and navigation patterns.
- Keep the existing application folder name initially; renaming it is unnecessary.

Inspect current files before editing. Follow the existing root `SKILL.md`, its project design rules and relevant `references/` documents. Use the supplied UAB specifications for shared UI conventions. Rentio requirements determine business behavior.

## Requirements

Read:

1. `docs/rentio/RENTIO_SMART_ERP_PRODUCTION_REQUIREMENTS.md`
2. `docs/rentio/RENTIO_OWNER_REVIEW_AND_DAILY_GUIDE.md`

Keep requirement IDs traceable.

Confirmed requirements and proposed implementation details are labelled in the specification. For unresolved business values, choose configurable fictional demo defaults and document them in `docs/rentio/DEMO_ASSUMPTIONS.md`.

Do not represent demo defaults as approved production policies. Ask only when a missing decision prevents meaningful prototype work; continue independent work meanwhile.

## Prototype boundary

Build a responsive local web prototype with persistent fictional data and role switching.

Implement working local simulations for Tally, e-invoice, messaging, biometric import and offline salesman synchronization. Clearly label simulated integrations.

Native mobile apps, real authentication, real financial transactions, production infrastructure and live external integrations are outside this prototype task.

Browser permissions and local audit history demonstrate behavior; they are not production security or tamper-proof records.

## Preserve all 16 modules

M1 Masters and Setup  
M2 Procurement and Intake  
M3 Grading  
M4 Production and Stage Tracking  
M5 Factory Godown Stock  
M6 Inventory  
M7 Dispatch and In-Transit  
M8 Distributor Inventory  
M9 Salesman and CRM  
M10 Tally and Compliance  
M11 Returns and Complaints  
M12 Logistics  
M13 Control Tower and Alerts  
M14 Costing and Reports  
M15 HR and Payroll  
M16 Season Mode and Forecast

Each module must offer a meaningful working flow appropriate to a local prototype. A navigation link or placeholder page alone is not completion.

## Implementation approach

Extend the existing application rather than creating another application.

Introduce a Rentio domain pack using existing metadata contracts where suitable. Inspect clinic-specific imports across routing, registry, persistence, permissions, workflows, pages and components; changing labels alone is insufficient.

Use shared domain services for transactions and derived views. Do not maintain separate hardcoded stock totals in dashboards, inventory and orders.

Use a separate versioned Rentio storage namespace. Preserve existing clinic storage. Refresh must retain Rentio changes; resetting demo data requires confirmation.

Check the existing persistence implementation before reuse: mutations currently operate on live state. Rentio multi-record transactions must validate and prepare changes before committing. Failed actions must not leave partial balance changes. Persistence failures must be visible.

## Stock and workflow invariants

- Every stock movement has a traceable lot or item identity.
- Parent genealogy and live child quantities must not be counted twice.
- Physical quantity, quality condition and reservation are separate.
- Reservations do not change physical stock.
- Issue moves quantity into pending transfer; receipt settles it.
- Partial receipt leaves an accountable residual.
- No negative available stock.
- Every transformation balances input, additions, outputs, rework, by-products, losses and residual.
- Record Actual, Counted or Carried measurement basis.
- Rework is existing material, not new procurement.
- Keep net food weight separate from packaging and vehicle tare.
- Held or expired stock cannot fulfill normal orders.
- Holds must affect relevant descendants and reservations.
- Corrections preserve original records through linked reversal or adjustment.
- Repeated submissions must not duplicate effects.
- Required maker-checker actions reject self-approval.
- Rate snapshots and route versions remain traceable.
- Financial settlement is separate from physical delivery.

Use explicit units and consistent rounding. Avoid floating-point drift in quantity and money calculations.

## Daily experience

Stage staff: Receive → Start → Record Output → Issue.

Owner: prioritized decisions, production constraints, deliveries at risk, stock exceptions and money follow-up.

Prefill existing source information. Staff confirm actual observations rather than repeatedly entering lot, party and order details.

Routine work follows delegated authority. Do not require owner approval for every action.

Support representative roles: Owner, Factory Head, Stage Owner, Back Office, QC, Godown/Dispatch, Distributor, Salesman, Accounts, HR and Administrator.

Role changes must affect actions and data scope, not only menu visibility.

## Demonstration data

Use fictional suppliers, employees, retailers and 17 distributors. Keep one main scenario clearly identified as RT-001.

Support:

- A starting scenario that users can execute.
- A completed scenario for demonstration.
- Separate exception scenarios.

Completed scenario balances must be derived from valid transactions or the same transaction replay logic, not unrelated dashboard constants.

## Quality and completion

Every primary button must perform its stated action, explain a genuine restriction, or clearly identify a simulated external action.

Test material balance, partial transfers, reservations, duplicate submission, permission scope, approval separation, rework, held stock and failed transactions.

Retain relevant shared-component tests. Adapt clinic-specific tests when replacing that domain; do not delete tests merely to obtain a passing result.

Run from `clinic-ops-admin/`:

- `npm ci` when dependencies are absent
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run dev -- --host 127.0.0.1`

Inspect key screens in a browser when available. Report browser checks that could not be performed.

Maintain `docs/rentio/BUILD_STATUS.md` with implemented flows, test results, remaining work and next steps. Use it to resume after context limits.

Do not mark the prototype complete until all 16 modules have their agreed local behavior, the main lot journey works, balances reconcile and required checks pass.

Deliver the local URL, demonstration instructions, role-switching instructions and honest limitations.
