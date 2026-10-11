import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ChecklistConfig, ConfigEntry, ScreeningConfig } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'
import { timeAgo } from '../lib/format'

type ConfigResponse = { entries: ConfigEntry[]; config: ScreeningConfig; pending: string[] }

const RULES: { key: keyof ScreeningConfig; label: string; help: string; kind: 'days' | 'count' | 'yesno' | 'optionalDays' }[] = [
  { key: 'guarantorDeadlineDays', label: 'Guarantor deadline', help: 'Days a guarantor has to confirm before the application closes.', kind: 'days' },
  { key: 'skillVerificationNudgeDays', label: 'Skill verification nudge', help: 'Days in skill verification before the approvals queue prompts you to chase. It never changes a status.', kind: 'days' },
  { key: 'referenceUnreachableAttempts', label: 'Calls before a reference is unreachable', help: 'How many unanswered calls before the reference is marked unreachable.', kind: 'count' },
  { key: 'cleanJobsForFullActive', label: 'Clean jobs for full activation', help: 'Completed jobs with clean feedback that lift a provisional Xpert to fully active.', kind: 'count' },
  { key: 'reverificationGapDays', label: 'Gap before reverification', help: 'Days away after which an Xpert must reverify. Leave empty until this is decided, and nobody is made to reverify.', kind: 'optionalDays' },
  { key: 'underReviewKeepsAccess', label: 'Under Review keeps access', help: 'Whether an Xpert under review can still take jobs.', kind: 'yesno' },
]

export function Settings() {
  const { has } = useAuth()
  const canEdit = has('settings.edit')
  const q = useQuery({ queryKey: ['config'], queryFn: () => api<ConfigResponse>('/config') })
  const qc = useQueryClient()
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['config'] }), qc.invalidateQueries({ queryKey: ['screening-config'] }), qc.invalidateQueries({ queryKey: ['reference-script'] }), qc.invalidateQueries({ queryKey: ['checklist'] })])

  if (q.isPending) return <Spinner label="Loading settings" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const { entries, config, pending } = q.data
  const byKey = new Map(entries.map((e) => [e.key, e]))

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Rules the business has not finished deciding are kept here so they can change without a new release. Anything marked as pending is a working value, not a decision."
      />
      {pending.length > 0 && (
        <p className="mb-4 rounded-lg bg-clay-600/20 px-4 py-3 text-sm text-clay-200">
          {pending.length} setting{pending.length === 1 ? ' is' : 's are'} still pending a decision. They work with the values shown.
        </p>
      )}

      <section className="card divide-y divide-ink-700" aria-labelledby="rules-h">
        <h2 id="rules-h" className="px-4 py-3 text-sm font-semibold text-ink-50 sm:px-5">Screening rules</h2>
        {RULES.map((r) => (
          <RuleRow key={r.key} rule={r} value={config[r.key]} entry={byKey.get(`screening.${r.key}`)} pending={pending.includes(r.key)} canEdit={canEdit} onSaved={refresh} />
        ))}
      </section>

      <QuoteValidity entry={byKey.get('quotes.validityDays')} canEdit={canEdit} onSaved={refresh} />
      <section className="card mt-6 divide-y divide-ink-700" aria-labelledby="jobs-h">
        <h2 id="jobs-h" className="px-4 py-3 text-sm font-semibold text-ink-50 sm:px-5">Job monitoring</h2>
        <HoursSetting settingKey="jobs.startOverdueHours" label="Flag a job that has not started" help="Hours after dispatch before a job that has not started is flagged on the job board." fallback={24} entry={byKey.get('jobs.startOverdueHours')} canEdit={canEdit} onSaved={refresh} />
        <HoursSetting settingKey="jobs.confirmationOverdueHours" label="Flag a job waiting on a confirmation" help="Hours one side may wait for the other to confirm completion before the job is flagged." fallback={48} entry={byKey.get('jobs.confirmationOverdueHours')} canEdit={canEdit} onSaved={refresh} />
      </section>
      <p className="mt-6 text-sm text-ink-300">Benchmark rates and Xpert price bands are on the <a className="text-forest-400 hover:underline" href="/pricing">Pricing</a> page.</p>

      <ChecklistEditor entry={byKey.get('screening.evidenceChecklists')} canEdit={canEdit} onSaved={refresh} />
      <ScriptEditor entry={byKey.get('screening.referenceScript')} canEdit={canEdit} onSaved={refresh} />
    </>
  )
}

