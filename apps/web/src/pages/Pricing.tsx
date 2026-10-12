import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { BENCHMARK_UNITS, BENCHMARK_UNIT_LABELS, formatGhs, type BenchmarkRate, type BenchmarkUnit, type PriceBand, type XpertSummary } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { CategorySelect } from '../components/catalogue'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'

export function Pricing() {
  const { has } = useAuth()
  const canRates = has('benchmarks.edit')
  const canBands = has('pricing.bands.edit')
  const [tab, setTab] = useState<'rates' | 'bands'>(canRates ? 'rates' : 'bands')
  return (
    <>
      <PageHeader title="Pricing" subtitle="Benchmark rates are the reference prices staff quote from. A price band is the range an individual Xpert is expected to charge. Changing either keeps the old value in the history." />
      <div role="tablist" aria-label="Pricing" className="mb-5 flex gap-2">
        {canRates && <TabButton on={tab === 'rates'} onClick={() => setTab('rates')}>Benchmark rates</TabButton>}
        {canBands && <TabButton on={tab === 'bands'} onClick={() => setTab('bands')}>Xpert price bands</TabButton>}
      </div>
      {tab === 'rates' && canRates && <Benchmarks />}
      {tab === 'bands' && canBands && <Bands />}
    </>
  )
}

const TabButton = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button role="tab" aria-selected={on} onClick={onClick} className={`min-h-[40px] rounded-lg px-4 text-sm ${on ? 'bg-forest-600/15 font-semibold text-forest-300' : 'text-ink-200 hover:bg-ink-800'}`}>{children}</button>
)

function Benchmarks() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['benchmarks'], queryFn: () => api<{ rates: BenchmarkRate[] }>('/pricing/benchmarks') })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['benchmarks'] }), qc.invalidateQueries({ queryKey: ['request'] })])
  const [dlg, setDlg] = useState<{ kind: 'add' } | { kind: 'edit'; rate: BenchmarkRate } | null>(null)
  const [showOld, setShowOld] = useState(false)

  if (q.isPending) return <Spinner label="Loading rates" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const rows = q.data.rates.filter((r) => showOld || r.active)

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-[40px] items-center gap-2 text-sm text-ink-200"><input type="checkbox" className="h-4 w-4 accent-forest-600" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show replaced rates</label>
        <Button onClick={() => setDlg({ kind: 'add' })}><Plus className="h-4 w-4" aria-hidden /> Add a rate</Button>
      </div>
      {rows.length === 0 && <EmptyState title="No benchmark rates yet" hint="Add one for each category you quote. Categories come from the fixed list." />}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className={`card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 ${r.active ? '' : 'opacity-60'}`}>
            <div className="min-w-0 flex-1 basis-48"><p className="text-sm font-semibold text-ink-50">{r.category}</p><p className="text-xs text-ink-300">{BENCHMARK_UNIT_LABELS[r.unit]}</p></div>
            <p className="text-sm font-semibold text-ink-50">{formatGhs(r.amountGhs)}</p>
            {r.active ? <Button variant="secondary" className="min-h-[36px]" onClick={() => setDlg({ kind: 'edit', rate: r })}>Change</Button> : <Badge>Replaced</Badge>}
          </li>
        ))}
      </ul>
      {dlg?.kind === 'add' && <AddRate onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg?.kind === 'edit' && <EditRate rate={dlg.rate} onClose={() => setDlg(null)} onDone={refresh} />}
    </>
  )
}

