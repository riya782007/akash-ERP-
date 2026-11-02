import { randomUUID } from 'node:crypto';
import { today, hashPassword } from './db.mjs';
export class BusinessError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export const check = (condition, message) => { if (!condition) throw new BusinessError(message); };
const int = (value, name = 'Amount') => { check(Number.isSafeInteger(value) && value >= 0 && value <= 100000000000, `${name} must be a non-negative integer in paise`); return value; };
const text = (v, name = 'Name') => { check(typeof v === 'string' && v.trim().length > 0 && v.length <= 500, `${name} is required (maximum 500 characters)`); return v.trim(); };
const moneyAccount = { Cash: 'Cash', UPI: 'Bank / UPI', Card: 'Card clearing', 'Bank transfer': 'Bank', Finance: 'Finance receivable' };
export const roles = { owner: ['*'], cashier: ['sale', 'service', 'service-payment', 'advance', 'attendance'], technician: ['service'], accountant: ['purchase', 'expense', 'advance', 'settle', 'salary', 'closing', 'return', 'lender-settlement'] };
const id = prefix => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
const jsonField = (field) => `(data::jsonb->>'${field}')`;

export function act(db, user, action, input = {}, requestKey) {
  check(roles[user.role]?.includes('*') || roles[user.role]?.includes(action), 'Your role cannot perform this action');
  return db.transact(async db => {
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const run = (sql, ...p) => db.prepare(sql).run(...p);
    if (requestKey) { const previous = await one('SELECT * FROM requests WHERE key=?', requestKey); if (previous) { check(previous.user_id === user.id, 'Request key already used'); return JSON.parse(previous.result); } }
    const date = today();
    if (!['attendance', 'service', 'settings', 'user', 'product', 'employee', 'access', 'update-product'].includes(action)) check(!await one('SELECT 1 FROM closings WHERE date=?', date), 'Today is closed. New financial entries are locked until the next business day.');
    let result; const docId = id(action.toUpperCase().slice(0, 3));
    const document = (kind, party, amount, status, data) => run('INSERT INTO documents(id,kind,date,party,amount,status,data,actor) VALUES(?,?,?,?,?,?,?,?)', docId, kind, date, party, amount, status, JSON.stringify(data), user.id);
    async function journal(entries) { check(entries.reduce((s, e) => s + e[1] - e[2], 0) === 0, 'Unbalanced journal'); for (const [account, debit, credit] of entries) if (debit || credit) await run('INSERT INTO ledger(document_id,account,debit,credit) VALUES(?,?,?,?)', docId, account, debit, credit); }
    function payment(method) { check(moneyAccount[method], 'Select a valid payment method'); check(method !== 'Finance' || ['sale', 'return'].includes(action), 'Finance is a sales receivable, not a cash or bank payment'); return moneyAccount[method]; }
    async function unit(unitId) { const u = await one('SELECT u.*,p.name,p.price,p.tax,p.category FROM units u JOIN products p ON p.id=u.product_id WHERE u.id=?', unitId); check(u, 'Handset or stock item not found'); return u; }
    const movement = (unitId, from, to, kind) => run('INSERT INTO movements(unit_id,document_id,from_location,to_location,action) VALUES(?,?,?,?,?)', unitId, docId, from, to, kind);
    async function newUnit(data, condition = 'New', status = 'available') {
      const product = await one('SELECT * FROM products WHERE id=?', data.productId); check(product, 'Select an existing product');
      const imei = data.imei?.trim() || null;
      if (product.category !== 'Accessories') check(/^\d{15}$/.test(imei || ''), 'A 15-digit IMEI is required for phones');
      if (imei) check(!await one('SELECT 1 FROM units WHERE imei=?', imei), 'This IMEI already exists');
      const uid = id('UNT'); await run('INSERT INTO units VALUES(?,?,?,?,?,?,?)', uid, product.id, imei, condition, data.location || 'Main store', status, int(data.cost, 'Cost')); return uid;
    }

    if (action === 'sale') {
      check(Array.isArray(input.items) && input.items.length > 0 && input.items.length <= 100, 'Add at least one item');
      check(new Set(input.items.map(i => i.unitId)).size === input.items.length, 'The same unit cannot be billed twice');
      const lines = [];
      for (const i of input.items) {
        const u = await unit(i.unitId); check(u.status === 'available' && u.location === 'Main store', `${u.name} is not available at this store`);
        const discount = int(i.discount || 0, 'Discount'); check(discount <= u.price, 'Discount exceeds price');
        if (user.role !== 'owner') check(discount <= Math.floor(u.price * .05), 'Discounts above 5% require the owner');
        lines.push({ unit: u, discount, net: u.price - discount });
      }
      const total = int(lines.reduce((s, l) => s + l.net, 0), 'Invoice total');
      if (input.employeeId) check(await one('SELECT 1 FROM employees WHERE id=?', input.employeeId), 'Select a valid salesperson');
      const payments = input.payments || []; const creditAmount = int(input.creditAmount || 0, 'Credit applied'); let creditDocument = null; let creditData = null;
      if (creditAmount) {
        creditDocument = await one("SELECT * FROM documents WHERE id=? AND kind IN ('advance','exchange') AND status!='Settled'", input.creditId); check(creditDocument, 'Select an open customer deposit or exchange credit');
        creditData = JSON.parse(creditDocument.data);
        check(creditDocument.kind === 'exchange' || creditData.type === 'Customer', 'Staff advances cannot be used as customer credit');
        check(creditDocument.party.toLowerCase() === String(input.customer).trim().toLowerCase(), 'Credit belongs to a different customer');
        check(creditAmount <= (creditData.remaining ?? creditDocument.amount), 'Credit exceeds the outstanding balance');
        check(creditAmount <= total, 'Credit exceeds the invoice total');
      }
      check(payments.length > 0 || creditAmount === total, 'Add a payment');
      check(payments.reduce((s, p) => s + int(p.amount), 0) + creditAmount === total, 'Payment total must equal the invoice total'); payments.forEach(p => payment(p.method));
      const tax = lines.reduce((s, l) => s + Math.round(l.net * l.unit.tax / (10000 + l.unit.tax)), 0);
      await document('sale', text(input.customer, 'Customer'), total, 'Completed', { phone: input.phone || '', payments, creditId: creditDocument?.id || null, creditAmount, employeeId: input.employeeId || null, tax, items: lines.map(l => ({ unitId: l.unit.id, name: l.unit.name, imei: l.unit.imei, price: l.unit.price, discount: l.discount, net: l.net })) });
      let cost = 0;
      for (const l of lines) { await run('INSERT INTO sale_lines VALUES(?,?,?,?,?)', docId, l.unit.id, l.unit.price, l.discount, l.unit.tax); await run("UPDATE units SET status='sold' WHERE id=?", l.unit.id); await movement(l.unit.id, l.unit.location, 'Customer', 'sale'); cost += l.unit.cost; }
      if (creditDocument) { const remaining = (creditData.remaining ?? creditDocument.amount) - creditAmount; await run('UPDATE documents SET data=?,status=? WHERE id=?', JSON.stringify({ ...creditData, remaining }), remaining === 0 ? 'Settled' : creditDocument.status, creditDocument.id); }
      await journal([...payments.map(p => [payment(p.method), p.amount, 0]), ...(creditDocument ? [[creditDocument.kind === 'exchange' ? 'Exchange credit liability' : 'Customer advances', creditAmount, 0]] : []), ['Sales', 0, total - tax], ['Output tax', 0, tax], ['Cost of goods sold', cost, 0], ['Inventory', 0, cost]]);
      result = { id: docId, total };
    } else if (action === 'purchase' || action === 'exchange') {
      const cost = int(input.cost, 'Cost'); const party = text(input.party, action === 'purchase' ? 'Supplier' : 'Customer');
      await document(action, party, cost, action === 'exchange' ? 'Awaiting inspection' : 'Received', input);
      const used = (await one('SELECT category FROM products WHERE id=?', input.productId))?.category === 'Used phones';
      const uid = await newUnit(input, action === 'exchange' || used ? (input.condition || 'Grade B') : 'New', action === 'exchange' || used ? 'inspection' : 'available');
      await movement(uid, action === 'purchase' ? 'Supplier' : 'Customer', input.location || 'Main store', action);
      await journal([['Inventory', cost, 0], [action === 'exchange' ? 'Exchange credit liability' : payment(input.method), 0, cost]]); result = { id: docId, unitId: uid };
    } else if (action === 'inspect') {
      const u = await unit(input.unitId); check(u.status === 'inspection', 'Only a phone awaiting inspection can be released');
      await document('inspection', u.name, 0, 'Passed', { unitId: u.id, notes: text(input.notes, 'Inspection notes') }); await run("UPDATE units SET status='available' WHERE id=?", u.id); await movement(u.id, u.location, u.location, 'inspection passed'); result = { id: docId };
    } else if (action === 'return') {
      const original = await one('SELECT * FROM documents WHERE id=?', input.originalId); check(original && ['sale', 'purchase'].includes(original.kind), 'Enter a valid sale or purchase document');
      const u = await unit(input.unitId); const reason = text(input.reason, 'Return reason'); let amount;
      if (original.kind === 'sale') {
        const line = await one('SELECT * FROM sale_lines WHERE sale_id=? AND unit_id=?', original.id, u.id); check(line, 'This item is not on the selected invoice'); check(u.status === 'sold', 'This item is not sold');
        check(!await one(`SELECT 1 FROM documents WHERE kind='return' AND ${jsonField('originalId')}=? AND ${jsonField('unitId')}=?`, original.id, u.id), 'This sale line has already been returned');
        amount = line.price - line.discount; const tax = Math.round(amount * line.tax / (10000 + line.tax));
        await document('return', original.party, amount, 'Refunded', { originalId: original.id, unitId: u.id, reason, type: 'sales' });
        await run("UPDATE units SET status='inspection',location='Main store' WHERE id=?", u.id); await movement(u.id, 'Customer', 'Main store', 'sales return');
        await journal([['Sales returns', amount - tax, 0], ['Output tax', tax, 0], [payment(input.method), 0, amount], ['Inventory', u.cost, 0], ['Cost of goods sold', 0, u.cost]]);
      } else {
        check(await one('SELECT 1 FROM movements WHERE document_id=? AND unit_id=? AND action=?', original.id, u.id, 'purchase'), 'This item is not on the purchase'); check(u.status === 'available', 'Only available stock can be returned to supplier'); amount = u.cost;
        await document('return', original.party, amount, 'Returned', { originalId: original.id, unitId: u.id, reason, type: 'purchase' }); await run("UPDATE units SET status='returned_to_supplier' WHERE id=?", u.id); await movement(u.id, u.location, 'Supplier', 'purchase return'); await journal([[payment(input.method), amount, 0], ['Inventory', 0, amount]]);
      }
      result = { id: docId, amount };
    } else if (action === 'transfer') {
      const u = await unit(input.unitId); check(u.status === 'available', 'Only available stock can be transferred'); check(['Main store', 'Store room'].includes(input.destination), 'Choose a valid destination'); check(u.location !== input.destination, 'Choose a different destination');
      await document('transfer', input.destination, 0, 'Transferred', { unitId: u.id, from: u.location, to: input.destination }); await movement(u.id, u.location, input.destination, 'transfer'); await run('UPDATE units SET location=? WHERE id=?', input.destination, u.id); result = { id: docId };
    } else if (action === 'expense') {
      const amount = int(input.amount); check(amount > 0, 'Expense must be greater than zero'); await document('expense', text(input.party, 'Paid to'), amount, 'Paid', input); await journal([[`Expense: ${text(input.category, 'Category')}`, amount, 0], [payment(input.method), 0, amount]]); result = { id: docId };
    } else if (action === 'advance') {
      const amount = int(input.amount); check(amount > 0, 'Advance must be greater than zero'); check(['Customer', 'Staff'].includes(input.type), 'Choose customer or staff advance');
      await document('advance', text(input.party), amount, 'Open', { ...input, remaining: amount }); await journal(input.type === 'Customer' ? [[payment(input.method), amount, 0], ['Customer advances', 0, amount]] : [['Staff advances', amount, 0], [payment(input.method), 0, amount]]); result = { id: docId };
    } else if (action === 'settle') {
      const d = await one("SELECT * FROM documents WHERE id=? AND kind IN ('advance','exchange') AND status!='Settled'", input.documentId); check(d, 'Open advance or exchange credit not found'); const data = JSON.parse(d.data);
      const amount = int(input.amount); const remaining = data.remaining ?? d.amount; check(amount > 0 && amount <= remaining, 'Amount exceeds the remaining balance');
      const liability = d.kind === 'exchange' ? 'Exchange credit liability' : data.type === 'Customer' ? 'Customer advances' : 'Staff advances';
      await document('settlement', d.party, amount, 'Settled', { originalId: d.id, method: input.method }); await journal(liability === 'Staff advances' ? [[payment(input.method), amount, 0], [liability, 0, amount]] : [[liability, amount, 0], [payment(input.method), 0, amount]]);
      await run('UPDATE documents SET data=?,status=? WHERE id=?', JSON.stringify({ ...data, remaining: remaining - amount }), remaining === amount ? 'Settled' : d.status, d.id); result = { id: docId };
    } else if (action === 'service') {
      if (input.id) {
        const d = await one("SELECT * FROM documents WHERE id=? AND kind='service'", input.id); check(d, 'Service job not found'); const data = JSON.parse(d.data);
        const next = { 'Received': 'Diagnosing', 'Diagnosing': 'Awaiting approval', 'Awaiting approval': 'Repairing', 'Repairing': 'Ready for pickup', 'Ready for pickup': 'Delivered' }[d.status]; check(input.status === next, 'Invalid service status transition');
        if (next === 'Delivered') { check(user.role === 'owner' || user.role === 'cashier', 'Only the owner or cashier can hand over a device'); check(data.paid, 'Record final payment before handing over the device'); }
        await run('UPDATE documents SET status=? WHERE id=?', next, d.id); result = { id: d.id };
      } else { check(/^\d{15}$/.test(input.imei || ''), 'Enter the device’s 15-digit IMEI'); await document('service', text(input.customer, 'Customer'), int(input.estimate || 0), 'Received', { ...input, device: text(input.device, 'Device'), issue: text(input.issue, 'Reported issue') }); result = { id: docId }; }
    } else if (action === 'service-payment') {
      const d = await one("SELECT * FROM documents WHERE id=? AND kind='service'", input.id); check(d, 'Service job not found'); const data = JSON.parse(d.data); check(!data.paid, 'This repair is already paid'); check(d.status === 'Ready for pickup', 'Mark repair ready for pickup before taking final payment'); const amount = int(input.amount); check(amount > 0, 'Payment must be greater than zero');
      await document('service-payment', d.party, amount, 'Paid', { jobId: d.id, method: input.method }); await journal([[payment(input.method), amount, 0], ['Service income', 0, amount]]); await run('UPDATE documents SET data=? WHERE id=?', JSON.stringify({ ...data, paid: true, paidAmount: amount }), d.id); result = { id: docId };
    } else if (action === 'attendance') {
      check(await one('SELECT 1 FROM employees WHERE id=?', input.employeeId), 'Employee not found'); const a = await one('SELECT * FROM attendance WHERE employee_id=? AND date=?', input.employeeId, date); const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      if (!a) await run('INSERT INTO attendance VALUES(?,?,?,NULL)', input.employeeId, date, time); else { check(!a.check_out, 'Already checked out today'); await run('UPDATE attendance SET check_out=? WHERE employee_id=? AND date=?', time, input.employeeId, date); }
      result = { id: input.employeeId };
    } else if (action === 'salary') {
      const e = await one('SELECT * FROM employees WHERE id=?', input.employeeId); check(e, 'Employee not found'); check(/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month || ''), 'Select a payroll month');
      check(!await one(`SELECT 1 FROM documents WHERE kind='salary' AND ${jsonField('employeeId')}=? AND ${jsonField('month')}=?`, e.id, input.month), 'Salary already paid for this month');
      const incentive = int(input.incentive || 0); const deduction = int(input.deduction || 0); check(deduction <= e.salary + incentive, 'Deductions exceed salary'); const recovery = int(input.advanceRecovery || 0); let staffAdvance = null; let advanceData = null;
      if (recovery) { staffAdvance = await one("SELECT * FROM documents WHERE id=? AND kind='advance' AND status='Open'", input.advanceId); check(staffAdvance, 'Select an open staff advance'); advanceData = JSON.parse(staffAdvance.data); check(advanceData.type === 'Staff' && staffAdvance.party.toLowerCase() === e.name.toLowerCase(), 'Advance must belong to the selected employee'); check(recovery <= (advanceData.remaining ?? staffAdvance.amount), 'Recovery exceeds outstanding advance'); }
      const gross = e.salary + incentive - deduction; check(recovery <= gross, 'Advance recovery exceeds payable salary'); const amount = gross - recovery; await document('salary', e.name, amount, 'Paid', { ...input, base: e.salary }); await journal([['Salary expense', gross, 0], [payment(input.method), 0, amount], ['Staff advances', 0, recovery]]);
      if (staffAdvance) { const remaining = (advanceData.remaining ?? staffAdvance.amount) - recovery; await run('UPDATE documents SET data=?,status=? WHERE id=?', JSON.stringify({ ...advanceData, remaining }), remaining === 0 ? 'Settled' : 'Open', staffAdvance.id); }
      result = { id: docId };
    } else if (action === 'closing') {
      const expected = await cashBalance(db); const counted = int(input.counted); const difference = counted - expected; check(!difference || input.notes?.trim(), 'Explain the cash difference before closing');
      await run('INSERT INTO closings VALUES(?,?,?,?,?,?)', date, expected, counted, difference, input.notes || '', user.id); result = { id: date, expected, counted, difference };
    } else if (action === 'update-product') {
      const previous = await one('SELECT * FROM products WHERE id=?', input.id); check(previous, 'Product not found'); check(Number.isInteger(input.tax) && input.tax >= 0 && input.tax <= 10000, 'Invalid tax rate'); check(['Smartphones', 'Accessories', 'Used phones'].includes(input.category), 'Choose a valid category'); check(previous.category === input.category, 'Product category cannot change after creation');
      await run('UPDATE products SET name=?,brand=?,sku=?,price=?,cost=?,tax=?,reorder=? WHERE id=?', text(input.name), text(input.brand), text(input.sku), int(input.price), int(input.cost), input.tax, int(input.reorder), input.id); result = { id: input.id };
    } else if (action === 'product') {
      const productId = id('PRD'); check(['Smartphones', 'Accessories', 'Used phones'].includes(input.category), 'Choose a valid category'); check(Number.isInteger(input.tax) && input.tax >= 0 && input.tax <= 10000, 'Invalid tax rate');
      await run('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)', productId, text(input.name), text(input.brand, 'Brand'), input.category, text(input.sku, 'SKU'), int(input.price), int(input.cost), input.tax, int(input.reorder ?? 3)); result = { id: productId };
    } else if (action === 'gift') {
      const u = await unit(input.unitId); check(u.status === 'available' && u.location === 'Main store', 'Gift item is unavailable'); check(u.category === 'Accessories', 'Only accessories can be issued as gifts');
      const sale = await one("SELECT * FROM documents WHERE id=? AND kind='sale'", input.saleId); check(sale, 'A gift must reference an existing sale'); await document('gift', sale.party, 0, 'Issued', { saleId: sale.id, unitId: u.id, name: u.name }); await run("UPDATE units SET status='sold' WHERE id=?", u.id); await movement(u.id, u.location, 'Customer', 'gift'); await journal([['Promotional expense', u.cost, 0], ['Inventory', 0, u.cost]]); result = { id: docId };
    } else if (action === 'settings') {
      const settings = { name: text(input.name), address: text(input.address, 'Address'), phone: text(input.phone, 'Phone'), gstin: input.gstin || '', openingCash: 0 }; await run("INSERT INTO settings VALUES('store',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(settings)); result = { id: 'store' };
    } else if (action === 'employee') {
      const employeeId = id('EMP'); await run('INSERT INTO employees VALUES(?,?,?,?,?)', employeeId, text(input.name), text(input.role, 'Job role'), int(input.salary), int(input.incentive || 0)); result = { id: employeeId };
    } else if (action === 'access') {
      const target = await one('SELECT * FROM users WHERE id=?', input.userId); check(target, 'User not found'); check(target.id !== user.id, 'You cannot disable your own account'); check(input.active === 0 || input.active === 1, 'Invalid access status'); await run('UPDATE users SET active=? WHERE id=?', input.active, target.id); await run('DELETE FROM sessions WHERE user_id=?', target.id); result = { id: target.id };
    } else if (action === 'lender-settlement') {
      const sale = await one("SELECT * FROM documents WHERE id=? AND kind='sale'", input.saleId); check(sale, 'Sale not found'); const data = JSON.parse(sale.data); const financed = data.payments.filter(p => p.method === 'Finance').reduce((s, p) => s + p.amount, 0);
      const received = (await one(`SELECT COALESCE(SUM(amount),0) n FROM documents WHERE kind='lender-settlement' AND ${jsonField('saleId')}=?`, sale.id)).n; const amount = int(input.amount);
      check(amount > 0 && amount <= financed - received, 'Settlement exceeds outstanding lender receivable'); check(['UPI', 'Bank transfer'].includes(input.method), 'Receive lender settlements into a bank account');
      await document('lender-settlement', sale.party, amount, 'Received', { saleId: sale.id, method: input.method, reference: text(input.reference, 'Lender reference') }); await journal([[payment(input.method), amount, 0], ['Finance receivable', 0, amount]]); result = { id: docId };
    } else if (action === 'funding') {
      const amount = int(input.amount); check(amount > 0, 'Funding must be greater than zero'); await document('funding', 'Owner capital', amount, 'Posted', { notes: text(input.notes, 'Reference'), method: input.method }); await journal([[payment(input.method), amount, 0], ['Owner capital', 0, amount]]); result = { id: docId };
    } else if (action === 'user') {
      check(input.password?.length >= 12, 'Use a password with at least 12 characters'); check(Object.keys(roles).includes(input.role), 'Invalid role'); const uid = id('USR'); await run('INSERT INTO users VALUES(?,?,?,?,?,1)', uid, text(input.name), text(input.username), hashPassword(input.password), input.role); result = { id: uid };
    } else throw new BusinessError('Unknown action');
    await run('INSERT INTO audit(actor,action,document_id,details) VALUES(?,?,?,?)', user.id, action, result.id, JSON.stringify({ role: user.role }));
    if (requestKey) await run('INSERT INTO requests VALUES(?,?,?)', requestKey, user.id, JSON.stringify(result));
    return result;
  });
}

