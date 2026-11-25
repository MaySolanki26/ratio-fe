# Rentio · BA closure round — results and retest script

**Date:** 25 Nov 2026 · **Scope:** the eight items in `CLAUDE_RENTIO_BA_CLOSURE.md` · **State:** implemented and independently retested in the running browser.

| # | Item | Requirement IDs | Status |
| --- | --- | --- | --- |
| 1 | Controlled repacking | FR-103, BR-029, WF-13, AC-23/25 | Implemented |
| 2 | Multi-stop delivery proof | FR-112, WF-14, EC-61, AC-25 | Implemented |
| 3 | Grouped incidents | FR-115, AC-25 | Implemented |
| 4 | Replenishment suggestions | FR-101/106/113/117, WF-12, AC-26 | Implemented |
| 5 | Graphical owner dashboard | FR-072, FR-114 | Implemented |
| 6 | Working Inbox page | FR-072/113 (work queue) | Implemented |
| 7 | Logout and demo login | prototype boundary (no real auth) | Implemented |
| 8 | Light theme first | UI rule | Implemented |

## 0. Checks (run from `clinic-ops-admin/`)

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | **24 files, 250 tests, all passing** (was 19 / 197 before this round) |
| `npm run build` | passes (usual > 500 kB chunk warning) |

New tests:
- `src/test/rentio-ba-closure.test.ts` (9) — domain scenarios that post real transactions and prove failure, duplicate, scope and atomic paths for items 1–4.
- `src/test/rentio-ba-ui.test.tsx` (6) — the same demos driven through the real UI (App, scoped users, forms), plus the owner charts.
- `src/test/rentio-shell.test.tsx` (14) — items 6–8 (inbox per role, login/logout/bookmark/refresh, per-user light-first theme).
- `src/test/rentio-guard-fixes.test.ts` (6) — added during this round by an independent retester: repack destination under treatment hold; multi-stop shipments settle only through stop proof. Kept as is.

RT-001 is unchanged: the 17-step replay and **10,000 kg raw + 20 kg oil = 10,020 kg** reconciliation still pass (`rentio.test.ts`). All BA fixtures are separate roots (`MIG-0030`, `MIG-0031`, `POUCH-1-B01`, `RT-005`).

## 1. Fresh data set for independent tests

The four demos are in the default **demo snapshot**. Data version is still **102**, so a browser that already holds Rentio data keeps its old data (without the new fixtures). To get the fixtures:

- **Preferred:** a new, disposable browser profile → open `http://127.0.0.1:5173/` → the login chooser appears (fresh browser).
- **Or** in an existing profile: sign in as Vikram → *Presenter tools › Demo script & RT-001 trace* → **Download backup** (JSON file) → account menu **Reset demo data…** → **Demo snapshot**.

Fixture quantities in a fresh demo snapshot:

| Fixture | Where | Quantity |
| --- | --- | --- |
| `MIG-0030` A2 packed, torn outer bags (mfg 2026-10-01, best before 2027-03-30) | F1 · Stack S04 | 10 × 25 kg = **250 kg**, released, unreserved |
| `POUCH-1-B01` empty 1 kg pouches | Stores | **220** pouches |
| `MIG-0031` B2 packed | F1 · Stack S06 | 20 × 25 kg = **500 kg**, fully reserved |
| `SO-0006` → D01 B2 250 kg, `SO-0007` → D02 B2 250 kg | Orders | approved, reserved (`RES-0006`, `RES-0007`), ready to dispatch |
| RT-002 cleaning run `RUN-0002` (EX-8) | Production | **Delayed** (owner Suresh Yadav) |
| `SO-0001` D02 B1 500 kg on held `MIG-0001/B1-PK` (EX-2) | Orders | **at risk** (owner Kiran Shah) |
| `PO-RT-002` open 3,000 kg, promised 2026-11-26 | Purchases | counted as timely supply |
| `PO-RT-005` 3,000 kg, promised build date + 10 days | Purchases | **not** counted (beyond the 3-day lead time) |
| D17 (500 kg, app sync 52 h ago) vs D04 / D08 / D11 / D14 (synced 9–19 h ago) | Distributors | stale vs current partners |

Users: Vikram Mehta (Owner), Sunita Rao (Factory Head), Suresh Yadav / Anil Kumar (Stage Owners), Kiran Shah (Back Office), Meera Iyer (QC), Ravi Patil (Godown/Dispatch), Dinesh Agarwal (Distributor D01), Farah Khan (Distributor D02). Switch with the account menu (avatar) or **Log out** and pick a user on the login screen.

