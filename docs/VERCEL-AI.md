# Vercel and AI setup

The application is plain Node, not Next.js. `vercel.json` explicitly uses framework `null` and the existing public directory. In Vercel project settings choose **Other**, root directory **.**, build command **npm run vercel-build**, output directory **public**, Node **24.x**. Remove old `next build` overrides and redeploy the new commit.

## Required backend

Vercel functions cannot persist the local SQLite file. This deployment serves static UI on Vercel and forwards API requests through a same-origin function to a durable Node server. Deploy the included Dockerfile on a host supporting a persistent disk, one replica, and HTTPS. Mount writable persistent storage at `/app/data`. Do not use demo mode. Alternatively deploy the entire app on that durable host and skip Vercel completely.

Backend environment:

| Variable | Value |
| --- | --- |
| ERP_ADMIN_PASSWORD | Unique secret, at least 12 characters; creates `owner` on first start only |
| ERP_DB | `/app/data/mehers.sqlite` with a persistent volume |
| HOST | `0.0.0.0` |
| PORT | `4310` or the port required by your host |
| ERP_SECURE_COOKIE | `1` for HTTPS |
| ERP_PUBLIC_ORIGIN | Exact Vercel production URL, e.g. `https://your-shop.vercel.app`, no trailing slash |
| OPENAI_API_KEY | Optional secret OpenAI project API key, stored only on backend |
| OPENAI_MODEL | `gpt-6-luna` (current low-cost model; verify access in your API project) |
| AI_DAILY_REQUEST_LIMIT | `25` initially; integer 1–1000, store-wide daily request cap |

Vercel environment:

| Variable | Value |
| --- | --- |
| ERP_BACKEND_ORIGIN | HTTPS origin of that Node backend, no path, e.g. `https://your-backend.example.com` |

No database or OpenAI secret belongs in frontend variables. Backend must be online before login works; without the origin the proxy returns a clear 503. Preview deployments are not automatically approved as public origins. API requests use HttpOnly same-origin cookies; the backend accepts only its own origin or configured ERP_PUBLIC_ORIGIN.

## AI behavior and spending

The AI assist button offers daily priorities from role-filtered aggregates, repair intake checklists from supplied notes, and customer message drafts. Only generate on click; there is no background polling, no automatic messaging and no financial writes. Outputs are plain text, escaped in the UI. Notes are limited to 1,200 characters; outputs are capped at 700 tokens including reasoning. Identical requests per user/day are cached in SQLite. Failed attempts count toward the daily cap and do not automatically retry. Set OpenAI project budget alerts as well; this request cap is not a currency-denominated spending guarantee.

The API key is never returned to the browser. `store:false` disables response storage, but is not a claim of zero provider retention. Staff should not put names, phone numbers, IMEIs, credentials or other private details into notes. Daily context contains counts, totals and low-stock product names, not customer identities or employee salaries.

Current reference: https://developers.openai.com/api/docs/models/gpt-6-luna and https://developers.openai.com/api/docs/pricing . Default was selected from current low-cost models rather than deprecated nano aliases. Model access and live response quality must be tested with the deployment's actual API project.

## Before sharing with Akash

Deploy the backend, set both sets of variables, redeploy Vercel, sign in as `owner`, replace store placeholders, create a separate appropriately scoped user for Akash, and enter verified products/opening stock. Test sale, return, closing, backup restoration, and an AI request. Share the production URL and credentials privately. GST/statutory invoice work described in README remains outstanding; do not treat this as certified tax invoicing software.
