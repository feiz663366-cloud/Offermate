/* Offermate 秋招岗位库
   数据：data/jobs/manifest.json + 分组文件（数组编码，字段见 manifest.fields）
   设计要点：
     1) 13k 条全塞一页会卡，按招聘类型拆文件，首屏只加载默认分组；
     2) 只在「加载更多」时增量插 DOM，首屏 40 条；
     3) 每次筛选重建索引一次，输入框防抖 120ms。
*/
(function () {
  'use strict';

  var BASE = 'data/jobs/';
  var PAGE = 40;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    manifest: null,
    group: '',
    rows: [],
    view: [],
    shown: 0,
    q: '',
    city: '',
    nat: '',
    ind: '',
    sort: 'new'
  };

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(u) {
    u = String(u || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  }

  var DAY = 86400000;

  function parseDeadline(s) {
    var m = String(s || '').match(/(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
    if (!m) return null;
    var t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    return isNaN(t) ? null : t;
  }

  function deadlineView(s) {
    var t = parseDeadline(s);
    if (t == null) return { text: String(s || '招满即止'), cls: '' };
    var left = Math.ceil((t - Date.now()) / DAY);
    if (left < 0) return { text: '已截止', cls: 'due' };
    if (left === 0) return { text: '今天截止', cls: 'due' };
    if (left <= 7) return { text: '剩 ' + left + ' 天', cls: 'due' };
    if (left <= 30) return { text: '剩 ' + left + ' 天', cls: 'warn' };
    return { text: '剩 ' + left + ' 天', cls: '' };
  }

  function citiesOf(l) {
    return String(l || '').split(/[\s,，、;；\/|]+/).filter(function (x) { return x && x.length <= 8; });
  }

  function bump(map, key) {
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  }

  function topKeys(map, min, cap) {
    return Object.keys(map)
      .filter(function (k) { return map[k] >= min; })
      .sort(function (a, b) { return map[b] - map[a]; })
      .slice(0, cap);
  }

  function fillSelect(el, items, placeholder) {
    var html = '<option value="">' + esc(placeholder) + '</option>';
    for (var i = 0; i < items.length; i++) {
      html += '<option value="' + esc(items[i]) + '">' + esc(items[i]) + '</option>';
    }
    el.innerHTML = html;
    el.classList.remove('on');
  }

  /* ---------- 数据 ---------- */
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function loadGroup(key) {
    var g = null;
    for (var i = 0; i < state.manifest.groups.length; i++) {
      if (state.manifest.groups[i].key === key) { g = state.manifest.groups[i]; break; }
    }
    if (!g) return Promise.resolve();

    $('jList').innerHTML = '<p class="jobs-loading">正在加载 ' + esc(g.label) + ' 岗位…</p>';
    return getJSON(BASE + g.file).then(function (rows) {
      state.group = key;
      state.rows = rows.map(decorate);
      buildFacets();
      apply();
    });
  }

  var F = null; // 字段下标

  function decorate(row) {
    var it = {
      c: row[F.c], u: row[F.u], w: row[F.w], p: row[F.p],
      l: row[F.l], d: row[F.d], n: row[F.n], i: row[F.i],
      g: row[F.g], dt: row[F.dt]
    };
    it.ls = citiesOf(it.l);
    it.dl = parseDeadline(it.d);
    it.blob = (it.c + ' ' + it.p + ' ' + it.l + ' ' + it.i + ' ' + it.n + ' ' + it.g).toLowerCase();
    return it;
  }

  function buildFacets() {
    var cmap = {}, nmap = {}, imap = {};
    for (var i = 0; i < state.rows.length; i++) {
      var it = state.rows[i];
      bump(nmap, it.n);
      bump(imap, it.i);
      for (var j = 0; j < it.ls.length; j++) bump(cmap, it.ls[j]);
    }
    fillSelect($('fCity'), topKeys(cmap, 8, 46), '全部城市');
    fillSelect($('fNat'), topKeys(nmap, 1, 30), '全部性质');
    fillSelect($('fInd'), topKeys(imap, 1, 40), '全部行业');
    if (state.city) $('fCity').value = state.city;
    if (state.nat) $('fNat').value = state.nat;
    if (state.ind) $('fInd').value = state.ind;
    syncOn();
  }

  function syncOn() {
    ['fType', 'fCity', 'fNat', 'fInd', 'fSort'].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.toggle('on', !!el.value);
    });
  }

  /* ---------- 筛选 + 渲染 ---------- */
  function apply() {
    var q = state.q.trim().toLowerCase();
    var terms = q ? q.split(/\s+/).filter(Boolean) : [];
    var out = [];

    for (var i = 0; i < state.rows.length; i++) {
      var it = state.rows[i];
      if (state.city && it.ls.indexOf(state.city) < 0) continue;
      if (state.nat && it.n !== state.nat) continue;
      if (state.ind && it.i !== state.ind) continue;
      if (terms.length) {
        var ok = true;
        for (var t = 0; t < terms.length; t++) {
          if (it.blob.indexOf(terms[t]) < 0) { ok = false; break; }
        }
        if (!ok) continue;
      }
      out.push(it);
    }

    if (state.sort === 'ddl') {
      out.sort(function (a, b) {
        var av = a.dl == null ? Infinity : a.dl;
        var bv = b.dl == null ? Infinity : b.dl;
        return av - bv;
      });
    } else if (state.sort === 'name') {
      out.sort(function (a, b) { return a.c.localeCompare(b.c, 'zh-Hans-CN'); });
    } else {
      out.sort(function (a, b) { return (b.dt || '').localeCompare(a.dt || ''); });
    }

    state.view = out;
    state.shown = 0;
    $('jList').innerHTML = '';
    $('jHit').textContent = out.length.toLocaleString('zh-CN');
    $('jEmpty').hidden = out.length > 0;
    $('jMore').hidden = true;
    $('jReset').hidden = !(state.q || state.city || state.nat || state.ind);
    $('qClear').hidden = !state.q;
    renderMore();
    writeHash();
  }

  function card(it) {
    var dl = deadlineView(it.d);
    var u = safeUrl(it.u);
    var w = safeUrl(it.w);
    var tags = '';
    if (it.n) tags += '<span class="tag">' + esc(it.n) + '</span>';
    if (it.g) tags += '<span class="tag hot">' + esc(it.g) + '</span>';
    if (dl.cls === 'due') tags += '<span class="tag due">' + esc(dl.text) + '</span>';
    else if (dl.cls === 'warn') tags += '<span class="tag warn">' + esc(dl.text) + '</span>';

    var meta = '';
    if (it.l) meta += '<span><i>地点</i>' + esc(it.l) + '</span>';
    if (it.i) meta += '<span><i>行业</i>' + esc(it.i) + '</span>';
    if (dl.cls !== 'due' && dl.cls !== 'warn') meta += '<span><i>截止</i>' + esc(dl.text) + '</span>';
    if (it.dt) meta += '<span><i>更新</i>' + esc(it.dt) + '</span>';

    var act = u
      ? '<a class="btn btn-lime btn-sm" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">去投递</a>'
      : '<span class="btn btn-ghost btn-sm">见公告</span>';
    var link = w
      ? '<a class="link" href="' + esc(w) + '" target="_blank" rel="noopener noreferrer">招聘公告</a>'
      : '';

    return '<article class="job">' +
      '<div class="job-main">' +
        '<h3 class="job-co">' + esc(it.c) + tags + '</h3>' +
        '<p class="job-pos">' + esc(it.p || '岗位详情见投递页') + '</p>' +
        '<div class="job-meta">' + meta + '</div>' +
      '</div>' +
      '<div class="job-act">' + act + link + '</div>' +
      '</article>';
  }

  function renderMore() {
    var end = Math.min(state.shown + PAGE, state.view.length);
    var buf = [];
    for (var i = state.shown; i < end; i++) buf.push(card(state.view[i]));
    if (buf.length) $('jList').insertAdjacentHTML('beforeend', buf.join(''));
    state.shown = end;

    var left = state.view.length - end;
    $('jMore').hidden = left <= 0;
    $('jMore').textContent = left > 0 ? '加载更多（还有 ' + left.toLocaleString('zh-CN') + ' 条）' : '';
    $('jProgress').textContent = state.view.length
      ? '已显示 ' + state.shown.toLocaleString('zh-CN') + ' / ' + state.view.length.toLocaleString('zh-CN')
      : '';
  }

  /* ---------- 地址栏参数（方便分享某次筛选） ---------- */
  function writeHash() {
    var p = [];
    if (state.group) p.push('type=' + encodeURIComponent(state.group));
    if (state.q) p.push('q=' + encodeURIComponent(state.q));
    if (state.city) p.push('city=' + encodeURIComponent(state.city));
    if (state.nat) p.push('nat=' + encodeURIComponent(state.nat));
    if (state.ind) p.push('ind=' + encodeURIComponent(state.ind));
    if (state.sort !== 'new') p.push('sort=' + state.sort);
    var url = location.pathname + (p.length ? '?' + p.join('&') : '');
    try { history.replaceState(null, '', url); } catch (e) { /* 本地 file:// 可能报错，忽略 */ }
  }

  function readParams() {
    var sp = new URLSearchParams(location.search);
    state.q = sp.get('q') || '';
    state.city = sp.get('city') || '';
    state.nat = sp.get('nat') || '';
    state.ind = sp.get('ind') || '';
    state.sort = sp.get('sort') || 'new';
    return sp.get('type') || '';
  }

  /* ---------- 事件 ---------- */
  function bind() {
    var timer = null;
    $('q').addEventListener('input', function (e) {
      var v = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = v; apply(); }, 120);
    });
    $('qClear').addEventListener('click', function () {
      $('q').value = ''; state.q = ''; apply(); $('q').focus();
    });

    $('fType').addEventListener('change', function (e) {
      loadGroup(e.target.value);
      syncOn();
    });
    ['fCity', 'fNat', 'fInd'].forEach(function (id) {
      $(id).addEventListener('change', function (e) {
        state[{ fCity: 'city', fNat: 'nat', fInd: 'ind' }[id]] = e.target.value;
        syncOn();
        apply();
      });
    });
    $('fSort').addEventListener('change', function (e) {
      state.sort = e.target.value; syncOn(); apply();
    });

    $('jReset').addEventListener('click', function () {
      state.q = ''; state.city = ''; state.nat = ''; state.ind = '';
      $('q').value = '';
      $('fCity').value = ''; $('fNat').value = ''; $('fInd').value = '';
      syncOn();
      apply();
    });

    $('jMore').addEventListener('click', renderMore);

    // 岗位文字过长时点一下展开
    $('jList').addEventListener('click', function (e) {
      var p = e.target.closest && e.target.closest('.job-pos');
      if (p) p.classList.toggle('open');
    });

    // 滚到底自动续 40 条
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (ents) {
        if (ents[0].isIntersecting && !$('jMore').hidden) renderMore();
      }, { rootMargin: '400px' });
      io.observe($('jMore'));
    }
  }

  /* ---------- 启动 ---------- */
  function boot() {
    getJSON(BASE + 'manifest.json').then(function (m) {
      state.manifest = m;
      F = {};
      m.fields.forEach(function (k, i) { F[k] = i; });

      $('jCount').textContent = m.groups.reduce(function (s, g) { return s + g.count; }, 0)
        .toLocaleString('zh-CN');
      $('jUpdated').textContent = '更新于 ' + m.updated;
      var src = $('jSrc');
      if (src) { src.href = m.source; src.textContent = '腾讯文档 · ' + m.sourceName; }
      $('jMeta').innerHTML = '数据更新于 ' + esc(m.updated) +
        ' · 来源 <a href="' + esc(m.source) + '" target="_blank" rel="noopener noreferrer">' +
        esc(m.sourceName) + '</a> · 岗位信息以企业官方公告为准';

      // 招聘类型下拉
      var opts = '';
      m.groups.forEach(function (g) {
        opts += '<option value="' + esc(g.key) + '">' + esc(g.label) + '（' + g.count + '）</option>';
      });
      $('fType').innerHTML = opts;

      var want = readParams();
      var key = want || m.default;
      var exists = m.groups.some(function (g) { return g.key === key; });
      if (!exists) key = m.default;
      $('fType').value = key;
      $('fSort').value = state.sort;
      $('q').value = state.q;

      bind();
      return loadGroup(key);
    }).catch(function (err) {
      var S = window.SITE || {};
      var offline = /^(chrome|moz)-extension:$/.test(location.protocol) || location.protocol === 'file:';
      var online = (S.siteOnline || '') + 'jobs.html';
      if (offline) {
        // 扩展内的 site/ 副本不带 data/（5MB+ 且每天在变），引导到网页版看
        $('jList').innerHTML = '<p class="jobs-loading">岗位库需要联网加载最新数据。' +
          (online.indexOf('http') === 0
            ? '<br><a class="btn btn-lime btn-sm" style="margin-top:14px;display:inline-flex" href="' +
              esc(online) + '" target="_blank" rel="noopener noreferrer">在网页版打开岗位库</a>'
            : '') + '</p>';
      } else {
        $('jList').innerHTML = '<p class="jobs-loading">岗位数据没加载出来（' + esc(err.message) +
          '）。<br>请检查网络后刷新页面。</p>';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
