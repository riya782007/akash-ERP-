import { DatabaseSync,backup } from 'node:sqlite';
import { resolve,dirname } from 'node:path';
import { mkdirSync,existsSync } from 'node:fs';
const source=resolve(process.env.ERP_DB||'data/mehers.sqlite');
if(!existsSync(source))throw Error('Database not found; set ERP_DB to the database you want to back up.');
const target=resolve(process.argv[2]||`data/backups/mehers-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
if(existsSync(target)||source===target)throw Error('Backup destination must be a new file.');
mkdirSync(dirname(target),{recursive:true});
const db=new DatabaseSync(source,{readOnly:true});
try{await backup(db,target);const check=new DatabaseSync(target,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');}finally{check.close();}console.log(`Verified backup written to ${target}`);}finally{db.close();}
