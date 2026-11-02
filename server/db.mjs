import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password, stored) { const [salt, hash] = stored.split(':'); return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64)); }
export function openDatabase(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','cashier','technician','accountant')), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL, category TEXT NOT NULL, sku TEXT NOT NULL UNIQUE, price INTEGER NOT NULL CHECK(price>=0), cost INTEGER NOT NULL CHECK(cost>=0), tax INTEGER NOT NULL DEFAULT 1800, reorder INTEGER NOT NULL DEFAULT 3);
    CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), imei TEXT UNIQUE, condition TEXT NOT NULL, location TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('available','sold','returned_to_supplier','inspection')), cost INTEGER NOT NULL CHECK(cost>=0));
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, kind TEXT NOT NULL, date TEXT NOT NULL, party TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sale_lines(sale_id TEXT NOT NULL REFERENCES documents(id), unit_id TEXT NOT NULL REFERENCES units(id), price INTEGER NOT NULL, discount INTEGER NOT NULL, tax INTEGER NOT NULL, PRIMARY KEY(sale_id,unit_id));
    CREATE TABLE IF NOT EXISTS movements(id INTEGER PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id), document_id TEXT REFERENCES documents(id), from_location TEXT, to_location TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), account TEXT NOT NULL, debit INTEGER NOT NULL DEFAULT 0 CHECK(debit>=0), credit INTEGER NOT NULL DEFAULT 0 CHECK(credit>=0));
    CREATE TABLE IF NOT EXISTS employees(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,salary INTEGER NOT NULL, incentive INTEGER NOT NULL DEFAULT 100);
    CREATE TABLE IF NOT EXISTS attendance(employee_id TEXT NOT NULL REFERENCES employees(id),date TEXT NOT NULL,check_in TEXT NOT NULL,check_out TEXT,PRIMARY KEY(employee_id,date));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT NOT NULL,action TEXT NOT NULL,document_id TEXT,details TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests(key TEXT PRIMARY KEY,user_id TEXT NOT NULL,result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS closings(date TEXT PRIMARY KEY,expected INTEGER NOT NULL,counted INTEGER NOT NULL,difference INTEGER NOT NULL,notes TEXT NOT NULL,actor TEXT NOT NULL);
  `);
  return db;
}
export function seedDemo(db) {
  if (db.prepare('SELECT count(*) n FROM products').get().n) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run('demo-owner','Mehers','owner',hashPassword(randomBytes(32).toString('hex')),'owner');
    const products = [
      ['p1','iPhone 15 · 128 GB','Apple','Smartphones','APL-IP15-128',5990000,5350000,8],
      ['p2','Galaxy A55 · 256 GB','Samsung','Smartphones','SAM-A55-256',3999900,3450000,5],
      ['p3','V30 · 128 GB','Vivo','Smartphones','VIV-V30-128',3199900,2760000,7],
      ['p4','Nord CE4 · 128 GB','OnePlus','Smartphones','OP-NCE4-128',2499900,2180000,2],
      ['p5','Redmi Note 13 · 128 GB','Xiaomi','Smartphones','MI-RN13-128',1699900,1440000,9],
      ['p6','AirPods (2nd generation)','Apple','Accessories','APL-AP2',1099900,850000,2],
      ['p7','20W USB-C power adapter','Apple','Accessories','APL-20W',190000,125000,12],
      ['p8','Tempered glass · Universal','Generic','Accessories','ACC-GLASS',29900,6500,24],
      ['p9','iPhone 12 · 64 GB','Apple','Used phones','USED-IP12-64',1990000,1450000,3]
    ];
    let serial = 1;
    for (const [id,name,brand,category,sku,price,cost,quantity] of products) {
      db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)').run(id,name,brand,category,sku,price,cost,1800,3);
      for(let i=0;i<quantity;i++) db.prepare('INSERT INTO units VALUES(?,?,?,?,?,?,?)').run(`u${serial}`,id,category==='Accessories'?null:`99000000${String(serial).padStart(7,'0')}`,category==='Used phones'?'Grade B':'New','Main store','available',cost), serial++;
    }
    for (const e of [['e1','Aakash Meher','Store manager',2200000,100],['e2','Priya Sahu','Sales associate',1500000,150],['e3','Rakesh Nayak','Technician',1800000,100],['e4','Sonal Das','Sales associate',1500000,150]]) db.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run(...e);
    for (const id of ['e1','e2','e3']) db.prepare('INSERT INTO attendance VALUES(?,?,?,NULL)').run(id,today(),'09:30');
    db.prepare('INSERT INTO settings VALUES(?,?)').run('store',JSON.stringify({name:'Mehers',address:'Configure store address',phone:'Configure store phone',gstin:'',openingCash:0}));
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
}
