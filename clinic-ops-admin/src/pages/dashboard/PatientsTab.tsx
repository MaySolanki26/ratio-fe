import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HeartPulse, Send, UserCheck, UserPlus, Users } from 'lucide-react';
import { addDays, formatDate } from '../../lib/dates';
import { resourcePath } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { activeMasterValues } from '../../services/registry';
import { CardEmpty, ColumnChart, DashCard, StatGrid, DonutChart, SplitBars, StatCard, ViewAllToggle, ShareBar, TrendChart } from '../../components/dashboard';
import { ageOn, inRange, type DashData } from './model';

const AGE_BANDS = [
  { key: '0-17', label: '0–17', min: 0, max: 17 },
  { key: '18-34', label: '18–34', min: 18, max: 34 },
  { key: '35-49', label: '35–49', min: 35, max: 49 },
  { key: '50-64', label: '50–64', min: 50, max: 64 },
  { key: '65-79', label: '65–79', min: 65, max: 79 },
  { key: '80+', label: '80+', min: 80, max: 200 },
];
const OPEN_REF = ['received', 'in_review', 'scheduled'];

/** Patients: registry size and growth, who is seen, age groups, payer mix, patient status, referrals by specialty. */
export function PatientsTab({ d, actor }: { d: DashData; actor: Actor }) {
  const navigate = useNavigate();
  const ws = actor.workspaceId;
  const { patients, referrals, today } = d;
  const [specOpen, setSpecOpen] = useState(false);

  const fresh = patients.filter((p) => inRange(p, 'registeredOn', d.from, d.to)).length;
  const active = patients.filter((p) => p.status === 'active').length;
  const seen = new Set(d.cur.filter((a) => a.status === 'completed').map((a) => String(a.patientId))).size;
  const openRefs = referrals.filter((r) => OPEN_REF.includes(String(r.status)));
  const urgentRefs = openRefs.filter((r) => r.urgency === 'urgent').length;

  // Age groups — date of birth may be hidden for this role (masked → skipped)
  const withDob = patients.filter((p) => /^\d{4}-\d{2}-\d{2}/.test(String(p.dateOfBirth ?? '')));
  const ages = AGE_BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    value: withDob.filter((p) => {
      const age = ageOn(String(p.dateOfBirth).slice(0, 10), today);
      return age >= b.min && age <= b.max;
    }).length,
  }));

  const payers = activeMasterValues('payer').map((p) => ({ key: p.key, label: p.label, value: patients.filter((x) => x.payer === p.key).length }));
  const statuses = activeMasterValues('patientStatus').map((s) => ({ key: s.key, label: s.label, value: patients.filter((x) => x.status === s.key).length }));
  const specialties = activeMasterValues('specialty').map((s) => ({
    key: s.key,
    label: s.label,
    first: referrals.filter((r) => r.specialty === s.key && OPEN_REF.includes(String(r.status))).length,
    second: referrals.filter((r) => r.specialty === s.key && !OPEN_REF.includes(String(r.status))).length,
  })).filter((s) => s.first + s.second > 0);

  // New registrations per week, last 12 weeks (is the practice growing?)
  const regTrend = Array.from({ length: 12 }, (_, i) => {
    const end = addDays(today, -(11 - i) * 7);
    const start = addDays(end, -6);
    const [dd, mm] = formatDate(end).replace(',', '').split(' ');
    return { key: end, label: `${dd} ${mm}`, count: patients.filter((p) => String(p.registeredOn ?? '') >= start && String(p.registeredOn ?? '') <= end).length };
  });

  return (
    <>
      <StatGrid>
        <StatCard label="Patients" icon={Users} info="Everyone on the patient registry." value={String(patients.length)} note={{ text: `${active} active` }} to={resourcePath(ws, 'patients', { view: 'v_patients_all' })} />
        <StatCard label="New Patients" icon={UserPlus} info={`Registered · ${d.period.toLowerCase()}.`} value={String(fresh)} to={resourcePath(ws, 'patients', { view: 'v_patients_new' })} />
        {d.can.appts && <StatCard label="Patients Seen" icon={HeartPulse} info="Different patients with a completed visit in the period." value={String(seen)} note={{ text: patients.length ? `${Math.round((seen / patients.length) * 100)}% of registry` : 'In this period' }} />}
        <StatCard label="Active" icon={UserCheck} value={String(active)} unit={patients.length ? `${Math.round((active / patients.length) * 100)}%` : undefined} note={{ text: 'Status Active' }} />
        {d.can.referrals && <StatCard label="Open Referrals" icon={Send} info="Received, in review or scheduled referrals." value={String(openRefs.length)} note={urgentRefs ? { text: `${urgentRefs} urgent`, tone: 'danger' } : { text: 'None urgent', tone: 'success' }} to={resourcePath(ws, 'referrals', { view: 'v_ref_open' })} />}
      </StatGrid>

      <div className="dv-row is-halves">
        <DashCard title="Age Groups" meta={withDob.length < patients.length ? `${patients.length - withDob.length} without a date of birth` : 'All patients'}>
          {withDob.length ? <ColumnChart ariaLabel="Patients by age group" bars={ages} tooltip={(b) => `${b.value} ${b.value === 1 ? 'patient' : 'patients'} aged ${b.label}`} /> : <CardEmpty>Dates of birth are hidden for your role</CardEmpty>}
        </DashCard>
        <DashCard className="is-centered" title="Payer Mix" meta="Share of patients by who pays">
          {patients.length ? <ShareBar ariaLabel="Patients by payer" slices={payers} summary={(() => { const top = [...payers].sort((x, y) => y.value - x.value)[0]; const insured = payers.filter((x) => x.key !== 'self_pay').reduce((t, x) => t + x.value, 0); return `${Math.round((insured / patients.length) * 100)}% insured · largest payer ${top.label}`; })()} /> : <CardEmpty>No patients yet</CardEmpty>}
        </DashCard>
      </div>

      <div className="dv-row is-wide-left">
        <DashCard title="New Registrations" meta="Per week · last 12 weeks">
          <TrendChart ariaLabel="New patient registrations per week" data={regTrend} series={[{ key: 'count', label: 'Registered' }]} average />
        </DashCard>
        <DashCard title="Patient Status" meta="Registry right now">
          <DonutChart ariaLabel="Patients by status" legendTitle="Status" totalLabel="patients" slices={statuses} onSliceClick={() => navigate(resourcePath(ws, 'patients', { view: 'v_patients_all' }))} />
        </DashCard>
      </div>

      <div className="dv-row">
        {d.can.referrals && (
          <DashCard title="Referrals by Specialty" meta="Open and finished" action={<ViewAllToggle expanded={specOpen} total={specialties.length} limit={6} onToggle={() => setSpecOpen((o) => !o)} />}>
            {specialties.length ? <SplitBars bars={specialties} firstLabel="Open" secondLabel="Closed or declined" limit={6} expanded={specOpen} /> : <CardEmpty>No referrals yet</CardEmpty>}
          </DashCard>
        )}
      </div>
    </>
  );
}
