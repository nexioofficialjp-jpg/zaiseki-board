/**
 * 在席ボード API (GAS)
 * 画面は GitHub Pages 側(docs/)。ここはデータの読み書きだけを JSON で返す。
 * 状態は 在席 → 外出 → 退社 → 休み → 在席 と1タップごとに巡回する。
 *
 * GET  ?api=state            全員の状態
 * GET  ?api=me&t=<token>     本人の状態
 * POST JSON {action: 'cycle'|'undo', id}            ボードから
 * POST JSON {action: 'me_cycle'|'me_undo', t}       本人用から
 * POST JSON {key, action: 'list'|'add'|'rename'|'location'|'delete'|'move'|'reissue', ...}  名簿編集(secret.js の鍵)
 */
const STATUSES = ['在席', '外出', '退社', '休み'];
const LOCATIONS = ['渡辺ビルA', '渡辺ビルB', '波多野ビル3F', 'Hope crew'];
const SITE_URL = 'https://nexioofficialjp-jpg.github.io/zaiseki-board/';
const SHEET_ROSTER = '名簿';
const SHEET_LOG = 'ログ';
const CACHE_KEY = 'state_v2';
const CACHE_SEC = 60;
const COL = { id: 1, name: 2, status: 3, updated: 4, prev: 5, token: 6, order: 7, location: 8 };
const ROSTER_HEADER = ['ID', '名前', '状態', '更新時刻', '前状態', 'トークン', '順', '拠点'];
const LOG_HEADER = ['日時', 'ID', '名前', '前', '後', '操作元'];

