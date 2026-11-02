import { randomUUID } from 'node:crypto';
import { today, hashPassword } from './db.mjs';
export class BusinessError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export const check=(condition,message)=>{if(!condition)throw new BusinessError(message);};
const int=(value,name='Amount')=>{check(Number.isSafeInteger(value)&&value>=0&&value<=100000000000,`${name} must be a non-negative integer in paise`);return value;};
const text=(v,name='Name')=>{check(typeof v==='string'&&v.trim().length>0&&v.length<=500,`${name} is required (maximum 500 characters)`);return v.trim();};
const moneyAccount={Cash:'Cash',UPI:'Bank / UPI',Card:'Card clearing','Bank transfer':'Bank',Finance:'Finance receivable'};
export const roles={owner:['*'],cashier:['sale','service','service-payment','advance','attendance'],technician:['service'],accountant:['purchase','expense','advance','settle','salary','closing','return','lender-settlement']};
const id=(prefix)=>`${prefix}-${randomUUID().slice(0,8).toUpperCase()}`;
export function transact(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
export function act(db,user,action,input={},requestKey){
 check(roles[user.role]?.includes('*')||roles[user.role]?.includes(action),'Your role cannot perform this action');
 return transact(db,()=>{
  if(requestKey){const previous=db.prepare('SELECT * FROM requests WHERE key=?').get(requestKey);if(previous){check(previous.user_id===user.id,'Request key already used');return JSON.parse(previous.result);}}
  const date=today();
  if(!['attendance','service','settings','user','product','employee','access','update-product'].includes(action))check(!db.prepare('SELECT 1 FROM closings WHERE date=?').get(date),'Today is closed. New financial entries are locked until the next business day.');
  let result;const docId=id(action.toUpperCase().slice(0,3));
  function document(kind,party,amount,status,data){db.prepare('INSERT INTO documents(id,kind,date,party,amount,status,data,actor) VALUES(?,?,?,?,?,?,?,?)').run(docId,kind,date,party,amount,status,JSON.stringify(data),user.id);}
  function journal(entries){check(entries.reduce((s,e)=>s+e[1]-e[2],0)===0,'Unbalanced journal');for(const [account,debit,credit] of entries)if(debit||credit)db.prepare('INSERT INTO ledger(document_id,account,debit,credit) VALUES(?,?,?,?)').run(docId,account,debit,credit);}
  function payment(method){check(moneyAccount[method],'Select a valid payment method');check(method!=='Finance'||['sale','return'].includes(action),'Finance is a sales receivable, not a cash or bank payment');return moneyAccount[method];}
  function unit(unitId){const u=db.prepare('SELECT u.*,p.name,p.price,p.tax,p.category FROM units u JOIN products p ON p.id=u.product_id WHERE u.id=?').get(unitId);check(u,'Handset or stock item not found');return u;}
  function movement(unitId,from,to,kind){db.prepare('INSERT INTO movements(unit_id,document_id,from_location,to_location,action) VALUES(?,?,?,?,?)').run(unitId,docId,from,to,kind);}
  function newUnit(data,condition='New',status='available'){
   const product=db.prepare('SELECT * FROM products WHERE id=?').get(data.productId);check(product,'Select an existing product');
   const imei=data.imei?.trim()||null;
   if(product.category!=='Accessories')check(/^\d{15}$/.test(imei||''),'A 15-digit IMEI is required for phones');
   if(imei)check(!db.prepare('SELECT 1 FROM units WHERE imei=?').get(imei),'This IMEI already exists');
   const uid=id('UNT');db.prepare('INSERT INTO units VALUES(?,?,?,?,?,?,?)').run(uid,product.id,imei,condition,data.location||'Main store',status,int(data.cost,'Cost'));return uid;
  }
  if(action==='sale'){
   check(Array.isArray(input.items)&&input.items.length>0&&input.items.length<=100,'Add at least one item');
   check(new Set(input.items.map(i=>i.unitId)).size===input.items.length,'The same unit cannot be billed twice');
   const lines=input.items.map(i=>{const u=unit(i.unitId);check(u.status==='available'&&u.location==='Main store',`${u.name} is not available at this store`);const discount=int(i.discount||0,'Discount');check(discount<=u.price,'Discount exceeds price');if(user.role!=='owner')check(discount<=Math.floor(u.price*.05),'Discounts above 5% require the owner');return {unit:u,discount,net:u.price-discount};});
   const total=int(lines.reduce((s,l)=>s+l.net,0),'Invoice total');
   if(input.employeeId)check(db.prepare('SELECT 1 FROM employees WHERE id=?').get(input.employeeId),'Select a valid salesperson');const payments=input.payments||[];const creditAmount=int(input.creditAmount||0,'Credit applied');let creditDocument=null;let creditData=null;
   if(creditAmount){creditDocument=db.prepare("SELECT * FROM documents WHERE id=? AND kind IN ('advance','exchange') AND status!='Settled'").get(input.creditId);check(creditDocument,'Select an open customer deposit or exchange credit');creditData=JSON.parse(creditDocument.data);check(creditDocument.kind==='exchange'||creditData.type==='Customer','Staff advances cannot be used as customer credit');check(creditDocument.party.toLowerCase()===String(input.customer).trim().toLowerCase(),'Credit belongs to a different customer');check(creditAmount<=(creditData.remaining??creditDocument.amount),'Credit exceeds the outstanding balance');check(creditAmount<=total,'Credit exceeds the invoice total');}
   check(payments.length>0||creditAmount===total,'Add a payment');
   check(payments.reduce((s,p)=>s+int(p.amount),0)+creditAmount===total,'Payment total must equal the invoice total');payments.forEach(p=>payment(p.method));
   const tax=lines.reduce((s,l)=>s+Math.round(l.net*l.unit.tax/(10000+l.unit.tax)),0);
   document('sale',text(input.customer,'Customer'),total,'Completed',{phone:input.phone||'',payments,creditId:creditDocument?.id||null,creditAmount,employeeId:input.employeeId||null,tax,items:lines.map(l=>({unitId:l.unit.id,name:l.unit.name,imei:l.unit.imei,price:l.unit.price,discount:l.discount,net:l.net}))});
   let cost=0;for(const l of lines){db.prepare('INSERT INTO sale_lines VALUES(?,?,?,?,?)').run(docId,l.unit.id,l.unit.price,l.discount,l.unit.tax);db.prepare("UPDATE units SET status='sold' WHERE id=?").run(l.unit.id);movement(l.unit.id,l.unit.location,'Customer','sale');cost+=l.unit.cost;}
   if(creditDocument){const remaining=(creditData.remaining??creditDocument.amount)-creditAmount;db.prepare('UPDATE documents SET data=?,status=? WHERE id=?').run(JSON.stringify({...creditData,remaining}),remaining===0?'Settled':creditDocument.status,creditDocument.id);}
   journal([...payments.map(p=>[payment(p.method),p.amount,0]),...(creditDocument?[[creditDocument.kind==='exchange'?'Exchange credit liability':'Customer advances',creditAmount,0]]:[]),['Sales',0,total-tax],['Output tax',0,tax],['Cost of goods sold',cost,0],['Inventory',0,cost]]);
   result={id:docId,total};
  }else if(action==='purchase'||action==='exchange'){
   const cost=int(input.cost,'Cost');const party=text(input.party,action==='purchase'?'Supplier':'Customer');
   document(action,party,cost,action==='exchange'?'Awaiting inspection':'Received',input);
   const used=db.prepare('SELECT category FROM products WHERE id=?').get(input.productId)?.category==='Used phones';
   const uid=newUnit(input,action==='exchange'||used?(input.condition||'Grade B'):'New',action==='exchange'||used?'inspection':'available');
   movement(uid,action==='purchase'?'Supplier':'Customer',input.location||'Main store',action);
   journal([['Inventory',cost,0],[action==='exchange'?'Exchange credit liability':payment(input.method),0,cost]]);result={id:docId,unitId:uid};
  }else if(action==='inspect'){
   const u=unit(input.unitId);check(u.status==='inspection','Only a phone awaiting inspection can be released');
   document('inspection',u.name,0,'Passed',{unitId:u.id,notes:text(input.notes,'Inspection notes')});db.prepare("UPDATE units SET status='available' WHERE id=?").run(u.id);movement(u.id,u.location,u.location,'inspection passed');result={id:docId};
  }else if(action==='return'){
   const original=db.prepare('SELECT * FROM documents WHERE id=?').get(input.originalId);check(original&&['sale','purchase'].includes(original.kind),'Enter a valid sale or purchase document');
   const u=unit(input.unitId);const reason=text(input.reason,'Return reason');let amount;
   if(original.kind==='sale'){
    const line=db.prepare('SELECT * FROM sale_lines WHERE sale_id=? AND unit_id=?').get(original.id,u.id);check(line,'This item is not on the selected invoice');check(u.status==='sold','This item is not sold');
    check(!db.prepare("SELECT 1 FROM documents WHERE kind='return' AND json_extract(data,'$.originalId')=? AND json_extract(data,'$.unitId')=?").get(original.id,u.id),'This sale line has already been returned');
    amount=line.price-line.discount;const tax=Math.round(amount*line.tax/(10000+line.tax));
    document('return',original.party,amount,'Refunded',{originalId:original.id,unitId:u.id,reason,type:'sales'});
    db.prepare("UPDATE units SET status='inspection',location='Main store' WHERE id=?").run(u.id);movement(u.id,'Customer','Main store','sales return');
    journal([['Sales returns',amount-tax,0],['Output tax',tax,0],[payment(input.method),0,amount],['Inventory',u.cost,0],['Cost of goods sold',0,u.cost]]);
   }else{
    const originalMove=db.prepare('SELECT 1 FROM movements WHERE document_id=? AND unit_id=? AND action=?').get(original.id,u.id,'purchase');check(originalMove,'This item is not on the purchase');check(u.status==='available','Only available stock can be returned to supplier');amount=u.cost;
    document('return',original.party,amount,'Returned',{originalId:original.id,unitId:u.id,reason,type:'purchase'});db.prepare("UPDATE units SET status='returned_to_supplier' WHERE id=?").run(u.id);movement(u.id,u.location,'Supplier','purchase return');journal([[payment(input.method),amount,0],['Inventory',0,amount]]);
   }result={id:docId,amount};
  }else if(action==='transfer'){
   const u=unit(input.unitId);check(u.status==='available','Only available stock can be transferred');check(['Main store','Store room'].includes(input.destination),'Choose a valid destination');check(u.location!==input.destination,'Choose a different destination');
   document('transfer',input.destination,0,'Transferred',{unitId:u.id,from:u.location,to:input.destination});movement(u.id,u.location,input.destination,'transfer');db.prepare('UPDATE units SET location=? WHERE id=?').run(input.destination,u.id);result={id:docId};
  }else if(action==='expense'){
   const amount=int(input.amount);check(amount>0,'Expense must be greater than zero');document('expense',text(input.party,'Paid to'),amount,'Paid',input);journal([[`Expense: ${text(input.category,'Category')}`,amount,0],[payment(input.method),0,amount]]);result={id:docId};
  }else if(action==='advance'){
   const amount=int(input.amount);check(amount>0,'Advance must be greater than zero');check(['Customer','Staff'].includes(input.type),'Choose customer or staff advance');
   document('advance',text(input.party),amount,'Open',{...input,remaining:amount});journal(input.type==='Customer'?[[payment(input.method),amount,0],['Customer advances',0,amount]]:[['Staff advances',amount,0],[payment(input.method),0,amount]]);result={id:docId};
  }else if(action==='settle'){
   const d=db.prepare("SELECT * FROM documents WHERE id=? AND kind IN ('advance','exchange') AND status!='Settled'").get(input.documentId);check(d,'Open advance or exchange credit not found');const data=JSON.parse(d.data);
   const amount=int(input.amount);const remaining=data.remaining??d.amount;check(amount>0&&amount<=remaining,'Amount exceeds the remaining balance');
   const liability=d.kind==='exchange'?'Exchange credit liability':data.type==='Customer'?'Customer advances':'Staff advances';
   document('settlement',d.party,amount,'Settled',{originalId:d.id,method:input.method});journal(liability==='Staff advances'?[[payment(input.method),amount,0],[liability,0,amount]]:[[liability,amount,0],[payment(input.method),0,amount]]);
   db.prepare('UPDATE documents SET data=?,status=? WHERE id=?').run(JSON.stringify({...data,remaining:remaining-amount}),remaining===amount?'Settled':d.status,d.id);result={id:docId};
  }else if(action==='service'){
   if(input.id){
    const d=db.prepare("SELECT * FROM documents WHERE id=? AND kind='service'").get(input.id);check(d,'Service job not found');const data=JSON.parse(d.data);
    const next={'Received':'Diagnosing','Diagnosing':'Awaiting approval','Awaiting approval':'Repairing','Repairing':'Ready for pickup','Ready for pickup':'Delivered'}[d.status];check(input.status===next,'Invalid service status transition');
    if(next==='Delivered'){check(user.role==='owner'||user.role==='cashier','Only the owner or cashier can hand over a device');check(data.paid,'Record final payment before handing over the device');}
    db.prepare('UPDATE documents SET status=? WHERE id=?').run(next,d.id);result={id:d.id};
   }else{check(/^\d{15}$/.test(input.imei||''),'Enter the device’s 15-digit IMEI');document('service',text(input.customer,'Customer'),int(input.estimate||0),'Received',{...input,device:text(input.device,'Device'),issue:text(input.issue,'Reported issue')});result={id:docId};}
  }else if(action==='service-payment'){
   const d=db.prepare("SELECT * FROM documents WHERE id=? AND kind='service'").get(input.id);check(d,'Service job not found');const data=JSON.parse(d.data);check(!data.paid,'This repair is already paid');check(d.status==='Ready for pickup','Mark repair ready for pickup before taking final payment');const amount=int(input.amount);check(amount>0,'Payment must be greater than zero');
   document('service-payment',d.party,amount,'Paid',{jobId:d.id,method:input.method});journal([[payment(input.method),amount,0],['Service income',0,amount]]);db.prepare('UPDATE documents SET data=? WHERE id=?').run(JSON.stringify({...data,paid:true,paidAmount:amount}),d.id);result={id:docId};
  }else if(action==='attendance'){
   check(db.prepare('SELECT 1 FROM employees WHERE id=?').get(input.employeeId),'Employee not found');const a=db.prepare('SELECT * FROM attendance WHERE employee_id=? AND date=?').get(input.employeeId,date);const time=new Date().toLocaleTimeString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'});
   if(!a)db.prepare('INSERT INTO attendance VALUES(?,?,?,NULL)').run(input.employeeId,date,time);else{check(!a.check_out,'Already checked out today');db.prepare('UPDATE attendance SET check_out=? WHERE employee_id=? AND date=?').run(time,input.employeeId,date);}result={id:input.employeeId};
  }else if(action==='salary'){
   const e=db.prepare('SELECT * FROM employees WHERE id=?').get(input.employeeId);check(e,'Employee not found');check(/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month||''),'Select a payroll month');check(!db.prepare("SELECT 1 FROM documents WHERE kind='salary' AND json_extract(data,'$.employeeId')=? AND json_extract(data,'$.month')=?").get(e.id,input.month),'Salary already paid for this month');
   const incentive=int(input.incentive||0);const deduction=int(input.deduction||0);check(deduction<=e.salary+incentive,'Deductions exceed salary');const recovery=int(input.advanceRecovery||0);let staffAdvance=null;let advanceData=null;
   if(recovery){staffAdvance=db.prepare("SELECT * FROM documents WHERE id=? AND kind='advance' AND status='Open'").get(input.advanceId);check(staffAdvance,'Select an open staff advance');advanceData=JSON.parse(staffAdvance.data);check(advanceData.type==='Staff'&&staffAdvance.party.toLowerCase()===e.name.toLowerCase(),'Advance must belong to the selected employee');check(recovery<=(advanceData.remaining??staffAdvance.amount),'Recovery exceeds outstanding advance');}
   const gross=e.salary+incentive-deduction;check(recovery<=gross,'Advance recovery exceeds payable salary');const amount=gross-recovery;document('salary',e.name,amount,'Paid',{...input,base:e.salary});journal([['Salary expense',gross,0],[payment(input.method),0,amount],['Staff advances',0,recovery]]);
   if(staffAdvance){const remaining=(advanceData.remaining??staffAdvance.amount)-recovery;db.prepare('UPDATE documents SET data=?,status=? WHERE id=?').run(JSON.stringify({...advanceData,remaining}),remaining===0?'Settled':'Open',staffAdvance.id);}result={id:docId};
  }else if(action==='closing'){
   const expected=cashBalance(db);const counted=int(input.counted);const difference=counted-expected;check(!difference||input.notes?.trim(),'Explain the cash difference before closing');
   db.prepare('INSERT INTO closings VALUES(?,?,?,?,?,?)').run(date,expected,counted,difference,input.notes||'',user.id);result={id:date,expected,counted,difference};
  }else if(action==='update-product'){
   check(db.prepare('SELECT 1 FROM products WHERE id=?').get(input.id),'Product not found');check(Number.isInteger(input.tax)&&input.tax>=0&&input.tax<=10000,'Invalid tax rate');check(['Smartphones','Accessories','Used phones'].includes(input.category),'Choose a valid category');const previous=db.prepare('SELECT * FROM products WHERE id=?').get(input.id);check(previous.category===input.category,'Product category cannot change after creation');db.prepare('UPDATE products SET name=?,brand=?,sku=?,price=?,cost=?,tax=?,reorder=? WHERE id=?').run(text(input.name),text(input.brand),text(input.sku),int(input.price),int(input.cost),input.tax,int(input.reorder),input.id);result={id:input.id};
  }else if(action==='product'){
   const productId=id('PRD');check(['Smartphones','Accessories','Used phones'].includes(input.category),'Choose a valid category');check(Number.isInteger(input.tax)&&input.tax>=0&&input.tax<=10000,'Invalid tax rate');
   db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?)').run(productId,text(input.name),text(input.brand,'Brand'),input.category,text(input.sku,'SKU'),int(input.price),int(input.cost),input.tax,int(input.reorder??3));result={id:productId};
  }else if(action==='gift'){
   const u=unit(input.unitId);check(u.status==='available'&&u.location==='Main store','Gift item is unavailable');check(u.category==='Accessories','Only accessories can be issued as gifts');
   const sale=db.prepare("SELECT * FROM documents WHERE id=? AND kind='sale'").get(input.saleId);check(sale,'A gift must reference an existing sale');document('gift',sale.party,0,'Issued',{saleId:sale.id,unitId:u.id,name:u.name});db.prepare("UPDATE units SET status='sold' WHERE id=?").run(u.id);movement(u.id,u.location,'Customer','gift');journal([['Promotional expense',u.cost,0],['Inventory',0,u.cost]]);result={id:docId};
  }else if(action==='settings'){
   const settings={name:text(input.name),address:text(input.address,'Address'),phone:text(input.phone,'Phone'),gstin:input.gstin||'',openingCash:0};db.prepare("INSERT INTO settings VALUES('store',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(settings));result={id:'store'};
  }else if(action==='employee'){
   const employeeId=id('EMP');db.prepare('INSERT INTO employees VALUES(?,?,?,?,?)').run(employeeId,text(input.name),text(input.role,'Job role'),int(input.salary),int(input.incentive||0));result={id:employeeId};
  }else if(action==='access'){
   const target=db.prepare('SELECT * FROM users WHERE id=?').get(input.userId);check(target,'User not found');check(target.id!==user.id,'You cannot disable your own account');check(input.active===0||input.active===1,'Invalid access status');db.prepare('UPDATE users SET active=? WHERE id=?').run(input.active,target.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);result={id:target.id};
  }else if(action==='lender-settlement'){
   const sale=db.prepare("SELECT * FROM documents WHERE id=? AND kind='sale'").get(input.saleId);check(sale,'Sale not found');const data=JSON.parse(sale.data);const financed=data.payments.filter(p=>p.method==='Finance').reduce((s,p)=>s+p.amount,0);const received=db.prepare("SELECT COALESCE(SUM(amount),0) n FROM documents WHERE kind='lender-settlement' AND json_extract(data,'$.saleId')=?").get(sale.id).n;const amount=int(input.amount);check(amount>0&&amount<=financed-received,'Settlement exceeds outstanding lender receivable');check(['UPI','Bank transfer'].includes(input.method),'Receive lender settlements into a bank account');document('lender-settlement',sale.party,amount,'Received',{saleId:sale.id,method:input.method,reference:text(input.reference,'Lender reference')});journal([[payment(input.method),amount,0],['Finance receivable',0,amount]]);result={id:docId};
  }else if(action==='funding'){
   const amount=int(input.amount);check(amount>0,'Funding must be greater than zero');document('funding','Owner capital',amount,'Posted',{notes:text(input.notes,'Reference'),method:input.method});journal([[payment(input.method),amount,0],['Owner capital',0,amount]]);result={id:docId};
  }else if(action==='user'){
   check(input.password?.length>=12,'Use a password with at least 12 characters');check(Object.keys(roles).includes(input.role),'Invalid role');const uid=id('USR');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run(uid,text(input.name),text(input.username),hashPassword(input.password),input.role);result={id:uid};
  }else throw new BusinessError('Unknown action');
  db.prepare('INSERT INTO audit(actor,action,document_id,details) VALUES(?,?,?,?)').run(user.id,action,result.id,JSON.stringify({role:user.role}));
  if(requestKey)db.prepare('INSERT INTO requests VALUES(?,?,?)').run(requestKey,user.id,JSON.stringify(result));return result;
 });
}
export function cashBalance(db){return db.prepare("SELECT COALESCE(SUM(debit-credit),0) balance FROM ledger WHERE account='Cash'").get().balance;}
export function snapshot(db,user,demo=false){
 const owner=['owner','accountant'].includes(user.role);
 const products=db.prepare("SELECT p.*,COUNT(CASE WHEN u.status='available' THEN 1 END) stock FROM products p LEFT JOIN units u ON p.id=u.product_id GROUP BY p.id ORDER BY p.name").all();
 const units=db.prepare('SELECT u.*,p.name,p.brand,p.category,p.price FROM units u JOIN products p ON p.id=u.product_id ORDER BY u.id').all();
 const docs=db.prepare('SELECT * FROM documents ORDER BY created_at DESC,rowid DESC').all().map(d=>({...d,data:JSON.parse(d.data)}));
 const settings=db.prepare("SELECT value FROM settings WHERE key='store'").get();
 const data={user:{id:user.id,name:user.name,role:user.role},demo,date:today(),products,units,documents:docs,employees:db.prepare('SELECT * FROM employees').all(),attendance:db.prepare('SELECT * FROM attendance WHERE date=?').all(today()),settings:settings?JSON.parse(settings.value):{name:'Mehers',address:'Boudh, Odisha',phone:'',gstin:''},closings:db.prepare('SELECT * FROM closings ORDER BY date DESC').all(),cash:cashBalance(db),ledger:owner?db.prepare('SELECT account,SUM(debit) debit,SUM(credit) credit FROM ledger GROUP BY account').all():[],audit:owner?db.prepare('SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.id DESC LIMIT 100').all():[],users:user.role==='owner'?db.prepare('SELECT id,name,username,role,active FROM users').all():[]};
 if(!owner){data.products=data.products.map(({cost,...p})=>p);data.units=data.units.map(({cost,...u})=>u);data.employees=data.employees.map(({salary,incentive,...e})=>e);data.documents=data.documents.filter(d=>['sale','service','advance','exchange'].includes(d.kind));data.closings=[];data.cash=null;}
 if(user.role==='technician'){data.documents=data.documents.filter(d=>d.kind==='service');data.products=[];data.units=[];data.employees=[];data.attendance=[];}
 return data;
}
