# Deploy on Vercel + Supabase (with optional AI)

The whole app runs on Vercel: static UI from `public/` and one serverless function (`api/index.mjs`) that talks to Supabase Postgres. No second server is needed.

## Why the old build failed

The Vercel project had the **Next.js** framework preset, but this app is plain Node with no `next` dependency, so `next build` stopped with `NEXT_NO_VERSION`. `vercel.json` now sets `"framework": null` (Vercel's "Other" preset), so Vercel runs `npm run vercel-build` (syntax checks) and serves `public/`.

## 1. Supabase (database) — about 5 minutes

1. Create a project at supabase.com. **Region: South Asia (Mumbai)** — `vercel.json` runs the API in Vercel's Mumbai region (`bom1`), so the two sit next to each other. If you pick another Supabase region, change `"regions"` in `vercel.json` to the nearest Vercel region.
2. Save the database password you choose.
3. Open **Connect** (top of the project page) → **Transaction pooler** → copy the URI (port **6543**). Replace `[YOUR-PASSWORD]` with your password. If the password contains `@ # / : ?` etc., URL-encode those characters (or pick a password with letters and digits only).

Tables are created automatically on first request (`server/schema.sql`; you can also paste it into the SQL Editor). Row Level Security is enabled with no policies and privileges are revoked from Supabase's `anon`/`authenticated` roles, so Supabase's public REST API cannot read ERP data — only the server's direct connection can. You do **not** need Supabase's anon or service-role keys.

Supabase free-tier projects pause after a week without activity; daily use keeps it awake. Paid plans include daily backups; `npm run backup` (below) works on any plan.

## 2. Vercel (hosting)

1. Vercel → **Add New → Project** → import `riya782007/akash-ERP-` (or open the existing project).
2. **Settings → Build and Deployment:** Framework Preset **Other**, Root Directory **`.`** (empty), and clear any overridden Build/Output/Install commands — `vercel.json` defines them. Node.js **24.x**.
3. **Settings → Environment Variables** (Production, and Preview if you use previews):

| Name | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | **Yes** | Supabase Transaction pooler URI from step 1 (port 6543) |
| `ERP_ADMIN_PASSWORD` | **Yes** (first start) | Password for username **`owner`**, 12+ characters. Only used when the database is empty; changing it later does nothing. |
| `OPENAI_API_KEY` | For AI | OpenAI project key (`sk-…`). Server-side only. |
| `OPENAI_MODEL` | No | `gpt-6-luna` (default; OpenAI's lowest-cost model) |
| `AI_DAILY_REQUEST_LIMIT` | No | `100` (default). Store-wide AI requests per day. |

Remove variables from the old two-server design if present: `ERP_BACKEND_ORIGIN`, `ERP_DB`, `HOST`, `PORT`. `ERP_SECURE_COOKIE` and `ERP_PUBLIC_ORIGIN` are not needed on Vercel.

4. **Deployments → Redeploy** (environment variables only apply to new deployments).
5. Open `https://<your-project>.vercel.app/api/health` → should show `{"ok":true,…,"ai":true}`. Then open the site and sign in as `owner`.

## 3. Hand over to Akash

1. Sign in as `owner` → **Settings**: store name, address, phone, GSTIN.
2. **Admin → Add workspace user**: create Akash's own login (role `owner` if he runs the shop; `cashier`/`accountant`/`technician` for staff). Each person gets their own username — don't share the `owner` login.
3. Add employees and products (use **Smart fill** to paste product details), then receive opening stock via **Purchases** (one IMEI per phone).
4. Share the URL and each person's credentials privately (not over a group chat).
5. Test one sale, one return, one repair job end-to-end and a daily closing before the first real business day.

## AI features (gpt-6-luna)

All AI is optional, on-demand and review-first. Numbers are calculated by the database; the model only explains, drafts or extracts. Customer names, phone numbers, IMEIs and salaries are never sent to OpenAI.

| Feature | Where | Who |
| --- | --- | --- |
| **Today's brief** — top priorities from today's sales vs 7-day average, aging repairs, unpaid pickups, low stock, staff present | AI assist (top bar) | All roles (each sees only their data) |
| **Ask about my shop** — plain-language questions over 30-day figures (top sellers, margins, salesperson totals, payment mix, expenses) | AI assist | Owner, accountant |
| **Restock plan** — computed reorder table (3 weeks of demand + reorder level) with estimated cost, plus a short purchase plan | AI assist | Owner, accountant |
| **Repair intake checklist** — checklist, clarifying questions and checks to run, from the device + issue | AI assist and **New service intake** form | Owner, cashier, technician |
| **Customer update** — WhatsApp-ready message in English, Hindi or Odia from the job's real status/estimate; one tap to open WhatsApp with the customer's number | Any repair job → **Draft customer update** | Owner, cashier, technician |
| **Smart fill** — type "samsung s24 fe 8/256 54999 cost 49500" and the product form fills itself | **Add product** form | Owner |

**Cost control:** gpt-6-luna is $0.10 per 1M input and $0.50 per 1M output tokens. Typical requests here are 100–500 input tokens and up to ~400 output tokens, about $0.0001–$0.0003 each (well under ₹0.05). Simple drafting uses reasoning effort `none`; analysis uses `low`. Identical requests on the same day are served from cache at no cost, and `AI_DAILY_REQUEST_LIMIT` caps total requests. Also set a monthly budget in your OpenAI project's billing settings.

## Backups

```sh
DATABASE_URL="postgresql://…" npm run backup
```

Writes all ERP tables to a JSON file in `data/backups/` after checking the ledger balances. Keep backups private and offsite.

## Local development

```sh
npm install
npm run demo   # sample data, in-memory, http://127.0.0.1:4310
npm start      # empty local database in ./data/pglite (or set DATABASE_URL to use Supabase)
npm test
```
