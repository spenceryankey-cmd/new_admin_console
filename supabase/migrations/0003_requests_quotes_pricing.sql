-- 0003_requests_quotes_pricing.sql
--
-- BeyondX admin console, Phase 3 (requests, quotes, pricing, payments).
-- ADDITIVE ONLY: creates new tables, seeds new permission grants and one
-- configuration value. It does not read, alter or drop any existing table.
-- NOT APPLIED YET. Show it to the project owner, then run once after 0002a.
--
-- Ids that point at existing records (employer_id, xpert_id, source_task_id) are
-- plain text with no foreign key, for the same reason as in 0002a: the existing
-- tables are owned by the backend. A later generated migration can add links.

begin;

-- Benchmark rates: the reference prices staff quote from. ----------------------
create table public.benchmark_rate (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,
  unit          text not null check (unit in ('per_job', 'per_hour', 'per_day')),
  amount_ghs    numeric(12,2) not null check (amount_ghs > 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text
);
-- One live rate per category and unit. Replaced rates are kept, marked inactive.
create unique index benchmark_rate_live on public.benchmark_rate (lower(category), unit) where active;

-- Price bands: the range an individual Xpert is expected to charge. ----------------
create table public.price_band (
  id            uuid primary key default gen_random_uuid(),
  xpert_id      text not null,
  category      text not null,
  min_ghs       numeric(12,2) not null check (min_ghs > 0),
  max_ghs       numeric(12,2) not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id),
  change_reason text,
  check (max_ghs >= min_ghs)
);
create unique index price_band_live on public.price_band (xpert_id, lower(category)) where active;

-- Requests: what an employer asks for. -----------------------------------------------
create table public.job_request (
  id                   uuid primary key default gen_random_uuid(),
  employer_id          text,
  employer_name        text not null,
  employer_phone       text not null,
  category             text not null,
  description          text not null,
  location             text not null,
  timing               text not null,
  special_requirements text,
  photos               jsonb not null default '[]'::jsonb,
  status               text not null default 'new'
                       check (status in ('new', 'quoted', 'accepted', 'declined', 'expired', 'cancelled')),
  source_task_id       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id),
  change_reason        text
);
create index job_request_status_idx on public.job_request (status, created_at desc);

-- Quotes: one request can have several over time; at most one is live (sent). -----------
create table public.quote (
  id              uuid primary key default gen_random_uuid(),
  request_id      uuid not null references public.job_request (id),
  version         integer not null check (version >= 1),
  status          text not null default 'draft'
                  check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'withdrawn')),
  total_ghs       numeric(12,2) not null check (total_ghs > 0),
  lines           jsonb not null,
  notes           text,
  composed_by     uuid references auth.users (id),
  sent_at         timestamptz,
  valid_until     timestamptz,
  responded_at    timestamptz,
  response_source text check (response_source in ('employer', 'staff_logged')),
  response_note   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id),
  change_reason   text,
  unique (request_id, version)
);
create unique index quote_one_open_per_request on public.quote (request_id) where status in ('draft', 'sent');
create index quote_valid_until_idx on public.quote (valid_until) where status = 'sent';

-- Payments: created when the employer accepts. The console records state only; no
-- money moves through it. Release to the Xpert is built in Phase 4. -----------------------
create table public.payment (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references public.job_request (id),
  quote_id       uuid not null references public.quote (id),
  amount_ghs     numeric(12,2) not null check (amount_ghs > 0),
  method         text not null default 'momo' check (method in ('momo')),
  status         text not null default 'pending' check (status in ('pending', 'received', 'released', 'refunded')),
  momo_reference text,
  received_at    timestamptz,
  recorded_by    uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id),
  change_reason  text,
  unique (quote_id)
);
-- A MoMo reference can be used once, so a payment cannot be counted twice.
create unique index payment_momo_reference_key on public.payment (lower(momo_reference)) where momo_reference is not null;

