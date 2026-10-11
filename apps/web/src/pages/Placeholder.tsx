import { useLocation } from 'react-router-dom'
import { EmptyState, PageHeader } from '../components/ui'
import { ALL_ITEMS } from '../layout/nav'

export function Placeholder() {
  const { pathname } = useLocation()
  const item = ALL_ITEMS.find((i) => i.to === pathname)
  if (!item) return <NotFound />
  return (
    <>
      <PageHeader title={item.label} subtitle={item.summary} />
      <EmptyState title={`Arrives in Phase ${item.phase}`} hint="This screen is part of the plan and is not built yet. Nothing here is lost or hidden." />
    </>
  )
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState title="There is nothing at this address" hint="Use the menu to find what you need." />
    </>
  )
}

export function NoAccess() {
  return (
    <>
      <PageHeader title="Not available to your role" />
      <EmptyState title="You do not have access to this screen" hint="If you think you should, ask a super admin to check your role." />
    </>
  )
}
