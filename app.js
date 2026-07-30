/* ============================================================
 * 高考718高频词 · 背单词工作台
 * 学习闭环：背单词 → 今日文章 → 今日拼写 → 重点复习（艾宾浩斯）
 * ============================================================ */
"use strict";

/* ---------------- 基础工具 ---------------- */
const WORD_MAP = {};
WORDS.forEach(w => WORD_MAP[w.id] = w);
const TOTAL_DAYS = GROUPS.length;

function todayStr(d) {
  const t = d || new Date();
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}
function addDays(dateStr, n) {
  const p = dateStr.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1, p[2] + n);
  return todayStr(d);
}
function diffDays(a, b) { // b - a （天）
  const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
  return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000);
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// 是否支持 Web Speech 语音合成（部分 Android WebView / 旧系统不支持）
const TTS_OK = (typeof window !== "undefined") && !!window.speechSynthesis;
if (!TTS_OK && document && document.body) document.body.classList.add("no-tts");

function speak(text) {
  if (!TTS_OK) return; // 当前环境无语音能力，静默跳过（按钮已隐藏）
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
}

/* ---------------- 词形匹配（用于文章高亮/拼写挖空） ---------------- */
const IRREG = {
  lead:["led"],seek:["sought"],feed:["fed"],deal:["dealt"],mean:["meant"],win:["won"],
  rise:["rose","risen"],arise:["arose","arisen"],bear:["bore","borne"],catch:["caught"],
  fight:["fought"],stand:["stood"],hold:["held"],spend:["spent"],bend:["bent"],
  strike:["struck"],swing:["swung"],hang:["hung"],stick:["stuck"],dig:["dug"],
  draw:["drew","drawn"],throw:["threw","thrown"],grow:["grew","grown"],fly:["flew","flown"],
  blow:["blew","blown"],wear:["wore","worn"],tear:["tore","torn"],swear:["swore","sworn"],
  freeze:["froze","frozen"],steal:["stole","stolen"],wake:["woke","woken"],
  forbid:["forbade","forbidden"],forgive:["forgave","forgiven"],hide:["hid","hidden"],
  ride:["rode","ridden"],shake:["shook","shaken"],mistake:["mistook","mistaken"],
  undertake:["undertook","undertaken"],overcome:["overcame"],swim:["swam","swum"],
  sink:["sank","sunk"],shrink:["shrank","shrunk"],spring:["sprang","sprung"],
  sweep:["swept"],weep:["wept"],pay:["paid"],lay:["laid"],sell:["sold"],flee:["fled"],
  shoot:["shot"],forget:["forgot","forgotten"],bind:["bound"],wind:["wound"],
  grind:["ground"],slide:["slid"],light:["lit"],prove:["proven"],
  overhear:["overheard"],withdraw:["withdrew","withdrawn"],oversee:["oversaw","overseen"],
  foresee:["foresaw","foreseen"],burn:["burnt"],learn:["learnt"],dream:["dreamt"],
  lean:["leant"],kneel:["knelt"],spill:["spilt"]
};
function wordForms(word) {
  const w = word.toLowerCase();
  const f = new Set([w, w+"s", w+"es", w+"ed", w+"d", w+"ing", w+"er", w+"est", w+"ly"]);
  if (w.endsWith("e")) { f.add(w.slice(0,-1)+"ing"); f.add(w.slice(0,-1)+"ed"); }
  if (w.endsWith("y")) { f.add(w.slice(0,-1)+"ies"); f.add(w.slice(0,-1)+"ied"); f.add(w.slice(0,-1)+"ier"); f.add(w.slice(0,-1)+"iest"); }
  if (w.length > 2) { f.add(w + w[w.length-1] + "ing"); f.add(w + w[w.length-1] + "ed"); }
  (IRREG[w] || []).forEach(x => f.add(x));
  return f;
}
// 每天的 form -> wordId 映射（较长的原词优先，避免短词吃掉长词）
function buildFormMap(dayIdx) {
  const map = {};
  const ids = GROUPS[dayIdx] || [];
  const words = ids.map(id => WORD_MAP[id]).sort((a, b) => b.word.length - a.word.length);
  words.forEach(w => {
    wordForms(w.word).forEach(f => { if (!(f in map)) map[f] = w.id; });
  });
  return map;
}

/* ---------------- 数据持久化 ---------------- */
const STORAGE_KEY = "english_workbench_v2";
const DEFAULT_STATE = {
  version: 2,
  currentDay: 1,                 // 1-based
  flash: {},                     // day -> {idx, known:[], unknown:[], done}
  review: {},                    // wordId -> {addedDate, stage, nextReviewDate, lastResult, history, sources}
  completion: {},                // day -> {flash, article, spelling}
  reviewDone: {},                // dateStr -> true（当天到期任务清空过）
  streak: { last: "", count: 0 },
  notes: {},                     // day -> text
  spell: {}                      // day -> {vals:{}, hinted:[], checked}
};
let S = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 2) return Object.assign(JSON.parse(JSON.stringify(DEFAULT_STATE)), s);
    }
    // 兼容 v1：仅尝试迁移重点词表
    const old = localStorage.getItem("english_workbench_v1");
    const s2 = JSON.parse(JSON.stringify(DEFAULT_STATE));
    if (old) {
      try {
        const o = JSON.parse(old);
        (o.keyWords || o.important || []).forEach(id => {
          if (WORD_MAP[id]) s2.review[id] = newRec("manual");
        });
      } catch (e) { /* 迁移失败则忽略，不报错 */ }
    }
    return s2;
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); }

