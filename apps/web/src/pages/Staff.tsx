import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import {
  ROLES,
  ROLE_LABELS,
  inviteStaffSchema,
  type InviteStaffInput,
  type Role,
  type StaffMember,
} from '@beyondx/shared'
import { useAuth } from '../auth/AuthProvider'
import { ActionDialog, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'
import { dateTime } from '../lib/format'

type Dialog =
  | { kind: 'invite' }
  | { kind: 'role'; member: StaffMember }
  | { kind: 'active'; member: StaffMember }
  | null

export function Staff() {
  const { has, me } = useAuth()
  const qc = useQueryClient()
  const canManage = has('staff.manage')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [toast, setToast] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['staff'], queryFn: () => api<{ staff: StaffMember[] }>('/staff') })

  const refresh = () => qc.invalidateQueries({ queryKey: ['staff'] })

  const invite = useMutation({
    mutationFn: (body: InviteStaffInput) => api('/staff/invite', { method: 'POST', body }),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/staff/${id}`, { method: 'PATCH', body }),
    onSuccess: refresh,
  })

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Everyone who can sign in to this console. Accounts are deactivated, never deleted, so the history stays intact."
        action={
          canManage && (
            <Button onClick={() => setDialog({ kind: 'invite' })}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Invite staff
            </Button>
          )
        }
      />
      {toast && (
        <p role="status" className="mb-4 rounded-lg bg-forest-900/60 px-4 py-2.5 text-sm text-forest-300">{toast}</p>
      )}

      {list.isPending && <Spinner label="Loading staff" />}
      {list.isError && <ErrorState message={errorText(list.error)} onRetry={() => void list.refetch()} />}
      {list.data && list.data.staff.length === 0 && <EmptyState title="No staff yet" hint="Invite the first person to get started." />}

      {list.data && list.data.staff.length > 0 && (
        <ul className="space-y-3">
          {list.data.staff.map((m) => (
            <li key={m.userId} className="card flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate text-sm font-semibold text-ink-50">
                  {m.fullName} {m.userId === me?.staff.userId && <span className="font-normal text-ink-300">(you)</span>}
                </p>
                <p className="truncate text-sm text-ink-300">{m.email}</p>
                <p className="mt-1 text-xs text-ink-400">Added {dateTime(m.createdAt)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={m.role === 'super_admin' ? 'green' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
                <Badge tone={m.isActive ? 'green' : 'red'}>{m.isActive ? 'Active' : 'Deactivated'}</Badge>
              </div>
              {canManage && m.userId !== me?.staff.userId && (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'role', member: m })}>Change role</Button>
                  <Button variant="secondary" onClick={() => setDialog({ kind: 'active', member: m })}>
                    {m.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === 'invite' && (
        <InviteDialog
          onClose={() => setDialog(null)}
          onSend={async (input) => {
            await invite.mutateAsync(input)
            setToast(`Invitation sent to ${input.email}.`)
          }}
        />
      )}
      {dialog?.kind === 'role' && (
        <RoleDialog
          member={dialog.member}
          onClose={() => setDialog(null)}
          onSave={async (role, reason) => {
            await update.mutateAsync({ id: dialog.member.userId, body: { role, reason } })
            setToast(`${dialog.member.fullName} is now ${ROLE_LABELS[role]}.`)
          }}
        />
      )}
      {dialog?.kind === 'active' && (
        <ActionDialog
          title={dialog.member.isActive ? `Deactivate ${dialog.member.fullName}` : `Reactivate ${dialog.member.fullName}`}
          description={
            dialog.member.isActive
              ? 'They are signed out of the console straight away and cannot sign in again until reactivated. Their history stays.'
              : 'They will be able to sign in again with their existing password.'
          }
          confirmLabel={dialog.member.isActive ? 'Deactivate' : 'Reactivate'}
          danger={dialog.member.isActive}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await update.mutateAsync({ id: dialog.member.userId, body: { isActive: !dialog.member.isActive, reason } })
            setToast(`${dialog.member.fullName} was ${dialog.member.isActive ? 'deactivated' : 'reactivated'}.`)
          }}
        />
      )}
    </>
  )
}

function InviteDialog({ onClose, onSend }: { onClose: () => void; onSend: (i: InviteStaffInput) => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('ops_reviewer')

  return (
    <ActionDialog
      title="Invite staff"
      description="They get an email with a link to choose a password. Use an address that is not used by an employer on the main site."
      confirmLabel="Send invitation"
      requireReason={false}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = inviteStaffSchema.safeParse({ email, fullName, role })
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the details')
        await onSend(parsed.data)
      }}
    >
      <div>
        <label className="label" htmlFor="inv-name">Full name</label>
        <input id="inv-name" className="field" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="inv-email">Email</label>
        <input id="inv-email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label className="label" htmlFor="inv-role">Role</label>
        <select id="inv-role" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </div>
    </ActionDialog>
  )
}

function RoleDialog({
  member,
  onClose,
  onSave,
}: {
  member: StaffMember
  onClose: () => void
  onSave: (role: Role, reason: string) => Promise<void>
}) {
  const [role, setRole] = useState<Role>(member.role)
  return (
    <ActionDialog
      title={`Change role for ${member.fullName}`}
      description="The new role applies on their next action."
      confirmLabel="Save role"
      onClose={onClose}
      onConfirm={async (reason) => {
        if (role === member.role) throw new Error('Pick a different role')
        await onSave(role, reason)
      }}
    >
      <div>
        <label className="label" htmlFor="role-sel">Role</label>
        <select id="role-sel" className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </div>
    </ActionDialog>
  )
}
