/* ==========================================================
   肥鱼摸鱼大作战
   玩法：按住 = 摸鱼偷 token（开心值涨 / 老板概率涨）
        松开 = 认真工作（开心值掉 / 概率回落）
        概率见底 → 光头老板推门巡视，此时摸鱼 = 当场开除
   ========================================================== */
'use strict';

const CFG = {
  happyStart: 75,
  happyGain: 7.5,      // 摸鱼时每秒 +
  happyDrain: 4.2,     // 工作时每秒 -
  happyStress: 7.5,    // 老板巡视时每秒 -
  riskGain: 10.0,      // 摸鱼时每秒 +
  riskDrain: 11.0,     // 工作时每秒 -
  alertAt: 50,         // 预警阈值（会随难度上移）
  bossRate: 0.32,      // risk 拉满时每秒推门概率
  inspectBase: 2.8,    // 巡视基础时长
  inspectMax: 4.5,
  tokensPerSec: 2.4,
  grace: 0.45,         // 巡视期间摸鱼的「最后一刻」缓冲
  doorWalk: 2.2,       // 老板从门口走到工位的时间
  cryAt: 18,           // 开心值低于此值开始哭泣
  cryGrace: 9.0,       // 哭泣到老板进来前的缓冲
  dlgMin: 4,           // 对话最小间隔
  dlgMax: 7,           // 对话最大间隔
  dlgDur: 5.5,         // 单条对话停留时长
};

/* ---- 三档难度：reset() 时按选中档覆盖 CFG ---- */
const DIFFS = [
  { name: '摸鱼学徒',
    p: { happyStart: 85, happyDrain: 3.0, happyStress: 5.0, happyGain: 8.0,
         riskGain: 7.5, riskDrain: 13.0, bossRate: 0.20, inspectBase: 2.2,
         inspectMax: 3.6, cryAt: 14, cryGrace: 11.0, grace: 0.60, dlgMin: 5, dlgMax: 8 } },
  { name: '正常上班', p: {} },   // 用 CFG 默认值
  { name: '卷王之王',
    p: { happyStart: 70, happyDrain: 5.6, happyStress: 9.0, happyGain: 7.0,
         riskGain: 13.0, riskDrain: 9.0, bossRate: 0.46, inspectBase: 3.4,
         inspectMax: 5.2, cryAt: 24, cryGrace: 7.0, grace: 0.35, dlgMin: 3, dlgMax: 5.5 } },
];
const CFG_DEFAULT = { ...CFG };
let DIFF_IDX = 1;

function applyDiff(i) {
  DIFF_IDX = i;
  Object.assign(CFG, CFG_DEFAULT, DIFFS[i].p);
}

const $ = (id) => document.getElementById(id);
const stage = $('stage'), fyWrap = $('fyWrap'), dbWrap = $('dbWrap'), bossWrap = $('bossWrap');
const fx = $('fx'), flash = $('flash'), edge = $('edge');
const dlgEl = $('dlg'), dlgThread = $('dlgThread'), dlgOpts = $('dlgOpts');

/* ==========================================================
   豆包对话系统 v3
   正常时：我发消息 → 豆姐随机回（面板在玩家侧，右下）
   老板在场：豆姐【主动】搭话，点回复 = 当场开除（必须忍住）
   ========================================================== */
const DB = { recent: [] };

const CAT_ICON = { ask: '🙏', news: '📰', chat: '💬', gossip: '🤔', sneak: '⚠' };

/* 打字机：一句一句吐字，galgame 的灵魂 */
let typeTimer = null;
function typeInto(el, text, speed = 32) {
  clearInterval(typeTimer);
  let i = 0;
  el.textContent = '';
  const caret = document.createElement('span');
  caret.className = 'caret';
  el.appendChild(caret);
  typeTimer = setInterval(() => {
    i++;
    el.textContent = text.slice(0, i);
    if (i % 3 === 0) Audio2.blip();      // 打字音
    if (i >= text.length) {
      clearInterval(typeTimer); typeTimer = null;
      caret.remove();
    }
  }, speed);
}
function skipType() {                 // 点击对话框可跳过打字
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  [...dlgThread.querySelectorAll('.txt')].forEach((e) => {
    if (e.dataset.full && e.textContent !== e.dataset.full) {
      e.textContent = e.dataset.full;
      const c = e.querySelector('.caret'); if (c) c.remove();
    }
  });
}