## 2. Item 1 — controlled repacking (200 kg → 199 × 1 kg + 1 kg recorded loss)

1. Sign in as **Ravi Patil** → *Godowns & stock › Godowns & stacks* → panel **Controlled repacking** → **Record repack**.
2. Enter: Packed lot and stack = `MIG-0030 · A2 · F1 · Stack S04 — 250 kg free (10 × 25 kg)`; Released net input **200**; Target pack size **1 kg packs**; New packs filled **199**; Measured net **199**; Packaging used `POUCH-1-B01 … 220 in stores`; Real loss **1**; Loss reason *Spillage while opening torn bags*. The preview shows **Balanced ✓**, opened bags 8 × 25 kg, stays in the stack 50 kg.
3. **Submit for QC release** → toast `RPK-0001 recorded — waiting for QC release; source unchanged`. **Before release:** MIG-0030 still 250 kg in S04, pouches still 220. Ravi's **Release & post** is disabled ("You recorded this repack — an independent checker must release it").
4. Sign in as **Meera Iyer** → My work / Inbox shows *Release repack RPK-0001* → open → **Release & post** → **Release and post**.
5. **After:** new lot `MIG-0030/RP1` = 199 kg (199 × 1 kg) in S04, grade A2, packed 2026-10-01, best before 2027-03-30, parent MIG-0030; MIG-0030 = 50 kg (2 bags) left in S04; one 1 kg loss movement with the reason; pouches 220 → **21**. Lot drawer shows genealogy; *Audit log* shows the transactions. Root `MIG-0030` still totals 250 kg (50 + 199 + 1 loss); packaging is never in food mass.
6. **Trace through a later parent hold:** Meera → *Holds & counts* → quality hold on `MIG-0030` → `MIG-0030/RP1` shows "on hold (on parent MIG-0030)" and is no longer free to sell.

Refusals (each shows "Not posted — nothing changed"): loss 0 (1 kg unbalanced, shown live in the preview); measured 198 ("re-weigh; never adjust the loss"); loss with no reason; 250 kg → 249 pouches (only 220 pouches); BAGS-25 packaging for 1 kg packs; 5 kg packs (no active SKU); `MIG-0031` (reserved); S04 under a treatment hold; destination stack under treatment hold (guard added by the retester); Anil (Stage Owner) cannot record; a hold placed after the proposal makes Meera's release fail with no movement; a second release → "already released and posted"; same key → no second effect.

## 3. Item 2 — multi-stop delivery proof (D01 + D02 on one vehicle)

1. **Ravi Patil** → *Dispatch & distributors › Trips & freight* → panel **Multi-stop deliveries** → **Dispatch multi-stop trip**. `SO-0006 → D01` and `SO-0007 → D02` are ticked; vehicle MH12-AB-4455, driver Sanjay More (fictional) → **Dispatch trip**. Result: trip `TRP-…` with stop 1 D01 and stop 2 D02, status "In transit — 2 stops pending".
2. **Dinesh Agarwal** (D01) → *Distributor stock* → shipment row shows "stop 1 of TRP-…" → **Record stop outcome** → Outcome *Accepted (all)*, receiver prefilled, Proof reference `POD-D01-001.jpg` → **Submit & lock stop**. D01 stock +250 kg. Trip now "1 of 2 stops recorded" — **not complete**. Dinesh never sees the D02 stop. A second submit → "already recorded … locked".
3. **Farah Khan** (D02) → *Distributor stock* → **Record stop outcome** → *Part accepted*, Accepted good **150**, proof `POD-D02-001.jpg`, reason *4 bags wet from rain — refused*. Preview: accepted 150 kg, refused 100 kg stays in transit → submit. D02 stock +150 kg; 100 kg stays in transit custody.
4. **Vikram Mehta** → *Trips & freight*: stop 1 **Accepted**, stop 2 **Part accepted**, trip "All stops recorded — 100 kg unresolved"; next step "100 kg still on the vehicle — Godown/Dispatch decides disposition". Owner overview: delivery chart shows D02's red "Short / refused — in transit" segment; *Delivery promises* shows `SO-0007` "Refused at delivery — 100 kg on the vehicle". Alert `stop:TRP-…#2` (owner Ravi Patil) is in Vikram's and Ravi's Inbox, never in Dinesh's.
5. **Ravi Patil** → open the alert (focus on the trip) → **Return to factory** → reason → **Move to factory quarantine**. QUAR +100 kg (held for QC); trip "All stops settled"; `SO-0007` becomes "Partly delivered — 100 kg open" (the returned quantity is open again, not delivered). No collection or payment is created.

