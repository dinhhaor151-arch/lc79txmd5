// engine.js — Thuật toán phân tích dùng chung cho server và HTML
// Server dùng: const { computeSignals, makeDecision } = require('./engine');

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

  // S1: Money Pressure
  let mp = majorPct > 78 ? 0.95 : majorPct > 70 ? 0.80 : majorPct > 63 ? 0.62 :
           majorPct > 57 ? 0.42 : majorPct > 53 ? 0.22 : 0.06;

  // S2: Smart Money
  let sm = 0, smFavor = null;
  if (avgT > 0 && avgX > 0) {
    const r = avgT / avgX;
    if (r > 2.5)       { sm = 0.90; smFavor = 'TAI'; }
    else if (r > 1.8)  { sm = 0.72; smFavor = 'TAI'; }
    else if (r > 1.35) { sm = 0.48; smFavor = 'TAI'; }
    else if (r < 0.40) { sm = 0.90; smFavor = 'XIU'; }
    else if (r < 0.56) { sm = 0.72; smFavor = 'XIU'; }
    else if (r < 0.74) { sm = 0.48; smFavor = 'XIU'; }
    else               { sm = 0.08; }
  }

  // S3: Crowd Trap
  let ct = majorCrdPct > 70 ? 0.88 : majorCrdPct > 63 ? 0.68 :
           majorCrdPct > 57 ? 0.40 : majorCrdPct > 53 ? 0.18 : 0.04;

  // S4: Divergence Whale
  let dv = 0, dvFavor = null;
  if (divPct > 25)      { dv = 0.88; dvFavor = majorM; }
  else if (divPct > 15) { dv = 0.62; dvFavor = majorM; }
  else if (divPct > 8)  { dv = 0.35; dvFavor = majorM; }
  else dv = 0.06;

  // S5: Imbalance Risk
  let ib = imbal > 0.40 ? 0.92 : imbal > 0.28 ? 0.72 : imbal > 0.18 ? 0.50 :
           imbal > 0.10 ? 0.28 : 0.06;

  // S6: History Bias
  let hb = 0, hbFavor = null;
  const withDom = sessions.filter(s => s.dominant && s.dominant !== 'EQUAL' && s.result);
  if (withDom.length >= 5) {
    const minorWins = withDom.filter(s => s.result !== s.dominant).length;
    const minorRate = minorWins / withDom.length;
    if (minorRate > 0.70)      { hb = 0.90; hbFavor = minorM; }
    else if (minorRate > 0.55) { hb = 0.60; hbFavor = minorM; }
    else if (minorRate < 0.30) { hb = 0.90; hbFavor = majorM; }
    else if (minorRate < 0.45) { hb = 0.60; hbFavor = majorM; }
    else { hb = 0.10; }
  }

  // S7: Recent Momentum
  let rm = 0, rmFavor = null;
  const recentResults = sessions.filter(s => s.result).slice(0, 3).map(s => s.result);
  if (recentResults.length >= 3) {
    if (recentResults.every(r => r === 'TAI'))      { rm = 0.60; rmFavor = 'XIU'; }
    else if (recentResults.every(r => r === 'XIU')) { rm = 0.60; rmFavor = 'TAI'; }
    else if (recentResults[0] !== recentResults[1]) { rm = 0.30; rmFavor = recentResults[0] === 'TAI' ? 'XIU' : 'TAI'; }
  }

  // S8: Dominant Follow
  let df = 0, dfFavor = null;
  if (withDom.length >= 8) {
    const minorWins = withDom.filter(s => s.result !== s.dominant).length;
    const minorRate = minorWins / withDom.length;
    if (minorRate < 0.40) {
      df = Math.min(0.70 + (0.40 - minorRate) * 1.5, 0.95);
      dfFavor = majorM;
    } else if (minorRate > 0.60) {
      df = Math.min(0.70 + (minorRate - 0.60) * 1.5, 0.95);
      dfFavor = minorM;
    }
  }

  const targetSide = hbFavor || minorM;
  const moneySignal  = mp > 0.40;
  const crowdSignal  = ct > 0.40 && minorCrd === minorM;
  const smartSignal  = smFavor === targetSide && sm > 0.50;
  const agreementCount = [moneySignal, crowdSignal, smartSignal].filter(Boolean).length;

  const mp_c = hbFavor === majorM ? -mp * 0.5 : mp;
  const sm_c = smFavor === targetSide ? sm : smFavor ? -sm * 0.4 : 0;
  const ct_c = minorCrd === targetSide ? ct : -ct * 0.3;
  const dv_c = dvFavor === targetSide ? dv : dvFavor ? -dv * 0.3 : 0;
  const ib_c = ib;
  const hb_c = hbFavor === targetSide ? hb : hbFavor ? -hb * 0.8 : 0;
  const rm_c = rmFavor === targetSide ? rm : rmFavor ? -rm * 0.4 : 0;
  const df_c = dfFavor === targetSide ? df : dfFavor ? -df * 0.6 : 0;

  const rawScore =
    mp_c * 0.20 + sm_c * 0.18 + ct_c * 0.12 + dv_c * 0.08 +
    ib_c * 0.07 + hb_c * 0.25 + rm_c * 0.05 + df_c * 0.15;

  let score = 0.5 + rawScore * 0.70;
  if (agreementCount === 3) score = Math.min(0.97, score + 0.06);
  if (agreementCount === 0) score = Math.max(0.05, score - 0.05);
  score = Math.max(0.05, Math.min(0.97, score));

  return {
    score, majorM, minorM, majorPct, predTarget: hbFavor || minorM,
    pAT, pAX, pUT, pUX, avgT, avgX,
    imbal, divPct, majorCrd, minorCrd, majorCrdPct,
    mp, sm, smFavor, ct, dv, dvFavor, ib,
    hb, hbFavor, rm, rmFavor, df, dfFavor,
    agreementCount, withDomCount: withDom.length
  };
}

function makeDecision(s, sessionHistory) {
  const sessions = sessionHistory || [];
  const conf = s.score * 100;
  const target   = s.predTarget || s.minorM;
  const opposite = target === 'TAI' ? 'XIU' : 'TAI';
  let prediction, level;
  if      (conf >= 72) { prediction = target;   level = 'STRONG'; }
  else if (conf >= 62) { prediction = target;   level = 'GOOD'; }
  else if (conf >= 52) { prediction = target;   level = 'WEAK'; }
  else if (conf <= 38) { prediction = opposite; level = 'COUNTER'; }
  else                 { prediction = target;   level = 'WEAK'; }
  return { prediction, conf, level };
}

module.exports = { computeSignals, makeDecision };