// ---------- 入口 ----------
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.api) {
    // 旧URLで開いた人を表示側へ送る
    return HtmlService.createHtmlOutput(
      '<meta http-equiv="refresh" content="0;url=' + SITE_URL + '"><a href="' + SITE_URL + '">在席ボードを開く</a>');
  }
  try {
    if (p.api === 'state') return json_({ ok: true, result: getState() });
    if (p.api === 'me') return json_({ ok: true, result: getMe(p.t) });
    throw new Error('不明な api: ' + p.api);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  try {
    const q = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const a = q.action;
    let out;
    if (a === 'cycle') out = cycleStatus(q.id, 'board');
    else if (a === 'undo') out = undoStatus(q.id, 'board');
    else if (a === 'me_cycle') out = cycleStatus(findBy_('token', String(q.t || '')).id, 'me');
    else if (a === 'me_undo') out = undoStatus(findBy_('token', String(q.t || '')).id, 'me');
    else {
      checkKey_(q.key);
      if (a === 'list') out = adminList_();
      else if (a === 'add') out = { id: adminAdd_(q.name, q.location) };
      else if (a === 'rename') out = adminRename_(q.id, q.name);
      else if (a === 'location') out = adminSetLocation_(q.id, q.location);
      else if (a === 'delete') out = adminDelete_(q.id);
      else if (a === 'move') out = adminMove_(q.id, q.dir);
      else if (a === 'reissue') out = { token: adminReissueToken_(q.id) };
      else throw new Error('不明な action: ' + a);
    }
    return json_({ ok: true, result: out });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- シート ----------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name, header) {
  let sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    sh.appendRow(header);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rosterRows_() {
  const sh = sheet_(SHEET_ROSTER, ROSTER_HEADER);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, ROSTER_HEADER.length).getValues();
  const rows = [];
  vals.forEach((v, i) => {
    if (!v[COL.id - 1]) return;
    rows.push({
      row: i + 2,
      id: String(v[COL.id - 1]),
      name: String(v[COL.name - 1]),
      status: String(v[COL.status - 1] || STATUSES[0]),
      updated: v[COL.updated - 1] ? new Date(v[COL.updated - 1]).getTime() : 0,
      prev: String(v[COL.prev - 1] || ''),
      token: String(v[COL.token - 1] || ''),
      order: Number(v[COL.order - 1]) || 0,
      location: String(v[COL.location - 1] || '')
    });
  });
  rows.sort((a, b) => a.order - b.order);
  return rows;
}

function publicMember_(r) {
  return { id: r.id, name: r.name, status: r.status, updated: r.updated, order: r.order, location: r.location };
}

function invalidate_() { CacheService.getScriptCache().remove(CACHE_KEY); }

function log_(r, before, after, source) {
  sheet_(SHEET_LOG, LOG_HEADER).appendRow([new Date(), r.id, r.name, before, after, source || '']);
}

function writeStatus_(sh, r, newStatus, source) {
  const now = new Date();
  sh.getRange(r.row, COL.status, 1, 3).setValues([[newStatus, now, r.status]]);
  log_(r, r.status, newStatus, source);
  invalidate_();
  return { id: r.id, name: r.name, status: newStatus, prev: r.status, updated: now.getTime(), location: r.location };
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function findBy_(key, val) {
  const r = rosterRows_().find(x => x[key] === val);
  if (!r) throw new Error('該当者がいません');
  return r;
}

// ---------- 公開(状態) ----------
function getState() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const state = { ts: Date.now(), statuses: STATUSES, locations: LOCATIONS, members: rosterRows_().map(publicMember_) };
  cache.put(CACHE_KEY, JSON.stringify(state), CACHE_SEC);
  return state;
}

function cycleStatus(id, source) {
  return withLock_(() => {
    const r = findBy_('id', String(id));
    const next = STATUSES[(STATUSES.indexOf(r.status) + 1) % STATUSES.length];
    return writeStatus_(sheet_(SHEET_ROSTER, ROSTER_HEADER), r, next, source || 'board');
  });
}

function undoStatus(id, source) {
  return withLock_(() => {
    const r = findBy_('id', String(id));
    if (!r.prev || STATUSES.indexOf(r.prev) < 0) throw new Error('戻す先がありません');
    return writeStatus_(sheet_(SHEET_ROSTER, ROSTER_HEADER), r, r.prev, (source || 'board') + ':戻す');
  });
}

function getMe(token) {
  if (!token) throw new Error('URLが不正です');
  return publicMember_(findBy_('token', String(token)));
}

// ---------- 名簿編集 (secret.js の ADMIN_KEY が必要) ----------
function checkKey_(key) {
  if (typeof ADMIN_KEY === 'undefined' || !ADMIN_KEY) throw new Error('ADMIN_KEY 未設定');
  if (String(key || '') !== ADMIN_KEY) throw new Error('鍵が違います');
}

function adminList_() {
  return {
    site: SITE_URL,
    locations: LOCATIONS,
    members: rosterRows_().map(r => ({
      id: r.id, name: r.name, location: r.location, status: r.status, updated: r.updated, order: r.order, token: r.token
    }))
  };
}

function rand_(n) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function location_(loc) {
  loc = String(loc || '').trim();
  if (LOCATIONS.indexOf(loc) < 0) throw new Error('拠点は ' + LOCATIONS.join(' / ') + ' のどれか');
  return loc;
}

function adminAdd_(name, location) {
  name = String(name || '').trim();
  if (!name) throw new Error('名前が空です');
  const loc = location_(location);
  return withLock_(() => {
    const sh = sheet_(SHEET_ROSTER, ROSTER_HEADER);
    const rows = rosterRows_();
    const order = rows.length ? Math.max.apply(null, rows.map(r => r.order)) + 1 : 1;
    const id = rand_(6);
    sh.appendRow([id, name, STATUSES[0], new Date(), '', rand_(24), order, loc]);
    log_({ id: id, name: name }, '', STATUSES[0], 'admin:追加(' + loc + ')');
    invalidate_();
    return id;
  });
}

function adminSetLocation_(id, location) {
  const loc = location_(location);
  return withLock_(() => {
    const r = findBy_('id', String(id));
    sheet_(SHEET_ROSTER, ROSTER_HEADER).getRange(r.row, COL.location).setValue(loc);
    log_(r, r.location, loc, 'admin:拠点変更');
    invalidate_();
    return true;
  });
}

function adminRename_(id, name) {
  name = String(name || '').trim();
  if (!name) throw new Error('名前が空です');
  return withLock_(() => {
    const r = findBy_('id', String(id));
    sheet_(SHEET_ROSTER, ROSTER_HEADER).getRange(r.row, COL.name).setValue(name);
    log_(r, r.name, name, 'admin:名前変更');
    invalidate_();
    return true;
  });
}

function adminDelete_(id) {
  return withLock_(() => {
    const r = findBy_('id', String(id));
    sheet_(SHEET_ROSTER, ROSTER_HEADER).deleteRow(r.row);
    log_(r, r.status, '', 'admin:削除');
    invalidate_();
    return true;
  });
}

function adminMove_(id, dir) {
  return withLock_(() => {
    const rows = rosterRows_();
    const i = rows.findIndex(x => x.id === String(id));
    if (i < 0) throw new Error('該当者がいません');
    const j = i + (Number(dir) < 0 ? -1 : 1);
    if (j < 0 || j >= rows.length) return true;
    const sh = sheet_(SHEET_ROSTER, ROSTER_HEADER);
    rows.forEach((r, k) => { r.order = k + 1; });
    const tmp = rows[i].order; rows[i].order = rows[j].order; rows[j].order = tmp;
    rows.forEach(r => sh.getRange(r.row, COL.order).setValue(r.order));
    invalidate_();
    return true;
  });
}

function adminReissueToken_(id) {
  return withLock_(() => {
    const r = findBy_('id', String(id));
    const t = rand_(24);
    sheet_(SHEET_ROSTER, ROSTER_HEADER).getRange(r.row, COL.token).setValue(t);
    log_(r, '', '', 'admin:トークン再発行');
    return t;
  });
}

/** 初回のみ: シートを用意する(エディタから実行して承認する) */
function setup() {
  sheet_(SHEET_ROSTER, ROSTER_HEADER);
  sheet_(SHEET_LOG, LOG_HEADER);
  const s1 = ss_().getSheetByName('シート1') || ss_().getSheetByName('Sheet1');
  if (s1 && ss_().getSheets().length > 1 && s1.getLastRow() === 0) ss_().deleteSheet(s1);
  return 'ok';
}

// 2026-11-19 clasp 送信対象を限定

