/* Offermate 官网交互
   1) 价格卡按 SITE.plans 渲染，改价只改 config.js
   2) 识别从扩展跳转的 ?from=extension&v=x&plan=xxx，显示来源条并高亮对应档位
   3) 群号一键复制
*/
(function () {
  'use strict';

  var S = window.SITE || {};
  var PLANS = S.plans || [];
  var FEATS = S.feats || [];
  var QQ = String(S.qqGroup || '').trim();
  var QQ_JOIN = String(S.qqJoinUrl || '').trim();

  /* 运行环境：扩展内打开（chrome-extension:// / moz-extension://）或本地双击（file://）。
     这两种情况下所有资源必须自带，不能依赖线上地址。 */
  var IS_EXT = /^(chrome|moz)-extension:$/.test(location.protocol);
  var IS_LOCAL = IS_EXT || location.protocol === 'file:';

  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  function $(id) { return document.getElementById(id); }

  /* ---------- 价格卡 ---------- */
  /* 价格最多两位小数、去掉末尾 0：19.99 → 19.99，19.9 → 19.9，119 → 119。
     之前用 toFixed(1)，19.99 会被截成 20.0，改价后必须按两位算。 */
  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return String(Math.round(v * 100) / 100);
  }

  /* 日均价 = 总价 ÷ 周期天数，保留两位（四舍五入）。
     0.6663 → 0.67，0.4443 → 0.44，0.2465 → 0.25。 */
  function perDay(price, days) {
    var d = Number(days);
    if (!isFinite(d) || d <= 0) return '';
    return (Number(price) / d).toFixed(2);
  }

  /* 以月卡（30 天）日均价为基准算省幅，季卡 33%、年卡 63%。
     真实算出来的比例，不是编的折扣。 */
  function saveVs(base) {
    if (!base || !base.price || !base.days) return '';
    var baseDay = base.price / base.days;
    if (!baseDay) return '';
    return function (p) {
      if (p.id === base.id) return 0;
      var pct = Math.round((1 - (p.price / p.days) / baseDay) * 100);
      return pct > 0 ? pct : 0;
    };
  }

  function planHTML(p, hotId, saveFn) {
    var hot = p.id === hotId;
    var save = p.orig && p.orig > p.price ? Math.round((p.orig - p.price) * 100) / 100 : 0;
    var day = perDay(p.price, p.days);
    var pct = saveFn ? saveFn(p) : 0;
    var feats = FEATS.map(function (f) {
      return '<li>' + CHECK + '<span>' + f + '</span></li>';
    }).join('');

    return '' +
      '<article class="plan' + (hot ? ' hot' : '') + '" data-plan="' + p.id + '">' +
        (p.tag ? '<span class="plan-tag">' + p.tag + '</span>' : '') +
        '<div class="plan-name">' + p.name + '</div>' +
        '<div class="plan-desc">' + p.desc + '</div>' +
        '<div class="plan-price">' +
          '<span class="cur">¥</span>' +
          '<span class="num">' + money(p.price) + '</span>' +
          '<span class="unit">/ ' + p.days + ' 天</span>' +
        '</div>' +
        '<div class="plan-perday">' +
          '平均约 <b>¥' + day + '</b> / 天' +
          (pct ? '<span class="plan-save">比月卡省 ' + pct + '%</span>' : '') +
        '</div>' +
        (save ? '<div class="plan-orig"><s>原价 ¥' + money(p.orig) + '</s><b>省 ¥' + money(save) + '</b></div>' : '') +
        '<ul class="plan-feats">' + feats + '</ul>' +
        '<button class="btn ' + (hot ? 'btn-lime' : 'btn-dark') + ' btn-block" data-buy="' + p.id + '">' +
          (p.cta || '获取卡密') +
        '</button>' +
      '</article>';
  }

  function renderPlans() {
    var box = $('planGrid');
    if (!box || !PLANS.length) return;
    // 推荐档：优先带 tag 的；没配 tag 就取中间那档（三档时是季卡）
    var hot = (PLANS.filter(function (p) { return p.tag; })[0] || PLANS[Math.floor(PLANS.length / 2)] || PLANS[0] || {}).id;
    // 省幅基准取月卡；没有月卡就取第一档
    var base = PLANS.filter(function (p) { return p.id === 'month'; })[0] || PLANS[0];
    var saveFn = saveVs(base);
    box.innerHTML = PLANS.map(function (p) { return planHTML(p, hot, saveFn); }).join('');
  }

  /* ---------- 免费额度条 ---------- */
  function renderFree() {
    var box = $('freeBand');
    var F = S.free;
    if (!box || !F) return;
    var fill = Number(F.fill) || 0;
    var quiz = Number(F.quiz) || 0;
    if (!fill && !quiz) { box.hidden = true; return; }
    box.innerHTML = '' +
      '<div class="free-l">' +
        '<span class="free-eyebrow">新用户免费</span>' +
        '<h3>不用先买卡，装完就能填</h3>' +
        '<p>' + (F.note || '') + '</p>' +
      '</div>' +
      '<div class="free-nums">' +
        (fill ? '<div class="free-num"><b>' + fill + '</b><span>次一键填写</span></div>' : '') +
        (quiz ? '<div class="free-num"><b>' + quiz + '</b><span>次测评搜题</span></div>' : '') +
      '</div>';
    box.hidden = false;
  }

  /* ---------- 复制 ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    // file:// 或旧浏览器降级
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve(ok);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  /* 点击「加群获取 xx卡」：能一键加群就跳，否则复制群号并提示 */
  function gotPlan(planId) {
    var p = PLANS.filter(function (x) { return x.id === planId; })[0];
    var label = p ? p.name : '卡密';
    if (QQ_JOIN) {
      window.open(QQ_JOIN, '_blank', 'noopener');
      return;
    }
    copy(QQ).then(function (ok) {
      toast(ok ? ('群号已复制，去 QQ 粘贴搜索，说明要「' + label + '」') : ('请手动搜索 QQ 群：' + QQ));
    });
  }

  /* ---------- 从扩展跳转 ---------- */
  /* 页面间点链接（首页 ↔ 定价）时 query 会丢，用 sessionStorage 兜住。
     同一标签页内有效，不落盘、不外发；file:// 下可能被拒，包 try。 */
  var MEM_KEY = 'offermate_site_ctx';

  function readCtx() {
    var q = new URLSearchParams(location.search);
    var ctx = { from: q.get('from') || '', v: q.get('v') || '', plan: q.get('plan') || '' };
    if (!ctx.from) {
      try {
        var saved = JSON.parse(sessionStorage.getItem(MEM_KEY) || '{}');
        if (saved.from) ctx.from = saved.from;
        if (!ctx.v && saved.v) ctx.v = saved.v;
      } catch (e) {}
    }
    if (ctx.from) {
      try {
        sessionStorage.setItem(MEM_KEY, JSON.stringify({ from: ctx.from, v: ctx.v }));
      } catch (e) {}
    }
    return ctx;
  }

  function initFromExtension() {
    var ctx = readCtx();
    if (ctx.from !== 'extension') return;

    var bar = $('fromBar');
    if (bar) {
      var vEl = bar.querySelector('[data-v]');
      if (vEl) vEl.textContent = ctx.v ? ('v' + ctx.v) : '当前版本';
      /* 扩展内打开时换一句更准确的话：不是「跳转而来」，是扩展自带的页。
         只替换首尾两段，中间的版本号节点不动。 */
      if (IS_EXT) {
        var leadEl = bar.querySelector('[data-from-lead]');
        var tailEl = bar.querySelector('[data-from-tail]');
        if (leadEl) leadEl.textContent = '这是扩展自带的说明页';
        if (tailEl) tailEl.textContent = '，不联网，随时可看。';
      }
      bar.hidden = false;
      var close = bar.querySelector('.x');
      if (close) close.addEventListener('click', function () { bar.hidden = true; });
    }

    // ?plan=month → 高亮那一档（滚动到位 + 描边）
    var want = ctx.plan;
    if (want) {
      var card = document.querySelector('.plan[data-plan="' + want + '"]');
      if (card) {
        card.style.borderColor = '#A8E80A';
        card.style.boxShadow = '0 0 0 3px rgba(201,255,59,.55), 0 24px 60px rgba(20,45,100,.14)';
        setTimeout(function () {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 400);
      }
    }
  }

  /* ---------- 导航滚动高亮 ---------- */
  function initNav() {
    var links = [].slice.call(document.querySelectorAll('.nav-links a[href^="#"]'));
    if (!links.length) return;
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el) map[id] = a;
    });
    if (!window.IntersectionObserver) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.classList.remove('on'); });
        var a = map[e.target.id];
        if (a) a.classList.add('on');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) io.observe(el);
    });
  }

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    renderPlans();
    renderFree();
    initFromExtension();
    initNav();

    // 事件委托：所有「获取卡密」按钮 + 群号复制
    document.addEventListener('click', function (e) {
      var buy = e.target.closest('[data-buy]');
      if (buy) { gotPlan(buy.getAttribute('data-buy')); return; }
      var cp = e.target.closest('[data-copy-qq]');
      if (cp) {
        copy(QQ).then(function (ok) {
          toast(ok ? '群号已复制' : ('群号：' + QQ));
        });
      }
    });

    // 把群号/邮箱填进页面占位
    [].forEach.call(document.querySelectorAll('[data-qq]'), function (el) {
      el.textContent = QQ || '暂未开放';
    });
    /* 「月卡 ¥9.9 起」这类文案也从 config 现算：
       两个渠道价格不同，HTML 里写死数字必然会有一个渠道写错。 */
    if (PLANS.length) {
      var p0 = PLANS[0];
      var fromTxt = p0.name + ' ¥' + money(p0.price) + ' 起。';
      [].forEach.call(document.querySelectorAll('[data-price-from]'), function (el) {
        el.textContent = fromTxt;
      });
    }
    [].forEach.call(document.querySelectorAll('[data-email]'), function (el) {
      el.textContent = S.email || '';
      if (S.email && el.tagName === 'A') el.href = 'mailto:' + S.email;
    });
    [].forEach.call(document.querySelectorAll('[data-ver]'), function (el) {
      el.textContent = S.version ? ('v' + S.version) : '';
    });

    // 隐私政策：扩展内 / 本地双击 → 指向扩展自带的 privacy.html；线上 → 指向站点
    // 用 new URL 解析成绝对地址写进去，页面挪目录也不会指错
    [].forEach.call(document.querySelectorAll('[data-privacy]'), function (el) {
      if (IS_LOCAL) {
        el.href = new URL(S.privacyLocal || '../privacy.html', location.href).href;
      } else {
        el.href = S.privacyUrl || '#';
      }
    });
  });
})();
