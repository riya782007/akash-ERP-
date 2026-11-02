# Operating and deployment guide

## Local use

1. Install Node.js 24 from the official distribution.
2. Start `npm run demo` for demonstration, or set a strong `ERP_ADMIN_PASSWORD` and run `npm start` for a clean database.
3. Open the printed localhost URL. Live username is `owner` on first setup.
4. Keep the terminal/server running. All clients talk to the same server, not browser-local storage.

A prepared local preview may use port 4311 instead of the default 4310. It is not a publicly hosted site. If the preview is stopped, use `npm run demo` and open the URL it prints.

## Production packaging

A Dockerfile is included. It runs Node as a non-root user, exposes port 4310 and expects `/app/data` to be a durable volume. Supply `ERP_ADMIN_PASSWORD` through your deployment's secret manager on first start. Do not bake it into the image. Use a single replica; do not put SQLite on an ephemeral or unreliable shared filesystem.

Build: `docker build -t mehers-erp .`

Run behind an HTTPS reverse proxy on an approved host, with a persistent volume at `/app/data`, `ERP_SECURE_COOKIE=1`, and the application port restricted to the proxy. Hostname, TLS, persistent-volume ownership, backup destination and monitoring must be configured on the selected host. No hosting account or production domain was selected for this repository handoff. The Docker image was supplied as configuration; it has not been built in this environment.

This Node/SQLite runtime is not a static site and cannot be deployed unchanged to GitHub Pages or a Cloudflare Worker. Do not publish the frontend alone and imply its API is live.

## Backup and recovery

Run `npm run backup` with `ERP_DB` set to the intended database. The command uses the SQLite online backup API, refuses an existing destination and validates the result with `PRAGMA integrity_check`. Its default destination is a new file in `data/backups/`.

Schedule it daily on the deployment host and copy verified snapshots to encrypted offsite storage with retention and failure alerts. Those external schedules and credentials are not configured here. Treat employee, customer and device data as confidential.

To restore: stop the application; take a separate backup of the current state; copy the chosen verified snapshot to a **new** database filename; set `ERP_DB` to that filename; start the server; verify counts and trial balance before admitting users. This avoids overwriting the original database or mixing its WAL files with restored data. Test restoration using a separate instance before live handover.

## Before production billing

Confirm legal entity name and GSTIN; approve invoice numbering/format, tax calculations and credit-note treatment with the client's accountant. Configure and test the actual printer/scanner. Enter verified opening stock, account balances, customer/staff advances and employee policies. Confirm return rules, device ownership checks and service approval evidence. Verify each real role against the permission matrix. Create owner recovery procedures and test a backup restore.

## Daily routine

Open the workspace, check team attendance and low stock, receive purchase units, bill from the main store, and record expenses at the time incurred. Service jobs progress through diagnosis and customer approval; collect payment before handover. Exchange and returned phones remain unsaleable until inspected. At closing, count physical cash and explain discrepancies before locking the day. The application prevents backdated financial entries; there is no UI to reopen a closed day in v1.