-- Request status changes and a quote response happen together, so they are done in
-- one function. Called by the API only. ---------------------------------------------------
create or replace function public.quote_apply_response(
  p_quote_id uuid, p_expected_status text, p_response text, p_source text, p_note text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q public.quote%rowtype;
  r_status text;
  new_req text;
  pay_id uuid;
begin
  select * into q from public.quote where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if q.status <> p_expected_status then
    raise exception 'This quote is now %. Reload and try again.', q.status using errcode = '40001';
  end if;
  if p_response not in ('accepted', 'declined', 'expired') then raise exception 'Bad response'; end if;
  new_req := p_response;
  select status into r_status from public.job_request where id = q.request_id for update;
  if r_status <> 'quoted' then
    raise exception 'The request is %, not waiting on a quote.', r_status using errcode = '40001';
  end if;

  update public.quote set status = p_response, responded_at = now(),
         response_source = case when p_response = 'expired' then null else p_source end,
         response_note = p_note, updated_by = p_actor, change_reason = 'Quote ' || p_response
   where id = q.id;
  update public.job_request set status = new_req, updated_by = p_actor, change_reason = 'Quote ' || p_response
   where id = q.request_id;
  if p_response = 'accepted' then
    insert into public.payment (request_id, quote_id, amount_ghs, updated_by, change_reason)
    values (q.request_id, q.id, q.total_ghs, p_actor, 'Created on acceptance') returning id into pay_id;
  end if;
  return jsonb_build_object('quote', q.id, 'request_status', new_req, 'payment', pay_id);
end $$;
revoke execute on function public.quote_apply_response(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Sending and withdrawing a quote also change the request, so they are one step each. -------------
create or replace function public.quote_send(p_quote_id uuid, p_valid_days integer, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q public.quote%rowtype;
  r_status text;
  until_ts timestamptz := now() + make_interval(days => p_valid_days);
begin
  select * into q from public.quote where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if q.status <> 'draft' then raise exception 'This quote is already %.', q.status using errcode = '40001'; end if;
  select status into r_status from public.job_request where id = q.request_id for update;
  if r_status <> 'new' then raise exception 'The request is %, so a quote cannot be sent.', r_status using errcode = '40001'; end if;
  update public.quote set status = 'sent', sent_at = now(), valid_until = until_ts, updated_by = p_actor, change_reason = 'Quote sent' where id = q.id;
  update public.job_request set status = 'quoted', updated_by = p_actor, change_reason = 'Quote sent' where id = q.request_id;
  return jsonb_build_object('quote', q.id, 'valid_until', until_ts);
end $$;

create or replace function public.quote_withdraw(p_quote_id uuid, p_reason text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q public.quote%rowtype;
begin
  select * into q from public.quote where id = p_quote_id for update;
  if not found then raise exception 'Quote not found' using errcode = 'P0002'; end if;
  if q.status not in ('draft', 'sent') then raise exception 'This quote is already %.', q.status using errcode = '40001'; end if;
  update public.quote set status = 'withdrawn', response_note = p_reason, responded_at = now(), updated_by = p_actor, change_reason = p_reason where id = q.id;
  if q.status = 'sent' then
    update public.job_request set status = 'new', updated_by = p_actor, change_reason = 'Quote withdrawn: ' || p_reason where id = q.request_id and status = 'quoted';
  end if;
  return jsonb_build_object('quote', q.id);
end $$;
revoke execute on function public.quote_send(uuid, integer, uuid), public.quote_withdraw(uuid, text, uuid) from public, anon, authenticated;

-- Quote validity, in days. Decided: three days. -----------------------------------------------
insert into public.console_config (key, value, pending, note) values
  ('quotes.validityDays', '3'::jsonb, false, 'Decided: a sent quote is valid for three days, then it expires.')
on conflict (key) do nothing;

-- Permissions -------------------------------------------------------------------------------------
-- Quote composing is held by every role that can see the dashboard. Recording a payment
-- arriving is for finance. quotes.signoff stays as it was: no approval step was asked for.
insert into public.role_permission (role, permission) values
  ('ops_reviewer',     'quotes.compose'),
  ('decision_maker',   'quotes.read'),
  ('decision_maker',   'quotes.compose'),
  ('finance_approver', 'quotes.compose'),
  ('finance_approver', 'payments.record'),
  ('super_admin',      'payments.record')
on conflict (role, permission) do nothing;

-- Standard conventions -----------------------------------------------------------------------------
create trigger benchmark_rate_touch before update on public.benchmark_rate for each row execute function public.touch_updated_at();
create trigger price_band_touch     before update on public.price_band     for each row execute function public.touch_updated_at();
create trigger job_request_touch    before update on public.job_request    for each row execute function public.touch_updated_at();
create trigger quote_touch          before update on public.quote          for each row execute function public.touch_updated_at();
create trigger payment_touch        before update on public.payment        for each row execute function public.touch_updated_at();

create trigger benchmark_rate_audit after insert or update on public.benchmark_rate for each row execute function public.audit_row_change('id');
create trigger price_band_audit     after insert or update on public.price_band     for each row execute function public.audit_row_change('id');
create trigger job_request_audit    after insert or update on public.job_request    for each row execute function public.audit_row_change('id');
create trigger quote_audit          after insert or update on public.quote          for each row execute function public.audit_row_change('id');
create trigger payment_audit        after insert or update on public.payment        for each row execute function public.audit_row_change('id');

create trigger benchmark_rate_no_delete before delete on public.benchmark_rate for each row execute function public.block_hard_delete();
create trigger price_band_no_delete     before delete on public.price_band     for each row execute function public.block_hard_delete();
create trigger job_request_no_delete    before delete on public.job_request    for each row execute function public.block_hard_delete();
create trigger quote_no_delete          before delete on public.quote          for each row execute function public.block_hard_delete();
create trigger payment_no_delete        before delete on public.payment        for each row execute function public.block_hard_delete();

alter table public.benchmark_rate enable row level security;
alter table public.price_band     enable row level security;
alter table public.job_request    enable row level security;
alter table public.quote          enable row level security;
alter table public.payment        enable row level security;

create policy benchmark_rate_read on public.benchmark_rate for select to authenticated using (public.has_permission('quotes.read') or public.has_permission('benchmarks.edit'));
create policy price_band_read     on public.price_band     for select to authenticated using (public.has_permission('quotes.read') or public.has_permission('pricing.bands.edit'));
create policy job_request_read    on public.job_request    for select to authenticated using (public.has_permission('quotes.read'));
create policy quote_read          on public.quote          for select to authenticated using (public.has_permission('quotes.read'));
create policy payment_read        on public.payment        for select to authenticated using (public.has_permission('quotes.read'));

revoke all on public.benchmark_rate, public.price_band, public.job_request, public.quote, public.payment from anon, authenticated;
grant select on public.benchmark_rate, public.price_band, public.job_request, public.quote, public.payment to authenticated;

commit;
