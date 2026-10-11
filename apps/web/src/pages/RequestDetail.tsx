import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { formatGhs, quoteProblems, BENCHMARK_UNIT_LABELS, type QuoteLine, type QuoteRecord, type RequestDetail as Detail } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, ErrorState, PageHeader, Spinner } from '../components/ui'
import { PaymentStatusBadge, QuoteStatusBadge, RequestStatusBadge } from '../components/requests'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

type Dialog = 'send' | 'withdraw' | 'accepted' | 'declined' | 'cancel' | 'paid' | null

export function RequestDetailPage() {
  const { id = '' } = useParams()
  const { has } = useAuth()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<Dialog>(null)
  const q = useQuery({ queryKey: ['request', id], queryFn: () => api<Detail>(`/requests/${id}`) })
  const refresh = () => Promise.all(['request', 'requests', 'req-counts'].map((k) => qc.invalidateQueries({ queryKey: [k] })))

  if (q.isPending) return <Spinner label="Loading the request" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const d = q.data
  const r = d.request
  const canCompose = has('quotes.compose')
  const sent = d.quotes.find((x) => x.status === 'sent')
  const draft = d.quotes.find((x) => x.status === 'draft')
  const expired = !!sent?.validUntil && new Date(sent.validUntil).getTime() <= Date.now()

  const post = (path: string, body?: unknown) => api(`/requests/${id}${path}`, { method: 'POST', body })

  return (
    <>
      <Link to="/requests" className="mb-4 inline-flex min-h-[36px] items-center gap-2 text-sm text-ink-300 hover:text-ink-50"><ArrowLeft className="h-4 w-4" aria-hidden /> All requests</Link>
      <PageHeader title={r.category} subtitle={`${r.employerName} · ${r.employerPhone}`} action={<RequestStatusBadge status={r.status} />} />

      <section className="card p-4 sm:p-5" aria-labelledby="rq-h">
        <h2 id="rq-h" className="text-sm font-semibold text-ink-50">The request</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Field label="What needs doing" value={r.description} wide />
          <Field label="Location" value={r.location} />
          <Field label="When" value={r.timing} />
          {r.specialRequirements && <Field label="Special requirements" value={r.specialRequirements} wide />}
          <Field label="Received" value={dateTime(r.createdAt)} />
        </dl>
        {r.photos.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {r.photos.map((p, i) => <li key={p}><a href={p} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-800">Photo {i + 1}</a></li>)}
          </ul>
        )}
        {canCompose && (r.status === 'new' || r.status === 'quoted') && (
          <div className="mt-4"><Button variant="ghost" onClick={() => setDialog('cancel')}>Cancel this request</Button></div>
        )}
      </section>

      {r.status === 'new' && canCompose && (
        <Composer detail={d} draft={draft} onSaved={refresh} onSend={() => setDialog('send')} />
      )}
      {r.status === 'new' && !canCompose && <p className="mt-6 text-sm text-ink-300">Your role cannot prepare quotes.</p>}

      {sent && (
        <section className="card mt-6 p-4 sm:p-5" aria-labelledby="sent-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="sent-h" className="text-sm font-semibold text-ink-50">Quote sent</h2>
            <Badge tone={expired ? 'red' : 'neutral'}>{expired ? 'Validity ran out' : `Valid until ${dateTime(sent.validUntil!)}`}</Badge>
          </div>
          <QuoteLines quote={sent} />
          {canCompose && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={expired} onClick={() => setDialog('accepted')}>Employer accepted</Button>
              <Button variant="secondary" disabled={expired} onClick={() => setDialog('declined')}>Employer declined</Button>
              <Button variant="ghost" onClick={() => setDialog('withdraw')}>Withdraw the quote</Button>
            </div>
          )}
          {expired && <p className="mt-3 text-xs text-ink-400">The quote runs out on its own at the next check. Withdraw it to prepare a new one now.</p>}
        </section>
      )}

      {d.payment && (
        <section className="card mt-6 p-4 sm:p-5" aria-labelledby="pay-h">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pay-h" className="text-sm font-semibold text-ink-50">Payment</h2>
            <PaymentStatusBadge status={d.payment.status} />
          </div>
          <p className="mt-2 text-2xl font-semibold text-ink-50">{formatGhs(d.payment.amountGhs)}</p>
          <p className="mt-1 text-sm text-ink-300">By MoMo, paid after the employer accepts. It is released to the Xpert when both sides confirm the job is done.</p>
          {d.payment.status === 'pending' && (has('payments.record') ? <div className="mt-4"><Button onClick={() => setDialog('paid')}>Record that payment arrived</Button></div> : <p className="mt-3 text-xs text-ink-400">Finance records when the payment arrives.</p>)}
          {d.payment.momoReference && <p className="mt-3 text-sm text-ink-200">MoMo reference {d.payment.momoReference}{d.payment.receivedAt ? `, received ${dateTime(d.payment.receivedAt)}` : ''}{d.payment.recordedByName ? `, recorded by ${d.payment.recordedByName}` : ''}</p>}
        </section>
      )}

      {d.quotes.length > 0 && (
        <section className="mt-6" aria-labelledby="qh-h">
          <h2 id="qh-h" className="mb-3 text-sm font-semibold text-ink-50">Quote history</h2>
          <ul className="space-y-3">
            {d.quotes.map((x) => (
              <li key={x.id} className="card p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-ink-50">Version {x.version}, {formatGhs(x.totalGhs)}</p>
                  <QuoteStatusBadge status={x.status} />
                </div>
                <p className="mt-1 text-xs text-ink-300">
                  {x.composedByName ? `Prepared by ${x.composedByName}` : 'Prepared by staff'}
                  {x.sentAt ? ` · sent ${dateTime(x.sentAt)}` : ''}
                  {x.respondedAt ? ` · closed ${dateTime(x.respondedAt)}` : ''}
                  {x.responseSource === 'staff_logged' ? ' · answer logged by staff' : x.responseSource === 'employer' ? ' · answered by the employer' : ''}
                </p>
                {x.responseNote && <p className="mt-1 text-xs text-ink-200">{x.responseNote}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog === 'send' && (
        <ActionDialog title="Send this quote" description={`The employer can accept or decline it. It stays valid for ${d.validityDays} days, then expires on its own.`} confirmLabel="Send quote" requireReason={false} onClose={() => setDialog(null)} onConfirm={async () => { await post('/quote/send'); await refresh() }} />
      )}
      {dialog === 'withdraw' && (
        <ActionDialog title="Withdraw the quote" description="The request goes back to New so a new quote can be prepared." confirmLabel="Withdraw" danger onClose={() => setDialog(null)} onConfirm={async (reason) => { await post('/quote/withdraw', { reason }); await refresh() }} />
      )}
      {(dialog === 'accepted' || dialog === 'declined') && (
        <ActionDialog
          title={dialog === 'accepted' ? 'The employer accepted' : 'The employer declined'}
          description={dialog === 'accepted' ? 'Use this when the employer told you directly. A payment record is created, waiting for the MoMo payment.' : 'This closes the request.'}
          confirmLabel={dialog === 'accepted' ? 'Record acceptance' : 'Record decline'}
          danger={dialog === 'declined'}
          requireReason={false}
          onClose={() => setDialog(null)}
          onConfirm={async () => { await post('/quote/response', { response: dialog }); await refresh() }}
        />
      )}
      {dialog === 'cancel' && (
        <ActionDialog title="Cancel this request" description="Any open quote is withdrawn. This cannot be undone." confirmLabel="Cancel the request" danger onClose={() => setDialog(null)} onConfirm={async (reason) => { await post('/cancel', { reason }); await refresh() }} />
      )}
      {dialog === 'paid' && <PaidDialog onClose={() => setDialog(null)} onSave={async (momoReference) => { await post('/payment/received', { momoReference, method: 'momo' }); await refresh() }} />}
    </>
  )
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-300">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-ink-100">{value}</dd>
    </div>
  )
}

function QuoteLines({ quote }: { quote: QuoteRecord }) {
  return (
    <div className="mt-3">
      <ul className="divide-y divide-ink-800 text-sm">
        {quote.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-4 py-2"><span className="text-ink-100">{l.description}</span><span className="text-ink-50">{formatGhs(l.amountGhs)}</span></li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-ink-700 pt-2 text-sm font-semibold text-ink-50"><span>Total</span><span>{formatGhs(quote.totalGhs)}</span></p>
      {quote.notes && <p className="mt-2 text-xs text-ink-300">{quote.notes}</p>}
    </div>
  )
}

function Composer({ detail, draft, onSaved, onSend }: { detail: Detail; draft: QuoteRecord | undefined; onSaved: () => Promise<unknown>; onSend: () => void }) {
  const [lines, setLines] = useState<{ description: string; amount: string }[]>([{ description: '', amount: '' }])
  const [notes, setNotes] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (draft) {
      setLines(draft.lines.map((l) => ({ description: l.description, amount: String(l.amountGhs) })))
      setNotes(draft.notes ?? '')
      setDirty(false)
    }
  }, [draft?.id, draft?.totalGhs])

  const parsed: QuoteLine[] = lines.filter((l) => l.description.trim() || l.amount.trim()).map((l) => ({ description: l.description.trim(), amountGhs: Number(l.amount) }))
  const cents = parsed.reduce((s, l) => s + Math.round((Number.isFinite(l.amountGhs) ? l.amountGhs : 0) * 100), 0)
  const total = cents / 100
  const problems = quoteProblems(parsed, total).filter((p) => p !== 'The lines do not add up to the total.')
  const complete = problems.length === 0 && parsed.every((l) => l.description.length >= 2)

  const save = useMutation({
    mutationFn: () => api(`/requests/${detail.request.id}/quote`, { method: 'PUT', body: { lines: parsed, totalGhs: total, notes: notes.trim() || undefined } }),
    onSuccess: async () => { setDirty(false); await onSaved() },
  })
  const rates = detail.benchmarks.filter((b) => b.category.toLowerCase() === detail.request.category.toLowerCase())
  const edit = (i: number, k: 'description' | 'amount', v: string) => { setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l))); setDirty(true) }

  return (
    <section className="card mt-6 p-4 sm:p-5" aria-labelledby="comp-h">
      <h2 id="comp-h" className="text-sm font-semibold text-ink-50">{draft ? `Quote draft, version ${draft.version}` : 'Prepare a quote'}</h2>
      <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_16rem]">
        <div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input className="field flex-1" aria-label={`Line ${i + 1} description`} placeholder="For example Labour" value={l.description} onChange={(e) => edit(i, 'description', e.target.value)} />
                <input className="field w-32" inputMode="decimal" aria-label={`Line ${i + 1} amount in GHS`} placeholder="GHS" value={l.amount} onChange={(e) => edit(i, 'amount', e.target.value)} />
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} className="rounded-lg p-2 text-ink-300 hover:bg-ink-800 disabled:opacity-30" onClick={() => { setLines(lines.filter((_, j) => j !== i)); setDirty(true) }}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <Button variant="ghost" className="mt-2" onClick={() => setLines([...lines, { description: '', amount: '' }])}><Plus className="h-4 w-4" aria-hidden /> Add a line</Button>
          <p className="mt-3 flex justify-between border-t border-ink-700 pt-3 text-sm font-semibold text-ink-50"><span>Total</span><span>{formatGhs(total)}</span></p>
          <label className="label mt-4" htmlFor="q-notes">Note to the employer (optional)</label>
          <textarea id="q-notes" rows={2} className="field" value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true) }} />
          {save.isError && <p role="alert" className="mt-3 text-sm text-danger-400">{errorText(save.error)}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" busy={save.isPending} disabled={!complete || !dirty} onClick={() => save.mutate()}>Save draft</Button>
            <Button disabled={!draft || dirty || !complete} onClick={onSend}>Send quote</Button>
          </div>
          {dirty && draft && <p className="mt-2 text-xs text-ink-400">Save your changes before sending.</p>}
        </div>
        <aside aria-label="Benchmark rates" className="rounded-lg bg-ink-800/50 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Benchmark rates for {detail.request.category}</p>
          {rates.length === 0 ? <p className="mt-2 text-xs text-ink-400">No benchmark rate is set for this category yet.</p> : (
            <ul className="mt-2 space-y-2">
              {rates.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2">
                  <span className="text-ink-100">{formatGhs(b.amountGhs)} <span className="text-xs text-ink-300">{BENCHMARK_UNIT_LABELS[b.unit].toLowerCase()}</span></span>
                  <Button variant="ghost" className="min-h-[32px] px-2 py-1 text-xs" onClick={() => { setLines([...lines.filter((l) => l.description || l.amount), { description: `Benchmark ${BENCHMARK_UNIT_LABELS[b.unit].toLowerCase()}`, amount: String(b.amountGhs) }]); setDirty(true) }}>Use</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-400">A benchmark is a starting point. Each Xpert's own price band is kept under Pricing.</p>
        </aside>
      </div>
    </section>
  )
}

function PaidDialog({ onClose, onSave }: { onClose: () => void; onSave: (ref: string) => Promise<void> }) {
  const [ref, setRef] = useState('')
  return (
    <ActionDialog title="Payment arrived" description="Enter the MoMo reference from the payment message. A reference can only be used once." confirmLabel="Record payment" requireReason={false} onClose={onClose} onConfirm={async () => { if (ref.trim().length < 4) throw new Error('Enter the MoMo reference.'); await onSave(ref.trim()) }}>
      <div><label className="label" htmlFor="momo">MoMo reference</label><input id="momo" className="field" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
    </ActionDialog>
  )
}