function pickTopics(n, cat) {
  const all = DLG_TOPICS;
  let idxs = all.map((_, i) => i);
  if (cat) idxs = idxs.filter(i => all[i].cat === cat);
  let pool = idxs.filter(i => !DB.recent.includes(i));
  if (pool.length < n) pool = idxs;
  if (!pool.length) pool = all.map((_, i) => i);
  const out = [];
  let guard = 0;
  while (out.length < Math.min(n, pool.length) && guard++ < 200) {
    const i = pool[Math.floor(Math.random() * pool.length)];
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/* 一条台词：名牌 + 文本（galgame 样式） */
function line(who, text, me) {
  const d = document.createElement('div');
  d.className = 'bub ' + (me ? 'me' : 'her');
  const w = document.createElement('span');
  w.className = 'who'; w.textContent = who;
  const t = document.createElement('span');
  t.className = 'txt'; t.dataset.full = text;
  d.appendChild(w); d.appendChild(t);
  return { el: d, txt: t };
}

function pushLine(who, text, me, animate) {
  const { el, txt } = line(who, text, me);
  dlgThread.appendChild(el);
  while (dlgThread.children.length > 4) dlgThread.removeChild(dlgThread.firstChild);
  scrollThread();
  if (animate) typeInto(txt, text); else txt.textContent = text;
}

function showThread(picks, sneak) {
  dlgOpts.innerHTML = '';
  picks.forEach((idx) => {
    const topic = DLG_TOPICS[idx];
    const msg = topic.msgs[Math.floor(Math.random() * topic.msgs.length)];
    const b = document.createElement('button');
    b.textContent = (CAT_ICON[topic.cat] ? CAT_ICON[topic.cat] + ' ' : '') + msg;
    b.onclick = (e) => { e.stopPropagation(); skipType(); onSendMessage(idx); };
    dlgOpts.appendChild(b);
  });
  if (sneak) {
    const w = document.createElement('span');
    w.className = 'dlg-warn';
    w.textContent = '👔 老板就站在旁边 —— 忍住别回！';
    dlgOpts.appendChild(w);
  }
}

/* 老板在场时点了回复 → 当场开除 */
function onSendMessage(idx) {
  if (S.dlg && S.dlg.sneak) {
    Audio2.caught();
    edge.classList.add('urgent');
    stage.classList.add('shake');
    gameOver('你被开除了！',
      '老板就站在旁边，你居然还有心思跟豆姐聊天 —— 当场抓获。', 'caught');
    return;
  }
  if (S.cry) return;
  sendToDoubao(idx);
}

/* 你点了一条 -> 发出去 -> 豆姐随机回 */
function sendToDoubao(idx) {
  if (!S.dlg || S.dlg.answered || S.dlg.sneak) return;
  if (S.mode !== 'playing' || S.cry) return;
  const topic = DLG_TOPICS[idx];
  const msg = topic.msgs[Math.floor(Math.random() * topic.msgs.length)];
  const rep = topic.replies[Math.floor(Math.random() * topic.replies.length)];

  S.dlg.answered = true;
  DB.recent.push(idx);
  if (DB.recent.length > 14) DB.recent.shift();

  // galgame 式：我的台词在上，豆姐的回复带打字机效果
  pushLine('肥鱼', msg, true, false);
  pushLine('豆包', rep.t, false, true);
  dlgOpts.innerHTML = '';
  dlgOpts.appendChild(pendingHint());

  const happy = rep.happy || 0;
  const token = rep.token || 0;
  S.happy = Math.max(0, Math.min(100, S.happy + happy));
  if (token) S.tokens += token;
  if (happy > 0) toast('开心值 +' + happy, '#ffb020');
  else if (happy < 0) toast('开心值 ' + happy, '#ff7a7a');
  if (token) toast('+' + token + ' token！', '#ffd166');
  if (happy >= 8) Audio2.clear(); else Audio2.emo();

  // 打字中：这段时间 risk 不下降（聊天占用了摸鱼时间）
  S.dlg.t = 1.2 + rep.t.length * 0.032;
  S.dlg.refresh = true;
}

/* 已发送、等待刷新时的占位提示 */
function pendingHint() {
  const s = document.createElement('span');
  s.className = 'dlg-wait';
  s.textContent = '豆包正在打字…';
  return s;
}

/* 始终滚到最新一条 */
function scrollThread() { dlgThread.scrollTop = dlgThread.scrollHeight; }

function nextDialog(cat) {
  if (S.cry) return;
  const sneak = cat === 'sneak';
  const picks = pickTopics(3, cat);
  S.dlg = { t: sneak ? CFG.dlgDur + 2.5 : CFG.dlgDur, answered: false, refresh: false, sneak };
  dlgThread.innerHTML = '';
  dlgEl.classList.toggle('sneak', sneak);
  dlgEl.classList.add('on');

  if (sneak) {
    // 老板在场：豆姐主动开口，屏幕上就是她说的话
    const idx = picks[0];
    const msg = DLG_TOPICS[idx].msgs[Math.floor(Math.random() * DLG_TOPICS[idx].msgs.length)];
    pushLine('豆包', msg, false, true);
    Audio2.alert();
    // 选项 = 你「回不回」，都指向同一条路：点了就完蛋
    const b = document.createElement('button');
    b.textContent = '回她一句';
    b.onclick = (e) => { e.stopPropagation(); skipType(); onSendMessage(idx); };
    dlgOpts.appendChild(b);
    const w = document.createElement('span');
    w.className = 'dlg-warn';
    w.textContent = '👔 老板就站在旁边 —— 点回复 = 当场开除';
    dlgOpts.appendChild(w);
  } else {
    showThread(picks, false);
  }
}

function closeDialog() { S.dlg = null; dlgEl.classList.remove('on', 'sneak'); }

/* ---------------- 音效（WebAudio 合成，无外部文件） ---------------- */
const Audio2 = {
  ctx: null,
  init() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'sine', vol = 0.14, delay = 0, slideTo = null) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  eat()    { this.tone(760, 0.09, 'triangle', 0.1); this.tone(1140, 0.08, 'sine', 0.06, 0.05); },
  alert()  { this.tone(300, 0.16, 'square', 0.07); this.tone(300, 0.16, 'square', 0.07, 0.24); },
  door()   { this.tone(150, 0.4, 'sawtooth', 0.05, 0, 90); },
  blip()   { this.tone(1150, 0.028, 'square', 0.022); },
  caught() { this.tone(520, 0.7, 'sawtooth', 0.13, 0, 70); this.tone(260, 0.8, 'square', 0.07, 0.05, 60); },
  clear()  { [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.1, i * 0.1)); },
  emo()    { [440, 392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.1, i * 0.16)); },
};