function show(rule: (typeof RULES)[number], v: unknown): string {
  if (rule.kind === 'yesno') return v ? 'Yes' : 'No'
  if (v === null || v === undefined) return 'Not set'
  return rule.kind === 'days' || rule.kind === 'optionalDays' ? `${v} days` : String(v)
}

function RuleRow({ rule, value, entry, pending, canEdit, onSaved }: { rule: (typeof RULES)[number]; value: unknown; entry: ConfigEntry | undefined; pending: boolean; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-50">
          {rule.label} {pending && <Badge tone="amber">Pending</Badge>}
        </p>
        <p className="mt-0.5 text-xs text-ink-300">{rule.help}</p>
        {entry?.note && <p className="mt-0.5 text-xs text-ink-400">{entry.note}</p>}
        {entry && <p className="mt-0.5 text-xs text-ink-400">Last saved {timeAgo(entry.updatedAt)}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-ink-50">{show(rule, value)}</span>
        {canEdit && <Button variant="secondary" className="min-h-[36px]" onClick={() => { setDraft(value === null || value === undefined ? '' : String(value)); setEditing(true) }}>Change</Button>}
      </div>
      {editing && (
        <ActionDialog
          title={rule.label}
          description={rule.help}
          confirmLabel="Save"
          onClose={() => setEditing(false)}
          onConfirm={async (reason) => {
            let v: unknown
            if (rule.kind === 'yesno') v = draft === 'true'
            else if (rule.kind === 'optionalDays' && draft.trim() === '') v = null
            else {
              v = Number(draft)
              if (!Number.isInteger(v) || (v as number) < 1) throw new Error('Enter a whole number, 1 or more.')
            }
            await api(`/config/screening.${rule.key}`, { method: 'PUT', body: { value: v, reason } })
            await onSaved()
          }}
        >
          {rule.kind === 'yesno' ? (
            <select className="field" aria-label={rule.label} value={draft} onChange={(e) => setDraft(e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input className="field" inputMode="numeric" aria-label={rule.label} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={rule.kind === 'optionalDays' ? 'Leave empty if not decided' : ''} />
          )}
        </ActionDialog>
      )}
    </div>
  )
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50) || 'item'
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean)
function toItems(text: string) {
  const seen = new Set<string>()
  return lines(text).map((label) => {
    let id = slug(label)
    while (seen.has(id)) id += '_2'
    seen.add(id)
    return { id, label }
  })
}

function ChecklistEditor({ entry, canEdit, onSaved }: { entry: ConfigEntry | undefined; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const stored = (entry?.value ?? {}) as ChecklistConfig
  const [draft, setDraft] = useState<Record<string, { items: string; autoFail: string }>>(() =>
    Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, { items: v.items.map((i) => i.label).join('\n'), autoFail: v.autoFail.map((i) => i.label).join('\n') }])),
  )
  const [newType, setNewType] = useState('')
  const [saving, setSaving] = useState(false)

  return (
    <section className="card mt-6 p-4 sm:p-5" aria-labelledby="cl-h">
      <h2 id="cl-h" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-50">
        Evidence checklists {entry?.pending && <Badge tone="amber">Pending</Badge>}
      </h2>
      <p className="mt-1 text-xs text-ink-300">One checklist per task type, one item per line. Items are yes or no. Automatic fail conditions fail the evidence on their own. Use the name "default" for a checklist that applies to any task type without its own. Until one is set, reviewers see a starter checklist.</p>
      <div className="mt-4 space-y-4">
        {Object.entries(draft).map(([type, v]) => (
          <div key={type} className="rounded-lg border border-ink-700 p-3">
            <p className="text-sm font-semibold text-ink-50">{type}</p>
            <label className="label mt-3" htmlFor={`i-${type}`}>Checklist items</label>
            <textarea id={`i-${type}`} rows={4} className="field" disabled={!canEdit} value={v.items} onChange={(e) => setDraft({ ...draft, [type]: { ...v, items: e.target.value } })} />
            <label className="label mt-3" htmlFor={`a-${type}`}>Automatic fail conditions</label>
            <textarea id={`a-${type}`} rows={3} className="field" disabled={!canEdit} value={v.autoFail} onChange={(e) => setDraft({ ...draft, [type]: { ...v, autoFail: e.target.value } })} />
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input className="field" aria-label="New task type" placeholder="Task type name, for example Tiling" value={newType} onChange={(e) => setNewType(e.target.value)} />
          <Button variant="secondary" disabled={newType.trim().length < 2 || newType.trim() in draft} onClick={() => { setDraft({ ...draft, [newType.trim()]: { items: '', autoFail: '' } }); setNewType('') }}>Add task type</Button>
          <Button onClick={() => setSaving(true)}>Save checklists</Button>
        </div>
      )}
      {saving && (
        <ActionDialog
          title="Save checklists"
          confirmLabel="Save"
          onClose={() => setSaving(false)}
          onConfirm={async (reason) => {
            const value: ChecklistConfig = {}
            for (const [type, v] of Object.entries(draft)) {
              const items = toItems(v.items)
              if (items.length === 0) throw new Error(`${type} needs at least one checklist item.`)
              value[type] = { items, autoFail: toItems(v.autoFail) }
            }
            await api('/config/screening.evidenceChecklists', { method: 'PUT', body: { value, reason } })
            await onSaved()
          }}
        />
      )}
    </section>
  )
}

function ScriptEditor({ entry, canEdit, onSaved }: { entry: ConfigEntry | undefined; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const [text, setText] = useState(((entry?.value as string[] | undefined) ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  return (
    <section className="card mt-6 p-4 sm:p-5" aria-labelledby="sc-h">
      <h2 id="sc-h" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-50">
        Reference call script {entry?.pending && <Badge tone="amber">Pending</Badge>}
      </h2>
      <p className="mt-1 text-xs text-ink-300">One question or step per line, in the order they are asked. Until a script is saved, callers see a starter script.</p>
      <textarea aria-label="Reference call script" rows={8} className="field mt-3" disabled={!canEdit} value={text} onChange={(e) => setText(e.target.value)} />
      {canEdit && <div className="mt-3"><Button onClick={() => setSaving(true)}>Save script</Button></div>}
      {saving && (
        <ActionDialog
          title="Save the call script"
          confirmLabel="Save"
          onClose={() => setSaving(false)}
          onConfirm={async (reason) => {
            await api('/config/screening.referenceScript', { method: 'PUT', body: { value: lines(text), reason } })
            await onSaved()
          }}
        />
      )}
    </section>
  )
}

function QuoteValidity({ entry, canEdit, onSaved }: { entry: ConfigEntry | undefined; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const value = typeof entry?.value === 'number' ? entry.value : 3
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  return (
    <section className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5" aria-labelledby="qv-h">
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="qv-h" className="text-sm font-semibold text-ink-50">Quote validity</h2>
        <p className="mt-0.5 text-xs text-ink-300">Days a sent quote stays valid before it expires on its own. Decided: three days.</p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-ink-50">{value} days</span>
        {canEdit && <Button variant="secondary" className="min-h-[36px]" onClick={() => { setDraft(String(value)); setEditing(true) }}>Change</Button>}
      </div>
      {editing && (
        <ActionDialog title="Quote validity" description="Applies to quotes sent from now on." confirmLabel="Save" onClose={() => setEditing(false)}
          onConfirm={async (reason) => {
            const n = Number(draft)
            if (!Number.isInteger(n) || n < 1) throw new Error('Enter a whole number of days, 1 or more.')
            await api('/config/quotes.validityDays', { method: 'PUT', body: { value: n, reason } })
            await onSaved()
          }}>
          <input className="field" inputMode="numeric" aria-label="Days" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </ActionDialog>
      )}
    </section>
  )
}

function HoursSetting({ settingKey, label, help, fallback, entry, canEdit, onSaved }: { settingKey: string; label: string; help: string; fallback: number; entry: ConfigEntry | undefined; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const value = typeof entry?.value === 'number' ? entry.value : fallback
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-50">{label} {entry?.pending && <Badge tone="amber">Pending</Badge>}</p>
        <p className="mt-0.5 text-xs text-ink-300">{help}</p>
        {entry?.note && <p className="mt-0.5 text-xs text-ink-400">{entry.note}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-ink-50">{value} hours</span>
        {canEdit && <Button variant="secondary" className="min-h-[36px]" onClick={() => { setDraft(String(value)); setEditing(true) }}>Change</Button>}
      </div>
      {editing && (
        <ActionDialog title={label} description="Applies straight away." confirmLabel="Save" onClose={() => setEditing(false)}
          onConfirm={async (reason) => {
            const n = Number(draft)
            if (!Number.isInteger(n) || n < 1) throw new Error('Enter a whole number of hours, 1 or more.')
            await api(`/config/${settingKey}`, { method: 'PUT', body: { value: n, reason } })
            await onSaved()
          }}>
          <input className="field" inputMode="numeric" aria-label="Hours" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </ActionDialog>
      )}
    </div>
  )
}