/* ---------------- 艾宾浩斯调度 ---------------- */
const INTERVALS = [1, 2, 4, 7, 15, 30]; // stage s -> 下次间隔
const STAGE_MAX = 6;
function newRec(source) {
  const t = todayStr();
  return { addedDate: t, stage: 0, nextReviewDate: addDays(t, 1), lastResult: null, history: [], sources: [source] };
}
function addToReview(wordId, source) {
  const rec = S.review[wordId];
  if (rec) {
    if (rec.sources.indexOf(source) < 0) rec.sources.push(source);
    save();
    return false; // 已存在
  }
  S.review[wordId] = newRec(source);
  save();
  return true;
}
function answerReview(wordId, correct) {
  const rec = S.review[wordId] || (S.review[wordId] = newRec("review-wrong"));
  const t = todayStr();
  rec.history.push({ date: t, result: correct ? "correct" : "wrong" });
  rec.lastResult = correct ? "correct" : "wrong";
  if (correct) {
    rec.stage = Math.min(rec.stage + 1, STAGE_MAX);
    rec.nextReviewDate = addDays(t, INTERVALS[Math.min(rec.stage, INTERVALS.length - 1)]);
  } else {
    rec.stage = 0;
    rec.nextReviewDate = addDays(t, 1);
    if (rec.sources.indexOf("review-wrong") < 0) rec.sources.push("review-wrong");
  }
  save();
}
function dueList() {
  const t = todayStr();
  return Object.keys(S.review)
    .filter(id => S.review[id].nextReviewDate <= t)
    .sort((a, b) => S.review[a].stage - S.review[b].stage);
}
function touchStreak() {
  const t = todayStr();
  if (S.streak.last === t) return;
  S.streak.count = (S.streak.last && diffDays(S.streak.last, t) === 1) ? S.streak.count + 1 : 1;
  S.streak.last = t;
  save();
}
function comp(day) {
  if (!S.completion[day]) S.completion[day] = { flash: false, article: false, spelling: false };
  return S.completion[day];
}
const SOURCE_LABEL = { flash: "背单词", manual: "手动收藏", "review-wrong": "复习答错", article: "文章收藏" };
const SOURCE_TAG = { flash: "blue", manual: "amber", "review-wrong": "red", article: "blue" };

/* ---------------- 路由 ---------------- */
let page = "home";
function nav(p) {
  page = p;
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => nav(btn.dataset.tab));
});
function setActiveTab() {
  const map = { article: "home", spell: "home", keyquiz: "key" };
  const active = map[page] || page;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === active));
}

/* ---------------- 弹层 ---------------- */
const sheetEl = document.getElementById("sheet");
const maskEl = document.getElementById("sheet-mask");
function openSheet(html) {
  sheetEl.innerHTML = html;
  sheetEl.classList.remove("hidden");
  maskEl.classList.remove("hidden");
}
function closeSheet() {
  sheetEl.classList.add("hidden");
  maskEl.classList.add("hidden");
}
maskEl.addEventListener("click", closeSheet);

function wordSheet(wordId, ctx) {
  const w = WORD_MAP[wordId];
  const inKey = !!S.review[wordId];
  let sentHtml = "";
  if (ctx && ctx.sentence) {
    sentHtml = '<div class="fc-sec"><div class="lab">文中例句</div><div class="en">' + ctx.sentence +
      '</div>' + (ctx.sentenceCn ? '<div class="cn">' + esc(ctx.sentenceCn) + '</div>' : '') + '</div>';
  }
  openSheet(
    '<div class="row" style="align-items:center">' +
      '<div class="grow"><span class="fc-word">' + esc(w.word) + '</span> ' +
      '<span class="sub">' + esc(w.phonetic) + ' ' + esc(w.pos) + '</span></div>' +
      '<button class="speak-btn" onclick="speak(\'' + esc(w.word) + '\')">🔊</button>' +
    '</div>' +
    '<div class="fc-meaning">' + esc(w.meaning) + '</div>' +
    sentHtml +
    '<div class="fc-sec"><div class="lab">例句</div><div class="en">' + esc(w.example.en) + '</div><div class="cn">' + esc(w.example.cn) + '</div></div>' +
    '<div class="fc-sec"><div class="lab">常用搭配</div>' +
      w.phrases.map(p => '<div class="en">· ' + esc(p.en) + ' <span class="cn" style="display:inline">' + esc(p.cn) + '</span></div>').join("") +
    '</div>' +
    (w.tip ? '<div class="fc-tip">💡 ' + esc(w.tip) + '</div>' : '') +
    '<button class="btn ' + (inKey ? 'btn-outline' : 'btn-primary') + ' btn-block mt16" id="sheet-add" ' + (inKey ? 'disabled' : '') + '>' +
      (inKey ? '✓ 已在重点复习' : '+ 加入重点复习') + '</button>'
  );
  const btn = document.getElementById("sheet-add");
  if (btn && !inKey) {
    btn.addEventListener("click", () => {
      addToReview(wordId, (ctx && ctx.source) || "manual");
      btn.textContent = "✓ 已加入重点复习";
      btn.disabled = true;
      btn.classList.remove("btn-primary");
      btn.classList.add("btn-outline");
      toast("已加入重点复习，明天开始安排复习");
      if (page === "key" || page === "review") render();
    });
  }
}

/* ============================================================
 * 页面渲染
 * ============================================================ */
const pageEl = document.getElementById("page");
function render() {
  setActiveTab();
  const fn = {
    home: renderHome, flash: renderFlash, review: renderReview,
    key: renderKey, about: renderAbout, article: renderArticle,
    spell: renderSpell, keyquiz: renderKeyQuiz
  }[page] || renderHome;
  fn();
}