/* ---------------- 状态 ---------------- */
const S = {
  mode: 'ready',        // ready | playing | inspect | over
  slacking: false,      // 当前是否在摸鱼
  happy: CFG.happyStart,
  risk: 0,
  tokens: 0,
  level: 1,
  alerted: false,
  inspectLeft: 0,
  bossPhase: 'idle',    // idle | in | stay | out
  bossTimer: 0,
  graceT: 0.45,
  graceTipShown: false,
  dlg: null,          // 当前对话 {t,answered,refresh,sneak}
  paused: false,
  best: 0, bestDiff: null,
  dlgNext: 2,         // 距下一轮对话的秒数
  sneakNext: 1.2,     // 距老板在场时下一次「主动搭话」的秒数
  cry: false,         // 是否处于哭泣状态
  cryLeft: 0,         // 哭泣剩余时间（老板就要来了）
  tAcc: 0,
  tkAcc: 0,
  moodT: 0,
  overReason: '',
  last: 0,
};

function reset() {
  applyDiff(DIFF_IDX);
  S.mode = 'ready'; S.slacking = false;
  S.happy = CFG.happyStart; S.risk = 0; S.tokens = 0; S.level = 1;
  S.alerted = false; S.inspectLeft = 0; S.bossPhase = 'idle'; S.bossTimer = 0;
  S.tAcc = 0; S.tkAcc = 0; S.moodT = 0;
  S.graceT = CFG.grace; S.graceTipShown = false;
  S.dlg = null; S.dlgNext = 2 + Math.random() * 2;
  S.sneakNext = 1.0 + Math.random() * 0.8;
  S.cry = false; S.cryLeft = 0;
  $('cryBar').classList.remove('on');
  fyWrap.dataset.state = 'work'; fyWrap.classList.remove('caught');
  hintState = ''; updateHint();          // 重置底部提示
  paintBest();
  const bs = $('bestStart'); if (bs) bs.textContent = S.best;
  dbWrap.dataset.state = 'work'; dbWrap.classList.remove('alerting');
  $('dbBubble').classList.remove('show'); $('fyMood').classList.remove('show');
  bossWrap.className = 'boss-wrap';
  stage.classList.remove('alarm', 'shake');
  edge.classList.remove('on', 'urgent');   // urgent 必须一起清，否则重开后一直闪红
  $('inspect').classList.remove('on');
  S.dlg = null; closeDialog();
  fx.innerHTML = '';
  syncHUD();
}

