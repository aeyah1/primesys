# PRimeSys

Web-based procurement monitoring system for NEMSU Cantilan Campus. Tracks the full lifecycle: purchase requests → TWG review → canvass & award → PO issuance → delivery. How it works in plain language: [docs/flow.md](docs/flow.md); the technical overview is [docs/overview.md](docs/overview.md).

## Stack

- **Frontend:** React 18, Vite, Tailwind, Radix UI, TanStack Query, Socket.IO client
- **Backend:** Node.js + Express, Socket.IO, MySQL2 (raw SQL, no ORM)
- **Auth:** JWT (7d), bcrypt, per-account lockout, email verification
- **Email:** Nodemailer + Gmail App Password

## Prerequisites

- Node.js 18+
- MariaDB 10.4+ (XAMPP) or MySQL 8+
- A Gmail account with an [App Password](https://myaccount.google.com/apppasswords) for sending verification emails

## Setup

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/primesys.git
cd primesys

cd server && npm install
cd ../client && npm install
```

### 2. Create the database

Start MySQL in the XAMPP Control Panel, then import `database/schema.sql`. That one file creates the `primesys` database, every table, the admin account, the current year's quarters, and the organization settings keys.

- **phpMyAdmin:** open http://localhost/phpmyadmin, go to **Import**, choose `database/schema.sql`, click **Import**.
- **Command line:**

  ```bash
  mysql -u root -p < database/schema.sql
  # XAMPP (root has no password):
  C:\xampp\mysql\bin\mysql.exe -u root < database\schema.sql
  ```

`schema.sql` already includes every migration in `server/db/`, so a fresh install needs nothing else. Do not run those migrations after it.

**Upgrading a database created from an older `schema.sql`:** apply the migrations your database is missing, in this order instead.

Legacy migrations, only for databases created before May 2026 (in `server/db/legacy/`):

```bash
cd server/db/legacy
mysql -u root -p primesys < add_user_columns.sql
mysql -u root -p primesys < add_verification.sql
mysql -u root -p primesys < create_reset_tokens.sql
mysql -u root -p primesys < add_missing_tables.sql
mysql -u root -p primesys < add_attachments.sql
mysql -u root -p primesys < add_reminders.sql
mysql -u root -p primesys < add_po_status.sql
mysql -u root -p primesys < add_department_codes.sql
mysql -u root -p primesys < create_org_settings.sql
mysql -u root -p primesys < add_indexes.sql
mysql -u root -p primesys < add_pr_reads.sql
```

Then the current ones (in `server/db/`):

```bash
cd server/db
mysql -u root -p primesys < add_lot_supplier_fields.sql
mysql -u root -p primesys < add_twg_role.sql
mysql -u root -p primesys < add_pr_category.sql
mysql -u root -p primesys < add_rejected_status.sql
mysql -u root -p primesys < rename_extension_to_requestor.sql
mysql -u root -p primesys < add_user_approval.sql
mysql -u root -p primesys < add_quarter_budget.sql
mysql -u root -p primesys < add_pr_soft_delete.sql
mysql -u root -p primesys < add_po_cancellation.sql
mysql -u root -p primesys < drop_user_supplier_id.sql
mysql -u root -p primesys < add_token_version.sql
mysql -u root -p primesys < add_twg_assignments.sql
mysql -u root -p primesys < widen_lot_item_name.sql
mysql -u root -p primesys < add_multi_supplier.sql
mysql -u root -p primesys < add_delivery_items.sql
mysql -u root -p primesys < drop_user_approval.sql
mysql -u root -p primesys < add_appendix60_fields.sql
mysql -u root -p primesys < add_departments.sql
mysql -u root -p primesys < add_nemsu_forms.sql
mysql -u root -p primesys < add_procurement_mode.sql
mysql -u root -p primesys < add_bac.sql
mysql -u root -p primesys < add_bac_evaluation.sql
mysql -u root -p primesys < add_supplier_rfq.sql
mysql -u root -p primesys < add_quotation_schedule.sql
mysql -u root -p primesys < add_quote_revisions.sql
mysql -u root -p primesys < add_award_notices.sql
mysql -u root -p primesys < add_short_delivery.sql
mysql -u root -p primesys < add_supplier_links.sql
mysql -u root -p primesys < add_rfq_declined.sql
mysql -u root -p primesys < add_fund_administrator.sql
mysql -u root -p primesys < add_ppmp.sql
mysql -u root -p primesys < add_item_category.sql
mysql -u root -p primesys < add_pr_ppmp_link.sql
mysql -u root -p primesys < canvass_outside.sql
mysql -u root -p primesys < add_pr_requester_signature.sql
mysql -u root -p primesys < add_ppmp_withdraw.sql
mysql -u root -p primesys < add_twg_certificates.sql
mysql -u root -p primesys < add_canvass_bids.sql
mysql -u root -p primesys < add_bid_evaluation.sql
mysql -u root -p primesys < add_ppmp_quarters.sql
node fill_ppmp_quarters.js
mysql -u root -p primesys < add_ppmp_changes.sql
mysql -u root -p primesys < add_twg_review_certificate.sql
mysql -u root -p primesys < add_pr_delete_reason.sql
```

Apply only the ones your database is missing. The last ten need MariaDB (XAMPP); several of the earlier ones are one-shot `ALTER`s that fail if run twice. `add_user_columns.sql`, `add_missing_tables.sql`, and `add_twg_role.sql` would erase the `requestor` and `twg` roles on a newer database, so they stop with an error and change nothing when the database already has either role.

### 3. Configure environment

```bash
# Server
cp server/.env.example server/.env
# Edit server/.env — set DB_PASSWORD, MAIL_USER, MAIL_PASS
# Generate a JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Client
cp client/.env.example client/.env
```

### 4. Sign in as admin

`schema.sql` creates the admin account. Default login: **username** `admin` / **password** `Admin@1234`.
**Change this password immediately after first login** (Settings > Security).

The admin's email is the placeholder `admin@example.com`, and the app has no screen to change an email. Before importing, replace it in `schema.sql` (and in `reset_data.sql`) with the address that should get the admin's password-reset emails.

### 5. Run

```bash
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend
cd client && npm run dev
```

Open http://localhost:5173.

### 6. Run the tests

```bash
cd server && npm test            # every suite
cd server && npm test -- workflow  # only files whose name contains "workflow"
```

The tests need the local MariaDB running (XAMPP, `root` with no password, or set `TEST_DB_USER` / `TEST_DB_PASSWORD` / `TEST_DB_HOST` / `TEST_DB_PORT`). Each suite builds its own throwaway database from `database/schema.sql` (named `primesys_*_test_tmp`), boots the real server against it with email sending stubbed, and drops it afterwards. They never read or change the `primesys` database, and they refuse any database name that doesn't end in `_test_tmp`.

## Roles

`admin`, `procurement`, `requestor`, `supply`, `twg` — each with its own dashboard. Public sign-up is for NEMSU faculty and staff (NEMSU email addresses only, `ALLOWED_EMAIL_DOMAINS`) and always creates a Requestor (after email verification); the server ignores any role in the request. Every other role is assigned by an admin in User Management.

## PR Lifecycle

`draft → submitted → twg_review → bidding → for_po → completed`

- TWG reviews every submitted PR: approve (`twg_review`), send back for changes (`revision_requested`), or reject (`rejected`).
- Each TWG member reviews only the categories an admin assigns them (review areas, set in User Management). A PR goes to the reviewers of its category, and any one of them decides. If no active TWG member covers a category, admins are notified and the admin dashboard shows a warning. `add_twg_assignments.sql` gives every existing TWG member all areas.
- A PR's items and details are locked for every role once it is submitted. To get an approved PR changed, Procurement returns it for revision (a reason is required) before any supplier is awarded; the requestor edits it and it goes through the TWG again.
- Canvass: the BAC types in each supplier's quotation (a unit price per PR item, from the canvasser's returned RFQs) and sends them to the TWG, which marks each bid compliant or non-compliant (with the reason) and certifies them. The BAC then awards each lot (a section of the PR's items; a PR without sections is one lot) to one supplier that bid on all of it, by default the lowest total of the bidders compliant on the whole lot; a supplier the TWG found non-compliant on any of the lot's items can't be awarded it. Each supplier's awards get their own purchase order, whose supplier and total come from the awards on the server. An award can't exceed the approved budget (the PR's estimate) of its items. An item no one can supply can be dropped, with a reason, and the BAC can take a certified canvass back to correct bids or add new quotations.
- A PR stays in `bidding` while any item needs an award (a supplier's PO can already be out for the others), moves to `for_po` once every item is awarded or dropped, and to `completed` once every PO is fully delivered. Cancelling a supplier's PO (before delivery) cancels only its awards; their items go back to canvass.
- Procurement or admin can cancel a PR while it has no active PO (`cancelled`); its awards are cancelled with it. While the TWG has it (`submitted`, `revision_requested`), only an admin can cancel or delete it.
- A PR can be deleted only until its canvass starts (`bidding`, `twg_certification`, `bac_review` and later are cancelled instead). Deleting someone else's PR needs a reason; it is logged, kept on the PR, and whoever filed it is told, with the TWG reviewers of its area or Procurement when it was in their queue.
- Completed, rejected, cancelled and deleted PRs stay in the Archive.

Offices: each department carries the head who signs "Requested by" on the printed form, set in Settings > Organization. A person encodes for one office (User Management); the PR freezes that office's head when it is filed, so a later change of chair never rewrites PRs already on record.

Source of fund: every request is drawn on STF, GAA or IGP. Each source's code is set in Settings > Organization and frozen onto the request when it is filed, so the code printed on the form is the one that applied that day.

Who approves: at or below the threshold in Settings > Organization (₱50,000 by default) the Campus Director signs the form; above it, the University President.

Documents produced: Purchase Request (COA Appendix 60), Request for Quotation (one page per lot, the two price columns left blank for the supplier), Abstract of Quotations, Purchase Order, Inspection and Acceptance Report.

PR numbers: `{prefix} {year}-{sequence}`, e.g. `CSO 2026-001`, matching the campus's printed
Purchase Request form (Appendix 60). The prefix is set in Settings > Organization and the
sequence runs per calendar year. PRs numbered before this format keep their old numbers.

## Project Structure

```
primesys/
  client/              React SPA (Vite)
    src/
      pages/           Route components
      components/      Shared UI
      context/         Auth context
      lib/             axios, utils
  server/              Express API
    routes/            Route definitions
    controllers/       Request handlers
    middleware/        auth, authorize, validate
    db/                MySQL pool + migration SQL
    emails/            HTML email templates
    utils/             mailer, upload, helpers
  database/
    schema.sql         Complete database for a fresh install (import this)
    reset_data.sql     Wipe all data and restore the default admin
    clear_records.sql  Clear requests, PPMPs and notifications; keep users, offices, quarters, settings
```

## Security Notes

- JWT (HS256, 7 days) secret must be 32+ chars. Rotating it logs everyone out. Each request uses the account's current role and active status from the database (cached 30 s), not the role in the token, so role changes and deactivation apply at once.
- Sign-up: NEMSU email domains only (`ALLOWED_EMAIL_DOMAINS`; add `gmail.com` to the list for a demo, or `*` for any while testing); requestor only; any extra field (`role`, `is_verified`, …) is refused; hidden honeypot field; optional Cloudflare Turnstile check (`CAPTCHA_ENABLED`).
- Passwords: at least 8 characters (new passwords only), bcrypt cost 10.
- Sign-in: unknown accounts and wrong passwords get the same reply in the same time; account state is only shown after the right password.
- Limits (defaults, all configurable in `server/.env`, see `.env.example`):

  | What | Limit |
  |---|---|
  | Registrations | 10 per IP per hour |
  | Failed sign-ins | 30 per IP per 15 min |
  | Failed sign-ins on one account | locked after 5; 2 min, doubling on repeat up to 30 min; a password reset clears it |
  | Verification / reset emails | 5 requests per IP per hour, and at most one email per account every 2 min |
  | All API | 300 req/15 min per signed-in user (1,000 per IP otherwise); writes 100 per user (300 per IP) |

- Changing or resetting a password (including an admin setting a new one) signs the account out on every other device: tokens carry the account's `token_version`, which the change raises.
- Uploads (PDF, JPG, PNG, WEBP, Word, Excel; 10 MB) must match on extension, reported type, and file signature; files are stored under random names and downloaded only through authenticated, scoped routes.
- Reminders: requestors can remind only themselves; other staff can remind staff, or the requestor of a linked PR; linked PRs and lots must be in the user's scope; at most `REMINDER_DAILY_LIMIT` (20) per user per day.
- Every write is validated against its column (amounts, quantities, dates, text lengths), and database connections run in strict SQL mode, so nothing is silently cut or zeroed.
- Records are scoped per role and owner on the server; an out-of-scope record returns 404.
- Security events (sign-ins, lockouts, registrations, resets, role and status changes) are logged as `[security]` lines, without passwords or tokens.
- Helmet enabled, CORS locked to `CLIENT_URL`.

## License

Private project — not licensed for redistribution.
