import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('C:/Users/lzl19/.dsh/profiles/web/data/client.db', { readOnly: true });

const rows = db.prepare(`SELECT id, ts, text FROM episodic ORDER BY ts DESC LIMIT 20`).all();
console.log('=== latest 20 (ts desc) ===');
for (const r of rows) {
  const t = String(r.text ?? '');
  let kind = 'other';
  if (t.includes('"position"')) kind = 'mc_status';
  else if (t.includes('"facing"')) kind = 'mc_look';
  else if (/goto|gotoNear|gotoXZ|pathfind|wedged|timed out/.test(t)) kind = 'GOTO';
  else if (/mc_see|睁眼|画面|环顾|第一人称/.test(t)) kind = 'MC_SEE';
  else if (/chant|咏唱|回春|祈愿|innate|女神/.test(t)) kind = 'MYSTIC';
  else if (/dig|挖|Digging|blockUpdate/.test(t)) kind = 'DIG';
  else kind = t.slice(0, 20);
  console.log(`[${r.id}] ${kind}: ${t.slice(0, 110).replace(/\n/g, ' ')}`);
}

const see = db.prepare(`SELECT COUNT(*) c FROM episodic WHERE text LIKE '%环顾%' OR text LIKE '%第一人称%' OR text LIKE '%已拍摄%'`).get();
console.log(`\nmc_see total count: ${see.c}`);
db.close();
