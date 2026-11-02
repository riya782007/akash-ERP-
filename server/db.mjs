import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password, stored) { const [salt, hash] = stored.split(':'); return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64)); }

export const ERP_TABLES = ['users', 'sessions', 'products', 'units', 'documents', 'sale_lines', 'movements', 'ledger', 'employees', 'attendance', 'audit', 'settings', 'requests', 'closings', 'ai_requests', 'login_attempts'];
export const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Convert SQLite-style "?" placeholders to Postgres "$n", ignoring quoted text.
export function placeholders(sql) {
  let n = 0, out = '', quote = null;
  for (const ch of sql) {
    if (quote) { if (ch === quote) quote = null; out += ch; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    out += ch === '?' ? `$${++n}` : ch;
  }
  return out;
}

// A tiny query interface shared by Supabase (postgres.js) and local PGlite:
//   await db.prepare(sql).get(...params) / .all(...) / .run(...)
//   await db.transact(async tx => ...)   — serialised by an advisory lock, like SQLite's BEGIN IMMEDIATE.
class Db {
  constructor(query, begin, exec, close) { this.query = query; this.begin = begin; this.exec = exec; this.closeFn = close; }
  prepare(sql) {
    const text = placeholders(sql);
    return {
      all: (...p) => this.query(text, p),
      get: async (...p) => (await this.query(text, p))[0],
      run: async (...p) => { await this.query(text, p); }
    };
  }
  async transact(fn) {
    if (this.inTx) return fn(this);
    return this.begin(async q => {
      const tx = new Db(q, null, this.exec);
      tx.inTx = true;
      await q('SELECT pg_advisory_xact_lock(4310)', []);
      return fn(tx);
    });
  }
  close() { return this.closeFn?.(); }
}

const toNumber = v => (v === null ? null : Number(v));

// Supabase / any Postgres via DATABASE_URL. Use the Supabase "Transaction pooler" URI (port 6543) on Vercel.
async function openPostgres(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    prepare: false, // required for Supabase's transaction pooler
    max: Number(process.env.DB_POOL_MAX || 3),
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
    types: { bigint: { to: 20, from: [20, 1700], parse: toNumber, serialize: String } },
    onnotice: () => {}
  });
  const run = target => async (text, params) => [...await target.unsafe(text, params.map(v => v === undefined ? null : v))];
  return new Db(run(sql), fn => sql.begin(tx => fn(run(tx))), text => sql.unsafe(text), () => sql.end({ timeout: 5 }));
}

// Local development, demo and tests: embedded Postgres (PGlite). Optional dev dependency.
async function openPGlite(dir) {
  const mod = '@electric-sql/pglite';
  const { PGlite } = await import(mod);
  const pg = new PGlite(dir, { parsers: { 20: toNumber, 1700: toNumber } });
  const run = target => async (text, params) => (await target.query(text, params.map(v => v === undefined ? null : v))).rows;
  return new Db(run(pg), fn => pg.transaction(tx => fn(run(tx))), text => pg.exec(text), () => pg.close());
}

export async function openDatabase(url = process.env.DATABASE_URL, { migrate = true } = {}) {
  const db = url && /^postgres(ql)?:\/\//.test(url) ? await openPostgres(url) : await openPGlite(url || undefined);
  if (migrate) {
    await db.exec(SCHEMA);
    // Defence in depth on Supabase: RLS (enabled in the schema, no policies) already blocks the public
    // Data API; also revoke table privileges from Supabase's API roles when they exist.
    const apiRoles = (await db.prepare("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')").all()).map(r => r.rolname);
    if (apiRoles.length) await db.exec(`REVOKE ALL ON ${ERP_TABLES.join(',')} FROM ${apiRoles.join(',')}`);
  }
  return db;
}

// One shared connection per server instance / warm serverless function.
let shared;
export function getDatabase() {
  shared ??= openDatabase().catch(e => { shared = null; throw e; });
  return shared;
}

export async function seedDemo(db) {
  if ((await db.prepare('SELECT count(*) n FROM products').get()).n) return;
  await db.transact(async db => {
    await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run('demo-owner', 'Mehers', 'owner', hashPassword(randomBytes(32).toString('hex')), 'owner');
    const products = [
      ['p1', 'iPhone 15 · 128 GB', 'Apple', 'Smartphones', 'APL-IP15-128', 5990000, 5350000, 8],
      ['p2', 'Galaxy A55 · 256 GB', 'Samsung', 'Smartphones', 'SAM-A55-256', 3999900, 3450000, 5],
      ['p3', 'V30 · 128 GB', 'Vivo', 'Smartphones', 'VIV-V30-128', 3199900, 2760000, 7],
      ['p4', 'Nord CE4 · 128 GB', 'OnePlus', 'Smartphones', 'OP-NCE4-128', 2499900, 2180000, 2],
      ['p5', 'Redmi Note 13 · 128 GB', 'Xiaomi', 'Smartphones', 'MI-RN13-128', 1699900, 1440000, 9],
      ['p6', 'AirPods (2nd generation)', 'Apple', 'Accessories', 'APL-AP2', 1099900, 850000, 2],
      ['p7', '20W USB-C power adapter', 'Apple', 'Accessories', 'APL-20W', 190000, 125000, 12],
      ['p8', 'Tempered glass · Universal', 'Generic', 'Accessories', 'ACC-GLASS', 29900, 6500, 24],
      ['p9', 'iPhone 12 · 64 GB', 'Apple', 'Used phones', 'USED-IP12-64', 1990000, 1450000, 3]
    ];
    let serial = 1;
    for (const [id, name, brand, category, sku, price, cost, quantity] of products) {
      await db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)').run(id, name, brand, category, sku, price, cost, 1800, 3);
      for (let i = 0; i < quantity; i++, serial++) await db.prepare('INSERT INTO units VALUES(?,?,?,?,?,?,?)').run(`u${serial}`, id, category === 'Accessories' ? null : `99000000${String(serial).padStart(7, '0')}`, category === 'Used phones' ? 'Grade B' : 'New', 'Main store', 'available', cost);
    }
    for (const e of [['e1', 'Aakash Meher', 'Store manager', 2200000, 100], ['e2', 'Priya Sahu', 'Sales associate', 1500000, 150], ['e3', 'Rakesh Nayak', 'Technician', 1800000, 100], ['e4', 'Sonal Das', 'Sales associate', 1500000, 150]]) await db.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run(...e);
    for (const id of ['e1', 'e2', 'e3']) await db.prepare('INSERT INTO attendance VALUES(?,?,?,NULL)').run(id, today(), '09:30');
    await db.prepare('INSERT INTO settings VALUES(?,?)').run('store', JSON.stringify({ name: 'Mehers', address: 'Configure store address', phone: 'Configure store phone', gstin: '', openingCash: 0 }));
  });
}
