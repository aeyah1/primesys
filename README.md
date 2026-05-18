# PRimeSys

Web-based procurement management system. Tracks the full lifecycle: purchase requests → bidding → PO issuance → delivery.

## Stack

- **Frontend:** React 18, Vite, Tailwind, Radix UI, TanStack Query, Socket.IO client
- **Backend:** Node.js + Express, Socket.IO, MySQL2 (raw SQL, no ORM)
- **Auth:** JWT (7d), bcrypt, per-account lockout, email verification
- **Email:** Nodemailer + Gmail App Password

## Prerequisites

- Node.js 18+
- MySQL 8+
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

```bash
mysql -u root -p -e "CREATE DATABASE primesys CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p primesys < database/schema.sql
```

Then apply the migrations in `server/db/` in this order:

```bash
cd server/db
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

### 4. Seed the default admin

```bash
cd server
node seed.js
```

Default login — **username:** `admin` / **password:** `Admin@2026`
**Change this password immediately after first login.**

### 5. Run

```bash
# Terminal 1 — backend
cd server && npm run dev

# Terminal 2 — frontend
cd client && npm run dev
```

Open http://localhost:5173.

## Roles

`admin`, `procurement`, `extension`, `supply` — each with its own dashboard.

## PR Lifecycle

`draft → submitted → bidding → for_po → completed` (or `cancelled`)

PR numbers: `PR-{year}-{quarter}-{sequence}`

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
    schema.sql         Base schema (run first)
    reset_data.sql     Wipe all transactional data
```

## Security Notes

- JWT secret must be 32+ chars. Rotating it logs everyone out.
- Login: 5 attempts → 2 min per-account lockout.
- Email send (verify/reset): 5 requests/hour/IP.
- All API: 150 req/15min/IP, write ops: 60 req/15min/IP.
- Helmet enabled, CORS locked to `CLIENT_URL`.

## License

Private project — not licensed for redistribution.
