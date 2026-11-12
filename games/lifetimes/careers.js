/* Lifetimes: career, stat and free-time rules (game logic only, no screen code).
   Tuning numbers come from BAL (balance.js). Talks to the player only through L (life log), popup and toast. */
const RULES = (() => {
  /* ---------- free time ---------- */
  function timeBudget() {
    const T = BAL.time; let t = T.base;
    if (S.job || S.sp) t += T.job;
    else if (S.edu.school || (S.age >= 5 && S.age < 18 && !S.edu.dropped)) t += T.school;
    const young = S.people.filter(p => p.alive && ['Son', 'Daughter'].includes(p.rel) && p.age < 10).length;
    t += Math.max(T.maxKidPenalty, young * T.perYoungKid);
    if (S.vip && S.vip.staff && S.vip.staff.includes('Personal assistant')) t += T.assistant;
    return Math.max(3, t);
  }
  const timeUsed = () => (S.acts && S.acts._time) || 0;
  const timeLeft = () => timeBudget() - timeUsed();
  function timeCost(key) { for (const [pat, c] of BAL.time.costs) if (new RegExp(pat).test(key)) return c; return 0; }
  // Returns false (and spends nothing) if there is not enough free time left.
  function spendTime(key) {
    const c = timeCost(key); if (!c) return true;
    if (timeLeft() < c) return false;
    S.acts._time = timeUsed() + c; return true;
  }

  /* ---------- stats ---------- */
  // Positive gains shrink near the top, so 100% is never free.
  function gainScale(cur, d) {
    if (d <= 0) return d;
    const st = BAL.stats;
    if (cur >= st.hardCap) return Math.max(1, Math.round(d / 4));
    if (cur >= st.softCap) return Math.max(1, Math.round(d / 2));
    return d;
  }
  function ensureBase() {
    if (!S.base) S.base = { smarts: Math.min(S.stats.smarts, 70), looks: Math.min(S.stats.looks, 70) };
    return S.base;
  }
  function eduBoost(kind) { const b = ensureBase(); b.smarts = Math.min(90, b.smarts + BAL.stats.eduBoost[kind]); }
  // Smarts and looks drift back toward your natural level unless you keep working on them.
  function statYear() {
    const b = ensureBase(), d = BAL.stats.decay;
    if (S.age > 40 && !S.vampire) b.looks = Math.max(5, b.looks - BAL.stats.looksAging);
    ['smarts', 'looks'].forEach(k => {
      if (S.age < 18 && k === 'smarts') { b.smarts = Math.max(b.smarts, Math.min(S.stats.smarts, 75)); return; }
      const gap = S.stats[k] - b[k];
      if (gap > 0) S.stats[k] = Math.round(S.stats[k] - Math.max(1, gap * d));
    });
  }
  return { timeBudget, timeUsed, timeLeft, timeCost, spendTime, gainScale, ensureBase, eduBoost, statYear };
})();

