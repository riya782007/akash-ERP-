// Vercel serverless entry. vercel.json rewrites /api/<route> to /api/index?route=<route>;
// static files (index.html, app.js, styles.css) are served by Vercel from /public.
import { getDatabase } from '../server/db.mjs';
import { handle } from '../server/app.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.searchParams.get('route') ?? url.pathname.replace(/^\/api\/?/, '');
  if (!/^[a-zA-Z0-9_/-]*$/.test(route) || route.includes('..')) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); return res.end('{"error":"Invalid route"}'); }
  if (!process.env.DATABASE_URL) { res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'Setup needed: add DATABASE_URL (Supabase transaction pooler connection string) in Vercel → Settings → Environment Variables, then redeploy.' })); }
  let db;
  try { db = await getDatabase(); }
  catch (e) { console.error(e); res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'Database is unreachable. Check DATABASE_URL (use the Supabase "Transaction pooler" URI, port 6543) and that the Supabase project is active.' })); }
  return handle(db, req, res, '/api/' + route, { serveStatic: false });
}