/* ---------------- 工作台 ---------------- */
function renderHome() {
  const day = S.currentDay;
  const c = comp(day);
  const due = dueList().length;
  let learned = 0;
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    const f = S.flash[d];
    if (f) learned += f.done ? (GROUPS[d-1] || []).length : Math.min(f.idx, (GROUPS[d-1]||[]).length);
  }
  const keyCount = Object.keys(S.review).length;
  const reviewDone = due === 0;

  let dayCells = "";
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    const done = S.flash[d] && S.flash[d].done;
    dayCells += '<button class="day-cell ' + (done ? "done" : "") + (d === day ? " current" : "") + '" data-day="' + d + '">' +
      '<b>D' + d + '</b>' + (GROUPS[d-1]||[]).length + '词' + (done ? " ✓" : "") + '</button>';
  }

  pageEl.innerHTML =
    '<div class="hero">' +
      '<div class="h1">高考718高频核心词</div>' +
      '<div class="sub">每天 50 词 · 学-用-练-忘-再练 记忆闭环</div>' +
      '<div class="hero-stats">' +
        '<div class="hstat"><b>' + learned + '</b><span>已学单词</span></div>' +
        '<div class="hstat"><b>' + S.streak.count + '</b><span>连续打卡</span></div>' +
        '<div class="hstat"><b>' + keyCount + '</b><span>重点词汇</span></div>' +
        '<div class="hstat"><b>' + due + '</b><span>今日待复习</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="card"><div class="h2">📅 第 ' + day + ' 天 · 今日学习</div>' +
      '<div class="mods">' +
        '<button class="mod" id="m-flash">' + (c.flash ? '<span class="done-mark">✓ 完成</span>' : '') +
          '<span class="ico">🃏</span><b>背单词</b><span>' + (GROUPS[day-1]||[]).length + ' 张单词卡</span></button>' +
        '<button class="mod" id="m-article">' + (c.article ? '<span class="done-mark">✓ 完成</span>' : '') +
          '<span class="ico">📖</span><b>今日文章</b><span>50 词融入短文</span></button>' +
        '<button class="mod" id="m-spell">' + (c.spelling ? '<span class="done-mark">✓ 完成</span>' : '') +
          '<span class="ico">✍️</span><b>今日拼写</b><span>文章挖空默写</span></button>' +
        '<button class="mod" id="m-review">' + (reviewDone ? '<span class="done-mark">✓ 无到期</span>' : '<span class="done-mark" style="color:var(--red)">' + due + ' 词到期</span>') +
          '<span class="ico">⏰</span><b>今日复习</b><span>艾宾浩斯调度</span></button>' +
      '</div>' +
    '</div>' +
    '<div class="card"><div class="h2">🗓 学习计划（共 ' + TOTAL_DAYS + ' 天 · 718 词）</div>' +
      '<div class="day-grid">' + dayCells + '</div>' +
      '<div class="sub mt12">点击切换学习日；徽标 ✓ 表示该天单词卡已全部学完。</div>' +
    '</div>';

  document.getElementById("m-flash").addEventListener("click", () => nav("flash"));
  document.getElementById("m-article").addEventListener("click", () => nav("article"));
  document.getElementById("m-spell").addEventListener("click", () => nav("spell"));
  document.getElementById("m-review").addEventListener("click", () => nav("review"));
  pageEl.querySelectorAll(".day-cell").forEach(el => el.addEventListener("click", () => {
    S.currentDay = Number(el.dataset.day);
    save(); render();
  }));
}