function AddRate({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [category, setCategory] = useState('')
  const [unit, setUnit] = useState<BenchmarkUnit>('per_job')
  const [amount, setAmount] = useState('')
  return (
    <ActionDialog title="Add a benchmark rate" description="If a live rate already exists for this category and unit, it is replaced and kept in the history." confirmLabel="Save rate" onClose={onClose}
      onConfirm={async (reason) => {
        const n = Number(amount)
        if (!(n > 0)) throw new Error('Enter an amount above zero.')
        await api('/pricing/benchmarks', { method: 'POST', body: { category, unit, amountGhs: n, reason } })
        await onDone()
      }}>
      <div><label className="label" htmlFor="b-c">Category</label><CategorySelect id="b-c" value={category} onChange={setCategory} /></div>
      <div><label className="label" htmlFor="b-u">Unit</label><select id="b-u" className="field" value={unit} onChange={(e) => setUnit(e.target.value as BenchmarkUnit)}>{BENCHMARK_UNITS.map((u) => <option key={u} value={u}>{BENCHMARK_UNIT_LABELS[u]}</option>)}</select></div>
      <div><label className="label" htmlFor="b-a">Amount in GHS</label><input id="b-a" className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
    </ActionDialog>
  )
}

function EditRate({ rate, onClose, onDone }: { rate: BenchmarkRate; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [amount, setAmount] = useState(String(rate.amountGhs))
  const [off, setOff] = useState(false)
  return (
    <ActionDialog title={`${rate.category}, ${BENCHMARK_UNIT_LABELS[rate.unit].toLowerCase()}`} confirmLabel="Save" onClose={onClose}
      onConfirm={async (reason) => {
        const n = Number(amount)
        if (!off && !(n > 0)) throw new Error('Enter an amount above zero.')
        await api(`/pricing/benchmarks/${rate.id}`, { method: 'PATCH', body: off ? { active: false, reason } : { amountGhs: n, reason } })
        await onDone()
      }}>
      <div><label className="label" htmlFor="e-a">Amount in GHS</label><input id="e-a" className="field" inputMode="decimal" disabled={off} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <label className="flex min-h-[36px] items-center gap-2 text-sm text-ink-200"><input type="checkbox" className="h-4 w-4 accent-forest-600" checked={off} onChange={(e) => setOff(e.target.checked)} /> Stop using this rate</label>
    </ActionDialog>
  )
}

function Bands() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['bands'], queryFn: () => api<{ bands: PriceBand[] }>('/pricing/bands') })
  const refresh = () => qc.invalidateQueries({ queryKey: ['bands'] })
  const [adding, setAdding] = useState(false)
  const [off, setOff] = useState<PriceBand | null>(null)

  if (q.isPending) return <Spinner label="Loading bands" />
  if (q.isError) return <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
  const rows = q.data.bands.filter((b) => b.active)

  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Set a band</Button></div>
      {rows.length === 0 && <EmptyState title="No price bands yet" hint="A band records the range an Xpert is expected to charge for a category." />}
      <ul className="space-y-3">
        {rows.map((b) => (
          <li key={b.id} className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
            <div className="min-w-0 flex-1 basis-48"><p className="text-sm font-semibold text-ink-50">{b.xpertName ?? b.xpertId}</p><p className="text-xs text-ink-300">{b.category}</p></div>
            <p className="text-sm font-semibold text-ink-50">{formatGhs(b.minGhs)} to {formatGhs(b.maxGhs)}</p>
            <Button variant="ghost" className="min-h-[36px]" onClick={() => setOff(b)}>Stop using</Button>
          </li>
        ))}
      </ul>
      {adding && <AddBand onClose={() => setAdding(false)} onDone={refresh} />}
      {off && <ActionDialog title="Stop using this band" description={`${off.xpertName ?? off.xpertId}, ${off.category}`} confirmLabel="Stop using" danger onClose={() => setOff(null)} onConfirm={async (reason) => { await api(`/pricing/bands/${off.id}`, { method: 'PATCH', body: { active: false, reason } }); await refresh() }} />}
    </>
  )
}

function AddBand({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<unknown> }) {
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<XpertSummary | null>(null)
  const [category, setCategory] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const found = useQuery({ queryKey: ['xpert-pick', search], queryFn: () => api<{ xperts: XpertSummary[] }>(`/xperts?limit=6&q=${encodeURIComponent(search)}`), enabled: search.trim().length >= 2 && !chosen })
  const save = useMutation({ mutationFn: (body: unknown) => api('/pricing/bands', { method: 'POST', body }) })

  return (
    <ActionDialog title="Set a price band" confirmLabel="Save band" onClose={onClose}
      onConfirm={async (reason) => {
        if (!chosen) throw new Error('Choose the Xpert.')
        const a = Number(min), b = Number(max)
        if (!(a > 0) || !(b > 0)) throw new Error('Enter both amounts.')
        await save.mutateAsync({ xpertId: chosen.id, category, minGhs: a, maxGhs: b, reason })
        await onDone()
      }}>
      <div>
        <label className="label" htmlFor="bd-x">Xpert</label>
        {chosen ? (
          <p className="flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2 text-sm text-ink-50">{chosen.fullName}<button type="button" className="text-xs text-forest-300 hover:underline" onClick={() => setChosen(null)}>Change</button></p>
        ) : (
          <>
            <input id="bd-x" className="field" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
            {found.isError && <p className="mt-2 text-xs text-danger-400">{errorText(found.error)}</p>}
            {found.data && <ul className="mt-2 space-y-1">{found.data.xperts.map((x) => <li key={x.id}><button type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm text-ink-100 hover:bg-ink-800" onClick={() => setChosen(x)}>{x.fullName} <span className="text-xs text-ink-400">{x.phone}</span></button></li>)}{found.data.xperts.length === 0 && <li className="px-3 text-xs text-ink-400">No Xpert found.</li>}</ul>}
          </>
        )}
      </div>
      <div><label className="label" htmlFor="bd-c">Category</label><CategorySelect id="bd-c" value={category} onChange={setCategory} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="bd-min">From, GHS</label><input id="bd-min" className="field" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></div>
        <div><label className="label" htmlFor="bd-max">To, GHS</label><input id="bd-max" className="field" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></div>
      </div>
    </ActionDialog>
  )
}
