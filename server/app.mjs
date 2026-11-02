import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword } from './db.mjs';
import { act, snapshot, BusinessError } from './operations.mjs';
import { assist } from './ai.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const digest = t => createHash('sha256').update(t).digest('hex');
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};

function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) { // Vercel pre-parses JSON bodies
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(String(req.body) || '{}'); } catch { throw new BusinessError('Invalid JSON'); }
  }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) throw new BusinessError('Request too large', 413); }
  try { return JSON.parse(raw || '{}'); } catch { throw new BusinessError('Invalid JSON'); }
}
const cookieToken = req => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('mehers_session='))?.slice(15);
const clientIp = req => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
const isHttps = req => process.env.ERP_SECURE_COOKIE === '1' || req.headers['x-forwarded-proto'] === 'https' || !!process.env.VERCEL;

async function authenticate(db, req) { const token = cookieToken(req); if (!token) return null; return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1').get(digest(token), Date.now()); }
async function startSession(db, req, res, user) {
  const token = randomBytes(32).toString('hex');
  await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
  await db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), user.id, Date.now() + 8 * 60 * 60 * 1000);
  res.setHeader('Set-Cookie', `mehers_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${isHttps(req) ? '; Secure' : ''}`);
}

// Creates the first owner account from ERP_ADMIN_PASSWORD when the database is empty.
let bootstrapped = false;
export async function ensureOwner(db, env = process.env) {
  if (bootstrapped) return;
  if (!await db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const password = env.ERP_ADMIN_PASSWORD;
    if (!password || password.length < 12) throw new BusinessError('Setup needed: set ERP_ADMIN_PASSWORD (at least 12 characters) in the environment, then redeploy.', 503);
    await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1) ON CONFLICT DO NOTHING').run('owner', 'Mehers owner', 'owner', hashPassword(password), 'owner');
  }
  bootstrapped = true;
}

async function login(db, req, res, input) {
  const ip = digest(clientIp(req)); const now = Date.now();
  let attempt = await db.prepare('SELECT * FROM login_attempts WHERE ip=?').get(ip);
  if (attempt && now > attempt.until) attempt = null;
  if (attempt?.count >= 10) throw new BusinessError('Too many attempts. Try again in 15 minutes.', 429);
  const user = await db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(input.username || ''));
  if (!user || !verifyPassword(String(input.password || ''), user.password)) {
    await db.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN login_attempts.until<? THEN 1 ELSE login_attempts.count+1 END, until=CASE WHEN login_attempts.until<? THEN excluded.until ELSE login_attempts.until END').run(ip, now + 900000, now, now);
    throw new BusinessError('Username or password is incorrect', 401);
  }
  await db.prepare('DELETE FROM login_attempts WHERE ip=?').run(ip);
  await startSession(db, req, res, user); return json(res, 200, { ok: true });
}

// Handles one HTTP request. `pathname` is the logical path, e.g. /api/state.
export async function handle(db, req, res, pathname, { demo = false, serveStatic = true } = {}) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    if (demo && !['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host || '').replace(/:\d+$/, ''))) throw new BusinessError('Demo accepts localhost requests only', 403);
    if (req.method === 'POST') {
      const origin = req.headers.origin, host = req.headers['x-forwarded-host'] || req.headers.host;
      if (origin && origin !== `http://${host}` && origin !== `https://${host}` && origin !== process.env.ERP_PUBLIC_ORIGIN) throw new BusinessError('Cross-origin requests are not allowed', 403);
      if (!req.headers['content-type']?.includes('application/json')) throw new BusinessError('Use application/json', 415);
      const input = await readBody(req);
      if (!demo) await ensureOwner(db);
      if (pathname === '/api/login') return await login(db, req, res, input);
      if (pathname === '/api/demo' && demo) { await startSession(db, req, res, await db.prepare("SELECT * FROM users WHERE id='demo-owner'").get()); return json(res, 200, { ok: true }); }
      const user = await authenticate(db, req); if (!user) throw new BusinessError('Please sign in', 401);
      if (pathname === '/api/ai') return json(res, 200, await assist(db, user, input));
      if (pathname === '/api/logout') { await db.prepare('DELETE FROM sessions WHERE token=?').run(digest(cookieToken(req))); res.setHeader('Set-Cookie', 'mehers_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
      if (pathname.startsWith('/api/actions/')) {
        const key = req.headers['idempotency-key']; if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw new BusinessError('A valid idempotency key is required');
        return json(res, 200, await act(db, user, pathname.slice(13), input, key));
      }
      throw new BusinessError('Not found', 404);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new BusinessError('Method not allowed', 405);
    if (pathname === '/api/health') { await db.prepare('SELECT 1').get(); return json(res, 200, { ok: true, demo, ai: !!process.env.OPENAI_API_KEY }); }
    if (pathname === '/api/state') { const user = await authenticate(db, req); if (!user) throw new BusinessError('Please sign in', 401); return json(res, 200, { ...await snapshot(db, user, demo), ai: !!process.env.OPENAI_API_KEY }); }
    if (pathname.startsWith('/api/') || !serveStatic) throw new BusinessError('Not found', 404);
    const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
    const filename = files[pathname]; if (!filename) throw new BusinessError('Not found', 404);
    const path = resolve(ROOT, 'public', filename);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' })[extname(path)], 'Cache-Control': 'no-cache' }); res.end(readFileSync(path));
  } catch (error) {
    const expected = error instanceof BusinessError;
    if (!res.headersSent) {
      const conflict = typeof error?.code === 'string' && error.code.startsWith('23'); // Postgres integrity violations
      const dbDown = !expected && /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|CONNECT_TIMEOUT|password authentication|Tenant or user not found/i.test(String(error?.code) + ' ' + error?.message);
      json(res, expected ? error.status : conflict ? 409 : dbDown ? 503 : 500, { error: expected ? error.message : conflict ? 'The record conflicts with existing data. Check unique values and try again.' : dbDown ? 'Database is unreachable. Check DATABASE_URL (Supabase transaction pooler URI) and that the Supabase project is not paused.' : 'Unexpected server error' });
    } else res.end();
    if (!expected) console.error(error);
  }
}
