import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDemo } from '../server/db.mjs';
import { act } from '../server/operations.mjs';
import { assist } from '../server/ai.mjs';

const reply = text => ({ ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text }] }] }) });

test('AI: missing key, privacy, caching, daily cap and role limits', async () => {
  const db = await openDatabase('memory://'); await seedDemo(db);
  const owner = await db.prepare("SELECT * FROM users WHERE id='demo-owner'").get();
  try {
    await assert.rejects(() => assist(db, owner, { task: 'daily' }, {}), /not configured/);
    await act(db, owner, 'sale', { customer: 'Private Person', items: [{ unitId: 'u1', discount: 0 }], payments: [{ method: 'Cash', amount: 5990000 }] });
    let calls = 0;
    const fake = async (url, request) => {
      calls++; const payload = JSON.parse(request.body);
      assert.equal(payload.store, false); assert.equal(payload.model, 'gpt-6-luna');
      assert.ok(payload.max_output_tokens <= 600);
      assert.ok(!/Private Person|990000/.test(payload.input), 'no customer names or IMEIs');
      return reply('Review low stock.');
    };
    const env = { OPENAI_API_KEY: 'test-only', AI_DAILY_REQUEST_LIMIT: '2' };
    assert.equal((await assist(db, owner, { task: 'daily' }, env, fake)).cached, false);
    assert.equal((await assist(db, owner, { task: 'daily' }, env, fake)).cached, true);
    assert.equal(calls, 1);
    await assist(db, owner, { task: 'restock' }, env, fake);
    await assert.rejects(() => assist(db, owner, { task: 'repair', note: 'Screen cracked after fall' }, env, fake), /limit/);
    await assert.rejects(() => assist(db, { id: 't', role: 'technician', name: 'T' }, { task: 'ask', note: 'Best seller this month?' }, env, fake), /role/);
  } finally { await db.close(); }
});

test('AI: repair message uses job facts, fills the name locally and builds a WhatsApp number', async () => {
  const db = await openDatabase('memory://'); await seedDemo(db);
  const owner = await db.prepare("SELECT * FROM users WHERE id='demo-owner'").get();
  try {
    const job = await act(db, owner, 'service', { customer: 'Pooja Sahu', device: 'iPhone 13', issue: 'Display', estimate: 650000, imei: '990000000000901', phone: '98765 43210' });
    const fake = async (url, request) => { const p = JSON.parse(request.body); const input = JSON.parse(p.input); assert.equal(input.data.device, 'iPhone 13'); assert.equal(input.data.language, 'Hindi'); assert.ok(!/Pooja|98765/.test(p.input)); return reply('नमस्ते {{name}}, आपका iPhone 13 मिल गया है।'); };
    const r = await assist(db, owner, { task: 'message', jobId: job.id, language: 'Hindi' }, { OPENAI_API_KEY: 'x' }, fake);
    assert.match(r.text, /नमस्ते Pooja/); assert.equal(r.phone, '919876543210');
  } finally { await db.close(); }
});

test('AI: product smart fill returns structured fields; failures free the cache key', async () => {
  const db = await openDatabase('memory://'); await seedDemo(db);
  const owner = await db.prepare("SELECT * FROM users WHERE id='demo-owner'").get();
  try {
    let fail = true;
    const fake = async (url, request) => {
      const p = JSON.parse(request.body); assert.equal(p.text.format.type, 'json_schema'); assert.equal(p.reasoning.effort, 'none');
      if (fail) return { ok: false, status: 500, text: async () => 'boom' };
      return reply(JSON.stringify({ name: 'Galaxy S24 FE · 8/256 GB', brand: 'Samsung', category: 'Smartphones', sku: 'SAM-S24FE-256', price: 54999, cost: 49500, tax: 18, reorder: 2 }));
    };
    await assert.rejects(() => assist(db, owner, { task: 'product', note: 'samsung s24 fe 256 54999' }, { OPENAI_API_KEY: 'x' }, fake), /No ERP records were changed/);
    fail = false;
    const r = await assist(db, owner, { task: 'product', note: 'samsung s24 fe 256 54999' }, { OPENAI_API_KEY: 'x' }, fake);
    assert.equal(r.product.brand, 'Samsung'); assert.equal(r.product.price, 54999);
  } finally { await db.close(); }
});
