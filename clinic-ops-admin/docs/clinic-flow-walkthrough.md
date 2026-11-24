# Clinic Ops Admin — How the Clinic Works (Easy Walkthrough)

> One normal day at **Riverside Clinic**, following one patient from arrival to final bill.
> Use this file to verify the app step by step. Run `npm run dev` inside `clinic-ops-admin`
> and switch users from the **account menu (top right)**.
>
> Note: patient names, IDs (P-1045, APT-2210 …) and amounts below are **examples**. The real
> demo data has its own names and IDs. Money is shown in **USD ($)**.

---

## 0. What kind of system is this?

**A Clinic Operations Admin system** — the *front-office / back-office* side of an **outpatient clinic group**.

| It IS | It is NOT |
|---|---|
| Clinic operations / practice management | A full **Hospital Management System (HMS)** |
| Patient registration, appointment scheduling, check-in | No wards, beds, admission/discharge (IPD) |
| Billing (invoices, payments, write-offs) | No pharmacy, lab (LIS), radiology, OT |
| Referrals, tasks, approvals | No medical records (EMR) — no diagnosis, prescriptions, clinical notes |
| Staff & rooms, roles & permissions, audit | No real payments, SMS, email, or login |

So it is **more than a "clinic appointment" app** (it also covers patients, billing, referrals,
tasks, approvals, configuration and audit), but **less than a hospital system** (no inpatient or
clinical modules). Best short name: **Clinic Management / Practice Management System (administrative only)**.

It is also a **demo (frontend prototype)** built to show the *Universal Admin Builder 2.0* skill:
all data is fake and stored only in your browser (localStorage).

---

## 1. Setup — one organization, two clinics, four users

- **Organization:** Northwind Health Partners
- **Clinics (workspaces):** Riverside Clinic, Hillcrest Clinic — each has completely separate data.

| Person | Role | Can do |
|---|---|---|
| **Jordan Reyes** | Front desk | Register patients, book / confirm / check-in appointments |
| **Dr. Amara Osei** | Clinician (doctor) | Sees only own appointments, starts and completes visits, no billing |
| **Sam Whitfield** | Billing specialist | Create/issue invoices, record payments, request write-offs |
| **Morgan Ellis** | Practice manager | Everything + approvals, configuration, audit, booking override |

There is no password — the app changes menus, fields, masking and buttons based on who you are.

---

## 2. The story — new patient "Ravi Kumar"

### 🕘 9:00 AM — Morgan opens the app
- [ ] App opens on **Dashboard → Overview** (`/o/northwind/w/riverside/dashboard`).
- [ ] Shows today's appointments, waiting patients, unpaid invoices, pending approvals.
- [ ] Tabs **Scheduling / Patients / Billing** show charts for each area.

👉 Lesson: the dashboard is a quick summary of the whole clinic.

### 🕙 10:00 AM — Ravi walks in (switch to **Jordan**, front desk)

**Step 1 — Register the patient**
- [ ] **Patients → Register patient** opens a **3-step wizard** (personal → contact → insurance).
- [ ] Ravi has insurance → **Member ID is required**. (Self-pay patient → not required.)
- [ ] Leave halfway → the **draft is auto-saved**, nothing lost.
- [ ] Save → Ravi gets a patient ID (e.g. **P-1045**).

Behind the scenes:
1. Checks Jordan is allowed to create patients ✅
2. Checks required fields ✅
3. Saves to the database (browser storage)
4. Writes "Jordan created patient P-1045" in the **Audit log**
5. Records the event `patients.created`

**Step 2 — Book an appointment**
- [ ] **Scheduling → Day schedule** shows a calendar with rooms and doctors.
- [ ] Click free slot 11:00 → choose **Ravi + Dr. Amara + Room 2**.
- [ ] ❌ Room 2 already booked at 11:00 → app **rejects and explains why**.
- [ ] Pick **Room 3** → ✅ saved, status **Scheduled**.

> If the **doctor** is double-booked, Jordan cannot force it. Only **Morgan** can override,
> with a **reason**, and the override is written to the audit log.

**Step 3 — Confirm and check in**
- [ ] Call Ravi → click **Confirm** → status **Confirmed**.
- [ ] Ravi arrives → click **Check in** → status **Checked in**.

### 🕚 11:00 AM — The visit (switch to **Dr. Amara**, clinician)
- [ ] Menu is smaller — **no Billing**.
- [ ] Appointment list shows **only Dr. Amara's own appointments**.
- [ ] Ravi's **phone / email are masked** (e.g. `+91********10`) — doctors don't need contact info.
- [ ] Click **Start visit** → **In progress**, then **Complete visit** → **Completed**.

> Only clinicians have Start / Complete visit. Jordan never sees these buttons.

**Appointment journey:**
```
Scheduled → Confirmed → Checked in → In progress → Completed
     ↘ No-show / Cancelled → (Reopen) → Scheduled
```

**Ravi needs a specialist:**
- [ ] Dr. Amara creates a **Referral** → Cardiology, urgency High.
  Journey: `Received → In review → Scheduled → Closed` (or `Declined`).
- [ ] Dr. Amara creates a **Task** for Jordan: "Call Ravi with cardiology date".
  Journey: `Todo → In progress ⇄ Blocked → Done` (can Reopen).
- [ ] 🔔 Jordan gets a notification: "Dr. Amara assigned you T-…".

### 🕐 1:00 PM — Billing (switch to **Sam**)

