# Phase 3: requests, quotes, pricing and payments

Status: built and tested. Not deployed. Migration 0003 is waiting to be shown and run.

## Decisions applied

- Quote composing: every role that can see the dashboard (operations reviewer, decision maker, finance approver, super admin). A super admin can still remove it from a role on the Roles screen. The "decision pending" marker is gone.
- Finance sign off above a price band: not needed, so there is no approval step. The `quotes.signoff` permission still exists and nothing uses it. Remove it later if it stays unused.
- Quote validity: three days, kept in Settings so it can change without a release.
- Payment method: MoMo only.

## What was built

**Requests.** A request has category, description, photos, location, timing and special requirements. Staff can enter one taken by phone. The main site can write the same table. Statuses: New, Quote sent, Accepted, Declined, Quote expired, Cancelled. The legal moves live in one table (`packages/shared/src/requests.ts`) and anything else is refused.

**Quotes.** Staff prepare a quote from lines that must add up to the total, with the benchmark rates for the category beside them and a one tap Use. A draft can be edited until it is sent. Sending makes it valid for three days and moves the request to Quote sent in one database step. The employer can only accept or decline. Until the main site records that itself, staff log the employer's answer. A sent quote can be withdrawn, which returns the request to New. Each new quote is the next version, and every version is kept. Expired quotes close on their own in the hourly sweep.

**Payment.** Accepting a quote creates a payment record waiting for MoMo. Finance records the MoMo reference when it arrives. A reference can only be recorded once, so the same payment cannot be counted twice. Released to the Xpert is reserved for Phase 4, when both sides confirm the job is done. The console records state only. No money moves through it.

**Pricing.** Benchmark rates per category and unit, and price bands per Xpert. A change replaces the live value and keeps the old one marked replaced. Nothing is deleted.

**Also.** Dashboard counts (new requests, quotes out, payments to record). Quote validity in Settings. New permission `payments.record` for finance and super admin.

## Migration 0003 (shown, not run)

New tables `benchmark_rate`, `price_band`, `job_request`, `quote`, `payment`. Touches no existing table. One open quote per request, one live rate per category and unit, one live band per Xpert and category, and one payment per quote are enforced by the database. Tested on Postgres 16.

## Skipped on purpose

- **The link to the old task table.** The existing task form is replaced by the request form on the main site later. The column that links them can be added when that work starts.
- **Notifying the employer** that a quote is ready. The console has no way to send messages yet. The `recipient_id` column on `notifications` is not added, because that table is not confirmed in the schema export yet.
- **Checking a quote against an Xpert's price band.** No rule was asked for. Bands are recorded and shown for reference. The check belongs in Phase 4 when an Xpert is matched.
- **Refunds.** The status exists, but there is no screen until the rule for when a refund is due is decided.

## Assumed

- Request categories are free text that must match the benchmark category to show its rates. The existing category list was not available.
- Amounts are in Ghana cedis, to two decimal places.
- Staff logging the employer's answer is allowed for anyone who can compose quotes.

## Questions still open

1. When is a refund due, and who approves it?
2. Should an employer be told by SMS or email that a quote is ready, and from where?
3. The existing category list, so benchmark categories can be chosen from it.

## Tested

- API: 112 tests in total. The new ones cover who may do what, the quote and payment rules, expiry, withdrawal, cancellation, duplicate MoMo references and pricing.
- Migration 0003: applied after 0001 and 0002a on Postgres 16, with checks for the one open quote rule, acceptance creating a payment, stale answers refused, duplicate MoMo references refused, blocked deletes and the grants.
- Browser walkthrough on desktop and phone width against the real API code with sample data: new request, draft, send, accept, record payment, pricing, withdraw, settings. No console or network errors.
- Not tested against the real Supabase project.
