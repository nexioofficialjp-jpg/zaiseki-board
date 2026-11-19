// 在席ボード 名簿操作 (このPC専用。secret.js の ADMIN_KEY と .deploy.json の URL を使う)
// 使い方:
//   node admin.mjs list
//   node admin.mjs add <名前> <拠点> [兼任拠点をカンマ区切り 例: 渡辺ビルA,Hope crew]
//   node admin.mjs rename <ID> <新しい名前>
//   node admin.mjs location <ID> <拠点>            今いる場所を変える
//   node admin.mjs places <ID> <拠点1,拠点2>        兼任拠点を設定(空文字 "" で解除)
//   node admin.mjs move <ID> up|down
//   node admin.mjs reissue <ID>
//   node admin.mjs delete <ID>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const key = /ADMIN_KEY = '([^']+)'/.exec(readFileSync(join(here, 'secret.js'), 'utf8'))[1];
const url = JSON.parse(readFileSync(join(here, '.deploy.json'), 'utf8')).url;

const [action, ...args] = process.argv.slice(2);
const body = { key, action };
if (action === 'add') { [body.name, body.location, body.places] = args; }
else if (action === 'rename') { [body.id, body.name] = args; }
else if (action === 'location') { [body.id, body.location] = args; }
else if (action === 'places') { [body.id, body.places] = args; }
else if (action === 'move') { body.id = args[0]; body.dir = args[1] === 'up' ? -1 : 1; }
else if (action === 'reissue' || action === 'delete') { body.id = args[0]; }
else if (action !== 'list') { console.error('不明な操作: ' + action); process.exit(2); }

const res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
const text = await res.text();
let json;
try { json = JSON.parse(text); } catch { console.error('JSONでない応答:', text.slice(0, 300)); process.exit(1); }
if (!json.ok) { console.error('NG:', json.error); process.exit(1); }

if (action === 'list') {
  const r = json.result;
  console.log('ボード: ' + r.site);
  for (const loc of [...r.locations, 'その他']) {
    const list = r.members.filter(m => loc === 'その他' ? !r.locations.includes(m.location) : m.location === loc);
    if (!list.length) continue;
    console.log('\n[' + loc + ']');
    for (const m of list) {
      const d = m.updated ? new Date(m.updated).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
      const pl = m.places && m.places.length ? `  [兼任: ${m.places.join('/')}]` : '';
      console.log(`  ${m.id}  ${m.name}  ${m.status}  ${d}${pl}`);
    }
  }
} else {
  console.log('OK', JSON.stringify(json.result));
}
