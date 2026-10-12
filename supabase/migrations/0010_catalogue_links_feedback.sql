-- 0010_catalogue_links_feedback.sql
-- NOT APPLIED. Run after 0009.
--
-- 1. Every category field in the console must be one of the ten categories (migration 0009).
--    The foreign keys are added NOT VALID: they are enforced for every new row and for every change to a category
--    straight away, and existing rows are not touched or rejected. The view catalogue_mismatches lists existing rows whose
--    category is not on the list, so a person can review them. Once that view is empty, run
--    alter table ... validate constraint ... to finish the job. Nothing is rewritten or deleted here.
-- 2. Structured feedback: fixed reasons, and the task type the job covered. A rating of 2 or lower must carry at
--    least one reason. Existing feedback stays valid.

begin;

alter table public.job_request       add constraint job_request_category_fk       foreign key (category) references public.service_category (label) not valid;
alter table public.job               add constraint job_category_fk               foreign key (category) references public.service_category (label) not valid;
alter table public.recurring_service add constraint recurring_service_category_fk foreign key (category) references public.service_category (label) not valid;
alter table public.benchmark_rate    add constraint benchmark_rate_category_fk    foreign key (category) references public.service_category (label) not valid;
alter table public.price_band        add constraint price_band_category_fk        foreign key (category) references public.service_category (label) not valid;

create view public.catalogue_mismatches as
select 'job_request' as table_name, id::text as row_id, category from public.job_request       where category not in (select label from public.service_category)
union all
select 'job',                        id::text,           category from public.job               where category not in (select label from public.service_category)
union all
select 'recurring_service',          id::text,           category from public.recurring_service where category not in (select label from public.service_category)
union all
select 'benchmark_rate',             id::text,           category from public.benchmark_rate    where category not in (select label from public.service_category)
union all
select 'price_band',                 id::text,           category from public.price_band        where category not in (select label from public.service_category);
revoke all on public.catalogue_mismatches from anon, authenticated;

-- Structured feedback ------------------------------------------------------------------------------------
alter table public.feedback add column reasons text[] not null default '{}';
alter table public.feedback add column task_type_code text references public.task_type (code);
alter table public.feedback add constraint feedback_reasons_known check (reasons <@ array[
  'quality_work', 'communicated_well', 'left_site_clean', 'followed_instructions',
  'poor_quality', 'poor_communication', 'left_site_dirty', 'ignored_instructions', 'safety_concern'
]::text[]);

create function public.feedback_validate() returns trigger
language plpgsql as $$
begin
  if (select count(distinct r) from unnest(new.reasons) r) <> cardinality(new.reasons) then
    raise exception 'A reason can only be chosen once.';
  end if;
  if new.rating <= 2 and cardinality(new.reasons) = 0 then
    raise exception 'A rating of 2 or lower needs at least one reason.';
  end if;
  if new.task_type_code is not null and not exists (
    select 1
      from public.job j
      join public.service_category c on c.label = j.category
      join public.task_type t on t.category_code = c.code
     where j.id = new.job_id and t.code = new.task_type_code
  ) then
    raise exception 'That task type does not belong to the job''s category.';
  end if;
  return new;
end $$;
create trigger feedback_validate_trg before insert or update of rating, reasons, task_type_code, job_id on public.feedback
  for each row execute function public.feedback_validate();

commit;
