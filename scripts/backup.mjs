// Exports every ERP table to one JSON file. Usage:
//   DATABASE_URL="postgresql://…" npm run backup [-- path/to/file.json]
// (Supabase also keeps its own daily backups on paid plans.)
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { openDatabase } from '../server/db.mjs';

if (!process.env.DATABASE_URL) throw Error('Set DATABASE_URL to the Supabase connection string you want to back up.');
const target = resolve(process.argv[2] || `data/backups/mehers-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
if (existsSync(target)) throw Error('Backup destination must be a new file.');
const tables = ['users', 'products', 'units', 'documents', 'sale_lines', 'movements', 'ledger', 'employees', 'attendance', 'audit', 'settings', 'closings'];
const db = await openDatabase(process.env.DATABASE_URL, { migrate: false });
try {
  const dump = { exportedAt: new Date().toISOString(), tables: {} };
  for (const t of tables) dump.tables[t] = await db.prepare(`SELECT * FROM ${t}`).all();
  const debit = dump.tables.ledger.reduce((s, r) => s + r.debit, 0), credit = dump.tables.ledger.reduce((s, r) => s + r.credit, 0);
  if (debit !== credit) throw Error(`Ledger does not balance (${debit} vs ${credit}); backup not written.`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(dump), { mode: 0o600 });
  console.log(`Verified backup written to ${target} (${Object.entries(dump.tables).map(([k, v]) => `${k}: ${v.length}`).join(', ')})`);
} finally { await db.close(); }
