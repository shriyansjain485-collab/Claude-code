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
    const g = S.taxable || 0; S.taxable = 0; S.lastIncome = Math.max(0, g); if (g <= 0) return 0;
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
  // Yearly household spending. Mostly follows what you earn (last year's take-home pay), plus a lifestyle
  // that grows with spendable wealth. The home you live in does not count as spendable wealth.
  function living() {
    if (S.age < 18 || S.jail > 0) return { total: 0 };
    const L0 = BAL.living;
    const home = S.assets.some(a => a.type === 'house' && !a.rented);
    const homeValue = S.assets.filter(a => a.type === 'house' && !a.rented).reduce((t, a) => t + a.value, 0);
    const spendable = Math.max(0, netWorth() - homeValue);
    const atHome = !home && S.age < 26 && !partner() && alive().some(p => p.rel.startsWith('Mother') || p.rel.startsWith('Father'));
    const gross = Math.max(S.lastIncome || 0, S.job ? S.job.salary : 0), net = gross - incomeTax(gross);
    const lifestyle = L0.incomeShare * Math.max(0, net - L0.essentials) + table(L0.byWealth, spendable);
    let household = atHome ? L0.withParents : L0.essentials * (home ? 1 - L0.ownHomeDiscount : 1) + lifestyle;
    const kidsN = S.people.filter(p => p.alive && ['Son', 'Daughter'].includes(p.rel) && p.age < 18).length;
    const kidsCost = kidsN * (L0.perChild + lifestyle * L0.perChildLifestyle);
    const pets = S.pets.filter(p => p.alive).length * L0.perPet;
    const debt = S.money < 0 ? -S.money * L0.debtInterest : 0;
    const tm = typeof LEG !== 'undefined' ? (LEG.has('thrifty') ? 0.88 : LEG.has('spendthrift') ? 1.15 : 1) : 1;
    household *= tm;
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
    const luck = typeof LEG !== 'undefined' && LEG.has('lucky') ? 0.6 : 1;
    if (chance(H.burglary * luck)) {
      if (guarded) L('My bodyguard stopped a burglary at my home.', 'good');
      else { const v = amt('burglary', w + S.assets.reduce((a, x) => a + x.value, 0)); S.money -= v; L(`Burglars broke into my home and took ${fmt(v)} worth of valuables.`, 'bad'); }
    }
    if (chance(H.fraud * luck)) { const v = amt('fraud', w); S.money -= v; L(`An advisor I trusted quietly embezzled ${fmt(v)} from my accounts.`, 'bad'); }
    lawsuit(w, luck);
  }

  /* ---------- lawsuits: only for a real reason in the player's life ---------- */
  // Each reason: [weight, claim, text, how strong their case is (0-1)].
  function suitReasons(w) {
    const out = [], H = BAL.hazards, cap = (v, hi) => Math.round(lim(v, 5e3, hi));
    const car = S.assets.find(a => a.type === 'car' || a.type === 'classic');
    if (car && S.age >= 18) out.push([0.5, cap(w * 0.01, 2e6), `The other driver in a crash with your ${car.name.toLowerCase()} says it was your fault and wants damages.`, 0.45]);
    S.biz.forEach(b => {
      if (b.staff >= 3 && b.morale < 40) out.push([1, cap(b.value * 0.03, 50e6), `A former employee of ${b.name} claims unfair dismissal. Staff morale there is low (${Math.round(b.morale)}%).`, 0.55]);
      if (b.rating < 45) out.push([1, cap(b.value * 0.05, 80e6), `A customer says a poor product or service from ${b.name} harmed them. Its rating is only ${Math.round(b.rating)}%.`, 0.55]);
    });
    S.assets.filter(a => a.rented && a.tenant && (a.repair || a.tenant.mood < 35)).forEach(a => out.push([1, cap(a.value * 0.05, 5e6), `Your tenant ${a.tenant.name} is suing over the state of your ${a.name.toLowerCase()}${a.repair ? ': a repair has been left undone' : ''}.`, 0.6]));
    if (typeof LEG !== 'undefined') S.people.filter(LEG.isEnemy).forEach(e => out.push([1.5, cap(w * 0.02, 200e6), `${e.name}, who has had it in for you, has filed a lawsuit claiming you cheated them.`, 0.3]));
    if (S.fame >= H.lawsuitFame) out.push([0.5, cap(w * 0.02, 100e6), 'Someone you criticised in public says your words ruined their reputation and is suing for defamation.', 0.35]);
    if (S.karma != null && S.karma < 25 && S.age >= 18) out.push([1, cap(w * 0.03, 200e6), 'Someone you wronged in the past has found a lawyer and is suing you.', 0.6]);
    return out;
  }
  function lawsuit(w, luck) {
    const H = BAL.hazards; S.flags = S.flags || {};
    if (S.flags.lastSued != null && S.age - S.flags.lastSued < H.lawsuitCooldown) return;
    const rs = suitReasons(w); if (!rs.length) return;
    const total = rs.reduce((a, r) => a + r[0], 0);
    const wealth = 1 + Math.max(0, Math.log10(Math.max(1, netWorth()) / 1e6)) * H.lawsuitWealthWeight;
    if (!chance(luck * Math.min(H.lawsuitCap, total * H.lawsuitPerReason * wealth))) return;
    let r = Math.random() * total, pick = rs[0];
    for (const x of rs) { if ((r -= x[0]) < 0) { pick = x; break; } }
    const [, v, why, strength] = pick; S.flags.lastSued = S.age;
    const win = lim(1 - strength + ((S.karma == null ? 50 : S.karma) - 50) / 250, 0.15, 0.85);
    popup('Lawsuit', `${why} They want ${fmt(v)}. Your lawyer puts your chances in court at about ${Math.round(win * 100)}%.`, [
      [`Settle for ${fmt(Math.round(v * 0.5))}`, () => { S.money -= Math.round(v * 0.5); L(`I settled a lawsuit for ${fmt(Math.round(v * 0.5))}.`, 'bad'); }],
      [`Fight it in court (legal fees ${fmt(Math.round(v * 0.1))})`, () => {
        S.money -= Math.round(v * 0.1);
        if (chance(win)) L('I fought a lawsuit in court and won.', 'good');
        else { S.money -= v; L(`I lost a lawsuit and had to pay ${fmt(v)}.`, 'bad'); }
      }],
    ]);
  }

  function migrate() {
    phase(); if (S.taxable == null) S.taxable = 0;
    if (!S.portBasis) { S.portBasis = {}; if (S.port && S.market) for (const k in S.port) S.portBasis[k] = (S.port[k] || 0) * (S.market[k] || 0); }
    if (S.investBasis == null) S.investBasis = S.invest || 0;
    if (S.inv2 && S.inv2.goldBasis == null) S.inv2.goldBasis = S.inv2.gold || 0;
    (S.biz || []).forEach(b => { if (!b.rev0) b.rev0 = b.baseRev; if (b.basis == null) b.basis = b.value; });
  }

  return { table, liquid, amt, taxMult, incomeTax, earn, settleTax, capGains, inheritNet, propertyTax, corporateRate,
    phase, cycleYear, badTimes, ret, gain, bizCycle, living, growBiz, costRate, portfolioOverhead, hazards, suitReasons, migrate, gauss };
})();
