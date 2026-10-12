-- 0007_remove_quote_signoff.sql
-- NOT APPLIED. Changes data only, and only by revoking grants. No table or column is touched.
--
-- Decision: finance sign off for quotes above an Xpert's price band is intentionally not part of this
-- product. The quotes.signoff permission was never used by any route. It is gone from the shared package,
-- the role defaults, the API and the Roles screen. This revokes the rows that granted it.
--
-- The rows are revoked (granted = false), not deleted, because the console never hard deletes and the
-- database blocks it. The API only reads permissions it still knows, so the revoked rows are inert and
-- do not appear on the Roles screen. The change is audited like any other role permission edit.
-- Quote composing (quotes.compose) is untouched: every role that can see the dashboard keeps it.

begin;

update public.role_permission
   set granted = false,
       change_reason = 'Finance sign off for quotes is not part of this product (decision recorded in docs/PHASE3.md)'
 where permission = 'quotes.signoff'
   and granted;

commit;
