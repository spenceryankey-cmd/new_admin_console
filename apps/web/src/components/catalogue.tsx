import { SERVICE_CATEGORIES } from '@beyondx/shared'

/** The ten service categories. Nobody types a category: it is always chosen from the list. */
export function CategorySelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a category</option>
      {SERVICE_CATEGORIES.map((c) => <option key={c.code} value={c.label}>{c.label}</option>)}
    </select>
  )
}