const CAR = (() => {
  const chance = p => Math.random() < p;
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const DEFAULT = { peak: [25, 55], retire: 68, risk: ['layoff'], stress: 1 };
  function rule(j) { const c = CAREERS.find(x => x.id === j.career); return (c && BAL.career.rules[c.cat]) || DEFAULT; }
  function ensure(j) {
    if (j.stress == null) j.stress = 20;
    if (!j.rival) { const g = chance(.5) ? 'M' : 'F'; j.rival = { name: fname(g) + ' ' + P(LAST), skill: rnd(45, 75), heat: rnd(20, 45) }; }
    if (!j.ally) { const g = chance(.5) ? 'M' : 'F'; j.ally = { name: fname(g) + ' ' + P(LAST), bond: rnd(40, 60) }; }
    return j;
  }
  function lose(msg, cls) { if (!S.job) return; L(msg, cls || 'bad'); S.job = null; st('happy', -10); }
  function rep(d) { S.rep = clamp((S.rep == null ? 50 : S.rep) + d); }

  /* one year in a regular job */
  function jobYear() {
    const j = ensure(S.job), r = rule(j), a = S.age, K = BAL.career;
    j.salary = Math.round(j.salary * (1 + rnd(1, 3) / 100)); ECO.earn(j.salary); j.years++; j.inLevel++; S.flags.lastPay = j.salary; S.flags.worked = true;
    if (j.insured) { const c = Math.round(j.salary * K.insurance.cost); S.money -= c; }
    // performance follows your age curve, stress and reputation
    let drift = rnd(-6, 6);
    if (a < r.peak[0]) drift += 1;
    if (a > r.peak[1]) drift -= Math.ceil((a - r.peak[1]) / 4);
    if (j.stress > 70) drift -= 3;
    drift += Math.round(((S.rep == null ? 50 : S.rep) - 50) / 25);
    j.perf = clamp(j.perf + drift);
    // stress builds with seniority and the field, and eases off naturally toward a resting level
    j.stress = clamp(j.stress + rnd(0, 5) + j.level + (r.stress || 0) - (S.stats.happy > 70 ? 2 : 0) + (BAL.career.restingStress - j.stress) * BAL.career.stressRecovery);
    if (j.stress > 60) { st('health', -1); st('happy', -2); }
    if (S.job.fame) { S.fame = clamp(S.fame + rnd(1, 4) + j.level * 2); S.followers += Math.round(S.fame * rnd(200, 900) * (j.level + 1)); }
    if (a >= r.retire) { L(`I reached retirement age for my field and retired as ${j.title}.`, 'good'); S.job = null; st('happy', 4); return; }
    if (a === r.peak[1] + 1) L('I am past my professional peak. Keeping up will take more effort from here.');
    if (j.perf < 15 && chance(.5)) { lose(`I was fired from my job as ${j.title}.`); rep(-5); return; }
    if (risks(j, r)) return;
    // promotion: you compete with your rival for it
    if (j.perf > BAL.career.promoteAbove && j.inLevel >= 2 && chance(.45)) {
      const c = CAREERS.find(x => x.id === j.career);
      if (c && j.level < c.ladder.length - 1) {
        const me = j.perf + j.ally.bond / 10 + rnd(-15, 15), them = j.rival.skill + rnd(-15, 15);
        if (them > me) { j.rival.skill = clamp(j.rival.skill + K.rivalWins); j.rival.heat = clamp(j.rival.heat + 10); st('happy', -6); L(`My rival ${j.rival.name} got the promotion I wanted.`, 'bad'); }
        else { promote(); rep(2); }
      }
    }
  }

  /* the hazards of each field: at most one per year. Returns true if you lost the job. */
  function risks(j, r) {
    const K = BAL.career.risk, sal = j.salary;
    for (const type of r.risk) {
      if (type === 'layoff') {
        const m = ECO.phase() === 'crash' ? K.layoff.crash : ECO.phase() === 'recession' ? K.layoff.recession : 1;
        if (chance(K.layoff.base * m * (j.perf < 40 ? 1.5 : j.perf > 75 ? 0.5 : 1))) {
          const sev = Math.round(sal * K.layoff.severance); S.money += sev;
          lose(`I was laid off as ${j.title}${m > 1 ? ' as the economy turned' : ''}. I got ${fmt(sev)} in severance.`); return true;
        }
      }
      if (type === 'injury' && chance(K.injury.p * (S.stats.health < 50 ? 1.5 : 1))) {
        st('health', -rnd(8, 22)); const bill = Math.max(2000, ECO.amt('medicalBill')); S.money -= Math.round(bill * 0.3);
        if (chance(K.injury.careerEnding) || S.stats.health < 20) { const pay = Math.round(sal * 1.5); S.money += pay; lose(`I was badly injured on the job and can no longer work as ${j.title}. I received ${fmt(pay)} in compensation.`); return true; }
        j.perf = clamp(j.perf - 8); L(`I was injured on the job. My share of the medical bills was ${fmt(Math.round(bill * 0.3))}.`, 'bad'); return false;
      }
      if (type === 'scandal' && chance(K.scandal.p + S.fame * K.scandal.perFame)) { scandal(() => lose(`I lost my job as ${j.title} over the scandal.`)); return false; }
      if (type === 'lawsuit' && chance(K.lawsuit.p)) {
        const claim = Math.round(sal * (K.lawsuit.minSalary + Math.random() * (K.lawsuit.maxSalary - K.lawsuit.minSalary)));
        const ins = j.insured ? BAL.career.insurance.covers : 0;
        const what = P(['A client says my advice cost them dearly.', 'Someone I served claims I was negligent.', 'A complaint has turned into a formal claim against me.']);
        popup('Professional lawsuit', `${what} They want ${fmt(claim)}.${ins ? ` Your professional insurance covers ${Math.round(ins * 100)}%.` : ' You have no professional insurance.'}`, [
          [`Settle (${fmt(Math.round(claim * 0.6 * (1 - ins)))})`, () => { S.money -= Math.round(claim * 0.6 * (1 - ins)); rep(-3); L(`I settled a professional lawsuit for ${fmt(Math.round(claim * 0.6 * (1 - ins)))}.`, 'bad'); }],
          ['Fight it', () => { if (chance(.5)) { rep(3); L('I fought a professional lawsuit and was cleared.', 'good'); } else { S.money -= Math.round(claim * (1 - ins)); rep(-10); j.perf = clamp(j.perf - 10); L(`I lost a professional lawsuit and paid ${fmt(Math.round(claim * (1 - ins)))}.`, 'bad'); } }],
        ]);
        return false;
      }
      if (type === 'burnout' && j.stress >= K.burnoutAt) {
        popup('Burnout', 'You wake up and cannot face another day of work. You are completely burned out.', [
          ['Take three months of unpaid leave', () => { const c = Math.round(sal * 0.25); S.money -= c; j.stress = 25; st('happy', 8); st('health', 4); L(`I took unpaid leave to recover from burnout. It cost me ${fmt(c)} in pay.`); }],
          ['Push through it', () => { j.stress = 70; st('health', -12); st('happy', -10); j.perf = clamp(j.perf - 12); if (chance(.3)) { const b = Math.max(3000, ECO.amt('medicalBill')); S.money -= b; L(`I collapsed at work from exhaustion. The hospital bill was ${fmt(b)}.`, 'bad'); } else L('I pushed through burnout. My work and my health both suffered.', 'bad'); }],
          ['Quit', () => { lose(`I quit my job as ${j.title} to recover from burnout.`, ''); st('happy', 15); st('health', 5); }],
        ]);
        return false;
      }
    }
    return false;
  }

  function scandal(onFired) {
    const what = P(['An old, embarrassing video of you has surfaced.', 'A colleague has accused you of misconduct.', 'A reporter is running a story that makes you look terrible.', 'Private messages of yours have leaked.']);
    popup('Scandal', `${what} People are talking.`, [
      ['Apologize publicly', () => { rep(-8); if (chance(.15)) onFired(); else L('I apologized publicly. The scandal slowly faded.'); }],
      ['Deny everything', () => { if (chance(.5)) { rep(-2); L('I denied the story and it blew over.', 'good'); } else { rep(-25); S.fame = clamp(S.fame + 3); L('My denial fell apart when more evidence came out.', 'bad'); onFired(); } }],
      [`Hire a crisis PR firm (${fmt(Math.max(5000, ECO.amt('fine') * 4))})`, () => { const c = Math.max(5000, ECO.amt('fine') * 4); S.money -= c; rep(-3); L(`I paid a crisis PR firm ${fmt(c)} to bury a scandal.`); }],
    ]);
  }

  /* extra hazards for the special careers (sports, acting and so on have their own systems too) */
  function spYear() {
    const s = S.sp; if (!s || S.jail) return;
    if (['actor', 'music', 'director'].includes(s.kind)) {
      if (chance(0.02 + S.fame / 1500)) scandal(() => { S.fame = clamp(S.fame - 15); L('Studios and sponsors dropped me over the scandal.', 'bad'); });
      if (S.age > 55 && S.fame > 10 && chance(.5)) S.fame = clamp(S.fame - 1);
    }
    if (s.kind === 'agent' && S.age >= 60) spEnd('I reached the agency’s retirement age and handed in my badge.', 'good');
    if (s.kind === 'pol' && S.age >= 82 && s.office >= 0) { L('I retired from public office.', 'good'); s.office = -1; }
  }
  return { rule, ensure, jobYear, spYear, scandal, rep, lose };
})();
