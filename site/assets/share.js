/* 体验官福利页（share.html）
   页面上所有数字都来自 config.js 的 SITE.share，HTML 里不写死金额：
   改立减额度、换档位、换平台、调审核时效，只改 config.js 一处。
   _check-site.js 会拦「HTML 里出现 ¥ + 数字」，所以这里的 ¥ 也是运行时拼的。
*/
(function () {
  'use strict';

  var S = window.SITE || {};
  var SH = S.share || {};
  var PLANS = S.plans || [];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function all(sel) { return [].slice.call(document.querySelectorAll(sel)); }

  /* 最多两位小数、去掉末尾 0：50 → 50，19.99 → 19.99 */
  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return String(Math.round(v * 100) / 100);
  }

  function fill(sel, text) {
    all(sel).forEach(function (el) { el.textContent = text; });
  }

  function render() {
    var off = Number(SH.off) || 0;
    var planId = SH.planId || 'buyout';
    var plan = PLANS.filter(function (p) { return p.id === planId; })[0] || null;

    /* 先把数字都填上：即使活动暂停，页面也不该出现「立减  元」这种空档 */
    fill('[data-share-off]', money(off));
    fill('[data-share-limit]', SH.perPerson || 1);
    fill('[data-share-keep]', SH.keepDays || 30);
    fill('[data-share-channels]', SH.channels || '公开平台');
    fill('[data-share-review]', SH.reviewDays || '1–2 个工作日');

    if (plan) {
      var now = Math.round((plan.price - off) * 100) / 100;
      fill('[data-share-plan-name]', plan.name);
      fill('[data-share-was]', '¥' + money(plan.price));
      fill('[data-share-now]', money(now > 0 ? now : 0));

      /* 到手价算出来是负数或 0，说明立减额度配错了（比原价还高）。
         这种时候宁可原价展示，也不能让页面出现「¥0」这种不可信的数字。 */
      if (now <= 0) {
        fill('[data-share-now]', money(plan.price));
        fill('[data-share-was]', '');
        var save = $('.cp-price .save');
        if (save) save.hidden = true;
      }
    }

    /* 关掉活动：收起券面 / 首页福利块 / 定价页福利条，只留一句「本期已结束」，
       避免还在承诺一个拿不到的优惠。
       注意用 style.display 而不是 hidden 属性——.coupon 在 CSS 里是 display:grid，
       [hidden] 的 display:none 会被它盖掉，元素照样显示。 */
    if (SH.on === false) {
      all('[data-share-block]').forEach(function (el) { el.style.display = 'none'; });
      all('[data-share-offline]').forEach(function (el) { el.hidden = false; });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
