// engine.js v4 — Mode-based prediction
// Key findings từ analyze2.js:
// 1. Sau 6+ FOLLOW liên tiếp → 61% COUNTER tiếp theo
// 2. Imbal > 20% → 60% FOLLOW (bên nhiều tiền thắng)
// 3. Prev imbal 15-20% → 62.5% COUNTER tiếp theo
// 4. COUNTER → COUNTER: 53.7% (momentum counter)
// 5. FOLLOW → FOLLOW: 50.5% (gần random)

function computeSignals(amtTai, amtXiu, userTai, userXiu, sessionHistory) {
  const sessions = sessionHistory || [];
  const totalAmt  = amtTai + amtXiu;
  const totalUser = (userTai + userXiu) || 1;
  const pAT = amtTai / totalAmt * 100;
  const pAX = 100 - pAT;
  const pUT = userTai / totalUser * 100;
  const pUX = 100 - pUT;
  const avgT = userTai > 0 ? amtTai / userTai : 0;
  const avgX = userXiu > 0 ? amtXiu / userXiu : 0;
  const imbal = Math.abs(amtTai - amtXiu) / totalAmt;
  const divPct = Math.abs(pAT - pUT);
  const majorM = pAT > pAX ? 'TAI' : 'XIU';
  const minorM = majorM === 'TAI' ? 'XIU' : 'TAI';
  const majorPct = Math.max(pAT, pAX);
  const majorCrd = pUT > pUX ? 'TAI' : 'XIU';
  const minorCrd = majorCrd === 'TAI' ? 'XIU' : 'TAI';
  const majorCrdPct = Math.max(pUT, pUX);

  // ── Tính mode lịch sử ──
  const withMode = sessions.filter(s => s.result && s.dominant && s.dominant !== 'EQUAL').map(s => ({
    ...s,
    mode: s.result === s.dominant ? 'FOLLOW' : 'COUNTER'
  }));

  // ── S_MODE: Mode-based signal (KEY SIGNAL) ──
  let modeSig = 0, modeFavor = null;

  // Signal 1: Sau 6+ FOLLOW liên tiếp → 61% COUNTER
  if (withMode.length >= 6) {
    const last6 = withMode.slice(0, 6);
    if (last6.every(s => s.mode === 'FOLLOW')) {
      modeSig = 0.72; modeFavor = minorM; // COUNTER = bên ít tiền thắng
    }
  }
  // Signal 2: Sau 4-5 FOLLOW → 52-53% COUNTER (yếu hơn)
  if (!modeFavor && withMode.length >= 4) {
    const last4 = withMode.slice(0, 4);
    if (last4.every(s => s.mode === 'FOLLOW')) {
      modeSig = 0.55; modeFavor = minorM;
    }
  }

  // Signal 3: Imbal > 20% → 60% FOLLOW (bên nhiều tiền thắng)
  if (imbal > 0.20) {
    if (!modeFavor || modeSig < 0.65) {
      modeSig = 0.65; modeFavor = majorM;
    }
  }

  // Signal 4: COUNTER momentum — sau 3+ COUNTER → 56% COUNTER tiếp
  if (!modeFavor && withMode.length >= 3) {
    const last3 = withMode.slice(0, 3);
    if (last3.every(s => s.mode === 'COUNTER')) {
      modeSig = 0.58; modeFavor = minorM;
    }
  }

  // Signal 5: Prev imbal 15-20% → 62.5% COUNTER tiếp theo
  if (!modeFavor && withMode.length >= 1) {
    const prevImbal = withMode[0].imbalStore ? withMode[0].imbalStore * 100 : (withMode[0].imbal || 0);
    if (prevImbal >= 15 && prevImbal < 20) {
      modeSig = 0.63; modeFavor = minorM; // COUNTER
    }
  }

  // ── S1: Money Pressure ──
  let mp = imbal > 0.25 ? 0.88 : imbal > 0.15 ? 0.72 : imbal > 0.10 ? 0.52 :
           imbal > 0.07 ? 0.32 : imbal > 0.05 ? 0.15 : 0.03;

  // ── S2: Smart Money ──
  let sm = 0, smFavor = null;
  if (avgT > 0 && avgX > 0) {
    const r = avgT / avgX;
    if (r > 2.5)       { sm = 0.88; smFavor = 'TAI'; }
    else if (r > 1.8)  { sm = 0.70; smFavor = 'TAI'; }
    else if (r > 1.35) { sm = 0.45; smFavor = 'TAI'; }
    else if (r < 0.40) { sm = 0.88; smFavor = 'XIU'; }
    else if (r < 0.56) { sm = 0.70; smFavor = 'XIU'; }
    else if (r < 0.74) { sm = 0.45; smFavor = 'XIU'; }
    else               { sm = 0.03; }
  }

  // ── S6: History Bias ──
  let hb = 0, hbFavor = null;
  const withDom = sessions.filter(s => s.dominant && s.dominant !== 'EQUAL' && s.result);
  if (withDom.length >= 20) {
    const minorWins = withDom.filter(s => s.result !== s.dominant).length;
    const minorRate = minorWins / withDom.length;
    if (minorRate > 0.65)      { hb = 0.85; hbFavor = minorM; }
    else if (minorRate > 0.58) { hb = 0.58; hbFavor = minorM; }
    else if (minorRate < 0.35) { hb = 0.85; hbFavor = majorM; }
    else if (minorRate < 0.42) { hb = 0.58; hbFavor = majorM; }
    else { hb = 0.03; }
  }

  // ── S7: Momentum ──
  let rm = 0, rmFavor = null;
  const recentR = sessions.filter(s => s.result).slice(0, 5).map(s => s.result);
  if (recentR.length >= 5 && recentR.every(r => r === 'TAI')) { rm = 0.72; rmFavor = 'XIU'; }
  else if (recentR.length >= 5 && recentR.every(r => r === 'XIU')) { rm = 0.72; rmFavor = 'TAI'; }
  else if (recentR.length >= 3 && recentR.slice(0,3).every(r => r === 'TAI')) { rm = 0.52; rmFavor = 'XIU'; }
  else if (recentR.length >= 3 && recentR.slice(0,3).every(r => r === 'XIU')) { rm = 0.52; rmFavor = 'TAI'; }

  // ── Target ──
  // Ưu tiên: modeFavor > hbFavor > minorM
  const targetSide = modeFavor || hbFavor || minorM;

  // ── Composite Score ──
  const mode_c = modeFavor === targetSide ? modeSig : modeFavor ? -modeSig * 0.8 : 0;
  const mp_c   = hbFavor === majorM ? -mp * 0.3 : (targetSide === minorM ? mp : -mp * 0.3);
  const sm_c   = smFavor === targetSide ? sm : smFavor ? -sm * 0.2 : 0;
  const hb_c   = hbFavor === targetSide ? hb : hbFavor ? -hb * 0.9 : 0;
  const rm_c   = rmFavor === targetSide ? rm : rmFavor ? -rm * 0.2 : 0;

  const rawScore =
    mode_c * 0.40 +  // Mode signal — QUAN TRỌNG NHẤT
    mp_c   * 0.18 +
    sm_c   * 0.12 +
    hb_c   * 0.20 +
    rm_c   * 0.10;

  let score = 0.5 + rawScore * 0.65;
  score = Math.max(0.32, Math.min(0.97, score));

  return {
    score, majorM, minorM, majorPct, predTarget: targetSide,
    pAT, pAX, pUT, pUX, avgT, avgX,
    imbal, divPct, majorCrd, minorCrd, majorCrdPct,
    mp, sm, smFavor, hb, hbFavor, rm, rmFavor,
    modeSig, modeFavor,
    withDomCount: withDom.length,
    agreementCount: [mp > 0.40, sm > 0.40, modeSig > 0.55].filter(Boolean).length
  };
}

function makeDecision(s, sessionHistory) {
  const conf = s.score * 100;
  const target = s.predTarget || s.minorM;
  const warnings = [];
  if (s.imbal < 0.05) warnings.push('Tien can bang');
  if (s.modeFavor) warnings.push('Mode signal: ' + s.modeFavor + ' (' + (s.modeSig*100).toFixed(0) + '%)');

  let prediction, level;
  if      (conf >= 68) { prediction = target; level = 'STRONG'; }
  else if (conf >= 60) { prediction = target; level = 'GOOD'; }
  else if (conf >= 52) { prediction = target; level = 'WEAK'; }
  else                 { prediction = target; level = 'WEAK'; }

  return { prediction, conf, level, warnings };
}

module.exports = { computeSignals, makeDecision };
