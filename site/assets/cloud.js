/* Offermate 云端客户端（Supabase REST，零依赖）
 *
 * 为什么不用 supabase-js：
 *   1) MV3 扩展页的 CSP 禁止加载远程脚本，SDK 必须打包进包内（约 120KB）；
 *   2) 本项目只用到 Auth 与 PostgREST 两类接口，直接 fetch 足够；
 *   3) 少一个第三方依赖，商店审核少一份代码要解释。
 *
 * 使用方：
 *   - 扩展 Service Worker：background.js 里 importScripts 后 configure()
 *   - 扩展页面：account.html
 *   - 官网页面：my.html（同一份文件，靠 sync-site.py 同步）
 *
 * 配置不写死在这里：URL 与 anon key 来自 config.js 的 cloud 字段。
 * 这样扩展内副本仍然「无任何外部地址」，离线打开不会白屏。
 */
(function (root) {
  'use strict';

  var CFG = { url: '', anonKey: '' };
  var store = null;            /* { get, set, remove } 返回 Promise */
  var session = null;          /* { access_token, refresh_token, expires_at, user } */
  var SESSION_KEY = 'offermate_cloud_session';
  var inflight = null;         /* 并发 refresh 合并，避免多次刷新把 token 轮换掉 */

  /* ---------------- 基础 ---------------- */

  function configured() {
    return !!(CFG.url && CFG.anonKey);
  }

  function base() {
    return String(CFG.url || '').replace(/\/+$/, '');
  }

  function api(path) {
    return base() + path;
  }

  function enc(v) {
    return encodeURIComponent(String(v == null ? '' : v));
  }

  /* 网络层错误统一成一句人话，避免把 fetch 的英文异常直接抛给用户 */
  function netError(e) {
    var msg = (e && e.message) || String(e);
    if (/Failed to fetch|NetworkError|ERR_/i.test(msg)) {
      return new Error('连不上云端，请检查网络后重试');
    }
    return new Error(msg);
  }

  /* 带超时的 fetch。
     没有超时是个真实事故：网络半通（代理黑洞、DNS 卡住、被墙抖动）时
     fetch 会 pending 几分钟，按钮一直停在「正在注册…」，用户只能以为卡死。
     超时后主动 abort，转成一句能看懂的话。 */
  var TIMEOUT = 15000;

  function timedFetch(url, opts) {
    var o = {};
    for (var k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      o.signal = ctrl.signal;
      timer = setTimeout(function () {
        try { ctrl.abort(); } catch (e) { /* 已结束 */ }
      }, TIMEOUT);
    }
    function done() { if (timer) { clearTimeout(timer); timer = null; } }

    return fetch(url, o).then(function (r) {
      done();
      return r;
    }, function (e) {
      done();
      var aborted = (e && (e.name === 'AbortError' || /abort/i.test(e.message || '')));
      if (aborted) {
        throw new Error('连不上云端（' + (TIMEOUT / 1000) + ' 秒无响应）。请换个网络重试，或用手机热点。');
      }
      throw netError(e);
    });
  }

  function parseErr(status, body) {
    var d = body || {};
    var m = d.msg || d.message || d.error_description || d.error || '';
    if (typeof m === 'object') m = m.message || '';
    if (/Invalid login credentials/i.test(m)) return new Error('邮箱或密码不正确');
    if (/Email not confirmed/i.test(m)) return new Error('请先到邮箱点确认链接，再回来登录');
    if (/User already registered/i.test(m)) return new Error('这个邮箱已经注册过了，直接登录即可');
    if (/Password should be at least/i.test(m)) return new Error('密码太短，至少 6 位');
    if (/rate limit|too many/i.test(m)) return new Error('操作太频繁，请稍后再试');
    if (status === 401) return new Error('登录已过期，请重新登录');
    if (status === 403) return new Error('没有权限执行这个操作');
    return new Error(m || ('云端返回错误（' + status + '）'));
  }

  /* ---------------- 会话存储 ---------------- */

  function loadSession() {
    if (!store) return Promise.resolve(null);
    return Promise.resolve(store.get(SESSION_KEY)).then(function (v) {
      session = normalize(v);
      return session;
    }, function () { return null; });
  }

  function normalize(d) {
    if (!d || !d.access_token) return null;
    var exp = Number(d.expires_at || 0);
    if (!exp) {
      /* Supabase 返回的是 expires_in（秒），换算成本地时间戳，省得每次重算 */
      exp = Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600) - 60;
    }
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token || '',
      expires_at: exp,
      user: d.user ? { id: d.user.id, email: d.user.email } : (session && session.user) || null
    };
  }

  function saveSession(d) {
    session = normalize(d);
    if (session && store) {
      store.set(SESSION_KEY, session).catch(function () {});
    }
    return session;
  }

  function clearSession() {
    session = null;
    if (store) store.remove(SESSION_KEY).catch(function () {});
    return Promise.resolve(null);
  }

  function current() {
    return session;
  }

  function isLoggedIn() {
    return !!(session && session.access_token);
  }

  /* ---------------- Auth ---------------- */

  function authPost(path, body) {
    return timedFetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.anonKey },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = {};
        try { d = t ? JSON.parse(t) : {}; } catch (e) { d = {}; }
        if (!r.ok) throw parseErr(r.status, d);
        return d;
      });
    });
  }

  function signUp(email, password) {
    return authPost('/auth/v1/signup', { email: email, password: password }).then(function (d) {
      /* 开了「Confirm email」时不会返回 access_token，此时只能提示去邮箱确认 */
      if (d && d.access_token) return saveSession(d);
      return null;
    });
  }

  function signIn(email, password) {
    return authPost('/auth/v1/token?grant_type=password', { email: email, password: password })
      .then(saveSession);
  }

  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(new Error('登录已过期，请重新登录'));
    if (inflight) return inflight;
    inflight = authPost('/auth/v1/token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then(function (d) {
        inflight = null;
        return saveSession(d);
      }, function (e) {
        inflight = null;
        clearSession();
        throw e;
      });
    return inflight;
  }

  function signOut() {
    var token = session && session.access_token;
    var p = token
      ? timedFetch(api('/auth/v1/logout'), {
          method: 'POST',
          headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + token }
        }).catch(function () { /* 本地一定要退干净，网络失败不影响 */ })
      : Promise.resolve();
    return p.then(clearSession);
  }

  /* 取一个可用 token：剩余不足 60 秒先刷新 */
  function token() {
    if (!session) return Promise.reject(new Error('请先登录'));
    if (session.expires_at && session.expires_at - 60 > Math.floor(Date.now() / 1000)) {
      return Promise.resolve(session.access_token);
    }
    return refresh().then(function (s) { return s.access_token; });
  }

  /* 只拿到一个 access token（例如扩展跳到网页时用 fragment 带过来）：
     查一次 /auth/v1/user 补出用户信息，再当成本地会话存下。
     没有 refresh token，1 小时后过期需要重新登录——这是有意的，
     不把长期凭证放进 URL。 */
  function adoptToken(tk) {
    var t = String(tk || '').trim();
    if (!t) return Promise.resolve(null);
    return timedFetch(api('/auth/v1/user'), {
      headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + t }
    }).catch(function () { return null; }).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json();
    }).then(function (u) {
      return saveSession({
        access_token: t,
        refresh_token: '',
        expires_in: 3600,
        user: u ? { id: u.id, email: u.email } : null
      });
    });
  }

  /* ---------------- PostgREST ---------------- */

  /* opts: { method, path, body, prefer, auth(默认 true), retry } */
  function rest(opts) {
    var needAuth = opts.auth !== false;
    var getToken = needAuth ? token() : Promise.resolve('');

    return getToken.then(function (tk) {
      var headers = { apikey: CFG.anonKey, 'Content-Type': 'application/json' };
      if (tk) headers.Authorization = 'Bearer ' + tk;
      if (opts.prefer) headers.Prefer = opts.prefer;

      return timedFetch(api(opts.path), {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }).then(function (r) {
        return r.text().then(function (t) {
          var d = null;
          if (t) { try { d = JSON.parse(t); } catch (e) { d = null; } }

          /* 401 且还没重试过：多半是 token 刚过期，刷新后重放一次 */
          if (r.status === 401 && needAuth && !opts.retry) {
            return refresh().then(function () {
              return rest(Object.assign({}, opts, { retry: true }));
            });
          }
          if (!r.ok) throw parseErr(r.status, d || {});
          return d;
        });
      });
    });
  }

  /* ---------------- 业务接口 ---------------- */

  /* 投递记录：按时间倒序取最近 limit 条 */
  function listApplications(limit) {
    var n = Math.max(1, Math.min(500, Number(limit) || 200));
    return rest({
      path: '/rest/v1/applications?select=*&order=applied_at.desc&limit=' + n
    }).then(function (rows) { return Array.isArray(rows) ? rows : []; });
  }

  /* 写入一条投递记录；同一 url 重复填写只更新时间与次数 */
  function upsertApplication(rec) {
    var s = session;
    if (!s || !s.user) return Promise.reject(new Error('请先登录'));
    var row = {
      user_id: s.user.id,
      company: String(rec.company || '').slice(0, 80),
      position: String(rec.position || '').slice(0, 80),
      ats: String(rec.ats || '').slice(0, 20),
      host: String(rec.host || '').slice(0, 120),
      url: String(rec.url || '').slice(0, 800),
      page_title: String(rec.page_title || '').slice(0, 200),
      filled: Math.max(0, Math.min(999, Number(rec.filled) || 0)),
      applied_at: rec.applied_at || new Date().toISOString(),
      source: rec.source === 'manual' ? 'manual' : 'extension'
    };
    return rest({
      method: 'POST',
      path: '/rest/v1/applications?on_conflict=user_id,url',
      body: row,
      prefer: 'resolution=merge-duplicates,return=representation'
    });
  }

  function deleteApplication(id) {
    return rest({
      method: 'DELETE',
      path: '/rest/v1/applications?id=eq.' + enc(id),
      prefer: 'return=minimal'
    });
  }

  function updateApplication(id, patch) {
    var body = {};
    if (patch && patch.company !== undefined) body.company = String(patch.company).slice(0, 80);
    if (patch && patch.position !== undefined) body.position = String(patch.position).slice(0, 80);
    return rest({
      method: 'PATCH',
      path: '/rest/v1/applications?id=eq.' + enc(id),
      body: body,
      prefer: 'return=minimal'
    });
  }

  /* 卡密是否被吊销：不需要登录，激活前就能查 */
  function checkRevoked(licenseId) {
    if (!licenseId) return Promise.resolve(null);
    return rest({
      auth: false,
      path: '/rest/v1/revoked_licenses?select=license_id,reason,revoked_at&license_id=eq.' + enc(licenseId)
    }).then(function (rows) {
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    });
  }

  /* 把卡密信息记到自己的档案上（仅客服核对用，不参与授权判定） */
  function bindLicense(info) {
    var s = session;
    if (!s || !s.user) return Promise.resolve(null);
    return rest({
      method: 'PATCH',
      path: '/rest/v1/profiles?id=eq.' + enc(s.user.id),
      body: {
        license_id: info && info.licenseId ? String(info.licenseId).slice(0, 64) : null,
        license_plan: info && info.plan ? String(info.plan).slice(0, 20) : null,
        license_expires_at: (info && info.expiresAt) || null
      },
      prefer: 'return=minimal'
    });
  }

  /* ---------------- 初始化 ---------------- */

  /* storage 适配器：
     扩展内 → chrome.storage.local（Service Worker 与页面都能用）
     网页   → localStorage */
  var chromeStore = {
    get: function (k) {
      return new Promise(function (res) {
        chrome.storage.local.get(k, function (o) { res(o ? o[k] : null); });
      });
    },
    set: function (k, v) {
      return new Promise(function (res) {
        var o = {}; o[k] = v;
        chrome.storage.local.set(o, function () { res(); });
      });
    },
    remove: function (k) {
      return new Promise(function (res) {
        chrome.storage.local.remove(k, function () { res(); });
      });
    }
  };

  var webStore = {
    get: function (k) {
      try { return Promise.resolve(JSON.parse(localStorage.getItem(k) || 'null')); }
      catch (e) { return Promise.resolve(null); }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      return Promise.resolve();
    },
    remove: function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
      return Promise.resolve();
    }
  };

  function pickStore(kind) {
    if (kind === 'chrome') return chromeStore;
    if (kind === 'web') return webStore;
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ? chromeStore : webStore;
  }

  /* cfg: { url, anonKey }；kind: 'chrome' | 'web' | 省略（自动判断） */
  function configure(cfg, kind) {
    CFG = { url: (cfg && cfg.url) || '', anonKey: (cfg && cfg.anonKey) || '' };
    store = pickStore(kind);
    return configured();
  }

  root.__Cloud = {
    configure: configure,
    configured: configured,
    loadSession: loadSession,
    current: current,
    isLoggedIn: isLoggedIn,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    refresh: refresh,
    adoptToken: adoptToken,
    listApplications: listApplications,
    upsertApplication: upsertApplication,
    updateApplication: updateApplication,
    deleteApplication: deleteApplication,
    checkRevoked: checkRevoked,
    bindLicense: bindLicense
  };
})(typeof self !== 'undefined' ? self : this);
