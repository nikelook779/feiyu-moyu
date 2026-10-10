/* 玩法平衡模拟：把 game.js 的核心规则抽出来跑多种策略
   含对话系统与哭泣机制 */
const CFG = {
  happyStart: 75, happyGain: 7.5, happyDrain: 4.2, happyStress: 7.5,
  riskGain: 10.0, riskDrain: 11.0, alertAt: 50, bossRate: 0.32,
  inspectBase: 2.8, inspectMax: 4.5, tokensPerSec: 2.4,
  doorWalk: 2.2, grace: 0.45,
  cryAt: 18, cryGrace: 9.0,
  dlgHappyAvg: 4.3, dlgMin: 13, dlgMax: 24,
};

function run(name, policy, maxSec = 420, seed = 12345) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

  let happy = CFG.happyStart, risk = 0, tokens = 0, level = 1;
  let mode = 'play', slack = false, inspectLeft = 0, inspectTotal = 0;
  let phase = 'idle', ptimer = 0;
  let cry = false, cryL = 0, dlgNext = 6, dlgT = 0;
  const dt = 1 / 60;
  let t = 0, caught = 0, cleared = 0, slackTime = 0, cryFired = 0, dlgs = 0, reason = '';

  while (t < maxSec) {
    t += dt;
    const lv = level - 1;
    const rg = CFG.riskGain * (1 + 0.05 * lv);

    // ---- 对话系统：随机时刻弹出，玩家点一下拿平均收益 ----
    if (dlgT > 0) {
      dlgT -= dt;
      if (dlgT <= 0) { happy = Math.min(100, happy + CFG.dlgHappyAvg); dlgs++; }
    } else {
      dlgNext -= dt;
      if (dlgNext <= 0) { dlgT = 2.6; dlgNext = CFG.dlgMin + rnd() * (CFG.dlgMax - CFG.dlgMin); }
    }

    slack = policy({ happy, risk, mode, phase, cry, rnd });
    if (slack) slackTime += dt;

    // ---- 老板流程 ----
    if (phase === 'in') {
      ptimer -= dt;
      if (ptimer <= 0) {
        if (slack) { reason = 'caught'; caught++; break; }
        mode = 'inspect'; phase = 'stay';
        inspectTotal = Math.min(CFG.inspectMax, CFG.inspectBase + lv * 0.12);
        inspectLeft = inspectTotal;
      }
    } else if (phase === 'out') { ptimer -= dt; if (ptimer <= 0) phase = 'idle'; }

    if (mode === 'inspect') {
      inspectLeft -= dt; happy -= CFG.happyStress * dt;
      if (slack) { reason = 'caught'; caught++; break; }
      if (inspectLeft <= 0) { mode = 'play'; phase = 'out'; risk = 0; happy = Math.min(100, happy + 15); cleared++; }
      continue;
    }

    // ---- 哭泣机制：摸鱼可自救（40% 速率），7s 内回不到阈值就被劝退 ----
    if (cry) {
      cryL -= dt;
      if (slack) {
        happy += CFG.happyGain * 0.4 * dt;
        risk += rg * dt;
        tokens += CFG.tokensPerSec * 0.5 * dt;
      } else {
        happy += 1.6 * dt;
        risk = Math.max(0, risk - CFG.riskDrain * dt);
      }
      happy = Math.min(100, happy);
      if (happy >= CFG.cryAt + 12) { cry = false; cryL = 0; }
      else if (cryL <= 0) { reason = 'cry'; cryFired++; break; }
      continue;
    }
    if (happy <= CFG.cryAt) { cry = true; cryL = CFG.cryGrace; continue; }

    // ---- 正常推进 ----
    if (slack) { happy += CFG.happyGain * dt; risk += rg * dt; tokens += CFG.tokensPerSec * dt; }
    else { happy -= CFG.happyDrain * dt; risk -= CFG.riskDrain * dt; }
    risk = Math.max(0, Math.min(100, risk)); happy = Math.min(100, happy);
    level = 1 + Math.floor(tokens / 14);
    if (rnd() < (risk / 100) * CFG.bossRate * dt) { phase = 'in'; ptimer = CFG.doorWalk; }
    if (happy <= 0) { reason = 'emo'; break; }
  }
  if (!reason) reason = 'timeout';
  return { name, t: +t.toFixed(0), tokens: Math.floor(tokens), caught, cleared,
           cryFired, dlgs, slackPct: +(slackTime / t * 100).toFixed(0), reason };
}

const policies = [
  ['贪心·一直摸鱼', () => true],
  ['新手·见门就松', ({ risk, phase, mode }) => mode === 'play' && phase !== 'in' && risk < 50],
  ['老手·45收手', ({ risk, phase, mode }) => mode === 'play' && phase !== 'in' && risk < 45],
  ['保守·30收手', ({ risk, phase, mode }) => mode === 'play' && phase !== 'in' && risk < 30],
  ['哭泣会摸鱼救', ({ risk, phase, mode, cry }) => mode === 'play' && phase !== 'in' && (cry ? true : risk < 50)],
];

console.log('策略'.padEnd(14), '存活(s)'.padEnd(8), 'token'.padEnd(7), '摸鱼%'.padEnd(8), '巡视'.padEnd(6), '对话'.padEnd(6), '结局分布');
for (const [n, p] of policies) {
  const agg = { t: 0, tokens: 0, caught: 0, cleared: 0, slackPct: 0, dlgs: 0, cryFired: 0 };
  const runs = 6, ends = {};
  for (let i = 0; i < runs; i++) {
    const r = run(n, p, 420, 1000 + i * 7777);
    for (const k in agg) agg[k] += r[k];
    ends[r.reason] = (ends[r.reason] || 0) + 1;
  }
  console.log(
    n.padEnd(14),
    (agg.t / runs).toFixed(0).padEnd(8),
    (agg.tokens / runs).toFixed(0).padEnd(7),
    (agg.slackPct / runs).toFixed(0) + '%'.padEnd(8),
    (agg.cleared / runs).toFixed(1).padEnd(6),
    (agg.dlgs / runs).toFixed(0).padEnd(6),
    Object.entries(ends).map(([k, v]) => `${k}:${v}`).join(' '));
}