Also tested: a fully **Refused** stop settles nothing (250 kg stays in transit; stop 1 still pending; trip not complete); a distributor cannot decide disposition; the generic shipment receipt is refused for a stop shipment.

## 4. Item 3 — grouped incident (RT-002 delay + D02 order risk)

1. **Sunita Rao** → *Home › Incidents* → **Group alerts into incident** → name *RT-002 cleaning delay & D02 supply*, lead Sunita Rao, tick *Cleaning late by … — RT-002 (Suresh Yadav)* and *SO-0001 for D02 cannot ship: reserved B1 stock is on hold (Kiran Shah)* → **Create incident**. `INC-0001`: 2 linked · 2 open.
2. **Close incident** is disabled ("2 linked alert(s) still open — resolve or detach them first"). Both alerts are still open with their own owners, due times and escalation.
3. Staff reachability: **Kiran Shah** → *Alerts* / *Inbox* shows the risk with "Part of INC-0001 · lead Sunita Rao"; **Suresh Yadav** → *My work* shows the RT-002 output task tagged "Part of INC-0001". **Vikram Mehta** → Owner overview → panel **Incidents**: `INC-0001` lead Sunita, 2 linked, 2 open (Suresh Yadav, Kiran Shah).
4. Resolve for real: **Kiran** → the risk → **Reallocate held stock** (re-reserves eligible B1) → child shows **Resolved**. **Suresh** → record RT-002 cleaning output (or Sunita **Detach** with a reason — the delay alert stays open with Suresh).
5. **Sunita** → **Close incident** with a summary → closed. Coordination notes, detach and close are audited. A non-manager (Kiran) cannot create incidents; one alert cannot be in two open incidents; a second close → "already closed".

## 5. Item 4 — replenishment suggestions

**Kiran Shah** → *Season & planning › Replenishment suggestions* (also in his My work / Inbox):

| Suggestion | Fresh-snapshot figure | Shows |
| --- | --- | --- |
| Raw toor (R1) | **4,000 kg** = 12,000 min + 0 for demand − 5,000 ready − **3,000 PO-RT-002 (timely)**; PO-RT-005 listed as **not counted** | timely open supply reduces the need |
| 1 kg pouches (POUCH-1-B01) | **780 pouches** (220 < 400 min → up to 1,000; reviewer Ravi Patil) | real stores shortage incl. packaging |
| Oil, 25 kg bags | no action (480 kg, 820 bags above minimum) | — |
| D04 / D08 / D11 / D14 | 5,700 / 5,850 / 5,550 / 5,650 kg (current data) | current partners |
| D17 | 5,500 kg A1, **Stale data** (52 h) | stale partner |

1. D04 → **Accept** → note → **Accept (posts nothing)**: no order or movement is created; review recorded with all inputs. Then **Open Orders & dispatch (new factory order prefilled)** opens the normal New factory order form with D04 / B1 / 5,700 kg — nothing is created until Kiran submits.
2. D17 → **Accept** is disabled ("Confirm the current stock first — stale data cannot be accepted"). **Defer** with a reason works. **Confirm current stock** (e.g. 300 kg, *Phoned D17 owner*) recalculates using the confirmed figure; then Accept is allowed.
3. Raw → Accept → **Open Purchases & truck intake** opens the New purchase form prefilled with 4,000 kg. Pouches → **Ravi Patil** accepts (stores purchase is outside the prototype; audited review + link).
4. **Vikram Mehta** → Owner overview → panel **Replenishment to review** shows the same derived suggestions → **Review** drills to the row. Anil (Stage Owner) cannot review; a duplicate review of the same quantity is refused; a repack awaiting QC reduces the pouch projection.

## 6. Item 5 — owner charts

**Vikram Mehta** → Owner overview: after *Needs your decision* and *Top risks* (decisions first), the **Owner charts** section has two zero-baseline stacked bars:
- **Factory finished stock by grade** (kg in F1): Free to sell · Reserved (shippable) · Held / expired. Segments are exclusive; reserved-on-held stock is counted only in Held (caption states the at-risk kg). Bars link to Godowns & stacks.
- **Delivery outcome by distributor** (kg dispatched): Received good · Damaged (held) · On the road · Short / refused — in transit · Returned to factory · Settled by approval. Bars link to that distributor.

