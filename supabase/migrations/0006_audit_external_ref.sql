-- 0006_audit_external_ref.sql
-- NOT APPLIED. Additive only.
--
-- Xpert status changes now happen in the hetzner database, which writes its own audit row. The console copies
-- that row into this audit log so the Audit screen shows everything in one place. The copy carries the hetzner
-- row's unique key in metadata.external_ref, and this index makes a second copy of the same change impossible,
-- so a retry or the hourly repair can never double count.

begin;

create unique index if not exists audit_log_external_ref_idx
  on public.audit_log ((metadata ->> 'external_ref'))
  where metadata ? 'external_ref';

commit;
