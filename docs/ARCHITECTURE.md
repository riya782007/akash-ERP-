# Architecture

## Runtime and boundaries

On Vercel, `public/` is served as static files and `api/index.mjs` is a single serverless function; locally, `server/index.mjs` serves both. `server/db.mjs` owns the Postgres connection (Supabase via `postgres`, or embedded PGlite locally) and `server/schema.sql`, `server/operations.mjs` owns business commands and snapshot redaction, `server/app.mjs` owns HTTP authentication, sessions and transport controls, and `server/ai.mjs` owns optional AI assistance. `public/app.js` provides the UI. No third-party client runtime or external CDN is required.

Persistence is Supabase Postgres, reached through its transaction pooler (prepared statements disabled). Serverless instances may run concurrently; every write command takes a transaction-scoped advisory lock, so stock check-and-consume stays serialized exactly as before. Money columns are BIGINT paise. The schema is idempotent and applied on cold start; add versioned migrations before making breaking schema changes.

## Data model

- `products`: model/SKU, price, default cost, tax basis points and reorder level.
- `units`: physical item, unique nullable IMEI, product, condition, location, availability, actual acquisition cost.
- `documents`: immutable posted transaction headers and workflow data; service and credit statuses can advance.
- `sale_lines`: exact unit, historical price, discount and tax used by a sale.
- `movements`: source/destination of each operational stock movement.
- `ledger`: balanced debit/credit entries linked to a source document.
- `employees`, `attendance`: employee policy values and one daily attendance record.
- `users`, `sessions`: salted scrypt credentials, active state and hashed session tokens.
- `closings`: one IST business-date cash count and variance.
- `audit`: actor, action, reference and timestamp.
- `requests`: idempotent command results scoped to the initiating user.
- `settings`: store profile.
- `ai_requests`: per-day AI request cache and daily cap counter.
- `login_attempts`: login throttling by hashed client IP.

## Transaction invariants

Each command runs in a Postgres transaction holding `pg_advisory_xact_lock`, with rollback on any failure. The command validates role and closing state, validates inputs and current stock, writes the document, writes stock and accounting changes, records the audit event and stores the idempotent response. Repeat submission with the same request key returns the prior result without a second sale. The advisory lock serializes stock check-and-consume operations across all serverless instances (tested with simultaneous sales of the same handset).

The server derives sale prices and taxes from stored products; it never trusts a client-supplied invoice total. Payments plus applied credit must equal the bill total. Duplicate units and already-sold units are rejected. A returned unit is quarantined until inspection. A return validates original document membership and cannot reverse the same sale line twice. Product edits do not reprice historical invoices or change acquisition costs.

## Security controls and limits

Same-origin JSON POST requests; no permissive CORS. HttpOnly, SameSite=Strict, eight-hour session cookies. Secure cookies are automatic on Vercel/HTTPS. Credentials use random salts and scrypt. Session tokens are stored hashed; login failures are throttled per hashed IP in the database (shared across serverless instances). Row Level Security blocks Supabase's public Data API. Role checks happen on every command, and snapshots remove stock costs/payroll data from cashier responses and isolate the technician's service view. Disabled accounts lose sessions. Static file paths are allowlisted, not arbitrary disk paths. HTML derived from data is escaped. CSV cells beginning with spreadsheet formula characters are neutralized. Security headers and CSP disallow remote scripts and framing.

Local demo access is deliberately passwordless and restricted to loopback, including a Host check. Never expose it through a tunnel or proxy. No demo endpoint exists in live mode. Never put `DATABASE_URL` or `OPENAI_API_KEY` in client-side code or `NEXT_PUBLIC_`-style variables.

Limits: no MFA, no per-record technician assignment restriction, no field-level encryption, no external audit signing, no migration framework beyond initial schema, and no formal penetration test. Name-based credit matching is a v1 limitation. No absolute claim of “production secure” is made.

## Accounting scope

Sale: debit payment accounts/customer-credit liability; credit sales and configured output tax; debit cost of goods and credit inventory. Purchase: debit inventory at landed cost and credit the selected recorded payment account. No separate input-tax accounting or supplier credit terms. Customer advance: debit payment, credit liability. Staff advance: debit receivable, credit payment. Returns reverse the relevant original sale or purchase values. Salary recovery credits the specific outstanding staff-advance receivable. Lender settlement clears a finance receivable. Gifts consume inventory into promotional expense.

Purchases, expenses, advances, salaries and capital funding reject Finance as a tender. Finance is restricted to sales and return reversals; lender settlement clears it into a bank account.

## Scaling path

Preserve the command boundaries and move persistence behind repository interfaces; add versioned SQL migrations, stable party IDs, paginated APIs, transaction-level ledger browsing, append-only reversal documents and per-unit history screens. Then add durable background jobs for notifications, external payment reconciliation, offsite backup monitoring and synchronization. Avoid splitting into microservices before there is a real operational need.
