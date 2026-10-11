import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  EVIDENCE_TYPES,
  STATUS_LABELS,
  TRIGGER_LABELS,
  guarantorCountdown,
  type Move,
  type ReferenceRecord,
  type Trigger,
  type XpertDetail as Detail,
} from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, ErrorState, PageHeader, Spinner } from '../components/ui'
import { XpertTrustCard } from '../components/trust'
import { SourceBadge, StatusBadge, useRefreshScreening } from '../components/xpert'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'
import { supabase } from '../lib/supabase'
import { ApproveDialog } from './Approvals'
import { EvidenceOpen } from './EvidenceQueue'

type Dialog = { kind: 'move'; move: Move } | { kind: 'approve' } | { kind: 'retract' } | null

export function XpertDetailPage() {
  const { id = '' } = useParams()
  const { has } = useAuth()
  const refresh = useRefreshScreening()
  const [dialog, setDialog] = useState<Dialog>(null)
  const q = useQuery({ queryKey: ['xpert', id], queryFn: () => api<Detail>(`/xperts/${encodeURIComponent(id)}`) })

  if (q.isPending) return <Spinner label="Loading the record" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const d = q.data
  const x = d.xpert
  const canApprove = has('xperts.approve') && x.status === 'skill_verification'
  const manualMoves = d.moves.filter((m) => m.manual)

  return (
    <>
      <Link to="/xperts" className="mb-4 inline-flex min-h-[36px] items-center gap-2 text-sm text-ink-300 hover:text-ink-50">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All Xperts
      </Link>
      <PageHeader
        title={x.fullName}
        subtitle={[x.phone, x.homeArea, x.skills.join(', ')].filter(Boolean).join(' · ') || undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={x.status} />
            <SourceBadge source={x.verificationSource} />
            <Badge tone={x.accountActive ? 'green' : 'neutral'}>{x.accountActive ? 'Account on' : 'Account off'}</Badge>
          </div>
        }
      />

      <section className="card p-4 sm:p-5" aria-labelledby="actions-h">
        <h2 id="actions-h" className="text-sm font-semibold text-ink-50">Status</h2>
        <p className="mt-1 text-sm text-ink-300">
          {STATUS_LABELS[x.status]}{x.statusSince ? ` since ${dateTime(x.statusSince)}` : ''}.
        </p>
        {x.status === 'skill_verification' && d.screeningGaps.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-200">{d.screeningGaps.map((g) => <li key={g}>{g}</li>)}</ul>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {canApprove && <Button disabled={!d.screeningComplete} onClick={() => setDialog({ kind: 'approve' })}>Approve</Button>}
          {manualMoves.filter((m) => !(m.to === 'provisional_active' && x.status === 'skill_verification')).map((m) => (
            <span key={m.to} title={m.blockedReason ?? undefined}>
              <Button variant={m.to === 'removed' ? 'danger' : 'secondary'} disabled={!m.allowed} onClick={() => setDialog({ kind: 'move', move: m })}>
                Move to {STATUS_LABELS[m.to]}
              </Button>
            </span>
          ))}
          {manualMoves.length === 0 && !canApprove && <p className="text-sm text-ink-400">No manual status changes are available from here.</p>}
        </div>
        {manualMoves.some((m) => !m.allowed && m.blockedReason) && (
          <ul className="mt-3 space-y-1 text-xs text-ink-400">
            {manualMoves.filter((m) => !m.allowed && m.blockedReason).map((m) => <li key={m.to}>{STATUS_LABELS[m.to]}: {m.blockedReason}</li>)}
          </ul>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <GuarantorPanel d={d} onRetract={() => setDialog({ kind: 'retract' })} onChanged={refresh} />
        <EvidencePanel d={d} onChanged={refresh} />
        <ReferencesPanel d={d} onChanged={refresh} />
        <section className="card p-4 sm:p-5" aria-labelledby="hist-h">
          <h2 id="hist-h" className="text-sm font-semibold text-ink-50">Status history</h2>
          {d.history.length === 0 ? (
            <p className="mt-3 text-sm text-ink-400">No changes recorded yet.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {d.history.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="text-ink-50">
                    {h.oldStatus ? `${STATUS_LABELS[h.oldStatus]} to ${STATUS_LABELS[h.newStatus]}` : `Started as ${STATUS_LABELS[h.newStatus]}`}
                  </p>
                  <p className="text-xs text-ink-300">
                    {dateTime(h.changedAt)} · {h.automatic ? 'Automatic' : (h.changedByName ?? 'Staff')}
                    {h.trigger ? ` · ${TRIGGER_LABELS[h.trigger]}` : ''}
                  </p>
                  {h.reason && <p className="mt-0.5 text-xs text-ink-200">{h.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <XpertTrustCard xpertId={x.id} />

      {dialog?.kind === 'move' && <MoveDialog xpertId={id} expectedFrom={x.status} move={dialog.move} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'approve' && <ApproveDialog entry={{ xpert: { id, fullName: x.fullName } }} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'retract' && d.guarantor && (
        <ActionDialog
          title={`${d.guarantor.name} is withdrawing`}
          description={x.status === 'full_active' || x.status === 'provisional_active' ? 'The guarantor is retracted and this Xpert goes to Under Review while the position is sorted out.' : 'The guarantor is retracted. The Xpert will need a new one.'}
          confirmLabel="Retract the guarantor"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api(`/guarantors/${d.guarantor!.id}/retract`, { method: 'POST', body: { reason } })
            await refresh()
          }}
        />
      )}
    </>
  )
}

function MoveDialog({ xpertId, expectedFrom, move, onClose, onDone }: { xpertId: string; expectedFrom: Detail['xpert']['status']; move: Move; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [trigger, setTrigger] = useState<Trigger | ''>(move.triggers.length === 1 ? move.triggers[0]! : '')
  return (
    <ActionDialog
      title={`Move to ${STATUS_LABELS[move.to]}`}
      description={move.to === 'removed' ? 'Removal is final for this account. Someone other than the first pass reviewer must do it.' : undefined}
      confirmLabel={`Move to ${STATUS_LABELS[move.to]}`}
      danger={move.to === 'removed' || move.to === 'suspended'}
      onClose={onClose}
      onConfirm={async (reason) => {
        if (move.triggers.length > 0 && !trigger) throw new Error('Choose the reason for this change.')
        await api(`/xperts/${encodeURIComponent(xpertId)}/transition`, { method: 'POST', body: { expectedFrom, to: move.to, trigger: trigger || undefined, reason } })
        await onDone()
      }}
    >
      {move.triggers.length > 1 && (
        <div>
          <label className="label" htmlFor="trg">What happened</label>
          <select id="trg" className="field" value={trigger} onChange={(e) => setTrigger(e.target.value as Trigger | '')}>
            <option value="">Choose one</option>
            {move.triggers.map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
          </select>
        </div>
      )}
    </ActionDialog>
  )
}

function GuarantorPanel({ d, onRetract, onChanged }: { d: Detail; onRetract: () => void; onChanged: () => Promise<unknown> }) {
  const { has } = useAuth()
  const g = d.guarantor
  const canWork = has('guarantors.review')
  const [form, setForm] = useState({ name: '', contact: '', relationship: '' })
  const add = useMutation({
    mutationFn: () => api(`/xperts/${encodeURIComponent(d.xpert.id)}/guarantor`, { method: 'POST', body: { name: form.name, contact: form.contact, relationship: form.relationship || undefined } }),
    onSuccess: onChanged,
  })
  const cd = g && d.xpert.status === 'guarantor_pending' ? guarantorCountdown({ namedAt: g.namedAt }, new Date()) : null

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="g-h">
      <h2 id="g-h" className="text-sm font-semibold text-ink-50">Guarantor</h2>
      {!g ? (
        canWork ? (
          <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
            <p className="text-sm text-ink-300">No guarantor on record. Enter the one the applicant gave.</p>
            <input className="field" aria-label="Guarantor name" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="field" aria-label="Guarantor phone" placeholder="Phone number" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            <input className="field" aria-label="Relationship" placeholder="How they know the applicant" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
            {add.isError && <p role="alert" className="text-sm text-danger-400">{errorText(add.error)}</p>}
            <Button type="submit" busy={add.isPending} disabled={form.name.trim().length < 2 || form.contact.trim().length < 5}>Save guarantor</Button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-ink-400">No guarantor on record.</p>
        )
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-medium text-ink-50">{g.name}</p>
          <p className="text-ink-200"><a className="underline-offset-2 hover:underline" href={`tel:${g.contact}`}>{g.contact}</a>{g.relationship ? ` · ${g.relationship}` : ''}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge tone={g.explainerMessageSentAt ? 'green' : 'neutral'}>{g.explainerMessageSentAt ? 'Explainer sent' : 'Explainer not sent'}</Badge>
            <Badge tone={g.callbackOutcome === 'yes' ? 'green' : g.callbackOutcome ? 'amber' : 'neutral'}>
              {g.callbackOutcome === 'yes' ? 'Said yes' : g.callbackOutcome === 'no' ? 'Said no' : g.callbackOutcome === 'no_response' ? 'No answer' : 'Not called yet'}
            </Badge>
            {cd && <Badge tone={cd.overdue ? 'red' : cd.daysLeft <= 3 ? 'amber' : 'neutral'}>{cd.label}</Badge>}
          </div>
          {g.assignedToName && <p className="text-xs text-ink-400">{g.assignedToName} is working on this</p>}
          {canWork && <div className="pt-2"><Button variant="secondary" onClick={onRetract}>Guarantor is withdrawing</Button></div>}
        </div>
      )}
    </section>
  )
}

function EvidencePanel({ d, onChanged }: { d: Detail; onChanged: () => Promise<unknown> }) {
  const { has } = useAuth()
  const canAdd = has('evidence.review')
  const [taskType, setTaskType] = useState('')
  const [evidenceType, setEvidenceType] = useState<(typeof EVIDENCE_TYPES)[number]>('submitted_evidence')
  const [link, setLink] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const add = useMutation({
    mutationFn: async () => {
      let filePath: string | undefined
      if (file) {
        const up = await api<{ path: string; token: string }>('/evidence/upload-url', { method: 'POST', body: { xpertId: d.xpert.id, fileName: file.name } })
        const { error } = await supabase.storage.from('xpert-evidence').uploadToSignedUrl(up.path, up.token, file)
        if (error) throw new Error('The file did not upload. Check the connection and try again.')
        filePath = up.path
      }
      await api('/evidence', { method: 'POST', body: { xpertId: d.xpert.id, taskType, evidenceType, link: link.trim() || undefined, filePath } })
    },
    onSuccess: async () => {
      setTaskType(''); setLink(''); setFile(null)
      await onChanged()
    },
  })
  const ready = taskType.trim().length >= 2 && (link.trim() || file)

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="e-h">
      <h2 id="e-h" className="text-sm font-semibold text-ink-50">Skill evidence</h2>
      {d.evidence.length === 0 ? <p className="mt-3 text-sm text-ink-400">Nothing submitted yet.</p> : (
        <ul className="mt-3 space-y-3">
          {d.evidence.map((e) => (
            <li key={e.id} className="rounded-lg bg-ink-800/60 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink-50">{e.taskType}</p>
                <Badge tone={e.reviewOutcome === 'pass' ? 'green' : e.reviewOutcome === 'fail' ? 'red' : 'amber'}>
                  {e.reviewOutcome === 'pass' ? 'Passed' : e.reviewOutcome === 'fail' ? 'Failed' : 'Waiting for review'}
                </Badge>
              </div>
              <p className="text-xs text-ink-300">{e.evidenceType === 'certification' ? 'Certification' : 'Submitted evidence'}{e.reviewedByName ? ` · reviewed by ${e.reviewedByName}` : ''}</p>
              <div className="mt-2"><EvidenceOpen evidence={e} /></div>
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form className="mt-4 space-y-3 border-t border-ink-700 pt-4" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Add evidence</p>
          <input className="field" aria-label="Task type" placeholder="Task type, for example Tiling" value={taskType} onChange={(e) => setTaskType(e.target.value)} />
          <select className="field" aria-label="Evidence type" value={evidenceType} onChange={(e) => setEvidenceType(e.target.value as typeof evidenceType)}>
            <option value="submitted_evidence">Submitted evidence (photos, video, past work)</option>
            <option value="certification">Certification</option>
          </select>
          <input className="field" aria-label="Link" placeholder="Link to the evidence (https://...)" value={link} onChange={(e) => setLink(e.target.value)} />
          <input className="field" type="file" aria-label="Or upload a file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {add.isError && <p role="alert" className="text-sm text-danger-400">{errorText(add.error)}</p>}
          <Button type="submit" busy={add.isPending} disabled={!ready}>Add evidence</Button>
        </form>
      )}
    </section>
  )
}

function ReferencesPanel({ d, onChanged }: { d: Detail; onChanged: () => Promise<unknown> }) {
  const { has } = useAuth()
  const canAdd = has('references.review')
  const [form, setForm] = useState({ name: '', contact: '', relationship: '' })
  const add = useMutation({
    mutationFn: () => api('/references', { method: 'POST', body: { xpertId: d.xpert.id, ...form } }),
    onSuccess: async () => {
      setForm({ name: '', contact: '', relationship: '' })
      await onChanged()
    },
  })
  const label = (r: ReferenceRecord) => ({ pending: 'Not called yet', confirmed: 'Confirmed', inconclusive: 'Inconclusive', unreachable: 'Unreachable' })[r.outcome]
  return (
    <section className="card p-4 sm:p-5" aria-labelledby="r-h">
      <h2 id="r-h" className="text-sm font-semibold text-ink-50">References</h2>
      {d.references.length === 0 ? <p className="mt-3 text-sm text-ink-400">No references yet.</p> : (
        <ul className="mt-3 space-y-3">
          {d.references.map((r) => (
            <li key={r.id} className="rounded-lg bg-ink-800/60 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-ink-50">{r.name}</p>
                <Badge tone={r.outcome === 'confirmed' ? 'green' : r.outcome === 'pending' ? 'neutral' : 'amber'}>{label(r)}</Badge>
              </div>
              <p className="text-xs text-ink-300">{r.contact} · {r.relationship} · {r.attemptsMade} call{r.attemptsMade === 1 ? '' : 's'}</p>
              {r.warnings.map((w) => <p key={w} className="mt-1 text-xs text-clay-200">{w}</p>)}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form className="mt-4 space-y-3 border-t border-ink-700 pt-4" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Add a reference</p>
          <input className="field" aria-label="Reference name" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="field" aria-label="Reference phone" placeholder="Phone number" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <input className="field" aria-label="Relationship" placeholder="How they know the Xpert (not family)" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
          {add.isError && <p role="alert" className="text-sm text-danger-400">{errorText(add.error)}</p>}
          <Button type="submit" busy={add.isPending} disabled={form.name.trim().length < 2 || form.contact.trim().length < 5 || form.relationship.trim().length < 2}>Add reference</Button>
        </form>
      )}
    </section>
  )
}