/* ---------------- 背单词（Flashcards） ---------------- */
function flashState(day) {
  if (!S.flash[day]) S.flash[day] = { idx: 0, known: [], unknown: [], done: false };
  return S.flash[day];
}
let flipped = false;
function renderFlash() {
  const day = S.currentDay;
  const ids = GROUPS[day - 1] || [];
  const st = flashState(day);

  if (st.idx >= ids.length) {
    st.done = true;
    comp(day).flash = true;
    touchStreak(); save();
    pageEl.innerHTML =
      '<div class="h1">🃏 背单词 · 第 ' + day + ' 天</div>' +
      '<div class="card center" style="padding:36px 16px">' +
        '<div style="font-size:44px">🎉</div>' +
        '<div class="h2" style="justify-content:center;margin-top:10px">今日 ' + ids.length + ' 词已学完</div>' +
        '<div class="sub">认识 ' + st.known.length + ' 个 · 不认识 ' + st.unknown.length + ' 个（已自动加入重点复习）</div>' +
        '<div class="row mt16" style="justify-content:center">' +
          '<button class="btn btn-ghost" id="f-again">重学本组</button>' +
          '<button class="btn btn-primary" id="f-article">去读今日文章 →</button>' +
        '</div>' +
      '</div>';
    document.getElementById("f-again").addEventListener("click", () => {
      S.flash[day] = { idx: 0, known: [], unknown: [], done: st.done };
      save(); flipped = false; render();
    });
    document.getElementById("f-article").addEventListener("click", () => nav("article"));
    return;
  }

  const w = WORD_MAP[ids[st.idx]];
  const inKey = !!S.review[w.id];
  const pct = Math.round(st.idx / ids.length * 100);

  pageEl.innerHTML =
    '<div class="row" style="align-items:baseline"><div class="h1 grow">🃏 背单词</div>' +
      '<span class="sub">第 ' + day + ' 天 · ' + (st.idx + 1) + '/' + ids.length + '</span></div>' +
    '<div class="flash-progress"><i style="width:' + pct + '%"></i></div>' +
    '<div class="flashcard' + (flipped ? " flipped" : "") + '" id="fcard">' +
      '<div class="fc-inner">' +
        '<div class="fc-face fc-front">' +
          '<div class="fc-word">' + esc(w.word) + '</div>' +
          '<div class="fc-phon">' + esc(w.phonetic) + ' <span class="tag gray">' + esc(w.pos) + '</span></div>' +
          '<button class="speak-btn" id="spk1">🔊</button>' +
          '<div class="fc-hint">点击卡片查看释义 · 例句 · 搭配</div>' +
        '</div>' +
        '<div class="fc-face fc-back">' +
          '<div class="row" style="align-items:center"><div class="grow"><span class="fc-word">' + esc(w.word) + '</span> <span class="sub">' + esc(w.phonetic) + '</span></div>' +
          '<button class="speak-btn" id="spk2">🔊</button></div>' +
          '<div class="fc-meaning">' + esc(w.meaning) + '</div>' +
          '<div class="fc-sec"><div class="lab">例句 EXAMPLE</div><div class="en">' + esc(w.example.en) + '</div><div class="cn">' + esc(w.example.cn) + '</div></div>' +
          '<div class="fc-sec"><div class="lab">常用搭配 PHRASES</div>' +
            w.phrases.map(p => '<div class="en">· ' + esc(p.en) + '　<span style="color:var(--text-2);font-size:13px">' + esc(p.cn) + '</span></div>').join("") +
          '</div>' +
          (w.tip ? '<div class="fc-tip">💡 ' + esc(w.tip) + '</div>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn btn-danger grow" id="f-no">不认识</button>' +
      '<button class="btn btn-outline" id="f-key" ' + (inKey ? 'disabled' : '') + '>' + (inKey ? '✓ 已收藏' : '+ 重点') + '</button>' +
      '<button class="btn btn-primary grow" id="f-yes">认识 ✓</button>' +
    '</div>' +
    '<div class="sub center mt12">标记"不认识"会自动加入重点复习，按遗忘曲线安排复习</div>';

  document.getElementById("fcard").addEventListener("click", (e) => {
    if (e.target.closest(".speak-btn")) return;
    flipped = !flipped;
    document.getElementById("fcard").classList.toggle("flipped", flipped);
  });
  document.getElementById("spk1").addEventListener("click", () => speak(w.word));
  document.getElementById("spk2").addEventListener("click", () => speak(w.word + ". " + w.example.en));
  document.getElementById("f-key").addEventListener("click", (e) => {
    addToReview(w.id, "manual");
    e.target.textContent = "✓ 已收藏"; e.target.disabled = true;
    toast("已加入重点复习");
  });
  function next(known) {
    (known ? st.known : st.unknown).push(w.id);
    if (!known) addToReview(w.id, "flash");
    st.idx++;
    flipped = false;
    save(); render();
  }
  document.getElementById("f-yes").addEventListener("click", () => next(true));
  document.getElementById("f-no").addEventListener("click", () => { next(false); toast(w.word + " 已加入重点复习"); });
}

/* ---------------- 今日文章 ---------------- */
let showCn = false;
function splitSentences(text, isCn) {
  return isCn ? text.split(/(?<=[。！？])/).filter(s => s.trim())
              : text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
}
function renderArticle() {
  const day = S.currentDay;
  const art = ARTICLES[day - 1];
  const formMap = buildFormMap(day - 1);
  if (!art) { pageEl.innerHTML = '<div class="empty">本日暂无文章</div>'; return; }

  const parasEn = art.en.split(/\n\n+/);
  const parasCn = art.cn.split(/\n\n+/);
  const bodyHtml = parasEn.map((p, pi) =>
    "<p>" + p.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (tok) => {
      const id = formMap[tok.toLowerCase()];
      return id ? '<span class="tw" data-id="' + id + '" data-p="' + pi + '" data-tok="' + esc(tok) + '">' + esc(tok) + "</span>" : esc(tok);
    }) + "</p>"
  ).join("");

  comp(day).article = true; touchStreak(); save();

  pageEl.innerHTML =
    '<div class="h1">📖 今日文章</div>' +
    '<div class="sub">第 ' + day + ' 天 · ' + (GROUPS[day-1]||[]).length + ' 个目标词已高亮 · 点击单词查看释义</div>' +
    '<div class="card mt12">' +
      '<div class="h2">' + esc(art.title) + '</div>' +
      '<div class="sub" style="margin-top:-6px;margin-bottom:10px">' + esc(art.titleCn) + ' · ' + esc(art.theme || "") + '</div>' +
      '<div class="article-body">' + bodyHtml + '</div>' +
      '<button class="btn btn-ghost btn-sm toggle-cn" id="btn-cn">' + (showCn ? "收起译文" : "查看中文译文") + '</button>' +
      '<div class="article-cn mt12 ' + (showCn ? "" : "hidden") + '" id="cn-box">' +
        parasCn.map(p => "<p>" + esc(p) + "</p>").join("") +
      '</div>' +
    '</div>' +
    '<div class="row">' +
      '<button class="btn btn-outline grow" id="a-back">← 工作台</button>' +
      '<button class="btn btn-primary grow" id="a-spell">去今日拼写 →</button>' +
    '</div>';

  document.getElementById("btn-cn").addEventListener("click", () => {
    showCn = !showCn;
    document.getElementById("cn-box").classList.toggle("hidden", !showCn);
    document.getElementById("btn-cn").textContent = showCn ? "收起译文" : "查看中文译文";
  });
  document.getElementById("a-back").addEventListener("click", () => nav("home"));
  document.getElementById("a-spell").addEventListener("click", () => nav("spell"));
  pageEl.querySelectorAll(".tw").forEach(el => el.addEventListener("click", () => {
    const id = el.dataset.id, pi = Number(el.dataset.p), tok = el.dataset.tok;
    const sentsEn = splitSentences(parasEn[pi], false);
    const sentsCn = splitSentences(parasCn[pi] || "", true);
    let si = sentsEn.findIndex(s => s.toLowerCase().indexOf(tok.toLowerCase()) >= 0);
    if (si < 0) si = 0;
    const re = new RegExp("\\b(" + tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")\\b", "gi");
    const sentence = esc(sentsEn[si] || "").replace(re, '<b style="color:var(--primary-dark)">$1</b>');
    const sentenceCn = (sentsEn.length === sentsCn.length) ? sentsCn[si] : (parasCn[pi] || "");
    wordSheet(id, { sentence: sentence, sentenceCn: sentenceCn, source: "article" });
  }));
}

