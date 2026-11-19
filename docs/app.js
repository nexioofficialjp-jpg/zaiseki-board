// 在席ボード 共通処理 (API 呼び出し・表示部品)
(function () {
  var CFG = window.ZAISEKI_CONFIG;
  var ICONS = { '在席': '💺', '外出': '👣', '退社': '🏃', '休み': '🏠' };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // credentials: 'omit' が重要。Google にログイン中のブラウザでも匿名として呼ぶ。
  function apiGet(params) {
    var u = new URL(CFG.api);
    Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); });
    u.searchParams.set('_', Date.now());
    return fetch(u.toString(), { credentials: 'omit', cache: 'no-store', redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error); return j.result; });
  }
  function apiPost(body) {
    return fetch(CFG.api, { method: 'POST', credentials: 'omit', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error); return j.result; });
  }

  function tile(m, opts) {
    opts = opts || {};
    var b = document.createElement('button');
    b.className = 'tile';
    b.style.setProperty('--c', 'var(--c-' + m.status + ')');
    var multi = m.places && m.places.length > 1;
    if (multi) b.classList.add('multi');
    b.innerHTML = '<span class="name"></span><span class="st"><span class="ic"></span><span class="txt"></span></span>' +
      (opts.hint ? '<span class="hint"></span>' : '') + '<span class="time"></span>' +
      (multi && opts.placeChip !== false ? '<span class="place" title="タップで場所を切り替え"></span>' : '');
    b.querySelector('.name').textContent = m.name;
    b.querySelector('.ic').textContent = ICONS[m.status] || '';
    b.querySelector('.txt').textContent = m.status;
    b.querySelector('.time').textContent = fmtTime(m.updated);
    if (opts.hint) b.querySelector('.hint').textContent = opts.hint;
    var chip = b.querySelector('.place');
    if (chip) {
      chip.textContent = '⇄ ' + m.location;
      chip.onclick = function (ev) { ev.stopPropagation(); if (opts.onPlace) opts.onPlace(m); };
    }
    return b;
  }

  var toastTimer = null;
  function toast(msg, onUndo) {
    var t = document.getElementById('toast');
    if (!t) return;
    document.getElementById('toastMsg').textContent = msg;
    var btn = document.getElementById('undoBtn');
    btn.onclick = function () { t.classList.remove('show'); btn.onclick = null; onUndo(); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); btn.onclick = null; }, 8000);
  }

  window.Z = { cfg: CFG, pad: pad, fmtTime: fmtTime, apiGet: apiGet, apiPost: apiPost, tile: tile, toast: toast, ICONS: ICONS };
})();
