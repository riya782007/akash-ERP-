# Operating and deployment guide

## Local use

1. Install Node.js 24 from the official distribution.
2. Run `npm install`, then `npm run demo` for demonstration, or set a strong `ERP_ADMIN_PASSWORD` and run `npm start` for a clean database.
3. Open the printed localhost URL. Live username is `owner` on first setup.
4. Keep the terminal/server running. All clients talk to the same server, not browser-local storage.

A prepared local preview may use port 4311 instead of the default 4310. It is not a publicly hosted site. If the preview is stopped, use `npm run demo` and open the URL it prints.

## Production deployment

Use Vercel + Supabase as described in [DEPLOY.md](DEPLOY.md). The Dockerfile remains as an alternative host for the same code; it also needs `DATABASE_URL`.

## Backup and recovery

Run `DATABASE_URL=… npm run backup`. It exports every ERP table to a new JSON file in `data/backups/` and refuses to write if the ledger does not balance. Schedule it (for example weekly from a trusted machine) and keep copies encrypted and offsite; Supabase paid plans additionally keep daily backups and point-in-time recovery. Treat employee, customer and device data as confidential.

To restore, create a fresh Supabase project (or branch), point a local `npm start` at it with `DATABASE_URL` so the schema is created, import the JSON tables in dependency order (users, products, units, employees, documents, then the rest), and verify counts and the trial balance before switching Vercel's `DATABASE_URL`. Rehearse this once before live handover.

## Before production billing

Confirm legal entity name and GSTIN; approve invoice numbering/format, tax calculations and credit-note treatment with the client's accountant. Configure and test the actual printer/scanner. Enter verified opening stock, account balances, customer/staff advances and employee policies. Confirm return rules, device ownership checks and service approval evidence. Verify each real role against the permission matrix. Create owner recovery procedures and test a backup restore.

## Daily routine

Open the workspace, check team attendance and low stock, receive purchase units, bill from the main store, and record expenses at the time incurred. Service jobs progress through diagnosis and customer approval; collect payment before handover. Exchange and returned phones remain unsaleable until inspected. At closing, count physical cash and explain discrepancies before locking the day. The application prevents backdated financial entries; there is no UI to reopen a closed day in v1.