/* ---------------- 舞台缩放 ---------------- */
function fit() {
  const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  stage.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit); fit();

/* ---------------- 输入 ---------------- */
/* 注意：巡视期间也允许 press —— 老板巡视时你若还敢摸鱼，就是当场抓获。
   之前的版本用 mode!=='playing' 拦掉了，导致核心失败条件永远不成立。 */
const press = () => {
  if (S.mode === 'ready' || S.mode === 'over') return;
  S.slacking = true;
  fyWrap.dataset.state = 'slack';
};
const release = () => {
  S.slacking = false;
  if (S.mode === 'playing' || S.mode === 'inspect') fyWrap.dataset.state = 'work';
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault(); Audio2.init();
    if (S.paused) return;
    press();
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    e.preventDefault();
    togglePause();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { e.preventDefault(); release(); }
});
window.addEventListener('mousedown', (e) => { if (e.target.closest('button,#dlg')) return; Audio2.init(); press(); });
window.addEventListener('mouseup', () => release());
window.addEventListener('touchstart', (e) => {
  if (e.target.closest('button,#dlg')) return;
  e.preventDefault(); Audio2.init(); press();
}, { passive: false });
window.addEventListener('touchend', (e) => { e.preventDefault(); release(); }, { passive: false });
window.addEventListener('blur', release);

$('dlgThread').addEventListener('click', (e) => { e.stopPropagation(); skipType(); });

/* ---------------- 暂停 ---------------- */
function togglePause(force) {
  const want = force !== undefined ? force : !S.paused;
  // 只在游戏中可暂停；ready/over 时 Esc 无效
  if (want && (S.mode === 'ready' || S.mode === 'over')) return;
  S.paused = want;
  if (want) {
    S.slacking = false;                 // 暂停时松手，避免解冻后还在摸鱼
    fyWrap.dataset.state = 'work';
    $('pauseCard').classList.add('on');
    if (typeTimer) skipType();
  } else {
    $('pauseCard').classList.remove('on');
    S.last = performance.now();          // 避免 dt 突然变大
  }
}
$('btnPause').onclick = (e) => { e.stopPropagation(); Audio2.init(); togglePause(); };
$('btnResume').onclick = () => togglePause(false);
$('btnQuit').onclick = () => { togglePause(false); S.mode = 'over'; saveBest(); showResult('你溜了', '工位留给下一个摸鱼人。', 'quit'); };

/* ---------------- 最高分（本地存档） ---------------- */
const BEST_KEY = 'feiyu_moyu_best_v1';
function loadBest() {
  try {
    const v = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    S.best = Number(v.best) || 0;
    S.bestDiff = v.diff || null;
  } catch (e) { S.best = 0; }
}
function saveBest() {
  if (S.tokens > S.best) {
    S.best = S.tokens;
    S.bestDiff = DIFFS[DIFF_IDX].name;
    try { localStorage.setItem(BEST_KEY, JSON.stringify({ best: S.best, diff: S.bestDiff })); } catch (e) { }
    return true;
  }
  return false;
}
function paintBest() {
  $('bestVal').textContent = S.best;
  $('bestVal').title = S.bestDiff ? '记录来自「' + S.bestDiff + '」难度' : '';
}

/* ---------------- 难度选择 ---------------- */
document.querySelectorAll('.diff').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.diff').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    applyDiff(+b.dataset.d);
    Audio2.init();
  });
});

$('btnStart').onclick = () => {
  Audio2.init(); reset(); S.mode = 'playing';
  $('overlay').classList.remove('show'); $('cardStart').classList.remove('show');
};
$('btnRetry').onclick = () => {
  Audio2.init(); reset(); S.mode = 'playing';
  $('overlay').classList.remove('show'); $('cardOver').classList.remove('show');
};

/* ---------------- HUD ---------------- */
function syncHUD() {
  const h = Math.max(0, Math.min(100, S.happy));
  const r = Math.max(0, Math.min(100, S.risk));
  $('happyBar').style.width = h + '%';
  $('happyVal').textContent = Math.round(h);
  $('riskBar').style.width = r + '%';
  $('riskVal').textContent = Math.round(r) + '%';
  $('tokenVal').textContent = S.tokens;
  $('statRisk').classList.toggle('hot', r >= CFG.alertAt);
}