/* ---------------- 今日拼写 ---------------- */
function spellState(day) {
  if (!S.spell[day]) S.spell[day] = { vals: {}, hinted: [], checked: false };
  return S.spell[day];
}
function renderSpell() {
  const day = S.currentDay;
  const art = ARTICLES[day - 1];
  const formMap = buildFormMap(day - 1);
  const st = spellState(day);
  if (!art) { pageEl.innerHTML = '<div class="empty">本日暂无文章</div>'; return; }

  const blanked = {};   // wordId -> expected token
  let bi = 0;
  const parasEn = art.en.split(/\n\n+/);
  const bodyHtml = parasEn.map(p =>
    "<p>" + p.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (tok) => {
      const id = formMap[tok.toLowerCase()];
      if (id && !(id in blanked)) {
        blanked[id] = tok;
        bi++;
        const val = st.vals[id] || "";
        let cls = "", extra = "";
        if (st.checked) {
          const ok = val.trim().toLowerCase() === tok.toLowerCase();
          cls = ok ? "ok" : "bad";
          if (!ok) extra = '<span class="sp-answer">' + esc(tok) + '</span>';
        }
        return '<input class="sp-input ' + cls + '" data-id="' + id + '" value="' + esc(val) + '" ' +
          'style="width:' + Math.max(tok.length * 11 + 18, 52) + 'px" maxlength="' + (tok.length + 4) + '" ' +
          'autocomplete="off" autocapitalize="off" spellcheck="false" ' + (st.checked ? "disabled" : "") + '>' +
          extra +
          '<button class="sp-hintbtn" data-id="' + id + '" title="中文提示">💡</button>';
      }
      return esc(tok);
    }) + "</p>"
  ).join("");

  // 统计
  const total = Object.keys(blanked).length;
  let right = 0, wrong = 0, unfilled = 0;
  if (st.checked) {
    Object.keys(blanked).forEach(id => {
      const v = (st.vals[id] || "").trim().toLowerCase();
      if (!v) unfilled++;
      else if (v === blanked[id].toLowerCase()) right++;
      else wrong++;
    });
  }

  pageEl.innerHTML =
    '<div class="h1">✍️ 今日拼写</div>' +
    '<div class="sub">第 ' + day + ' 天 · 根据文章语境填出目标单词 · 点 💡 查看中文提示</div>' +
    (st.checked ?
      '<div class="sp-stats">' +
        '<div class="sp-stat"><b style="color:var(--primary-dark)">' + right + '</b>正确</div>' +
        '<div class="sp-stat"><b style="color:var(--red)">' + wrong + '</b>错误</div>' +
        '<div class="sp-stat"><b style="color:#b45309">' + st.hinted.length + '</b>已提示</div>' +
        '<div class="sp-stat"><b>' + unfilled + '</b>未填</div>' +
      '</div>' : '') +
    '<div class="card mt12"><div class="h2">' + esc(art.title) + '</div>' +
      '<div class="sp-body">' + bodyHtml + '</div>' +
    '</div>' +
    '<div class="card"><div class="h2">📝 笔记</div>' +
      '<textarea class="notes" id="sp-notes" placeholder="记录易错拼写、词形变化...">' + esc(S.notes[day] || "") + '</textarea>' +
    '</div>' +
    '<div class="row">' +
      (st.checked
        ? '<button class="btn btn-ghost grow" id="sp-retry">重新练习</button><button class="btn btn-primary grow" id="sp-review">去复习 →</button>'
        : '<button class="btn btn-primary btn-block grow" id="sp-check">检查答案</button>') +
    '</div>';

  pageEl.querySelectorAll(".sp-input").forEach(inp => {
    inp.addEventListener("input", () => { st.vals[inp.dataset.id] = inp.value; save(); });
  });
  pageEl.querySelectorAll(".sp-hintbtn").forEach(b => {
    b.addEventListener("click", () => {
      const w = WORD_MAP[b.dataset.id];
      if (st.hinted.indexOf(w.id) < 0) { st.hinted.push(w.id); save(); }
      toast("提示：" + w.meaning);
    });
  });
  document.getElementById("sp-notes").addEventListener("input", (e) => { S.notes[day] = e.target.value; save(); });
  if (st.checked) {
    document.getElementById("sp-retry").addEventListener("click", () => {
      S.spell[day] = { vals: {}, hinted: [], checked: false };
      save(); render();
    });
    document.getElementById("sp-review").addEventListener("click", () => nav("review"));
  } else {
    document.getElementById("sp-check").addEventListener("click", () => {
      st.checked = true;
      comp(day).spelling = true;
      // 拼错的词加入重点复习
      Object.keys(blanked).forEach(id => {
        const v = (st.vals[id] || "").trim().toLowerCase();
        if (v && v !== blanked[id].toLowerCase()) addToReview(id, "flash");
      });
      touchStreak(); save(); render();
      toast("已完成检查，拼错的词已加入重点复习");
    });
  }
}

