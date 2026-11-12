/* 我的投递（线上站）
 *
 * 数据来源：Supabase 的 applications 表，按 RLS 只返回当前登录用户的行。
 * 与扩展共享同一份 cloud.js，区别只在存储适配器（这里用 localStorage）。
 */
(function () {
  'use strict';

  var S = window.SITE || {};
  var CFG = S.cloud || {};
  var ON = false;
  var rows = [];

  function $(id) { return document.getElementById(id); }

  function hint(el, text, kind) {
    var box = $(el);
    box.textContent = text || '';
    box.className = (el === 'authHint' ? 'my-hint' : 'my-hint') + (kind ? ' ' + kind : '');
  }

  function fmt(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderList() {
    var box = $('list');
    box.innerHTML = '';

    if (!rows.length) {
      $('emptyText').hidden = false;
      $('statText').textContent = '0 条';
      return;
    }
    $('emptyText').hidden = true;
    $('statText').textContent = '共 ' + rows.length + ' 条';

    rows.forEach(function (r) {
      var li = document.createElement('li');

      var co = document.createElement('span');
      co.className = 'co';
      co.textContent = r.company || r.host || '未命名';

      var po = document.createElement('span');
      po.className = 'po';
      po.textContent = r.position || r.ats || '';

      var meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = fmt(r.applied_at) + (r.filled ? ' · 填 ' + r.filled + ' 项' : '');

      var del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.textContent = '删除';
      del.addEventListener('click', function () {
        if (!window.confirm('删除这条记录？云端也会一起删掉。')) return;
        del.disabled = true;
        __Cloud.deleteApplication(r.id).then(function () {
          rows = rows.filter(function (x) { return x.id !== r.id; });
          renderList();
          hint('listHint', '已删除', 'ok');
        }).catch(function (e) {
          del.disabled = false;
          hint('listHint', (e && e.message) || '删除失败', 'err');
        });
      });

      li.appendChild(co);
      if (po.textContent) li.appendChild(po);
      li.appendChild(meta);
      li.appendChild(del);
      box.appendChild(li);
    });
  }

  function loadList() {
    return __Cloud.listApplications(200).then(function (list) {
      rows = list;
      renderList();
    }).catch(function (e) {
      hint('listHint', (e && e.message) || '读取失败', 'err');
    });
  }

  function showAuthed(loggedIn, email) {
    $('authCard').hidden = !!loggedIn;
    $('listCard').hidden = !loggedIn;
    if (loggedIn) {
      hint('listHint', email ? ('当前账号：' + email) : '');
      return loadList();
    }
    return Promise.resolve();
  }

  function auth(mode) {
    var email = String($('email').value || '').trim();
    var pwd = String($('password').value || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { hint('authHint', '邮箱格式不对', 'err'); return; }
    if (pwd.length < 6) { hint('authHint', '密码至少 6 位', 'err'); return; }

    $('loginBtn').disabled = true;
    $('signupBtn').disabled = true;
    hint('authHint', mode === 'signup' ? '正在注册…' : '正在登录…');

    var p = mode === 'signup' ? __Cloud.signUp(email, pwd) : __Cloud.signIn(email, pwd);
    p.then(function (s) {
      $('loginBtn').disabled = false;
      $('signupBtn').disabled = false;
      if (!s) { hint('authHint', '注册成功，请到邮箱点确认链接后再登录', 'ok'); return; }
      $('password').value = '';
      showAuthed(true, s.user && s.user.email);
    }).catch(function (e) {
      $('loginBtn').disabled = false;
      $('signupBtn').disabled = false;
      hint('authHint', (e && e.message) || '操作失败', 'err');
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    ON = __Cloud.configure(CFG, 'web');
    if (!ON) {
      $('noticeCard').hidden = false;
      $('authCard').hidden = true;
      $('listCard').hidden = true;
      return;
    }

    $('loginBtn').addEventListener('click', function () { auth('signin'); });
    $('signupBtn').addEventListener('click', function () { auth('signup'); });
    $('password').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') auth('signin');
    });
    $('syncBtn').addEventListener('click', function () { loadList(); });
    $('logoutBtn').addEventListener('click', function () {
      __Cloud.signOut().then(function () {
        showAuthed(false);
        hint('authHint', '已退出登录', 'ok');
      });
    });

    /* 扩展跳过来时会带 #t=<access token>。
       先取走再立刻把 fragment 抹掉，避免留在地址栏/历史记录里。 */
    var hash = String(location.hash || '');
    var m = /[#&]t=([^&]+)/.exec(hash);
    var handoff = m ? decodeURIComponent(m[1]) : '';
    if (handoff) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }

    var start = handoff
      ? __Cloud.adoptToken(handoff).then(function (s) {
          return s ? showAuthed(true, s.user && s.user.email) : null;
        })
      : __Cloud.loadSession().then(function (s) {
          return s && s.access_token ? showAuthed(true, s.user && s.user.email) : showAuthed(false);
        });

    Promise.resolve(start).catch(function () { showAuthed(false); });
  });
})();
