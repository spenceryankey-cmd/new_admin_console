# Phase 8: Support inbox and Send a notification

Status: console side built and tested. The link to the main site is **not** written, because the main site's tables were not confirmed. Until it is, both pages open and say "not connected" instead of showing nothing.

## What was built

**Support inbox** (`/inbox`). Staff see messages from employers and Xperts, newest first, with a Needs attention list by default. Each message can be marked handled with a short note on what was done, and reopened. The messages themselves are never edited or deleted. Anything that looks like an ID number is hidden before it reaches the screen (the same sensitive field rules as the rest of the console).

**Send a notification** (`/notifications`). Choose who: one Xpert, one employer, all Xperts, all employers, or Xperts in one of the ten categories. Write the message (3 to 500 characters). The console first shows how many people it would reach (preview). Sending needs the number to be confirmed, and if the audience changed since the preview nothing is sent. Every send is recorded in a log with who sent it, to whom, how many were reached and how many were delivered. One person can send 10 an hour.

**Database (0012).** `inbox_state` (open or handled, note, who, when) and `notification_send` (the send log). Both have the audit trigger, row level security, and no hard delete. Permissions `inbox.read`, `inbox.handle` and `notifications.send` are added.

**Who can do what (defaults, can be changed in Staff roles).** Operations reviewers and decision makers can read and handle the inbox. Only decision makers and super admins can send notifications.

## The two ports the main site must fill

The console does not guess the main site's tables. It talks to two small interfaces in `apps/api/src/inbox/inbox.ports.ts`.

1. `InboxSource.recent(limit)` returns the latest support messages. The main site already has a `support_messages` table (it is mentioned in FOR_JAMES item 12). The console needs a **read only** database user for it, the same pattern as `console_reader` for the Xpert records. Needed from the main site: the table name and columns (id, sender kind, sender id, sender name, subject, body, created time).
2. `NotificationSink.resolve(audience)` and `deliver(recipients, body)` put a message in the bell on the Xpert and employer dashboards. Needed from the main site: how bell notifications are stored (table, who they belong to, read flag) and a write path the console may use. Preferably a small function or endpoint on the main site, so the console never writes into its tables directly.

Until both exist, the default providers answer with a 503 and the message "This is not connected to the main site yet."

## Not built

- SMS log (8C). No provider or log table was confirmed, so there is nothing honest to show.
- Replies to messages, assignees and threads.
- The inbox reads the latest 1000 messages and filters them in memory.
- Sending to one Xpert or employer needs the ID typed in; there is no search box yet.

## Tests

Shared (94), API (inbox 20 plus route access and sensitive field crawl), web (40), and `scripts/db/test_0012.sql` in CI. 0012 has not been applied to any real database. Apply it as step 3.7 of `docs/APPLY_CHECKLIST.md`.
