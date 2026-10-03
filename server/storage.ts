import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';

export class Store {
 readonly db:DatabaseSync;
 readonly dataDir:string;
 readonly uploadDir:string;
 private readonly key:Buffer;
 constructor(dataDir=process.env.CREATOR_DATA_DIR||resolve('data')) {
  this.dataDir=resolve(dataDir);this.uploadDir=join(this.dataDir,'uploads');
  mkdirSync(this.dataDir,{recursive:true,mode:0o700});mkdirSync(this.uploadDir,{recursive:true,mode:0o700});
  const keyPath=join(this.dataDir,'vault.key');
  if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});
  this.key=readFileSync(keyPath);if(this.key.length!==32)throw new Error('本地凭证密钥格式错误，请保留并检查 data/vault.key');
  chmodSync(keyPath,0o600);
  this.db=new DatabaseSync(join(this.dataDir,'creator.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS records_kind ON records(kind); CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, jobs TEXT NOT NULL);');
  chmodSync(join(this.dataDir,'creator.sqlite'),0o600);
 }
 list<T>(kind:string):T[]{return (this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind) as {body:string}[]).map(r=>JSON.parse(r.body));}
 get<T>(kind:string,id:string):T|undefined {const row=this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
 put<T extends {id:string}>(kind:string,value:T):T {this.db.prepare('INSERT INTO records(id,kind,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,body=excluded.body').run(value.id,kind,JSON.stringify(value));return value;}
 remove(kind:string,id:string){this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,id);}
 transaction<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 setSecret(id:string,value:unknown) {const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,nonce);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);const envelope=Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]).toString('base64');this.db.prepare('INSERT INTO vault(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,envelope);}
 getSecret<T>(id:string):T|undefined {const row=this.db.prepare('SELECT value FROM vault WHERE id=?').get(id) as {value:string}|undefined;if(!row)return;const envelope=Buffer.from(row.value,'base64');const decipher=createDecipheriv('aes-256-gcm',this.key,envelope.subarray(0,12));decipher.setAuthTag(envelope.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(envelope.subarray(28)),decipher.final()]).toString('utf8'));}
 removeSecret(id:string){this.db.prepare('DELETE FROM vault WHERE id=?').run(id);}
 idempotency(key:string):{fingerprint:string;jobs:string[]}|undefined {const row=this.db.prepare('SELECT fingerprint,jobs FROM idempotency WHERE key=?').get(key) as {fingerprint:string;jobs:string}|undefined;return row?{fingerprint:row.fingerprint,jobs:JSON.parse(row.jobs)}:undefined;}
 saveIdempotency(key:string,fingerprint:string,jobs:string[]){this.db.prepare('INSERT INTO idempotency(key,fingerprint,jobs) VALUES(?,?,?)').run(key,fingerprint,JSON.stringify(jobs));}
 close(){this.db.close();}
}
