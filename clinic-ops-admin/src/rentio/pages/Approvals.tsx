/** Maker-checker inbox: reviewed values, rule, exposure, maker; self-approval and missing authority are refused. */
import { useState } from 'react';
import { Tabs } from '../../components/primitives/feedback';
import { hasCap, userName } from '../../domain/rentio/access';
import { decideApproval } from '../../domain/rentio/ops';
import { useAct, useR } from '../store';
import { scopedApprovals } from '../../domain/rentio/scope';
import { InlineAlert } from '../../components/primitives/feedback';
import { deciderLabel, plainRule } from './_opsHelpers';
import { ApprovalsChart } from './_graphB';
import { FormButton, ImplNote, Panel, Reason, RPage, Status, str, Table, fmtTime, useFocusId } from '../ui';

export default function Approvals() {
  const { s, actor } = useR();
  const act = useAct();
  const focus = useFocusId();
  // read scope: approvals you asked for or are entitled to decide
  const visible = scopedApprovals(s, actor);
  const focused = focus ? visible.find((a) => a.id === focus) : undefined;
  const pending = visible.filter((a) => a.status === 'pending');
  const [tab, setTab] = useState<'mine' | 'pending' | 'decided'>(() => (focused ? (focused.status !== 'pending' ? 'decided' : 'pending') : 'mine'));
  const mine = pending.filter((a) => hasCap(actor, a.requiredCapability) && (!a.ownerOnly || actor.roleId === 'owner'));
  const rows = (tab === 'mine' ? mine : tab === 'pending' ? pending : visible.filter((a) => a.status !== 'pending')).slice().reverse();
  const why = (a: (typeof s.approvals)[number]) =>
    a.requestedBy === actor.id ? 'You requested this — an independent approver must decide (self-approval is rejected)' : !hasCap(actor, a.requiredCapability) ? `${actor.roleLabel} cannot decide this` : a.ownerOnly && actor.roleId !== 'owner' ? 'Exceeds delegated limit — owner decision' : undefined;
  return (
    <RPage title="Approvals" description="Requests that need an independent decision. Stock changes only when the approval posts.">
      {focus && !focused && <InlineAlert tone="info">That request is not visible to you, or no longer exists.</InlineAlert>}
      <ApprovalsChart pending={pending} isMine={(a) => mine.includes(a as (typeof mine)[number])} label={(t) => t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())} />
      <Panel
        title="Inbox"
        actions={
          <Tabs
            label="Approval filter"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'mine', label: 'For me', count: mine.length },
              { id: 'pending', label: 'All pending', count: pending.length },
              { id: 'decided', label: 'Decided', count: visible.length - pending.length },
            ]}
          />
        }
      >
        <Table
          rows={rows}
          rowKey={(a) => a.id}
          focus={focus}
          empty={tab === 'mine' ? 'Nothing needs your decision.' : 'No approvals.'}
          cols={[
            { key: 's', label: 'Requested change', render: (a) => (<><div>{a.summary}</div><div className="muted"><Reason text={plainRule(a.rule)} /></div></>) },
            { key: 'x', label: 'Qty / value', render: (a) => a.exposure ?? '—' },
            { key: 'by', label: 'Asked by', render: (a) => `${userName(a.requestedBy)} · ${fmtTime(a.requestedAt)}` },
            { key: 'who', label: 'Decided by', render: (a) => (a.ownerOnly ? 'Owner (beyond delegated limit)' : deciderLabel(a.requiredCapability)) },
            { key: 'st', label: 'Status', render: (a) => (<><Status s={a.status} />{a.decidedBy && <div className="muted">{userName(a.decidedBy)} · {fmtTime(a.decidedAt)}{a.reason ? ` · ${a.reason}` : ''}</div>}</>) },
            {
              key: 'act',
              label: '',
              render: (a) =>
                a.status === 'pending' ? (
                  <div className="rt-row">
                    <FormButton
                      label="Approve"
                      variant="primary"
                      disabledReason={why(a)}
                      title={`Approve ${a.id}`}
                      submitLabel="Approve and post"
                      note={<>{a.summary}. Approving posts the linked effect in the same transaction; if the posting fails nothing is approved.</>}
                      fields={[{ key: 'reason', label: 'Note (optional)', type: 'text' }]}
                      onSubmit={(v, key) => act(`Approve ${a.id}`, (ctx) => decideApproval(ctx, { approvalId: a.id, approve: true, reason: str(v.reason) || undefined }), { key })}
                    />
                    <FormButton
                      label="Reject"
                      variant="ghost"
                      disabledReason={why(a)}
                      title={`Reject ${a.id}`}
                      submitLabel="Reject"
                      fields={[{ key: 'reason', label: 'Reason (required)', type: 'textarea', required: true }]}
                      onSubmit={(v, key) => act(`Reject ${a.id}`, (ctx) => decideApproval(ctx, { approvalId: a.id, approve: false, reason: str(v.reason) }), { key })}
                    />
                  </div>
                ) : null,
            },
          ]}
        />
      </Panel>
      <ImplNote>Maker-checker (BR-003, EC-44): a request can never be approved by the person who made it, even if they hold the approval right. Approval and the linked posting run as one transaction. Requests visible via scopedApprovals (asked for, or entitled to decide). Owner-only items exceed the delegated limit (OQ-02 demo threshold).</ImplNote>
    </RPage>
  );
}