/* ---------------- 每日复习（艾宾浩斯 · 四选一） ---------------- */
let quizQueue = null, quizIdx = 0, quizStats = null, quizAnswered = false;
function makeQuestion(wordId) {
  const w = WORD_MAP[wordId];
  const others = shuffle(WORDS.filter(x => x.id !== wordId)).slice(0, 3);
  const type = Math.floor(Math.random() * 3);
  if (type === 0) {
    // 例句挖空选词
    const re = new RegExp("\\b[A-Za-z']*" + w.word.slice(0, Math.max(3, w.word.length - 3)) + "[A-Za-z']*\\b", "i");
    let stem = w.example.en;
    const formSet = wordForms(w.word);
    stem = stem.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, t => formSet.has(t.toLowerCase()) ? "______" : t);
    if (stem.indexOf("______") < 0) stem = w.example.en.replace(re, "______");
    return { wordId, q: '例句填空：<br>' + esc(stem), opts: shuffle([w, ...others].map(x => ({ label: x.word, ok: x.id === wordId }))) };
  }
  if (type === 1) {
    return { wordId, q: '哪个单词的意思是：<span class="blank">' + esc(w.meaning) + '</span>', opts: shuffle([w, ...others].map(x => ({ label: x.word, ok: x.id === wordId }))) };
  }
  return { wordId, q: '<span class="blank">' + esc(w.word) + '</span> ' + esc(w.phonetic) + ' 的意思是？', opts: shuffle([w, ...others].map(x => ({ label: x.meaning, ok: x.id === wordId }))) };
}
function renderReview() {
  const due = dueList();

  if (quizQueue === null) {
    if (due.length === 0) {
      const t = todayStr();
      const upcoming = Object.keys(S.review)
        .sort((a, b) => S.review[a].nextReviewDate < S.review[b].nextReviewDate ? -1 : 1)
        .slice(0, 5);
      pageEl.innerHTML =
        '<div class="h1">⏰ 每日复习</div>' +
        '<div class="sub">按艾宾浩斯遗忘曲线，只复习今天到期的词</div>' +
        '<div class="card mt12"><div class="empty"><div class="big">🎉</div>今日无到期复习任务' +
          (Object.keys(S.review).length === 0 ? '<br><span class="sub">在背单词时标记"不认识"或点"+重点"，词汇会进入复习计划</span>' : '') +
        '</div>' +
        (upcoming.length ?
          '<div class="h2">即将到期</div>' +
          upcoming.map(id => {
            const r = S.review[id], w = WORD_MAP[id];
            const dd = diffDays(t, r.nextReviewDate);
            return '<div class="kw-item"><div class="kw-main"><span class="kw-word">' + esc(w.word) + '</span>' +
              '<div class="kw-meaning">' + esc(w.meaning) + '</div></div>' +
              '<span class="due-badge later">' + (dd <= 0 ? "已到期" : dd + " 天后") + '</span></div>';
          }).join("") +
          '<button class="btn btn-ghost btn-block mt12" id="r-early">提前复习这些词</button>'
          : '') +
        '</div>';
      const eb = document.getElementById("r-early");
      if (eb) eb.addEventListener("click", () => {
        quizQueue = upcoming.slice();
        quizIdx = 0; quizStats = { right: 0, wrong: 0 }; quizAnswered = false;
        render();
      });
      return;
    }
    pageEl.innerHTML =
      '<div class="h1">⏰ 每日复习</div>' +
      '<div class="sub">按艾宾浩斯遗忘曲线调度 · 越生疏的词越先复习</div>' +
      '<div class="card mt12 center" style="padding:30px 16px">' +
        '<div style="font-size:40px">📋</div>' +
        '<div class="h2" style="justify-content:center;margin-top:8px">今日到期 ' + due.length + ' 个词</div>' +
        '<div class="sub">答对 → 进入下一记忆阶段，间隔拉长<br>答错 → 回到阶段 0，明天再复习</div>' +
        '<button class="btn btn-primary mt16" id="r-start" style="padding:12px 40px">开始复习</button>' +
      '</div>';
    document.getElementById("r-start").addEventListener("click", () => {
      quizQueue = due;
      quizIdx = 0; quizStats = { right: 0, wrong: 0 }; quizAnswered = false;
      render();
    });
    return;
  }

  if (quizIdx >= quizQueue.length) {
    const stats = quizStats;
    if (dueList().length === 0) { S.reviewDone[todayStr()] = true; }
    touchStreak(); save();
    pageEl.innerHTML =
      '<div class="h1">⏰ 每日复习</div>' +
      '<div class="card mt12 center" style="padding:34px 16px">' +
        '<div style="font-size:44px">' + (stats.wrong === 0 ? "🏆" : "💪") + '</div>' +
        '<div class="h2" style="justify-content:center;margin-top:8px">复习完成</div>' +
        '<div class="sub">答对 ' + stats.right + ' 题 · 答错 ' + stats.wrong + ' 题' +
          (stats.wrong > 0 ? '<br>答错的词已回到阶段 0，明天将再次出现' : '<br>相应词汇的复习间隔已拉长') + '</div>' +
        '<div class="row mt16" style="justify-content:center">' +
          '<button class="btn btn-ghost" id="r-key">查看重点列表</button>' +
          '<button class="btn btn-primary" id="r-home">返回工作台</button>' +
        '</div>' +
      '</div>';
    quizQueue = null;
    document.getElementById("r-key").addEventListener("click", () => nav("key"));
    document.getElementById("r-home").addEventListener("click", () => nav("home"));
    return;
  }

  const q = makeQuestion(quizQueue[quizIdx]);
  const rec = S.review[q.wordId];
  pageEl.innerHTML =
    '<div class="row" style="align-items:baseline"><div class="h1 grow">⏰ 复习</div>' +
      '<span class="sub">' + (quizIdx + 1) + '/' + quizQueue.length + ' · 阶段 ' + rec.stage + '</span></div>' +
    '<div class="flash-progress"><i style="width:' + Math.round(quizIdx / quizQueue.length * 100) + '%"></i></div>' +
    '<div class="card">' +
      '<div class="quiz-q">' + q.q + '</div>' +
      '<div class="opts">' + q.opts.map((o, i) => '<button class="opt" data-i="' + i + '">' + esc(o.label) + '</button>').join("") + '</div>' +
      '<div id="fb"></div>' +
    '</div>';

  pageEl.querySelectorAll(".opt").forEach(btn => btn.addEventListener("click", () => {
    if (quizAnswered) return;
    quizAnswered = true;
    const i = Number(btn.dataset.i);
    const correct = q.opts[i].ok;
    answerReview(q.wordId, correct);
    quizStats[correct ? "right" : "wrong"]++;
    pageEl.querySelectorAll(".opt").forEach((b, bi2) => {
      b.disabled = true;
      if (q.opts[bi2].ok) b.classList.add("right");
      else if (bi2 === i) b.classList.add("wrong");
    });
    const w = WORD_MAP[q.wordId];
    const rec2 = S.review[q.wordId];
    document.getElementById("fb").innerHTML =
      '<div class="quiz-fb ' + (correct ? "good" : "bad") + '">' +
        (correct ? '✓ 正确！进入阶段 ' + rec2.stage + '，下次复习：' + rec2.nextReviewDate
                 : '✗ 答错了。<b>' + esc(w.word) + '</b> ' + esc(w.meaning) + '，回到阶段 0，明日再复习') +
      '</div>' +
      '<button class="btn btn-primary btn-block mt12" id="q-next">' + (quizIdx + 1 >= quizQueue.length ? "查看结果" : "下一题") + '</button>';
    speak(w.word);
    document.getElementById("q-next").addEventListener("click", () => { quizIdx++; quizAnswered = false; render(); });
  }));
}

