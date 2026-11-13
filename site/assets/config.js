/* Offermate 官网配置 —— 站点所有可变内容集中在这里，改文案/价格不用碰 HTML。
   注意：qqGroup / email 必须与扩展包的 support-info.js 保持一致，
   改完跑 `node _check-site.js` 会比对两处是否同步。

   ---------- 单版本说明（v1.9.23 起） ----------
   全站只有这一份价格配置。扩展内置页（扩展包/site/）由
   `python 内部工具/sync-site.py` 从这里原样复制，商店包与电商包
   打出来的内容完全一致，不再有渠道覆盖文件。

   历史：1.9.16 起曾拆成「电商 9.9 四档 / 商店 19.99 三档」两份配置，
   1.9.22 起两渠道同价，1.9.23 干脆合并回一份——留着两套只会增加漏改风险。
   卡密由同一把私钥签发，任何渠道的卡都能互相激活。 */
/* 用 (window || self) 赋值：官网页面里是 window，扩展 Service Worker 里
   importScripts 加载时没有 window，只能挂到 self 上。两边读到的都是同一份配置。 */
(typeof window !== 'undefined' ? window : self).SITE = {
  brand: 'Offermate',
  slogan: 'AI 网申与测评助手',
  version: '1.9.33',

  /* 联系方式（与扩展 support-info.js 同源） */
  qqGroup: '1129142429',
  email: 'q187002569@163.com',

  /* 外部链接
     privacyUrl   线上部署时用（http/https 打开）
     privacyLocal 扩展内打开时用（chrome-extension:// 下指向扩展自带的隐私政策页）
     site.js 按 location.protocol 自动选，不用改这里 */
  privacyUrl: 'https://feiz663366-cloud.github.io/Offermate/',
  privacyLocal: '../privacy.html',
  /* 线上站根地址（末尾带斜杠）。扩展内「在网页端查看投递记录」用它拼 my.html */
  siteOnline: 'https://feiz663366-cloud.github.io/Offermate/site/',
  /* 扩展下载地址：留空则「获取扩展」按钮改为提示加群 */
  downloadUrl: '',

  /* 云端（Supabase）
     url / anonKey 在 Supabase 控制台 Project Settings → API 里取。
     anonKey 是公开凭证，可以放在前端；service_role key 绝对不要写进来。
     两个值都留空时，扩展与官网完全按纯本地模式运行，不发任何请求。 */
  cloud: {
    url: 'https://wiszvjuuhyiicrqhmdqc.supabase.co',
    anonKey: 'sb_publishable_nmMWahTk1HziPGOl_t8Y-Q_2Xe52diY'
  },

  /* 免费额度：新用户装完直接可用，不需要卡密。
     数值必须与扩展包 license-core.js 的 FREE_QUOTA 一致，
     改完跑 `node _check-site.js` 会比对两处。
     计数方式：一次「一键填写当前页面」算 1 次；一次「测评搜题」算 1 次。 */
  free: {
    fill: 10,
    quiz: 10,
    note: '两种额度分开计、互不占用。用完后粘贴卡密继续，已经填进去的简历和设置都不受影响。'
  },

  /* 价格档位
     id 是站内标识（用于 ?plan= 高亮、data-buy 按钮），**不是**卡密里的 plan 值。
     卡密客户端 materialize() 只认 month / quarter / year 三个值，所以：
       - month / quarter / year 三档：站内 id 与卡密 plan 同名，直接对应
       - buyout（买断版）：签发时用 `--plan year --days 3650`，
         站内 id 只用于展示，不进卡密

     日均价由 site.js 按 price ÷ days 现算，不写死，改价不用同步改文案。
     orig 留空/0 则不显示划线价：没有真实历史成交价时标「原价」属于虚构原价，别填。 */
  plans: [
    {
      id: 'month', name: '月卡', days: 30, price: 9.9, orig: 0,
      tag: '', desc: '短期集中投递',
      cta: '加群获取月卡'
    },
    {
      id: 'quarter', name: '季卡', days: 90, price: 16.99, orig: 0,
      tag: '最划算', desc: '覆盖整个秋招',
      cta: '加群获取季卡'
    },
    {
      id: 'year', name: '年卡', days: 365, price: 29, orig: 0,
      tag: '', desc: '实习 + 春招 + 秋招',
      cta: '加群获取年卡'
    },
    {
      /* 对外叫「买断版」不叫「永久」：「永久」是闲鱼和 Edge 商店的禁词，
         且离线授权无法真正承诺无限期，10 年已经远超应届生的使用周期。 */
      id: 'buyout', name: '买断版', days: 3650, price: 50, orig: 0,
      tag: '', desc: '一次付费，长期可用',
      cta: '加群获取买断版'
    }
  ],

  /* 所有档位都包含的功能（我的卡密不按功能切，只按时长卖） */
  feats: [
    '网申表单一键填写',
    '北森 / Moka / 飞书招聘 通用',
    '教育/实习/项目经历自动增行',
    '本地 PDF / Word 简历解析',
    'AI 测评辅助（Key 可选）',
    '简历只存本机，不上传服务器',
    '不自动提交，投递前由你确认'
  ],

  /* ---------- 体验官福利（share.html） ----------
     玩法：用户在公开平台发一条真实使用体验 → 加群私聊管理员提交链接 →
     人工审核通过 → 买断版立减 off 元。
     off 只作用于 planId 指定的档位，到手价 = 该档 price - off，由 share.js 现算，
     页面 HTML 里不写死任何金额（_check-site.js 会拦「¥ + 数字」）。
     关掉活动把 on 改成 false，页面会整体隐藏福利区并提示「本期已结束」。 */
  share: {
    on: true,
    off: 15,               // 立减金额
    planId: 'buyout',      // 作用于哪一档（改这里就换档）
    channels: '小红书 / 抖音 / B站 / 知乎',
    reviewDays: '1–2 个工作日',
    keepDays: 30,          // 笔记需保持公开的天数
    perPerson: 1           // 每人可领次数
  }
};