export async function cashBalance(db) { return (await db.prepare("SELECT COALESCE(SUM(debit-credit),0) balance FROM ledger WHERE account='Cash'").get()).balance; }

export async function snapshot(db, user, demo = false) {
  const owner = ['owner', 'accountant'].includes(user.role);
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  // Independent reads run in parallel to keep page loads fast over the network.
  const [products, units, docs, settingsRows, employees, attendance, closings, cash, ledger, audit, users] = await Promise.all([
    q("SELECT p.*,COUNT(CASE WHEN u.status='available' THEN 1 END) stock FROM products p LEFT JOIN units u ON p.id=u.product_id GROUP BY p.id ORDER BY p.name"),
    q('SELECT u.*,p.name,p.brand,p.category,p.price FROM units u JOIN products p ON p.id=u.product_id ORDER BY u.id'),
    q('SELECT id,kind,date,party,amount,status,data,actor,created_at FROM documents ORDER BY seq DESC'),
    q("SELECT value FROM settings WHERE key='store'"),
    q('SELECT * FROM employees'),
    q('SELECT * FROM attendance WHERE date=?', today()),
    q('SELECT * FROM closings ORDER BY date DESC'),
    cashBalance(db),
    owner ? q('SELECT account,SUM(debit) debit,SUM(credit) credit FROM ledger GROUP BY account') : [],
    owner ? q('SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.id DESC LIMIT 100') : [],
    user.role === 'owner' ? q('SELECT id,name,username,role,active FROM users') : []
  ]);
  const settings = settingsRows[0];
  const data = { user: { id: user.id, name: user.name, role: user.role }, demo, date: today(), products, units, documents: docs.map(d => ({ ...d, data: JSON.parse(d.data) })), employees, attendance, settings: settings ? JSON.parse(settings.value) : { name: 'Mehers', address: 'Boudh, Odisha', phone: '', gstin: '' }, closings, cash, ledger, audit, users };
  if (!owner) { data.products = data.products.map(({ cost, ...p }) => p); data.units = data.units.map(({ cost, ...u }) => u); data.employees = data.employees.map(({ salary, incentive, ...e }) => e); data.documents = data.documents.filter(d => ['sale', 'service', 'advance', 'exchange'].includes(d.kind)); data.closings = []; data.cash = null; }
  if (user.role === 'technician') { data.documents = data.documents.filter(d => d.kind === 'service'); data.products = []; data.units = []; data.employees = []; data.attendance = []; }
  return data;
}
