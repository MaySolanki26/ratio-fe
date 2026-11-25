/** Contextual help registry (page-level) + prototype boundary disclosure. */
import { domain } from '../../domain/active';
import { MODULE_MAP } from '../../domain/rentio/pack';

const RENTIO_HELP: Record<string, { title: string; body: string[] }> = {
  home: { title: 'Rentio home', body: ['Owner overview: decisions that need the owner first, then top risks, the stock flow and delivery promises — each opens the exact record.', 'My work: your next action, prefilled from the record it came from. Stage staff can do Receive, Start, Record output and Issue right there.'] },
  presenter: { title: 'Presenter tools', body: ['For demonstrations only: run the RT-001 script, show its lot accounting, try the safety controls, back up or restore this browser\'s demo data. Not part of daily work.'] },
  masters: { title: 'M1 Masters & setup', body: ['Masters use the shared grid, form, filter and inspector. Capacity and credit limits here are enforced by the transactions.', 'Route versions apply to new lots; lots keep the version they started with.'] },
  procurement: { title: 'M2 Procurement & intake', body: ['Intake stays held at the gate until an independent checker accepts it. The person who recorded the intake cannot accept it.', 'Commercial moisture deductions never change kilograms.'] },
  production: { title: 'M3–M4 Production', body: ['Stage staff work Receive → Start → Record output → Issue. Every kilogram is classified; no balancing loss is added automatically.', 'Issued material sits in pending custody until the receiver confirms; shortfalls stay as accountable residuals.'] },
  stock: { title: 'M5–M6 Godown & inventory', body: ['Physical quantity, condition (holds/expiry) and reservation are separate. Holds on a parent affect all descendants.', 'Godown totals are the sum of their stacks; there are no separately maintained totals.'] },
  distribution: { title: 'M7, M8, M12 Distribution', body: ['Reservation protects stock without moving it; dispatch moves it into transit; distributor receipt settles transit.', 'Retailer delivery deducts distributor stock once, with a unique challan reference.'] },
  sales: { title: 'M9, M11 Sales & returns', body: ['Offline orders are queued requests, revalidated on sync — conflicts are shown, never silently repriced.', 'Returns are held until QC decides; replacement and credit are separate from the physical return.'] },
  finance: { title: 'M10, M14 Finance & reports', body: ['Tally, IRN and messaging are SIMULATED. Retries look up the existing document first, so nothing duplicates.', 'Costing is provisional and operational; Tally remains the books of record.'] },
  hr: { title: 'M15 HR & payroll', body: ['Biometric import is simulated with a file; duplicates are ignored. Payroll uses a demo rule (no statutory formulas) and needs a different authorizer.'] },
  planning: { title: 'M16 Season & forecast', body: ['Season mode changes new runs only. The 7-day forecast stays gated until the owner approves a yield baseline.'] },
  admin: { title: 'Administration', body: ['Configuration changes follow Draft → Validate → Publish.', 'Audit log entries include every Rentio transaction and every blocked attempt (local simulation, not tamper-evident).'] },
};
const PAGE_HELP: Record<string, { title: string; body: string[] }> = {
  home: { title: 'Overview', body: ['The overview adapts to your role: front desk sees today’s arrivals, billing sees balances, managers see everything they can access.', 'Every number links to the list it summarizes.'] },
  scheduling: {
    title: 'Scheduling',
    body: [
      'Rooms are exclusive: overlapping in-person bookings in the same room are rejected.',
      'Clinician double-booking and non-working days are warnings that only a practice manager can override, with an audited reason.',
      'Use Day schedule or the Room calendar view and click an empty slot to book.',
    ],
  },
  patients: { title: 'Patients', body: ['Register patients with the step-by-step wizard (drafts autosave locally) or Quick add.', 'Phone and email are masked by default. Roles with sensitive-data access can reveal them with the eye icon; others see masked values everywhere, including exports and search.'] },
  billing: { title: 'Billing', body: ['Invoices are created on a full-page form with line items.', '“Record payment” records money you already received — nothing is charged.', 'Write-offs require approval by a different person (separation of duties).'] },
  work: { title: 'Work', body: ['Tasks, approvals and notifications are separate: completing a task never approves a request, and reading a notification never completes anything.'] },
  resources: { title: 'Staff & rooms', body: ['Rooms set to maintenance cannot be booked. Staff working days drive scheduling warnings.'] },
  admin: { title: 'Administration', body: ['Configuration changes follow Draft → Validate → Publish. Published versions are recorded and cannot be edited.', 'Audit log and Event trace are local simulations of server-side ledgers.'] },
};

export function HelpContent({ mod }: { mod: string }) {
  const rentio = domain().id === 'rentio';
  const h = rentio ? RENTIO_HELP[mod] ?? RENTIO_HELP.home : PAGE_HELP[mod] ?? PAGE_HELP.home;
  return (
    <div className="help">
      <section>
        <h3>{h.title}</h3>
        <ul className="plain-list bullets">
          {h.body.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>What is real in this prototype</h3>
        <ul className="plain-list bullets">
          <li>All data is fictional and generated from a fixed seed. It is stored only in this browser’s local storage.</li>
          <li>Role switching simulates sign-in. Permissions are enforced by an in-browser service layer — a model of server rules, not a security boundary.</li>
          {rentio ? (
            <li>Tally, e-invoice/IRN, WhatsApp/SMS, biometric import and offline salesman sync are local SIMULATIONS. No external system is contacted and no real money moves.</li>
          ) : (
            <li>No messages, emails, payments, payer claims or external referrals are sent. Buttons that would do so are disabled and say why.</li>
          )}
          <li>The audit log and event trace are local simulations; they are not tamper-evident and nothing is delivered to other systems.</li>
          <li>The AI assistant entry is present for layout only and is not enabled.</li>
          {rentio ? <li>Business values (tolerances, shelf life, credit limits, rates, durations) are configurable demo defaults listed in docs/rentio/DEMO_ASSUMPTIONS.md — not approved Rentio policy.</li> : <li>This is administrative software only. It provides no clinical advice or decision support.</li>}
        </ul>
      </section>
      {rentio && (
        <section>
          <h3>Simulated in this demo</h3>
          <p className="muted">{domain().banner}</p>
          <p className="muted">Permissions and audit history run in your browser to demonstrate the rules; a production system enforces them on a server with real sign-in, backups and validated integrations.</p>
        </section>
      )}
      {rentio && (
        <section>
          <h3>Module map (M1–M16)</h3>
          <ul className="plain-list bullets">
            {MODULE_MAP.map(([id, name, where]) => (
              <li key={id}>
                <strong>{id}</strong> {name} → {where}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Keyboard</h3>
        <ul className="plain-list bullets">
          <li>
            <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> — search pages, views and records
          </li>
          <li>
            <kbd>↑</kbd>/<kbd>↓</kbd> move between grid rows, <kbd>Enter</kbd> opens, <kbd>Space</kbd> selects
          </li>
          <li>
            <kbd>Esc</kbd> closes the topmost panel or dialog
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> sends a quick comment
          </li>
        </ul>
      </section>
    </div>
  );
}