/* ---------------- 重点复习单元 ---------------- */
function renderKey() {
  const ids = Object.keys(S.review).sort((a, b) => {
    const ra = S.review[a], rb = S.review[b];
    return ra.nextReviewDate < rb.nextReviewDate ? -1 : ra.nextReviewDate > rb.nextReviewDate ? 1 : ra.stage - rb.stage;
  });
  const t = todayStr();
  const due = dueList().length;

  pageEl.innerHTML =
    '<div class="h1">⭐ 重点复习</div>' +
    '<div class="sub">背错 / 复习答错 / 手动收藏的词都在这里，按遗忘曲线安排</div>' +
    '<div class="row mt12">' +
      '<button class="btn btn-primary grow" id="k-quiz" ' + (ids.length < 4 ? "disabled" : "") + '>🧩 多选题强化练习</button>' +
      '<button class="btn btn-ghost grow" id="k-review" ' + (due === 0 ? "disabled" : "") + '>⏰ 今日到期 ' + due + ' 词</button>' +
    '</div>' +
    '<div class="card mt12">' +
    (ids.length === 0
      ? '<div class="empty"><div class="big">⭐</div>还没有重点词汇<br><span class="sub">背单词时标记"不认识"，或在卡片/文章里点"+ 加入重点复习"</span></div>'
      : '<div class="h2">全部 ' + ids.length + ' 词</div>' + ids.map(id => {
          const r = S.review[id], w = WORD_MAP[id];
          if (!w) return "";
          const dd = diffDays(t, r.nextReviewDate);
          const reviewedTimes = r.history.length;
          const dots = Array.from({ length: 6 }, (_, i) => '<i class="' + (i < r.stage ? "on" : "") + '"></i>').join("");
          return '<div class="kw-item">' +
            '<div class="kw-main" data-id="' + id + '" style="cursor:pointer">' +
              '<span class="kw-word">' + esc(w.word) + '</span> ' +
              r.sources.map(s => '<span class="tag ' + (SOURCE_TAG[s] || "gray") + '">' + (SOURCE_LABEL[s] || s) + '</span>').join(" ") +
              '<div class="kw-meaning">' + esc(w.meaning) + '</div>' +
              '<div class="kw-meta"><span class="stage-dots">' + dots + '</span>阶段 ' + r.stage +
                (r.stage >= STAGE_MAX ? '（已巩固）' : '') + ' · 已复习 ' + reviewedTimes + ' 次 · ' +
                '<span class="due-badge ' + (dd <= 0 ? "due" : "later") + '">' + (dd <= 0 ? "已到期，今日复习" : "下次复习：" + dd + " 天后") + '</span></div>' +
            '</div>' +
            '<button class="btn btn-sm btn-outline kw-del" data-id="' + id + '">移除</button>' +
          '</div>';
        }).join("")) +
    '</div>';

  document.getElementById("k-quiz").addEventListener("click", () => {
    if (ids.length >= 4) { keyQuizInit(); nav("keyquiz"); }
  });
  document.getElementById("k-review").addEventListener("click", () => { if (due > 0) { quizQueue = null; nav("review"); } });
  pageEl.querySelectorAll(".kw-del").forEach(b => b.addEventListener("click", () => {
    delete S.review[b.dataset.id];
    save(); render();
    toast("已移除");
  }));
  pageEl.querySelectorAll(".kw-main").forEach(el => el.addEventListener("click", () => wordSheet(el.dataset.id, null)));
}

