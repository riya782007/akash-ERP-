// Local server: `npm start` (uses DATABASE_URL, or a local embedded Postgres in ./data/pglite)
// and `npm run demo` (in-memory database with sample data, localhost only).
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, seedDemo, today } from './db.mjs';
import { act } from './operations.mjs';
import { handle } from './app.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const demo = process.argv.includes('--demo');
const db = await openDatabase(demo ? (process.env.DATABASE_URL_DEMO || 'memory://') : (process.env.DATABASE_URL || resolve(ROOT, 'data/pglite')));

if (demo) {
  await seedDemo(db);
  const owner = await db.prepare("SELECT * FROM users WHERE id='demo-owner'").get();
  if (!await db.prepare('SELECT 1 FROM documents LIMIT 1').get()) {
    await db.transact(async db => {
      const { total } = await db.prepare('SELECT SUM(cost) total FROM units').get();
      await db.prepare('INSERT INTO documents(id,kind,date,party,amount,status,data,actor) VALUES(?,?,?,?,?,?,?,?)').run('OPEN-DEMO', 'opening', today(), 'Demo opening stock', total, 'Posted', '{}', owner.id);
      await db.prepare('INSERT INTO ledger(document_id,account,debit,credit) VALUES(?,?,?,?)').run('OPEN-DEMO', 'Inventory', total, 0);
      await db.prepare('INSERT INTO ledger(document_id,account,debit,credit) VALUES(?,?,?,?)').run('OPEN-DEMO', 'Opening equity', 0, total);
    });
    for (const [unitId, customer, method, employeeId] of [['u1', 'Aarav Pradhan', 'UPI', 'e2'], ['u9', 'Sushant Sahu', 'Card', 'e1'], ['u14', 'Ananya Mishra', 'Cash', 'e2'], ['u23', 'Debasis Meher', 'UPI', 'e4'], ['u34', 'Rohit Das', 'Cash', 'e1']]) {
      const u = await db.prepare('SELECT p.price FROM units u JOIN products p ON p.id=u.product_id WHERE u.id=?').get(unitId);
      await act(db, owner, 'sale', { customer, employeeId, items: [{ unitId, discount: 0 }], payments: [{ method, amount: u.price }] });
    }
    for (const [customer, device, issue, estimate, imei] of [['Pooja Sahu', 'iPhone 13', 'Display replacement', 650000, '990000000000901'], ['Amit Pradhan', 'Samsung Galaxy M34', 'Battery drains quickly', 180000, '990000000000902'], ['Sanjay Nayak', 'Vivo Y21', 'Charging port not working', 120000, '990000000000903']]) await act(db, owner, 'service', { customer, device, issue, estimate, imei, phone: '', technician: 'Rakesh Nayak' });
  }
}

const port = Number(process.env.PORT || 4310), host = process.env.HOST || '127.0.0.1';
if (demo && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Demo must be bound to loopback.');
const server = createServer((req, res) => handle(db, req, res, new URL(req.url, 'http://localhost').pathname, { demo }));
server.listen(port, host, () => console.log(`Mehers ERP ${demo ? 'DEMO' : 'LOCAL'}: http://${host}:${server.address().port}`));
process.on('SIGINT', () => server.close(async () => { await db.close(); process.exit(0); }));
process.on('SIGTERM', () => server.close(async () => { await db.close(); process.exit(0); }));
