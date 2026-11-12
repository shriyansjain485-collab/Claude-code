/* Lifetimes: economy rules (game logic only, no screen code).
   Reads tuning numbers from BAL (balance.js). Uses game globals at call time:
   S (the current life), L (write to the life log), popup (ask the player), netWorth, portValue, fmt, P. */
const ECO = (() => {
  const lim = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2; // ~N(0,1), bounded
  const chance = p => Math.random() < p;

  // Interpolate a [[x, y], ...] table on a log scale of x.
  function table(t, x) {
    if (x <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      const [x0, y0] = t[i - 1], [x1, y1] = t[i];
      if (x <= x1) {
        const f = x0 > 0 ? (Math.log(x) - Math.log(x0)) / (Math.log(x1) - Math.log(x0)) : x / x1;
        return y0 + (y1 - y0) * lim(f, 0, 1);
      }
    }
    return t[t.length - 1][1];
  }

  /* ---------- wealth ---------- */
  function liquid() {
    const v = S.inv2 || {};
    return Math.max(0, S.money) + (S.invest || 0) + portValue() + (v.gov || 0) + (v.corp || 0) + (v.junk || 0) + (v.gold || 0);
  }
  // A random gain or loss scaled to wealth, from BAL.events[key].
  function amt(key, wealth) {
    const e = BAL.events[key]; const w = wealth == null ? liquid() : wealth;
    return Math.round(lim(w * e.pct, e.floor, e.cap));
  }

  /* ---------- taxes ---------- */
  const taxMult = () => { const m = BAL.tax.countryMult; return m[S.country] != null ? m[S.country] : m.default; };
  function incomeTax(gross) {
    const b = BAL.tax.brackets; let t = 0;
    for (let i = 0; i < b.length; i++) {
      const lo = b[i][0], hi = i + 1 < b.length ? b[i + 1][0] : Infinity;
      if (gross > lo) t += (Math.min(gross, hi) - lo) * b[i][1];
    }
    return Math.round(t * taxMult());
  }
  // Add taxable income. Tax is settled once a year by settleTax().
  function earn(x) { S.money += x; S.taxable = (S.taxable || 0) + Math.max(0, x); return x; }
  function settleTax() {
    const g = S.taxable || 0; S.taxable = 0; if (g <= 0) return 0;
    const t = incomeTax(g); S.money -= t; S.yearTax = (S.yearTax || 0) + t;
    if (t > 0) L(`I paid ${fmt(t)} in income tax on ${fmt(g)} of income (${Math.round(t / g * 100)}%).`);
    return t;
  }
  function capGains(gain, what) {
    if (!(gain > 0)) return 0;
    const t = Math.round(gain * BAL.tax.capitalGains * Math.min(1.3, taxMult()));
    S.money -= t; S.yearTax = (S.yearTax || 0) + t;
    if (t >= 100) L(`I paid ${fmt(t)} in capital gains tax on ${what}.`);
    return t;
  }
  // Inheritance or a large gift to an heir. Returns what is left after tax.
  function inheritNet(amount) {
    const i = BAL.tax.inheritance; if (amount <= i.exempt) return amount;
    return Math.round(amount - (amount - i.exempt) * i.rate * Math.min(1.3, taxMult()));
  }
  const propertyTax = value => Math.round(value * BAL.tax.propertyRate * taxMult());
  const corporateRate = () => BAL.tax.corporate * Math.min(1.3, taxMult());

  /* ---------- market cycle ---------- */
  function phase() { if (!S.econ) S.econ = { phase: 'expansion', years: 0 }; return S.econ.phase; }
  function cycleYear() {
    phase(); const cur = BAL.cycle[S.econ.phase]; let r = Math.random(), next = S.econ.phase;
    for (const [k, p] of Object.entries(cur.next)) { if (r < p) { next = k; break; } r -= p; }
    if (next !== S.econ.phase) {
      const msg = { boom: 'The economy is booming.', expansion: 'The economy is growing steadily again.', recession: 'The economy slid into a recession.', crash: 'The stock market crashed. Panic everywhere.' }[next];
      L(msg, next === 'boom' || next === 'expansion' ? 'good' : 'bad');
      S.econ = { phase: next, years: 0 };
    } else S.econ.years++;
  }
  const badTimes = () => ['recession', 'crash'].includes(phase());
  // One year's return for an asset class (before diminishing returns).
  function ret(cls, extraDrift = 0, volMult = 1) {
    const a = BAL.assetClass[cls], c = BAL.cycle[phase()];
    return lim(c.ret * a.beta + (a.drift || 0) + extraDrift + (a.vol || 0) * volMult * gauss(), a.floor, a.cap);
  }
  // Gain on a holding of `value` at return r, with diminishing returns on very large holdings.
  function gain(value, r) {
    if (r <= 0 || value <= 0) return value * r;
    const d = BAL.sizeDamp; let g = 0;
    for (let i = 0; i < d.length; i++) {
      const lo = d[i][0], hi = i + 1 < d.length ? d[i + 1][0] : Infinity;
      if (value > lo) g += (Math.min(value, hi) - lo) * r * d[i][1];
    }
    return g;
  }
  const bizCycle = () => 1 + BAL.cycle[phase()].ret * BAL.assetClass.business.beta;

  /* ---------- cost of living ---------- */
  function living() {
    if (S.age < 18 || S.jail > 0) return { total: 0 };
    const L0 = BAL.living, nw = Math.max(0, netWorth());
    const home = S.assets.some(a => a.type === 'house' && !a.rented);
    const atHome = !home && S.age < 26 && !partner() && alive().some(p => p.rel.startsWith('Mother') || p.rel.startsWith('Father'));
    let household = atHome ? L0.withParents : table(L0.byNetWorth, nw) * (home ? 1 - L0.ownHomeDiscount : 1);
    const kidsN = S.people.filter(p => p.alive && ['Son', 'Daughter'].includes(p.rel) && p.age < 18).length;
    const kidsCost = kidsN * (L0.perChild + table(L0.byNetWorth, nw) * L0.perChildLifestyle);
    const pets = S.pets.filter(p => p.alive).length * L0.perPet;
    const debt = S.money < 0 ? -S.money * L0.debtInterest : 0;
    return { household: Math.round(household), kids: Math.round(kidsCost), pets, debt: Math.round(debt), total: Math.round(household + kidsCost + pets + debt), atHome };
  }

  /* ---------- businesses ---------- */
  // Grow (or shrink) a business's base revenue. Growth slows to nothing as it nears BAL.biz.maxScale × its starting size.
  function growBiz(b, m) {
    if (!b.rev0) b.rev0 = b.baseRev;
    const cap = b.rev0 * BAL.biz.maxScale, room = Math.max(0, 1 - b.baseRev / cap);
    const eff = m > 1 ? 1 + (m - 1) * room : m;
    b.baseRev = Math.round(b.baseRev * eff); return eff;
  }
  const costRate = b => BAL.biz.costRate.find(([max]) => b.baseRev < max)[1];
  const portfolioOverhead = () => 1 + Math.min(BAL.biz.portfolioOverheadMax, BAL.biz.portfolioOverhead * Math.max(0, S.biz.length - BAL.biz.portfolioFree));

  /* ---------- hazards that scale with wealth ---------- */
  function hazards() {
    const w = liquid(), H = BAL.hazards; if (w < H.minWealth || S.jail > 0) return;
    const guarded = S.vip && S.vip.staff && S.vip.staff.includes('Bodyguard');
    if (chance(H.burglary)) {
      if (guarded) L('My bodyguard stopped a burglary at my home.', 'good');
      else { const v = amt('burglary', w + S.assets.reduce((a, x) => a + x.value, 0)); S.money -= v; L(`Burglars broke into my home and took ${fmt(v)} worth of valuables.`, 'bad'); }
    }
    if (chance(H.fraud)) { const v = amt('fraud', w); S.money -= v; L(`An advisor I trusted quietly embezzled ${fmt(v)} from my accounts.`, 'bad'); }
    const pSue = Math.min(0.25, H.lawsuitBase + Math.max(0, netWorth()) / 1e9 * H.lawsuitPerBillion + S.fame * H.lawsuitPerFame);
    if (chance(pSue)) {
      const v = amt('lawsuit', w);
      popup('Lawsuit', `Someone is suing you for ${fmt(v)}. ${P(['They say you caused a car accident.', 'A former employee claims unfair dismissal.', 'A neighbor says your renovation damaged their home.', 'A business partner claims you broke a contract.', 'A stranger claims you defamed them online.'])}`, [
        [`Settle for ${fmt(Math.round(v * 0.5))}`, () => { S.money -= Math.round(v * 0.5); L(`I settled a lawsuit for ${fmt(Math.round(v * 0.5))}.`, 'bad'); }],
        [`Fight it in court (legal fees ${fmt(Math.round(v * 0.1))})`, () => {
          S.money -= Math.round(v * 0.1);
          if (chance(0.55)) L('I fought a lawsuit in court and won.', 'good');
          else { S.money -= v; L(`I lost a lawsuit and had to pay ${fmt(v)}.`, 'bad'); }
        }],
      ]);
    }
  }

  function migrate() {
    phase(); if (S.taxable == null) S.taxable = 0;
    if (!S.portBasis) { S.portBasis = {}; if (S.port && S.market) for (const k in S.port) S.portBasis[k] = (S.port[k] || 0) * (S.market[k] || 0); }
    if (S.investBasis == null) S.investBasis = S.invest || 0;
    if (S.inv2 && S.inv2.goldBasis == null) S.inv2.goldBasis = S.inv2.gold || 0;
    (S.biz || []).forEach(b => { if (!b.rev0) b.rev0 = b.baseRev; if (b.basis == null) b.basis = b.value; });
  }

  return { table, liquid, amt, taxMult, incomeTax, earn, settleTax, capGains, inheritNet, propertyTax, corporateRate,
    phase, cycleYear, badTimes, ret, gain, bizCycle, living, growBiz, costRate, portfolioOverhead, hazards, migrate, gauss };
})();
