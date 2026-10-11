import {
  BadgeCheck,
  Banknote,
  BriefcaseBusiness,
  ClipboardCheck,
  FileSearch,
  Flag,
  Gauge,
  Inbox,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  PhoneCall,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import type { Permission } from '@beyondx/shared'

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Shown if the person holds any of these. Empty means everyone. */
  anyOf: readonly Permission[]
  /** Build phase that delivers the screen. 1 or 2 means it exists now. */
  phase: 1 | 2 | 3 | 4 | 5
  summary: string
}

export type NavGroup = { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, anyOf: [], phase: 1, summary: 'Counts of everything waiting in each queue.' },
    ],
  },
  {
    title: 'Requests',
    items: [
      { to: '/requests', label: 'Requests and quotes', icon: Inbox, anyOf: ['quotes.read'], phase: 1, summary: 'New requests, the quote composer and employer responses.' },
      { to: '/pricing', label: 'Pricing', icon: Banknote, anyOf: ['pricing.bands.edit', 'benchmarks.edit'], phase: 1, summary: 'Benchmark rates and Xpert price bands.' },
    ],
  },
  {
    title: 'Xperts',
    items: [
      { to: '/xperts', label: 'Xpert pipeline', icon: Users, anyOf: ['xperts.read'], phase: 1, summary: 'Every Xpert by status, with a full record for each.' },
      { to: '/guarantors', label: 'Guarantor queue', icon: PhoneCall, anyOf: ['guarantors.review'], phase: 1, summary: 'Explainer messages and callback outcomes, with a two week countdown.' },
      { to: '/evidence', label: 'Evidence review', icon: FileSearch, anyOf: ['evidence.review'], phase: 1, summary: 'Submitted skill evidence beside the task checklist.' },
      { to: '/references', label: 'Reference calls', icon: MessageSquareText, anyOf: ['references.review'], phase: 1, summary: 'Call scripts and outcome logging.' },
      { to: '/approvals', label: 'Approvals', icon: BadgeCheck, anyOf: ['xperts.approve'], phase: 1, summary: 'Approve an Xpert once screening is complete.' },
      { to: '/flags', label: 'Flags', icon: Flag, anyOf: ['flags.read'], phase: 1, summary: 'Flags and counter flags, routed to decision makers.' },
    ],
  },
  {
    title: 'Jobs',
    items: [
      { to: '/jobs', label: 'Job board', icon: BriefcaseBusiness, anyOf: ['dispatch.match', 'jobs.monitor'], phase: 1, summary: 'Jobs by status, dispatch matching and live monitoring.' },
      { to: '/change-orders', label: 'Change orders', icon: ClipboardCheck, anyOf: ['changeorders.manage'], phase: 1, summary: 'Log scope changes and the confirmations from both sides.' },
      { to: '/coordinators', label: 'Coordinators', icon: UsersRound, anyOf: ['coordinators.read'], phase: 1, summary: 'Team rosters and metrics computed from the records.' },
      { to: '/feedback', label: 'Feedback', icon: Gauge, anyOf: ['feedback.read'], phase: 1, summary: 'Structured feedback from employers and Xperts, per job.' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/staff', label: 'Staff', icon: ShieldCheck, anyOf: ['staff.read'], phase: 1, summary: 'Invite staff and set their roles.' },
      { to: '/roles', label: 'Roles', icon: KeyRound, anyOf: ['staff.read'], phase: 1, summary: 'What each role is allowed to do.' },
      { to: '/audit', label: 'Audit log', icon: ScrollText, anyOf: ['audit.read'], phase: 1, summary: 'Every action taken in the console.' },
      { to: '/settings', label: 'Settings', icon: Settings, anyOf: ['settings.read'], phase: 2, summary: 'Screening rules, checklists and the reference script, with pending decisions marked.' },
    ],
  },
]

export const ALL_ITEMS = NAV.flatMap((g) => g.items)
export const FUTURE_ITEMS = ALL_ITEMS.filter((i) => i.phase > 5)
