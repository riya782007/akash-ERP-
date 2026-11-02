# Acceptance and verification

## Automated checks

Run `npm run check` and `npm test`. Each domain test uses an isolated in-memory database; HTTP tests use a temporary database and ephemeral localhost port. Test data never touches the live database.

Covered: atomic sale, bad split rollback, double selling, repeated line rejection, idempotent retries, split ledgers, linked return and quarantine, wrong-invoice return, duplicate IMEI rollback, supplier return, exchange settlement, opposite advance directions, closing lock, role checks and redaction, service order/payment gate, location-aware availability, duplicate payroll, gift expense, attendance uniqueness, invalid money, salted password hashing, deposit redemption, wrong-customer credit, full exchange-credit sale, payroll advance recovery, lender over-settlement, historical pricing and used-device inspection.

HTTP checks cover session access, cookie flags, static assets, disallowed disk paths, cross-origin rejection, required request key, repeat submission, invalid login and logout invalidation.

## Browser acceptance walkthrough

- Load demo and inspect the dashboard on desktop and compact layouts.
- Open new sale, select a stock item, enter a test customer and split Cash/UPI tender. Confirm a saved receipt, exact payment breakdown, increased sales and reduced stock.
- Search the saved invoice and open it again.
- Inspect inventory filters and exact units; receive a used device and release it only after inspection.
- Open service job, advance one valid stage and check persistence on reload.
- Inspect settings, trial balance, barcode labels, and printable receipt layout.
- Verify form errors remain visible and that empty lists have usable empty states.

A physical barcode scanner, receipt printer, real tax invoice, external payment system, Docker host and production infrastructure have not been tested here. Client acceptance is required before calling this a live deployment.
