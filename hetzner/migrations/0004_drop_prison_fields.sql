-- 0004_drop_prison_fields.sql (hetzner database)
-- NOT APPLIED. Run after 0001, 0002 and 0003.
--
-- BeyondX no longer works with prisons, so these four sensitive fields are not kept.
-- The Ghana Card columns stay. 0001 is not edited because it has already been shown.
-- Dropping a column is not a row delete, so the no-delete rules do not apply. The table's audit
-- trigger keeps recording changes to the rows that remain.

begin;

alter table xpert_restricted
  drop column prison_facility,
  drop column release_date,
  drop column offense_level,
  drop column offense_notes;

commit;
