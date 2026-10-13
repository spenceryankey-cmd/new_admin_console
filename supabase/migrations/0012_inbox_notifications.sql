-- 0012_inbox_notifications.sql
-- NOT APPLIED. Run after 0011. ADDITIVE ONLY: two new tables and three new permissions.
--
-- Support inbox. The messages themselves are written by the main site and stay there. The console only
-- keeps its own record of what staff did with each one: handled or not, and a note. message_ref is the
-- main site's id for the message, as text, with no foreign key (the messages are in another database).
--
-- Notifications. Every notification staff send from the console is recorded here with the exact text, who
-- it went to, how many people, and whether delivery worked, so there is a permanent record of what went out.
--
-- Both tables follow the usual rules: audit trigger, no hard delete, row level security, and the browser
-- can only read (the API writes, after checking the permission).

begin;

create table public.inbox_state (
  message_ref   text primary key check (char_length(message_ref) between 1 and 120),
  status        text not null default 'open' check (status in ('open', 'handled')),
  note          text check (note is null or char_length(note) <= 1000),
  handled_by    uuid references auth.users (id),
  handled_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text,
  -- A handled message says who handled it and when. An open one does not.
  constraint inbox_state_handled_consistent check (
    (status = 'handled' and handled_by is not null and handled_at is not null)
    or (status = 'open' and handled_by is null and handled_at is null)
  )
);

create table public.notification_send (
  id              uuid primary key default gen_random_uuid(),
  audience_kind   text not null check (audience_kind in ('xpert', 'employer', 'all_xperts', 'all_employers', 'xperts_in_category')),
  audience_detail text,
  body            text not null check (char_length(body) between 3 and 500),
  recipient_count integer not null check (recipient_count >= 1),
  delivered_count integer not null default 0 check (delivered_count >= 0 and delivered_count <= recipient_count),
  status          text not null check (status in ('sent', 'partial', 'failed')),
  error           text,
  sent_by         uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id),
  change_reason   text
);
create index notification_send_created_idx on public.notification_send (created_at desc);

-- Permissions ---------------------------------------------------------------------------------------
-- Ops reviewers and decision makers work the inbox. Only decision makers send notifications, because one
-- send can reach every Xpert or every employer. A super admin can change this on the Roles screen.
insert into public.role_permission (role, permission) values
  ('ops_reviewer',   'inbox.read'),
  ('ops_reviewer',   'inbox.handle'),
  ('decision_maker', 'inbox.read'),
  ('decision_maker', 'inbox.handle'),
  ('decision_maker', 'notifications.send'),
  ('super_admin',    'inbox.read'),
  ('super_admin',    'inbox.handle'),
  ('super_admin',    'notifications.send')
on conflict (role, permission) do nothing;

-- Standard conventions ---------------------------------------------------------------------------------
create trigger inbox_state_touch       before update on public.inbox_state       for each row execute function public.touch_updated_at();
create trigger notification_send_touch before update on public.notification_send for each row execute function public.touch_updated_at();

create trigger inbox_state_audit       after insert or update on public.inbox_state       for each row execute function public.audit_row_change('message_ref');
create trigger notification_send_audit after insert or update on public.notification_send for each row execute function public.audit_row_change('id');

create trigger inbox_state_no_delete       before delete on public.inbox_state       for each row execute function public.block_hard_delete();
create trigger notification_send_no_delete before delete on public.notification_send for each row execute function public.block_hard_delete();

alter table public.inbox_state       enable row level security;
alter table public.notification_send enable row level security;

create policy inbox_state_read       on public.inbox_state       for select to authenticated using (public.has_permission('inbox.read'));
create policy notification_send_read on public.notification_send for select to authenticated using (public.has_permission('notifications.send'));

revoke all on public.inbox_state, public.notification_send from anon, authenticated;
grant select on public.inbox_state, public.notification_send to authenticated;

commit;