function spawnTear() {
  const r = fyWrap.getBoundingClientRect();
  const st = stage.getBoundingClientRect();
  const sc = st.width / 1280;
  const el = document.createElement('div');
  el.className = 'tear';
  el.textContent = '💧';
  el.style.left = ((r.left - st.left) / sc + r.width / sc * 0.60) + 'px';
  el.style.top = ((r.top - st.top) / sc + r.height / sc * 0.22) + 'px';
  el.style.animationDelay = (Math.random() * 0.4) + 's';
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/* ---------------- token 飞行 ---------------- */
function mouthPoint() {
  // 以「摸鱼态立绘」的实际渲染框为基准，token 飞向肥鱼手/嘴处
  const st = stage.getBoundingClientRect();
  const sc = st.width / 1280;
  const r = $('fySlack').getBoundingClientRect();
  return {
    x: (r.left - st.left) / sc + r.width * 0.54,
    y: (r.top - st.top) / sc + r.height * 0.33,
  };
}

function spawnToken() {
  const mp = mouthPoint();
  const el = document.createElement('div');
  el.className = 'token';
  el.textContent = 'T';
  // 从舞台随机位置出生
  const sx = 90 + Math.random() * 900;
  const sy = 120 + Math.random() * 330;
  el.style.left = sx + 'px'; el.style.top = sy + 'px';
  fx.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = `translate(${mp.x - sx - 17}px, ${mp.y - sy - 17}px) scale(.32)`;
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 760);

  // 飘字
  const pop = document.createElement('div');
  pop.className = 'score-pop';
  pop.textContent = '+1';
  pop.style.left = (mp.x - 14) + 'px';
  pop.style.top = (mp.y - 46) + 'px';
  fx.appendChild(pop);
  setTimeout(() => pop.remove(), 920);

  S.tokens++;
  S.level = 1 + Math.floor(S.tokens / 14);
  S.moodT = 1.4;
  Audio2.eat();
}

/* ---------------- 老板 ---------------- */
const BOSS_HOME = '368px';   // 巡视站位：豆包与肥鱼之间的过道
const BOSS_AWAY = '-380px';  // 退回屏外

function bossEnter() {
  S.bossPhase = 'in'; S.bossTimer = CFG.doorWalk;
  S.alerted = false;
  S.risk = 0;               // 老板已到门口，概率清零（这次躲不掉了）
  bossWrap.className = 'boss-wrap on';
  // 老板站在豆包和肥鱼之间的过道上
  bossWrap.style.transition = 'none';
  bossWrap.style.left = BOSS_AWAY;
  void bossWrap.offsetWidth;              // 强制回流，确保入场动画会播
  bossWrap.style.transition = `left ${CFG.doorWalk}s cubic-bezier(.35,0,.25,1)`;
  bossWrap.style.left = BOSS_HOME;
  $('dbBubble').classList.remove('show');
  Audio2.door();
}

function bossStartInspect() {
  /* 老板已经走到面前 —— 你还在摸鱼，当场抓获，没有任何免死机会 */
  if (S.slacking) {
    S.mode = 'inspect'; S.bossPhase = 'stay';
    S.inspectTotal = 1; S.inspectLeft = 1;
    gameOver('你被开除了！', '老板推门进来的时候你还在偷 token —— 当场抓获。', 'caught');
    return;
  }
  S.mode = 'inspect'; S.bossPhase = 'stay';
  const lv = S.level - 1;
  S.inspectTotal = Math.min(CFG.inspectMax, CFG.inspectBase + lv * 0.12);
  S.inspectLeft = S.inspectTotal;
  S.graceT = CFG.grace; S.graceTipShown = false;
  bossWrap.className = 'boss-wrap on inspect';
  $('inspect').classList.add('on');
  stage.classList.add('alarm');
  edge.classList.add('on');
  // 姐姐这时最紧张 —— 保持警觉并喊话
  dbWrap.dataset.state = 'alert';
  dbWrap.classList.add('alerting');
  $('dbBubble').querySelector('span').textContent = '老板来了！！';
  $('dbBubble').classList.add('show');
  // 老板在场时豆姐会主动搭话 —— 忍住！点回复 = 当场开除
  S.dlg = null; closeDialog();
  setTimeout(() => {
    if (S.mode === 'inspect' && !S.dlg) nextDialog('sneak');
  }, 900);
}

