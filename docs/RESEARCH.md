# ERP research and design decisions

Research date: 1 November 2026. These are relevant reference systems, not an unsupported ranking of the world's best software. Product fit depends on operational complexity, implementation quality, cost and local support.

## What the reference systems teach us

| Reference | Verified pattern | Decision for Mehers |
| --- | --- | --- |
| [Odoo POS: serial numbers](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/shop/serial_numbers.html) | Tracked products retain serial/lot identity in sales workflows | A phone model and a physical handset are separate records; sales consume exact units |
| [Odoo POS workflow](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/use.html) | Register sessions include closing controls and cash differences | Daily physical cash count, an explicit variance note, and a financial-entry lock |
| [ERPNext serial numbers](https://docs.frappe.io/erpnext/serial-no) | Serialized stock changes through stock transactions | Stock status changes are recorded alongside document-linked movements; do not edit a counter alone |
| [Dynamics 365 inventory lookup](https://learn.microsoft.com/en-us/dynamics365/commerce/pos-inventory-lookup-operation) | Staff can look up availability by store and warehouse | Distinguish available stock from stock on the shop floor; transfers preserve location history |
| [SAP Business One](https://www.sap.com/products/erp/business-one.html) | Finance, purchasing, inventory and sales form an integrated small-business system | Use one transaction boundary for document, stock, ledger and audit records |
| [Newvora](https://newvora.in/) | Personalised business software is the studio's public positioning | Client-facing store identity comes first, with restrained “Powered by Newvora” attribution |

The engineering and UX decisions below are our application of those patterns, not claims that these systems use our specific implementation.

## Understand the counter before designing the menu

Confirmed facts: mobile retail, sales and service; one shop in Boudh; customer deposits and staff advances both required. The four operating roles are a working design assumption: owner, cashier, technician and accountant.

Likely needs to validate with the client:

- The cashier wants to finish a bill while talking to a customer, without re-entering handset details.
- The owner wants to trust what is sold, what is actually in the drawer and what needs attention.
- A technician wants an intelligible job queue, intake condition and approval state without salary or purchasing data.
- The accountant wants traceable source documents and balanced postings rather than disconnected spreadsheets.

These are hypotheses inferred from the business type, not interview findings.

## Experience principles

1. Start with today's actionable work: sales, stock, repairs, attendance and exception reminders.
2. Group navigation into Workspace, Operations and Business. Use plain labels, not accounting abbreviations.
3. Keep the identity of the handset visible at selection, billing, return and inspection.
4. Require explicit save actions; validate on the server; show an error near the form; do not lose entered values after a rejected save.
5. Make money movement legible. A customer deposit is a liability, staff advance is a receivable, and financed sale is not cash in the drawer.
6. Use a restrained forest-green and sage palette, bordered cards, consistent tables and compact status badges. Let the actions, amounts and exceptions carry the hierarchy.
7. Use native labels, visible keyboard focus, responsive navigation, mobile tables with horizontal scrolling and a Ctrl/Cmd-K search shortcut.
8. Separate demo from live records. Never imply that a manually recorded UPI payment has been verified by a gateway.

## Build-versus-configure recommendation

For this narrow, one-shop flow, a custom interface can be quicker to learn than a general enterprise menu. A compact modular server on Vercel with a Supabase Postgres transaction engine avoids deployment complexity. If the client requires statutory accounting, mature payroll, complex procurement or multiple branches, evaluate configuring ERPNext/Odoo or integrating a dedicated accounting system instead of recreating an entire enterprise suite. A custom screen is not a substitute for audited business rules.

## Next client validation session

Walk through a real purchase receipt, a split-payment phone sale, an exchange with balance payable, a faulty-handset return, a repair approval and collection, a staff advance recovery, and a cash mismatch. Confirm invoice fields, printer/scanner hardware, discount authority, return conditions, lender fees, salary policies, and language preferences. Odia/Hindi localization is not yet implemented; the current interface is English.
