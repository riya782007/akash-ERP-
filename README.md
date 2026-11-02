# Mehers Workspace

A custom retail operations application for **Mehers, Boudh, Odisha**, built by **Newvora**. One shop, with customer deposits and staff advances. The UI combines a calm store overview with IMEI-aware billing and connected operational records.

**Status:** runnable first release for local evaluation and client acceptance testing. This repository is not evidence of a production deployment. Demo mode contains fictional transactions and synthetic IMEIs. Do not enter real customer information into demo mode.

## Start the demo

Requires **Node.js 24 or newer**. There are no third-party runtime dependencies and no install/build step.

```sh
npm run demo
```

Open http://127.0.0.1:4310 and choose **Explore demo workspace**. Demo records persist in `data/demo.sqlite`, separate from the live database. Demo binds only to loopback. Use `PORT` to select another port.

## Start a clean installation

Set `ERP_ADMIN_PASSWORD` to a unique secret of at least 12 characters in your shell or deployment secret manager, then run:

```sh
npm start
```

The first start creates username `owner` with that password. Subsequent starts use the stored password hash; changing the environment variable does not reset it. `data/mehers.sqlite` starts with no sample products, employees, or financial records. Add store details, users, employees and products through the UI; record owner capital and receive opening stock through the purchase workflow. Keep credentials out of Git and shell command history. `.env.example` documents variables; the server does not automatically load dotenv files.

## Included workflows

| Client requirement | Implementation |
| --- | --- |
| Attendance | One check-in and check-out per employee per IST business date |
| Purchase entry | Product receipt, unique IMEI, landed cost, payment journal and stock movement |
| Sales | Available-unit selection, scan/search, discounts, split tenders, credit application and printable receipt |
| Mobile exchange | Incoming device, valuation, inspection hold, customer credit, redemption or payout |
| Sales/purchase returns | Original-document validation, reversal journal, duplicate-return prevention, inspection quarantine |
| Service | Intake, IMEI, condition/accessories, technician, six ordered stages, payment and handover |
| Transfer | Main store ↔ store room, with movement history |
| Advance | Customer liabilities, staff receivables, partial settlement, checkout redemption and salary recovery |
| Finance | Balanced journal, trial balance, owner funding, lender receivables and settlement |
| Payment modes | Cash, UPI, card, bank transfer and finance; split tender supported |
| Stock | Per-unit stock, availability, valuation and reorder signals |
| Discount | Per-line amounts, owner unrestricted up to price, cashier limit 5% |
| Gift | Complimentary accessory linked to a sale, stock consumption and promotional expense |
| Salary & incentive | Monthly salary register, approved incentives/deductions, advance recovery, duplicate-month protection |
| Second-hand phones | Separate product category, graded units, inspection before resale |
| Barcode generation | Printable Code 39 SKU labels and keyboard-wedge scan input |
| Expenses | Category, party, payment account and expense journal |
| Closing report | Cash-book balance, physical count, discrepancy note, payment breakdown and daily lock |
| Search | Global customer/document/product/IMEI search, table filters and CSV export |
| Admin | Store profile, product price updates, employees, four roles, access revocation and audit events |

All money is stored as integer paise. Configured sales tax is stored in basis points and extracted from tax-inclusive prices. Dates use Asia/Kolkata. Posted sales retain their original prices even when the product catalog changes.

## Verify and back up

```sh
npm run check
npm test
npm run backup
```

Tests cover transaction rollback, stock availability, duplicate IMEIs, returns, payment balancing, idempotency, role restrictions, service transitions, advances, payroll, closing locks and HTTP access controls. The HTTP suite starts an isolated temporary server and database. GitHub Actions runs checks and tests on Node 24.

`npm run backup` uses SQLite's online backup API and validates the copied database. Set `ERP_DB` to select a database (for example `data/demo.sqlite`). Backups contain sensitive information and are excluded from Git. See [operations](docs/OPERATIONS.md) for recovery and deployment.

## Important boundaries before live use

- This is an operational retail ERP v1, not certified GST/accounting/payroll software. HSN/SAC, CGST/SGST/IGST handling, input tax credit, statutory invoice numbering, GST returns and e-invoice integration are not implemented. The printable document is a sales receipt. Confirm tax requirements and implement the approved invoice format before production billing.
- Payments and lender settlements are manual records; no bank, UPI gateway, card terminal, biometric clock, SMS or WhatsApp integration is connected.
- Incentives and other salary deductions require approved manual values. Attendance proration, PF/ESI/TDS and statutory payroll are not calculated.
- One shop and two internal locations are configured. Transfers are immediate internal moves, not interbranch dispatch/receipt workflows.
- No offline write queue or sync conflict handling. The server must be available for every save. Current listings load the store snapshot; pagination and indexed server-side search are the next step for large histories.
- Customer and staff credits match names exactly (case-insensitive); stable party IDs, customer/supplier master records and collision handling are needed before importing a large historical ledger.
- Owner-managed account recovery, MFA, automatic offsite backup scheduling and a hosted HTTPS deployment remain deployment work. Application audit history is not an externally signed, tamper-proof log.

See [research and UX rationale](docs/RESEARCH.md), [architecture](docs/ARCHITECTURE.md), and [acceptance checklist](docs/ACCEPTANCE.md). No real sales records, credentials or database files belong in the public repository.