/* ---------------- 多选题强化练习 ---------------- */
let kq = null;
function splitSenses(meaning) {
  return meaning.split(/[;；,，、]|(?=\s(?:n|v|vt|vi|a|adj|adv|prep|conj|pron|num|int)\.)/)
    .map(s => s.trim()).filter(s => s && s.length >= 2);
}
function keyQuizInit() {
  // 到期词优先，其次按阶段升序
  const t = todayStr();
  const ids = Object.keys(S.review).sort((a, b) => {
    const da = S.review[a].nextReviewDate <= t ? 0 : 1;
    const db = S.review[b].nextReviewDate <= t ? 0 : 1;
    if (da !== db) return da - db;
    return S.review[a].stage - S.review[b].stage;
  }).slice(0, 8);
  kq = { list: ids, idx: 0, right: 0, wrong: 0, sel: new Set(), done: false };
}
function makeMultiQ(wordId) {
  const w = WORD_MAP[wordId];
  const senses = splitSenses(w.meaning).slice(0, 2);
  const phraseOpt = w.phrases[0] ? [{ label: "搭配 " + w.phrases[0].en + " 意为「" + w.phrases[0].cn + "」", ok: true }] : [];
  const correct = senses.map(s => ({ label: "释义：" + s, ok: true })).concat(phraseOpt);
  // 干扰项：其他词的释义 + 错误搭配释义
  const others = shuffle(WORDS.filter(x => x.id !== wordId && x.phrases.length));
  const distract = [];
  for (const o of others) {
    if (distract.length >= 5 - Math.min(correct.length, 3)) break;
    const os = splitSenses(o.meaning);
    if (!os.length) continue;
    if (distract.length % 2 === 0) distract.push({ label: "释义：" + os[0], ok: false });
    else distract.push({ label: "搭配 " + w.word + " " + (o.phrases[0].en.split(" ").slice(1).join(" ") || "up") + " 意为「" + o.phrases[0].cn + "」", ok: false });
  }
  return { wordId, w, opts: shuffle(correct.slice(0, 3).concat(distract)) };
}
function renderKeyQuiz() {
  if (!kq) { nav("key"); return; }
  if (kq.idx >= kq.list.length) {
    pageEl.innerHTML =
      '<div class="h1">🧩 多选强化</div>' +
      '<div class="card mt12 center" style="padding:34px 16px">' +
        '<div style="font-size:44px">' + (kq.wrong === 0 ? "🏆" : "💪") + '</div>' +
        '<div class="h2" style="justify-content:center;margin-top:8px">练习完成</div>' +
        '<div class="sub">全对 ' + kq.right + ' 题 · 有误 ' + kq.wrong + ' 题<br>结果已同步艾宾浩斯复习计划</div>' +
        '<button class="btn btn-primary mt16" id="kq-back">返回重点复习</button>' +
      '</div>';
    document.getElementById("kq-back").addEventListener("click", () => { kq = null; nav("key"); });
    return;
  }
  const q = kq.q && kq.q.wordId === kq.list[kq.idx] ? kq.q : (kq.q = makeMultiQ(kq.list[kq.idx]));
  const answered = kq.done;

  pageEl.innerHTML =
    '<div class="row" style="align-items:baseline"><div class="h1 grow">🧩 多选强化</div>' +
      '<span class="sub">' + (kq.idx + 1) + '/' + kq.list.length + '</span></div>' +
    '<div class="flash-progress"><i style="width:' + Math.round(kq.idx / kq.list.length * 100) + '%"></i></div>' +
    '<div class="card">' +
      '<div class="quiz-q">关于 <span class="blank">' + esc(q.w.word) + '</span> ' + esc(q.w.phonetic) +
        '，选出<b>所有</b>正确的描述：</div>' +
      '<div class="opts">' + q.opts.map((o, i) => {
        let cls = kq.sel.has(i) ? " sel" : "";
        if (answered) cls = o.ok ? " right" : (kq.sel.has(i) ? " wrong" : "");
        return '<button class="opt' + cls + '" data-i="' + i + '" ' + (answered ? "disabled" : "") + '>' + esc(o.label) + '</button>';
      }).join("") + '</div>' +
      '<div id="fb">' + (answered ? "" : '<button class="btn btn-primary btn-block mt12" id="kq-submit" ' + (kq.sel.size ? "" : "disabled") + '>提交答案</button>') + '</div>' +
    '</div>';

  if (!answered) {
    pageEl.querySelectorAll(".opt").forEach(btn => btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      if (kq.sel.has(i)) kq.sel.delete(i); else kq.sel.add(i);
      render();
    }));
    const sb = document.getElementById("kq-submit");
    if (sb) sb.addEventListener("click", () => {
      const correctSet = new Set(q.opts.map((o, i) => o.ok ? i : -1).filter(i => i >= 0));
      const ok = correctSet.size === kq.sel.size && [...kq.sel].every(i => correctSet.has(i));
      answerReview(q.wordId, ok);
      kq[ok ? "right" : "wrong"]++;
      kq.done = true;
      render();
      const rec = S.review[q.wordId];
      document.getElementById("fb").innerHTML =
        '<div class="quiz-fb ' + (ok ? "good" : "bad") + '">' +
          (ok ? '✓ 全部选对！下次复习：' + rec.nextReviewDate
              : '✗ 有遗漏或多选。' + esc(q.w.word) + '：' + esc(q.w.meaning) + '，回到阶段 0') +
        '</div>' +
        '<button class="btn btn-primary btn-block mt12" id="kq-next">' + (kq.idx + 1 >= kq.list.length ? "查看结果" : "下一题") + '</button>';
      document.getElementById("kq-next").addEventListener("click", () => {
        kq.idx++; kq.sel = new Set(); kq.done = false; kq.q = null; render();
      });
    });
  } else {
    // answered 状态由提交回调内重渲染补充 fb，这里补一个下一题按钮（防御）
    const fb = document.getElementById("fb");
    if (fb && !fb.innerHTML) {
      fb.innerHTML = '<button class="btn btn-primary btn-block mt12" id="kq-next">下一题</button>';
      document.getElementById("kq-next").addEventListener("click", () => {
        kq.idx++; kq.sel = new Set(); kq.done = false; kq.q = null; render();
      });
    }
  }
}

/* ---------------- 关于 ---------------- */
function renderAbout() {
  const total = Object.keys(S.review).length;
  pageEl.innerHTML =
    '<div class="h1">ℹ️ 关于</div>' +
    '<div class="card mt12"><div class="h2">📚 高考718高频核心词</div>' +
      '<div class="about-li"><span class="ico">📖</span><span>词库来自《高考英语718高频核心词》，按考频排序分为超高频、中高频、中低频 7 个 List，共 718 词，切分为 ' + TOTAL_DAYS + ' 天学习计划（每天 50 词）。</span></div>' +
      '<div class="about-li"><span class="ico">🔄</span><span>学习闭环：背单词 → 今日文章（50 词自然融入短文语境）→ 今日拼写（文章挖空默写）→ 重点复习（艾宾浩斯遗忘曲线调度）。</span></div>' +
      '<div class="about-li"><span class="ico">🧠</span><span>记忆算法：新词次日复习，答对依次按 1 → 2 → 4 → 7 → 15 → 30 天拉长间隔；答错回到阶段 0 重新巩固。6 个阶段全部通过即视为掌握。</span></div>' +
      '<div class="about-li"><span class="ico">💾</span><span>所有学习进度保存在本机浏览器（localStorage），刷新/关闭页面不丢失。当前重点词库：' + total + ' 词。</span></div>' +
    '</div>' +
    '<div class="card"><div class="h2">⚙️ 数据管理</div>' +
      '<button class="btn btn-danger btn-block" id="reset">清空全部学习记录</button>' +
      '<div class="sub mt8 center">此操作不可恢复，请谨慎</div>' +
    '</div>';
  document.getElementById("reset").addEventListener("click", () => {
    if (confirm("确定清空所有学习进度、重点复习记录吗？此操作不可恢复。")) {
      localStorage.removeItem(STORAGE_KEY);
      S = loadState();
      toast("已重置");
      nav("home");
    }
  });
}

/* ---------------- 启动 ---------------- */
window.speak = speak; // for inline handler
render();