**Step 1 — Make the invoice**
- [ ] **Billing → New invoice** (full-page form).
- [ ] Pick Ravi, link the appointment, add **line items**:
  - Consultation × 1 = $80
  - Blood test × 1 = $40
  - **Total = $120** (calculated automatically)
- [ ] Saved as **Draft** → click **Save & issue** → **Issued**.

**Step 2 — Ravi pays part**
- [ ] Ravi pays $100 cash → **Record payment** → enter $100, method Cash.
- [ ] App does **not** charge a card — it only records money already received.
- [ ] Clicking Save twice by mistake still records the payment **only once** (idempotency).

**Step 3 — Forgive the remaining $20**
- [ ] Click **Request write-off**, reason: "Senior citizen discount".
- [ ] Sam **cannot approve their own request** — a manager must.

### 🕑 2:00 PM — Approval (switch to **Morgan**)
- [ ] **Work → Work inbox → Approvals** shows Sam's request.
- [ ] Read reason → **Approve** → invoice becomes **Written off**. 🔔 Sam is notified.

**Invoice journey:**
```
Draft → Issued → Paid
  ↘ Void (cancelled invoice)
Issued → Write-off request → Manager approves → Written off
```

### 🕒 3:00 PM — Morgan's admin work

**1. Add a new field without coding — Configuration studio**
- [ ] **Administration → Configuration studio** → **Start draft**.
- [ ] Add field "Blood group" (A+, B+, O+ …) → **Validate** → **Publish**.
- [ ] ✨ The field now appears in the patient form, table columns, filters and detail panel automatically.

**2. Who did what — Audit log**
- [ ] **Administration → Audit log** shows: Jordan created patient, Jordan booked appointment,
  Dr. Amara completed visit, Sam requested write-off, Morgan approved write-off.

**3. System events — Event trace**
- [ ] Shows events like `invoices.created` (marked *simulated*; a real backend could use them to send SMS/email).

**4. Roles & access**
- [ ] Table showing what each role can see and do.

---

## 3. Features on every page

| Feature | Example | ✔ |
|---|---|---|
| **Saved views** | Filter "Today's confirmed appointments" → **Save as new** → share with team | [ ] |
| **Table / Board / Calendar** | Same appointments as list, status cards or calendar | [ ] |
| **Filters & Columns** | Show only unpaid invoices, hide columns | [ ] |
| **Export** | Download CSV (only roles allowed to export) | [ ] |
| **Detail panel (Inspector)** | Click a row → Details / Related / Activity / Comments | [ ] |
| **Comments + @mention** | Sam writes "@Morgan please check" → Morgan notified | [ ] |
| **Global search** | `Ctrl/⌘ + K` → type `INV-1002` → jumps to that invoice | [ ] |
| **Switch clinic** | Workspace switcher → Riverside ⇄ Hillcrest (separate data) | [ ] |
| **Theme** | Button at bottom of left icon rail → colours / dark mode | [ ] |
| **Reset data** | Account menu → fresh demo data | [ ] |

---

## 4. The whole day in one picture

```
 JORDAN (Front desk)        DR. AMARA (Doctor)        SAM (Billing)            MORGAN (Manager)
 ───────────────────        ──────────────────        ─────────────            ────────────────
 Register Ravi
 Book appointment ────────▶ sees it in own schedule
 Confirm → Check in
                            Start → Complete visit
                            Create referral
 🔔 gets task ◀──────────── Create task for Jordan
                                                      Create invoice $120
                                                      Issue invoice
                                                      Record $100 payment
                                                      Request $20 write-off ──▶ 🔔 sees in Approvals
                                                      🔔 approved ◀──────────── Approve
                                                                               Add "Blood group" field
                                                                               Check Audit log
```

---

## 5. Behind every Save — the same 5 checks

Code: `src/services/runtime.ts` (`createRecord`, `updateRecord`, `transitionRecord`, `recordPayment`)

1. 🔐 **Permission** — is this person/role allowed? (`services/authz.ts`)
2. ✅ **Validation** — required fields, ranges, inactive options (`services/validation.ts`)
3. 🚦 **Business rules** — allowed status change? room/doctor free? (`services/scheduling.ts`, lifecycles in `domain/clinic/resources.ts`)
4. 💾 **Save** with a version number — two people can't silently overwrite each other (`services/db.ts`)
5. 📝 **Log** — audit entry + event + notifications (`services/ledger.ts`)

Then the record is returned with sensitive fields **masked/hidden for that role**, and the screen refreshes.

---

## 6. Where things live in the code

| Area | File / folder |
|---|---|
| Routes (URLs → pages) | `src/App.tsx` |
| Org, clinics, roles, users, menu modules | `src/domain/clinic/pack.ts` |
| 7 record types (fields, forms, lifecycles) | `src/domain/clinic/resources.ts` |
| Dropdown lists (masters) | `src/domain/clinic/masters.ts` |
| Demo data generator | `src/domain/clinic/seed.ts` |
| Mock "server" services | `src/services/` |
| Shared UI (grid, forms, inspector, calendar) | `src/components/resource/` |
| App frame (rail, sidebar, top bar) | `src/components/shell/` |
| Dashboard | `src/pages/DashboardPage.tsx`, `src/pages/dashboard/`, `src/components/dashboard/` |
| Admin pages (studio, audit, events, settings) | `src/pages/AdminPages.tsx`, `src/pages/RolesPage.tsx` |

---

## 7. Remember — this is a demo

- Data is fake and stored only in your browser.
- No real login, no real payment, no SMS/email, AI assistant not enabled.
- Permission checks run in the browser → **not real security**. Production needs a backend server,
  real identity provider, server-side permissions and masking, payment and messaging providers.
