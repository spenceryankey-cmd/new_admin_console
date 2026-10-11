import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PERMISSIONS, PERMISSION_LABELS, ROLES, ROLE_LABELS, type Permission, type Role, type RolePermissionRow } from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'

const EDITABLE = ROLES.filter((r) => r !== 'super_admin')

export function Roles() {
  const { has } = useAuth()
  const canManage = has('staff.manage')
  const qc = useQueryClient()
  const [pending, setPending] = useState<{ role: Role; permission: Permission; granted: boolean } | null>(null)

  const matrix = useQuery({ queryKey: ['roles'], queryFn: () => api<{ rows: RolePermissionRow[] }>('/roles/permissions') })

  const grants = useMemo(() => {
    const s = new Set<string>()
    for (const r of matrix.data?.rows ?? []) if (r.granted) s.add(`${r.role}:${r.permission}`)
    return s
  }, [matrix.data])

  const save = useMutation({
    mutationFn: (v: { role: Role; permission: Permission; granted: boolean; reason: string }) =>
      api(`/roles/${v.role}/permissions/${v.permission}`, { method: 'PUT', body: { granted: v.granted, reason: v.reason } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="What each role may do. Changes apply on the next action and are recorded in the audit log with your reason."
      />
      {matrix.isPending && <Spinner label="Loading roles" />}
      {matrix.isError && <ErrorState message={errorText(matrix.error)} onRetry={() => void matrix.refetch()} />}
      {matrix.data && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-xs uppercase tracking-wide text-ink-300">
                <th scope="col" className="px-4 py-3 font-semibold">Permission</th>
                {EDITABLE.map((r) => (
                  <th key={r} scope="col" className="px-3 py-3 text-center font-semibold">{ROLE_LABELS[r]}</th>
                ))}
                <th scope="col" className="px-3 py-3 text-center font-semibold">{ROLE_LABELS.super_admin}</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS.map((p) => (
                <tr key={p} className="border-b border-ink-800 last:border-0">
                  <td className="px-4 py-3">
                    <span className="text-ink-50">{PERMISSION_LABELS[p]}</span>
                  </td>
                  {EDITABLE.map((r) => {
                    const on = grants.has(`${r}:${p}`)
                    return (
                      <td key={r} className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-forest-600"
                          checked={on}
                          disabled={!canManage}
                          onChange={() => setPending({ role: r, permission: p, granted: !on })}
                          aria-label={`${ROLE_LABELS[r]}: ${PERMISSION_LABELS[p]}`}
                        />
                      </td>
                    )
                  })}
                  <td className="px-3 py-3 text-center text-forest-300">
                    <Lock className="mx-auto h-4 w-4" aria-label="Always allowed" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pending && (
        <ActionDialog
          title={`${pending.granted ? 'Grant' : 'Remove'} permission`}
          description={`${pending.granted ? 'Give' : 'Take away from'} ${ROLE_LABELS[pending.role]}: ${PERMISSION_LABELS[pending.permission]}`}
          confirmLabel={pending.granted ? 'Grant' : 'Remove'}
          danger={!pending.granted}
          onClose={() => setPending(null)}
          onConfirm={async (reason) => {
            await save.mutateAsync({ ...pending, reason })
          }}
        />
      )}
    </>
  )
}