function bossLeave() {
  S.bossPhase = 'out'; S.bossTimer = CFG.doorWalk;
  S.mode = 'playing'; S.risk = 0; S.alerted = false;
  bossWrap.className = 'boss-wrap on';
  bossWrap.style.transition = `left ${CFG.doorWalk}s cubic-bezier(.35,0,.25,1)`;
  bossWrap.style.left = BOSS_AWAY;
  $('inspect').classList.remove('on');
  stage.classList.remove('alarm');
  edge.classList.remove('on');
  dbWrap.dataset.state = 'work'; dbWrap.classList.remove('alerting');
  $('dbBubble').classList.remove('show');
  Audio2.clear();
  // 躲过一劫的奖励
  S.happy = Math.min(100, S.happy + 15);
  flashHit(false);
  toast('老板走了！奖励开心值 +15', '#7ee081');
}

function bossLeaveDone() {
  bossWrap.className = 'boss-wrap';
  bossWrap.style.transition = '';
  S.bossPhase = 'idle';
}

/* 底部提示随状态变化 */
const HINTS = {
  normal: '按住 <kbd>空格</kbd> 或 <kbd>鼠标左键</kbd> 摸鱼偷 token · 松开立刻切回认真工作',
  alert: '⚠ 豆包在提醒你了 —— 赶紧松手切回工作！',
  inspect: '👔 老板正在巡视 · <b>绝对不能摸鱼</b>',
  cry: '😢 肥鱼在哭 · 按住摸鱼可以慢慢把心情拉回来',
  cryWarn: '😢 快摸鱼自救！再过一会儿就被劝退了',
};
let hintState = '';
function updateHint() {
  let k = 'normal';
  if (S.cry) k = S.cryLeft < CFG.cryGrace * 0.45 ? 'cryWarn' : 'cry';
  else if (S.mode === 'inspect') k = 'inspect';
  else if (S.alerted) k = 'alert';
  if (k === hintState) return;
  hintState = k;
  $('hint').dataset.state = k;
  $('hintText').innerHTML = HINTS[k];
}

/* ---------------- 结算 ---------------- */
function showResult(title, sub, reason) {
  S.mode = 'over'; S.overReason = reason;
  S.slacking = false;
  fyWrap.dataset.state = 'work';
  dbWrap.dataset.state = 'work'; dbWrap.classList.remove('alerting');
  $('dbBubble').classList.remove('show');
  $('inspect').classList.remove('on');
  stage.classList.remove('alarm');
  edge.classList.remove('on', 'urgent');
  S.dlg = null; closeDialog();
  S.cry = false; S.cryLeft = 0;
  fyWrap.classList.remove('crying');
  $('cryBar').classList.remove('on');
  $('pauseCard').classList.remove('on');
  S.paused = false;

  const isNew = saveBest();
  paintBest();
  $('finalTokens').textContent = S.tokens;
  $('overTitle').textContent = title;
  $('overSub').textContent = sub;
  $('stamp').textContent = reason === 'caught' ? '解 雇 通 知'
    : reason === 'cry' ? '劝 退 通 知'
    : reason === 'quit' ? '辞 职 申 请' : '情 绪 危 机';

  const rec = $('newRecord');
  if (isNew && S.tokens > 0) {
    rec.style.display = 'block';
    rec.textContent = '🏆 新纪录！历史最高 ' + S.best;
  } else {
    rec.style.display = S.tokens > 0 ? 'block' : 'none';
    rec.textContent = '历史最高 ' + S.best + (S.bestDiff ? '（' + S.bestDiff + '）' : '');
  }

  $('cardOver').classList.add('show');
  $('cardStart').classList.remove('show');
  $('overlay').classList.add('show');
  if (reason === 'caught') { bossWrap.className = 'boss-wrap on caught-anim'; Audio2.caught(); }
  else if (reason === 'cry') { bossWrap.className = 'boss-wrap on'; Audio2.caught(); }
  else Audio2.emo();
}

/* gameOver 是历史遗留名，保持可用 */
function gameOver(title, sub, reason) { showResult(title, sub, reason); }

/* ---------------- 反馈 ---------------- */
function flashHit(bad) {
  flash.classList.remove('go');
  void flash.offsetWidth;
  flash.classList.toggle('bad', bad);
  flash.classList.add('go');
  setTimeout(() => flash.classList.remove('go'), 420);   // 复位，避免残留遮罩挡住下一帧
}