Each has a legend, a "0 kg … max" axis, an accessible table equivalent ("Show as table (same figures)"), theme tokens only (`--s-success/info/warning/danger/text-muted/border-strong`), and stacks to one column under 900 px. They update after every posting (same ledger rows). Check in light and dark, and at phone width.

## 7. Items 6–8 — Inbox, login/logout, light theme (shell)

- **Inbox:** rail **Inbox** button (with unread count), phone drawer ☰ → Inbox, bell footer **Open Inbox**, and the old URL `/o/rentio/w/plant1/work/inbox` all open `home/inbox` (clinic keeps its own Work inbox). Items = the person's My work tasks + alerts they own / are escalated to, all scoped; each opens the exact record (`?focus=`); per-user read/unread; items leave when the work is done. Verify Vikram (approvals + serious exceptions), Kiran (reallocation, dispute, replenishment reviews), Anil (own receipt), Farah (D02 only), Dinesh (D01 only — empty state until the multi-stop trip is dispatched). My work stays the staff landing.
- **Login / logout:** fresh browser → `/login` with all 15 users grouped by role, searchable, labelled "Local demo sign-in — no password, simulated roles, fictional data", no business figures. Vikram → Owner overview; Anil → My work. Account menu **Log out** → login screen; refresh / Back / protected URLs stay on login; a bookmarked URL is reopened after sign-in when the chosen user may open it, otherwise their landing. Business data is untouched. Marker key `rentio.erp.db.v1.signin`.
- **Theme:** an unconfigured user is light even with OS dark. Vikram → theme Mode **Dark** → refresh: dark; switch to Kiran: light; back to Vikram: dark; logout/login keeps Vikram dark. Migration: stored per-user `light`/`dark` is kept as explicit; stored `system` (old automatic default) = no preference → light.

## 8. Limitations (honest)

- The independent owner and staff browser retest passed the scenarios below and used fictional data on isolated loopback origins.
- Existing browsers on data version 102 do not get the new fixtures until reset (see §1); the first visit after this round shows the login chooser once.
- Repack: one source lot per repack; no partial QC release; packaging is counted (no weighing of packaging); the 1 % tolerance and SKU list are demo values.
- Multi-stop: proof is a reference string (no photo upload); stop order is the tick order; only "return to factory" is offered as a disposition for refused goods (shortages still use the existing transit settlement).
- Incidents: children are alerts only (not arbitrary records); child state is derived from the live alert list, so an alert that disappears for any reason (e.g. out of the escalation window) reads as resolved.
- Replenishment: no stores purchase document exists in the prototype (audited review + link); partner grade = the grade they hold most; one confirmation is valid for 24 h; suggestions are not saved as documents, only reviews are.
- Inbox read state is per browser and not audited; sign-in is a local demo marker, not authentication.


## Independent browser retest results

- **Repack:** RPK-0001 was independently released by QC. The 200 kg input produced 199 × 1 kg packs and 1 kg recorded loss. The 50 kg source residual and original expiry were retained. Stores fell from 220 pouches to 21. A later parent hold reached the child, and a separate release into a treatment-held destination was refused.
- **Multi-stop:** TRP-0003 carried 250 kg per distributor. D01 accepted 250 kg and D02 accepted 150 kg. Ravi returned the refused 100 kg to quarantine. D02's order retained a 100 kg open balance after the trip was settled. The ordinary receipt path cannot settle a stop without proof.
- **Incidents:** INC-0001 closed after both the RT-002 short handover and Cleaning alert were resolved. A separate mixed-scope incident showed the Factory Head only the permitted plant child and count.
- **Replenishment:** the 979-pouch review posted no order. D17's stale suggestion required stock confirmation before a prefilled order could open. A separate 4,000 kg raw purchase reduced the raw recommendation to zero. Expiring confirmations and overdue open supply are covered by focused tests.
- **Owner experience:** charts matched transaction totals in light and dark modes and fit a 390 px viewport. The dashboard shortcut reached the charts. Scoped Inbox read state, exact handover links, the 15-profile chooser, sign-out protection and per-user theme persistence passed.
- **Final regression:** 250 automated tests across 24 files, clean type checking, successful build, and a browser replay of all 17 RT-001 steps with 10,020 kg retained after reload.

The final release checks also verified plant-local tomorrow dates for fresh demo PO-RT-002 and replaced free-text incident titles with a neutral label for restricted viewers. Existing saved transactions retain their dates. Other pre-existing fixed demo stock dates can still affect seeding much later.