/* toast 不应被底部对话框挡住 —— 放中上方空隙 */
function toast(text, color) {
  const el = document.createElement('div');
  el.className = 'score-pop';
  el.textContent = text;
  el.style.cssText = `left:50%;top:29%;transform:translateX(-50%);font-size:20px;color:${color};
    font-weight:900;white-space:nowrap;
    -webkit-text-stroke:4px rgba(255,255,255,.92);paint-order:stroke fill;
    text-shadow:0 2px 6px rgba(0,0,0,.22);`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/* ---------------- 主循环 ---------------- */
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - S.last) / 1000 || 0);
  S.last = t;
  if (S.paused) return;                       // 暂停：完全冻结
  if (S.mode === 'ready' || S.mode === 'over') return;

  const lv = S.level - 1;
  const riskGain = CFG.riskGain * (1 + 0.05 * lv);
  const alertAt = Math.min(72, CFG.alertAt + lv * 1.5);
  const inspecting = S.mode === 'inspect';

  /* 老板进出流程 */
  if (S.bossPhase === 'in') {
    S.bossTimer -= dt;
    if (S.bossTimer <= 0) bossStartInspect();
  } else if (S.bossPhase === 'out') {
    S.bossTimer -= dt;
    if (S.bossTimer <= 0) bossLeaveDone();
  }

  /* 数值推进 */
  if (inspecting) {
    // 巡视期间：开心值承压（下限 0，防止 HUD 出现负数）
    S.inspectLeft -= dt;
    S.happy = Math.max(0, S.happy - CFG.happyStress * dt);

    /* 巡视期间摸鱼 = 危险。但给 0.45s 的「最后一刻」缓冲：
       误触一下立刻松手能逃过，持续摸鱼才真的被抓。 */
    if (S.slacking) {
      S.graceT -= dt;
      edge.classList.add('urgent');
      if (!S.graceTipShown) { S.graceTipShown = true; toast('快松手！！', '#ff5c5c'); }
      if (S.graceT <= 0) {
        gameOver('你被开除了！', '光头老板就站在你工位边上，你还在偷 token —— 当场抓获。', 'caught');
        return;
      }
    } else {
      S.graceT = CFG.grace;
      S.graceTipShown = false;
      edge.classList.remove('urgent');
    }

    const pct = Math.max(0, Math.min(100, (S.inspectLeft / S.inspectTotal) * 100));
    $('inspectFill').style.width = pct + '%';
    if (S.inspectLeft <= 0) bossLeave();
  } else if (S.mode === 'playing') {

    /* ---- 哭泣：开心值过低就不想干活了 ---- */
    if (!S.cry && S.happy <= CFG.cryAt) {
      S.cry = true;
      S.cryLeft = CFG.cryGrace;
      S.slacking = false;
      fyWrap.classList.add('crying');
      S.dlg = null; closeDialog();   // 哭了就没人搭理你了
      $('cryBar').classList.add('on');
      toast('肥鱼emo 了…… 干活emo了', '#7fb7ff');
      Audio2.emo();
    }

    if (S.cry) {
      /* 哭泣中：摸鱼能慢慢把心情拉回来（速率仅为平时的 40%），
         但 risk 照涨 —— 想自救就得继续摸鱼，也就更容易被老板抓。
         不摸鱼则只微幅回升；7 秒内回不到 cryAt+12 就被劝退。 */
      S.cryLeft -= dt;
      if (S.slacking) {
        S.happy += CFG.happyGain * 0.4 * dt;
        S.risk += riskGain * dt;
        S.tkAcc += CFG.tokensPerSec * 0.5 * dt;
        while (S.tkAcc >= 1) { S.tkAcc -= 1; spawnToken(); }
        fyWrap.dataset.state = 'slack';
      } else {
        S.happy += 1.6 * dt;
        S.risk = Math.max(0, S.risk - CFG.riskDrain * dt);
        fyWrap.dataset.state = 'work';
      }
      S.happy = Math.max(0, Math.min(100, S.happy));

      $('cryFill').style.width = Math.max(0, S.cryLeft / CFG.cryGrace * 100) + '%';
      S.tAcc += dt;
      while (S.tAcc > 0.42) { S.tAcc -= 0.42; spawnTear(); }

      // 自救成功：心情回到阈值以上，擦干眼泪继续摸鱼
      if (S.happy >= CFG.cryAt + 12) {
        S.cry = false; S.cryLeft = 0;
        fyWrap.classList.remove('crying');
        $('cryBar').classList.remove('on');
        toast('肥鱼缓过来了！', '#7ee081');
        Audio2.clear();
      } else if (S.cryLeft <= 0) {
        gameOver('肥鱼哭着被辞退了',
          '上班上到当着老板面哭出来 —— 老板进来一看这状态，当场让你走人。', 'cry');
        return;
      }
    } else {
      if (S.slacking) {
        S.happy += CFG.happyGain * dt;
        S.risk  += riskGain * dt;
      } else {
        S.happy = Math.max(0, S.happy - CFG.happyDrain * dt);
        // 正在聊天打字时，risk 不下降 —— 聊天占用了摸鱼时间
        if (!(S.dlg && S.dlg.refresh)) S.risk -= CFG.riskDrain * dt;
      }
      S.risk = Math.max(0, Math.min(100, S.risk));
      S.happy = Math.max(0, Math.min(100, S.happy));

      // 预警：豆包提醒
      if (!S.alerted && S.risk >= alertAt) {
        S.alerted = true;
        dbWrap.dataset.state = 'alert';
        dbWrap.classList.add('alerting');
        $('dbBubble').classList.add('show');
        $('dbBubble').querySelector('span').textContent = '老板要来了，快收！';
        stage.classList.add('alarm');
        Audio2.alert();
      }
      if (S.alerted && S.risk < alertAt - 12) {
        S.alerted = false;
        dbWrap.dataset.state = 'work';
        dbWrap.classList.remove('alerting');
        $('dbBubble').classList.remove('show');
        stage.classList.remove('alarm');
      }

      // 老板推门：按概率触发
      const trigger = (S.risk / 100) * CFG.bossRate;
      if (Math.random() < trigger * dt) bossEnter();

      // token 产出
      if (S.slacking) {
        S.tkAcc += CFG.tokensPerSec * dt;
        while (S.tkAcc >= 1) { S.tkAcc -= 1; spawnToken(); }
      } else S.tkAcc = 0;
    }

    /* ---- 老板在场时豆姐主动搭话（每次巡视必有机会，忍住） ---- */
    if (inspecting && !S.dlg && S.inspectLeft > 0.6) {
      S.sneakNext -= dt;
      if (S.sneakNext <= 0) {
        nextDialog('sneak');
        S.sneakNext = 1.6 + Math.random() * 1.8;
      }
    } else if (!inspecting) {
      // 巡视一开始很快就能冒第一条，别让玩家整段巡视都遇不到
      S.sneakNext = Math.min(S.sneakNext, 0.35 + Math.random() * 0.3);
    }

    /* ---- 豆包对话：正常约每 4~7 秒来一轮 ---- */
    if (S.dlg) {
      S.dlg.t -= dt;
      $('dlgBar').querySelector('i').style.width =
        Math.max(0, S.dlg.t / CFG.dlgDur * 100) + '%';
      if (S.dlg.sneak) {
        // 老板在场：撑到巡视结束就自动消失
        if (!inspecting || S.dlg.t <= 0) {
          closeDialog();
          S.dlgNext = CFG.dlgMin + Math.random() * (CFG.dlgMax - CFG.dlgMin);
        }
      } else if (S.dlg.refresh && S.dlg.t <= 0) {
        // 发过一条之后，刷新一批新的备选
        S.dlg.refresh = false;
        const picks = pickTopics(3);
        S.dlg.answered = false;
        S.dlg.t = CFG.dlgDur;
        showThread(picks, false);
      } else if (S.dlg.t <= 0) {
        closeDialog();
        S.dlgNext = CFG.dlgMin + Math.random() * (CFG.dlgMax - CFG.dlgMin);
      }
    } else if (!inspecting && !S.cry && S.happy > CFG.cryAt + 6) {
      S.dlgNext -= dt;
      if (S.dlgNext <= 0) nextDialog();
    }
  }

  /* 心情气泡 */
  if (S.moodT > 0) {
    S.moodT -= dt;
    $('fyMood').classList.add('show');
    $('fyMood').textContent = S.slacking ? '^ω^' : (S.happy < 30 ? 'T_T' : '·_·');
  } else $('fyMood').classList.remove('show');

  updateHint();
  syncHUD();
}

/* 启动 */
requestAnimationFrame(loop);
loadBest();
reset();
$('cardStart').classList.add('show');