/* Lifetimes: choice events (game logic and content, no screen code).
   An event is data: a title, a description, requirements, and 2-4 options. Each option has one or more
   possible outcomes with probabilities. Outcomes can change money, stats, karma, fame, reputation,
   job performance and stress, and relationships. The engine shows events through popup() and logs through L().

   Outcome fields: p (probability weight), t (log text), c ('good' | 'bad'), m (money), s ({stat: change}),
   k (karma), f (fame), r (reputation), perf, stress, bond ([[who, change], ...]), fx (custom function).
   Money amounts: a number, or {a: index, x: multiplier} referring to the event's `amounts` list.
   Amount specs: ['w', pct, floor, cap] = share of liquid wealth, ['sal', fraction] = share of yearly pay,
   ['biz', fraction] = share of a business's yearly revenue, or a plain number.
   Text tokens: {partner} {friend} {parent} {kid} {sibling} {grandkid} {rival} {ally} {boss} {biz} {a0} {a1} {a2}. */
const EVT = (() => {
  const defs = [];
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const first = p => p.name.split(' ')[0];
  const yearlyPay = () => S.job ? S.job.salary : S.sp && S.sp.salary ? S.sp.salary : S.flags.pension || 30e3;

  function people(rel) {
    const a = S.people.filter(p => p.alive);
    if (rel === 'partner') { const p = partner(); return p ? [p] : []; }
    if (rel === 'friend') return a.filter(p => p.rel === 'Friend');
    if (rel === 'parent') return a.filter(p => p.rel.startsWith('Mother') || p.rel.startsWith('Father'));
    if (rel === 'kid') return a.filter(p => ['Son', 'Daughter'].includes(p.rel));
    if (rel === 'sibling') return a.filter(p => ['Brother', 'Sister'].includes(p.rel));
    if (rel === 'grandkid') return a.filter(p => ['Grandson', 'Granddaughter'].includes(p.rel));
    if (rel === 'ex') return a.filter(p => p.rel === 'Ex');
    return [];
  }

  function ok(e) {
    const q = e.req || {}, a = S.age;
    if (S.jail > 0 && !q.jail) return false;
    if (q.age && (a < q.age[0] || a > q.age[1])) return false;
    if (q.job && !S.job) return false;
    if (q.work && !(S.job || S.sp)) return false;
    if (q.cats) { if (!S.job) return false; const c = CAREERS.find(x => x.id === S.job.career); if (!c || !q.cats.includes(c.cat)) return false; }
    if (q.sp && !(S.sp && q.sp.includes(S.sp.kind))) return false;
    if (q.biz && !S.biz.length) return false;
    if (q.wealth) { const w = netWorth(); if (w < q.wealth[0] || w > (q.wealth[1] == null ? Infinity : q.wealth[1])) return false; }
    if (q.stats) for (const k in q.stats) { const v = S.stats[k]; if (v < q.stats[k][0] || v > q.stats[k][1]) return false; }
    if (q.country && !q.country.includes(S.country)) return false;
    if (q.rel === 'single' && partner()) return false;
    if (q.rel === 'partner' && !partner()) return false;
    if (q.rel === 'married' && !(partner() && partner().rel === 'Spouse')) return false;
    if (q.school === 'k12' && !(a >= 5 && a < 18 && !S.edu.dropped)) return false;
    if (q.school === 'uni' && !(S.edu.school && S.edu.school.type === 'uni')) return false;
    if (q.has) for (const h of q.has) {
      if (h === 'house') { if (!S.assets.some(x => x.type === 'house')) return false; }
      else if (h === 'car') { if (!S.assets.some(x => x.type === 'car')) return false; }
      else if (h === 'kidAge') { if (!people('kid').some(k => k.age >= q.kidAge[0] && k.age <= q.kidAge[1])) return false; }
      else if (!people(h).length) return false;
    }
    if (q.if && !q.if()) return false;
    return true;
  }

  function amount(spec, ctx) {
    if (typeof spec === 'number') return spec;
    const [kind, x, lo, hi] = spec;
    if (kind === 'w') return Math.round(Math.max(lo, Math.min(hi, ECO.liquid() * x)) / 10) * 10;
    if (kind === 'sal') return Math.round(yearlyPay() * x / 10) * 10;
    if (kind === 'biz') return Math.round((ctx.biz ? ctx.biz.baseRev : 100e3) * x / 100) * 100;
    return 0;
  }

  function context(e) {
    const q = e.req || {}, ctx = { tok: {} };
    ['partner', 'friend', 'parent', 'sibling', 'grandkid', 'ex'].forEach(r => { const l = people(r); if (l.length) { ctx[r] = P(l); ctx.tok[r] = first(ctx[r]); } });
    let ks = people('kid'); if (q.kidAge) ks = ks.filter(k => k.age >= q.kidAge[0] && k.age <= q.kidAge[1]);
    if (ks.length) { ctx.kid = P(ks); ctx.tok.kid = first(ctx.kid); }
    if (S.job) { CAR.ensure(S.job); ctx.tok.rival = S.job.rival.name; ctx.tok.ally = S.job.ally.name; }
    ctx.tok.boss = (Math.random() < .5 ? 'Mr. ' : 'Ms. ') + P(LAST);
    if (S.biz.length) { ctx.biz = P(S.biz); ctx.tok.biz = ctx.biz.name; }
    ctx.amt = (e.amounts || []).map(sp => amount(sp, ctx));
    ctx.amt.forEach((v, i) => ctx.tok['a' + i] = fmt(v));
    return ctx;
  }
  const fill = (t, ctx) => String(typeof t === 'function' ? t(ctx) : t).replace(/\{(\w+)\}/g, (m, k) => ctx.tok[k] != null ? ctx.tok[k] : m);

  function pick(outs) {
    if (!Array.isArray(outs)) return outs;
    const total = outs.reduce((a, o) => a + (o.p == null ? 1 : o.p), 0); let r = Math.random() * total;
    for (const o of outs) { r -= (o.p == null ? 1 : o.p); if (r <= 0) return o; }
    return outs[outs.length - 1];
  }

  function apply(o, ctx) {
    if (o.m != null) { const v = typeof o.m === 'number' ? o.m : Math.round(ctx.amt[o.m.a] * (o.m.x == null ? -1 : o.m.x)); S.money += v; }
    if (o.s) for (const k in o.s) st(k, o.s[k]);
    if (o.k) kar(o.k);
    if (o.f) S.fame = clamp(S.fame + o.f);
    if (o.r) CAR.rep(o.r);
    if (S.job) { if (o.perf) S.job.perf = clamp(S.job.perf + o.perf); if (o.stress) S.job.stress = clamp((S.job.stress || 0) + o.stress); }
    if (o.bond) o.bond.forEach(([who, d]) => {
      if (who === 'family') S.people.forEach(p => { if (p.alive && !['Friend', 'Ex'].includes(p.rel)) p.bond = clamp(p.bond + d); });
      else if (who === 'kids') people('kid').forEach(p => p.bond = clamp(p.bond + d));
      else if (who === 'friends') people('friend').forEach(p => p.bond = clamp(p.bond + d));
      else if (who === 'ally' && S.job) S.job.ally.bond = clamp(S.job.ally.bond + d);
      else if (who === 'rival' && S.job) S.job.rival.heat = clamp(S.job.rival.heat + d);
      else if (ctx[who]) ctx[who].bond = clamp(ctx[who].bond + d);
    });
    if (o.fx) o.fx(ctx);
    if (o.t) { const text = fill(o.t, ctx); L(text, o.c || ''); if (typeof toast === 'function') toast(text); }
  }

  function run(e) {
    const ctx = context(e);
    const opts = e.opts.filter(([, , need]) => !need || need.cost == null || S.money >= ctx.amt[need.cost]);
    popup(e.title, fill(e.text, ctx), (opts.length >= 2 ? opts : e.opts).map(([label, outs]) => [fill(label, ctx), () => apply(pick(outs), ctx)]));
  }
  function add(e) { defs.push(e); }
  // Adapters so these events join the game's yearly event roll.
  const legacy = () => defs.map(e => ({ id: e.id, min: (e.req && e.req.age ? e.req.age[0] : 0), max: (e.req && e.req.age ? e.req.age[1] : 130), once: e.once, cd: e.cd, w: e.w, cond: () => ok(e), run: () => run(e) }));
  return { defs, add, ok, run, legacy, people };
})();

/* ---------- helpers for event outcomes ---------- */
const X = {
  fire: msg => CAR.lose(msg),
  friend: where => { const f = person('Friend', clamp(S.age + R(-3, 3), 4, 99), C(.5) ? 'M' : 'F'); f.bond = R(55, 75); S.people.push(f); return f; },
  pet: (kind, name) => S.pets.push({ id: uid(), kind, name: name || P(PETNAMES), age: R(1, 4), alive: true, bond: 70 }),
  ill: n => { const i = ILL.find(x => x.n === n); if (i && !S.ill.some(x => x.n === n)) S.ill.push({ ...i }); },
  record: () => { S.record++; },
};

/* ---------- the events ---------- */
(() => {
  const E = (id, cat, title, text, req, opts, extra) => EVT.add({ id, cat, title, text, req, opts, ...(extra || {}) });
  const W = (pct, lo, hi) => ['w', pct, lo, hi];

  /* childhood */
  E('c_lostdog', 'childhood', 'Lost dog', 'A muddy dog with a collar follows you home from the park. The tag has a phone number.', { age: [5, 11] }, [
    ['Call the number', [{ p: .7, t: 'I returned a lost dog. The owner gave me $20 as a thank-you.', c: 'good', m: 20, k: 5 }, { p: .3, t: 'I returned a lost dog. The owner barely said thanks.', k: 4 }]],
    ['Hide it and keep it', [{ p: .5, t: 'I kept a lost dog and named it myself. I feel a bit guilty.', k: -5, s: { happy: 6 }, fx: () => X.pet('dog') }, { p: .5, t: 'My parents found the dog I was hiding and made me give it back.', c: 'bad', k: -3, bond: [['parent', -5]] }]],
    ['Leave it outside', { t: 'I left a lost dog outside. It was gone by morning.', k: -2 }]], { once: 1 });
  E('c_dare', 'childhood', 'The dare', 'Your friends dare you to jump off the garage roof onto an old mattress.', { age: [6, 12] }, [
    ['Jump!', [{ p: .6, t: 'I jumped off the garage roof and landed it. I am a legend on my street.', c: 'good', s: { happy: 8 } }, { p: .4, t: 'I jumped off the garage roof and broke my arm.', c: 'bad', s: { health: -10, happy: -4 }, fx: () => X.ill('a broken arm') }]],
    ['Refuse', { t: 'I refused a dangerous dare. My friends called me chicken.', s: { happy: -3, smarts: 1 } }],
    ['Dare someone else instead', [{ p: .5, t: 'I turned the dare around and nobody jumped.', s: { smarts: 1 } }, { p: .5, t: 'My friend took my dare and got hurt. I feel awful.', c: 'bad', k: -5, bond: [['friend', -10]] }]]], { once: 1 });
  E('c_newkid', 'childhood', 'The new kid', 'A new kid sits alone at lunch every day, staring at their sandwich.', { age: [6, 12], school: 'k12' }, [
    ['Sit with them', { t: 'I sat with the new kid at lunch. We became friends.', c: 'good', k: 5, s: { happy: 3 }, fx: () => X.friend() }],
    ['Wave from your table', { t: 'I waved at the new kid from across the room.', k: 1 }],
    ['Stay with your own group', { t: 'I left the new kid to eat alone.', k: -2 }]], { once: 1 });
  E('c_savings', 'childhood', 'Piggy bank', 'You have saved up your allowance for months. The jar is finally full.', { age: [7, 12], has: ['parent'] }, [
    ['Blow it all on candy and toys', { t: 'I spent all my savings on candy and toys. Worth it.', s: { happy: 7, health: -1 } }],
    ['Keep saving', { t: 'I kept saving my allowance. The jar keeps growing.', c: 'good', m: 60, s: { smarts: 2 } }],
    ['Buy {parent} a present', { t: 'I spent my savings on a present for {parent}. There were happy tears.', c: 'good', k: 4, bond: [['parent', 12]] }]], { once: 1 });
  E('c_recital', 'childhood', 'Stage fright', 'The school recital starts in ten minutes. Your hands are shaking and your stomach hurts.', { age: [7, 13], school: 'k12' }, [
    ['Go on anyway', [{ p: .65, t: 'I performed at the recital despite my nerves. Everyone clapped.', c: 'good', s: { happy: 8, looks: 1 } }, { p: .35, t: 'I froze on stage at the recital. It felt like an hour.', c: 'bad', s: { happy: -6 } }]],
    ['Pretend to be sick', { t: 'I faked a stomach ache to skip the recital.', s: { happy: -2 }, k: -1 }],
    ['Ask a friend to go on with you', { t: 'My friend and I performed together. It was not perfect, but it was fun.', c: 'good', s: { happy: 5 }, bond: [['friend', 6]] }]], { once: 1 });

  /* school */
  E('s_group', 'school', 'Group project', 'Your group project is due Friday. Your three teammates have done nothing.', { age: [11, 17], school: 'k12' }, [
    ['Do the whole thing yourself', { t: 'I did the entire group project alone. We got an A, and I got no sleep.', s: { smarts: 3, happy: -4 }, fx: () => { S.edu.grades = clamp(S.edu.grades + 5); } }],
    ['Tell the teacher', [{ p: .6, t: 'I told the teacher who really did the work. I was graded separately.', fx: () => { S.edu.grades = clamp(S.edu.grades + 3); }, bond: [['friends', -4]] }, { p: .4, t: 'The teacher said teamwork is part of the grade. Everyone was annoyed with me.', c: 'bad', s: { happy: -3 }, bond: [['friends', -6]] }]],
    ['Do only your share', { t: 'I did only my part of the group project. We got a C.', fx: () => { S.edu.grades = clamp(S.edu.grades - 6); } }]], { cd: 5 });
  E('s_rumor', 'school', 'The rumor', 'Someone has been spreading an embarrassing rumor about you. Everyone at school has heard it.', { age: [12, 17], school: 'k12' }, [
    ['Confront whoever started it', [{ p: .5, t: 'I confronted the person spreading rumors. They apologized in front of everyone.', c: 'good', s: { happy: 5 } }, { p: .5, t: 'I confronted the rumor-spreader and it turned into a shouting match.', c: 'bad', s: { happy: -4 } }]],
    ['Laugh it off', { t: 'I laughed off a rumor about me. It died within a week.', s: { happy: -1, smarts: 1 } }],
    ['Spread a worse one about them', { t: 'I spread a nasty rumor in revenge. Now nobody trusts either of us.', c: 'bad', k: -6, bond: [['friends', -5]] }]], { once: 1 });
  E('s_scholar', 'school', 'Scholarship exam', 'A foundation is offering full university scholarships to the top scorers on a brutal exam.', { age: [16, 17], school: 'k12', stats: { smarts: [55, 100] } }, [
    ['Study for months', [{ p: .55, t: 'I won a full university scholarship!', c: 'good', s: { happy: 10, smarts: 3 }, fx: () => { S.flags.scholar = 1; } }, { p: .45, t: 'I studied for months but just missed the scholarship cutoff.', c: 'bad', s: { happy: -5, smarts: 3 } }]],
    ['Wing it', [{ p: .15, t: 'I barely studied and still won a full scholarship. Unbelievable.', c: 'good', s: { happy: 10 }, fx: () => { S.flags.scholar = 1; } }, { p: .85, t: 'I winged the scholarship exam and bombed it.', s: { happy: -2 } }]],
    ['Skip it', { t: 'I did not bother with the scholarship exam.' }]], { once: 1 });
  E('s_coach', 'school', 'The coach’s offer', 'The coach says you have real talent, but only if you train six days a week.', { age: [12, 16], school: 'k12', stats: { health: [60, 100] } }, [
    ['Commit to training', { t: 'I committed to training six days a week. I am fitter than ever, and my grades slipped.', s: { health: 6, happy: 2 }, fx: () => { S.edu.grades = clamp(S.edu.grades - 8); } }],
    ['Train, but only three days', { t: 'I trained part-time. The coach was disappointed but I kept up at school.', s: { health: 3 } }],
    ['Decline', { t: 'I told the coach I wanted to focus on school.', fx: () => { S.edu.grades = clamp(S.edu.grades + 3); } }]], { once: 1 });
  E('s_phone', 'school', 'Caught in class', 'Your teacher catches you on your phone during a test. It looks a lot like cheating.', { age: [12, 17], school: 'k12' }, [
    ['Tell the truth', [{ p: .6, t: 'I explained I was only checking the time. The teacher believed me.', s: { happy: 1 } }, { p: .4, t: 'The teacher did not believe me and gave me a zero.', c: 'bad', fx: () => { S.edu.grades = clamp(S.edu.grades - 10); } }]],
    ['Blame the kid next to you', { t: 'I blamed a classmate. They got detention. I feel terrible.', c: 'bad', k: -7 }],
    ['Accept the punishment quietly', { t: 'I took a week of detention without arguing.', s: { happy: -3 }, k: 1 }]], { once: 1 });
  E('s_paycheck', 'school', 'First paycheck', 'Your first real paycheck has landed: {a0}.', { age: [14, 18], if: () => !!S.part }, [
    ['Save it', { t: 'I put my first paycheck in the bank.', c: 'good', m: { a: 0, x: 0.5 }, s: { smarts: 1 } }],
    ['Spend it with friends', { t: 'I spent my first paycheck on a great weekend with friends.', s: { happy: 6 }, bond: [['friends', 5]] }],
    ['Give half to your parents', { t: 'I gave half my first paycheck to my parents. They were moved.', c: 'good', k: 4, bond: [['parent', 10]] }]], { once: 1, amounts: [600] });

  /* university */
  E('u_major', 'university', 'Wrong major?', 'Two years in, you dread every lecture. Maybe you chose the wrong major.', { age: [18, 30], school: 'uni', if: () => S.edu.school.left <= 2 && S.edu.school.left >= 1 }, [
    ['Switch majors (one extra year)', { t: ctx => `I switched my major to ${S.edu.school.major}. It added a year, but I am happier.`, s: { happy: 8 }, fx: () => { S.edu.school.major = P(MAJORS.filter(m => m !== S.edu.school.major)); S.edu.school.left += 1; } }],
    ['Push through', { t: 'I stuck with a major I do not love.', s: { happy: -6, smarts: 1 } }],
    ['Drop out', { t: 'I dropped out of university.', c: 'bad', s: { happy: 3 }, fx: () => { S.edu.school = null; } }]], { once: 1 });
  E('u_party', 'university', 'Party or study', 'The party of the year is tonight. Your hardest final is at 9 a.m. tomorrow.', { age: [18, 30], school: 'uni' }, [
    ['Party', [{ p: .35, t: 'I partied all night and somehow passed my final.', s: { happy: 8 } }, { p: .65, t: 'I partied all night and failed my final.', c: 'bad', s: { happy: 4 }, fx: () => { S.edu.grades = clamp(S.edu.grades - 12); } }]],
    ['Study', { t: 'I skipped the party to study and aced my final.', c: 'good', s: { smarts: 2, happy: -3 }, fx: () => { S.edu.grades = clamp(S.edu.grades + 6); } }],
    ['Do both', { t: 'I studied until midnight, then went to the party. I was a wreck for a week.', s: { happy: 3, health: -4 }, fx: () => { S.edu.grades = clamp(S.edu.grades + 1); } }]], { cd: 3 });
  E('u_intern', 'university', 'Summer plans', 'You have two offers: an unpaid internship at a famous firm, or a summer job paying {a0}.', { age: [18, 30], school: 'uni' }, [
    ['Take the internship', { t: 'I did an unpaid internship at a famous firm. It will open doors.', c: 'good', r: 8, s: { smarts: 2, happy: -2 } }],
    ['Take the paid job', { t: 'I worked all summer and earned {a0}.', m: { a: 0, x: 1 } }],
    ['Take neither and travel', { t: 'I spent the summer backpacking instead.', s: { happy: 8 } }]], { once: 1, amounts: [6000] });
  E('u_roommate', 'university', 'Roommate trouble', 'Your roommate eats your food, never cleans, and is two months behind on their share of the rent.', { age: [18, 30], school: 'uni' }, [
    ['Have it out with them', [{ p: .5, t: 'I confronted my roommate. They paid up and cleaned up.', c: 'good', s: { happy: 4 } }, { p: .5, t: 'My roommate and I had a huge fight. Living together is now unbearable.', c: 'bad', s: { happy: -6 } }]],
    ['Move out', { t: 'I moved out. Breaking the lease cost me {a0}.', m: { a: 0 }, s: { happy: 5 } }],
    ['Put up with it', { t: 'I kept quietly covering for my roommate.', s: { happy: -5 }, m: -400 }]], { once: 1, amounts: [1200] });
  E('u_startup', 'university', 'Dorm-room startup', 'A brilliant classmate wants you as co-founder of their startup. You would need to put in {a0}.', { age: [18, 30], school: 'uni' }, [
    ['Join them', [{ p: .1, t: 'The dorm-room startup I co-founded was acquired! My share was {a1}.', c: 'good', m: { a: 1, x: 1 }, f: 3, s: { happy: 15 } }, { p: .25, t: 'Our startup was modestly successful. I got my money back and then some.', c: 'good', m: { a: 0, x: 1.5 }, s: { smarts: 2 } }, { p: .65, t: 'The startup folded within a year. I lost {a0}.', c: 'bad', m: { a: 0 }, s: { smarts: 2 } }], { cost: 0 }],
    ['Help out without investing', { t: 'I helped my classmate’s startup on weekends. I learned a lot.', s: { smarts: 3, happy: -1 } }],
    ['Decline', { t: 'I passed on joining a classmate’s startup.' }]], { once: 1, amounts: [3000, 250e3] });

  /* early career */
  E('e_negotiate', 'early career', 'The offer', 'You are new at work and have just learned a colleague hired with you earns 10% more.', { age: [18, 32], job: 1, if: () => S.job.years <= 2 }, [
    ['Ask for a matching raise', [{ p: .5, t: 'I asked for a raise to match my colleague and got it.', c: 'good', fx: () => { S.job.salary = Math.round(S.job.salary * 1.1); } }, { p: .5, t: 'My boss said no to a raise and now thinks I am ungrateful.', c: 'bad', perf: -6 }]],
    ['Work harder to prove yourself', { t: 'I put my head down and worked harder.', perf: 6, stress: 8 }],
    ['Say nothing', { t: 'I said nothing about the pay gap.', s: { happy: -3 } }]], { once: 1 });
  E('e_overtime', 'early career', 'Crunch time', '{boss} asks you to work every weekend this month to hit a deadline.', { age: [18, 40], job: 1 }, [
    ['Say yes', { t: 'I worked every weekend for a month. My boss noticed.', perf: 8, stress: 14, s: { happy: -4, health: -2 }, bond: [['partner', -5]] }],
    ['Say no', [{ p: .5, t: 'I refused weekend work. My boss respected the boundary.', stress: -4 }, { p: .5, t: 'I refused weekend work. My boss now sees me as "not a team player".', c: 'bad', perf: -8 }]],
    ['Ask for time off in return', [{ p: .6, t: 'I worked the weekends in exchange for extra vacation days.', c: 'good', perf: 5, stress: 4 }, { p: .4, t: 'My boss refused to trade overtime for vacation. I worked anyway.', perf: 3, stress: 12, s: { happy: -3 } }]]], { cd: 6 });
  E('e_mistake', 'early career', 'Nobody noticed', 'You made a mistake at work that will cost the company money. So far, nobody knows it was you.', { age: [18, 45], job: 1 }, [
    ['Own up', [{ p: .7, t: 'I admitted my mistake. My boss appreciated the honesty.', c: 'good', r: 5, perf: -2, k: 3 }, { p: .3, t: 'I admitted my mistake and got an official warning.', c: 'bad', perf: -10, k: 3 }]],
    ['Stay quiet', [{ p: .65, t: 'I kept quiet about my mistake and nobody ever found out.', k: -3, stress: 6 }, { p: .35, t: 'They traced the mistake back to me, and the cover-up made it worse.', c: 'bad', perf: -22, r: -12, k: -3 }]],
    ['Let {rival} take the blame', [{ p: .55, t: 'I let {rival} take the blame for my mistake.', k: -10, bond: [['rival', 20]], fx: () => { S.job.rival.skill = clamp(S.job.rival.skill - 5); } }, { p: .45, t: '{rival} proved the mistake was mine. I look like a liar.', c: 'bad', perf: -20, r: -15, k: -10, bond: [['rival', 25]] }]]], { cd: 8 });
  E('e_mentor', 'early career', 'A mentor', '{ally}, a respected senior colleague, offers to mentor you. It means early mornings and honest criticism.', { age: [18, 35], job: 1 }, [
    ['Accept gratefully', { t: '{ally} became my mentor. I am learning fast.', c: 'good', perf: 8, s: { smarts: 2 }, stress: 3, bond: [['ally', 20]] }],
    ['Politely decline', { t: 'I turned down {ally}’s offer to mentor me.', bond: [['ally', -8]] }]], { once: 1 });
  E('e_moonlight', 'early career', 'Side contract', 'A competitor of your employer offers you {a0} for some freelance work on the side. Your contract forbids it.', { age: [20, 50], job: 1 }, [
    ['Take it quietly', [{ p: .75, t: 'I did secret freelance work for a competitor and pocketed {a0}.', m: { a: 0, x: 1 }, k: -3, stress: 6 }, { p: .25, t: 'My employer found out about my side contract and fired me.', c: 'bad', m: { a: 0, x: 1 }, r: -10, fx: () => X.fire('I was fired for moonlighting.') }]],
    ['Ask your boss for permission', [{ p: .4, t: 'My boss allowed the freelance work. I earned {a0}.', c: 'good', m: { a: 0, x: 1 } }, { p: .6, t: 'My boss said absolutely not.', s: { happy: -1 } }]],
    ['Refuse', { t: 'I turned down side work from a competitor.', r: 2 }]], { cd: 10, amounts: [['sal', 0.2]] });

  /* each career field */
  E('k_retail', 'career', 'Going viral', 'A furious customer is screaming at you and filming it on their phone.', { cats: ['Service & retail'] }, [
    ['Stay calm and polite', [{ p: .7, t: 'I stayed calm while a customer screamed at me. The video made me look like a saint.', c: 'good', r: 8, f: 1 }, { p: .3, t: 'I stayed calm. The customer left a one-star review anyway.', stress: 5 }]],
    ['Snap back', [{ p: .4, t: 'I told off a rude customer. My coworkers cheered.', s: { happy: 6 } }, { p: .6, t: 'A video of me losing my temper at a customer went viral. I was fired.', c: 'bad', r: -12, f: 2, fx: () => X.fire('I was fired after the video spread.') }]],
    ['Fetch the manager', { t: 'I handed a screaming customer over to my manager.', stress: 2 }]], { cd: 7 });
  E('k_trades', 'career', 'The shortcut', 'The job is behind schedule. The foreman tells you to skip the safety checks and get it done.', { cats: ['Trades & industry'] }, [
    ['Refuse', [{ p: .6, t: 'I refused to skip safety checks. The foreman grumbled but backed down.', r: 3, perf: -3 }, { p: .4, t: 'I refused to skip safety checks and was taken off the job.', perf: -10 }]],
    ['Do it', [{ p: .72, t: 'I skipped the safety checks and finished on time.', perf: 8, stress: 5 }, { p: .28, t: 'Skipping the safety checks got me badly hurt.', c: 'bad', s: { health: -22 }, perf: -5 }]],
    ['Report it to the inspector', [{ p: .6, t: 'I reported the unsafe orders. The site was made safe.', c: 'good', r: 8, k: 5, bond: [['rival', 10]] }, { p: .4, t: 'I reported unsafe orders and was quietly pushed out.', c: 'bad', k: 5, fx: () => X.fire('I was let go after blowing the whistle.') }]]], { cd: 8 });
  E('k_public', 'career', 'An envelope', 'A man slides an envelope across the table. "{a0}. All you have to do is look the other way."', { cats: ['Public service', 'Law & government'] }, [
    ['Take it', [{ p: .65, t: 'I took a bribe of {a0}.', m: { a: 0, x: 1 }, k: -15 }, { p: .35, t: 'The bribe was a sting. I was arrested and lost my career.', c: 'bad', k: -15, r: -40, fx: () => { arrest('I was convicted of taking a bribe.', R(1, 4)); } }]],
    ['Refuse', { t: 'I pushed the envelope back across the table.', k: 4, r: 2 }],
    ['Report him', [{ p: .8, t: 'I reported a bribery attempt. I was commended.', c: 'good', k: 8, r: 10, perf: 6 }, { p: .2, t: 'I reported a bribery attempt. Powerful people now want me gone.', k: 8, r: 5, stress: 15 }]]], { cd: 10, amounts: [['sal', 0.6]] });
  E('k_office', 'career', 'Stolen thunder', 'In front of the whole department, {rival} presents your idea as their own.', { cats: ['Office & business'] }, [
    ['Call it out on the spot', [{ p: .5, t: 'I called out {rival} in the meeting and proved the idea was mine.', c: 'good', perf: 8, bond: [['rival', 20]], fx: () => { S.job.rival.skill = clamp(S.job.rival.skill - 6); } }, { p: .5, t: 'I accused {rival} in the meeting and came across as petty.', c: 'bad', perf: -6, r: -4, bond: [['rival', 20]] }]],
    ['Talk to them privately', { t: 'I confronted {rival} in private. They shrugged, but will think twice next time.', bond: [['rival', 8]], stress: 3 }],
    ['Email your boss the original files', { t: 'I quietly sent my boss proof the idea was mine.', perf: 5, bond: [['rival', 12]] }],
    ['Let it go', { t: 'I let {rival} take credit for my idea.', s: { happy: -5 }, fx: () => { S.job.rival.skill = clamp(S.job.rival.skill + 4); } }]], { cd: 7 });
  E('k_tech', 'career', 'Launch day', 'You find a serious flaw the night before a big launch. Fixing it properly means a two-week delay.', { cats: ['Tech & science'] }, [
    ['Insist on the delay', [{ p: .6, t: 'I delayed the launch to fix a flaw. It was the right call.', c: 'good', r: 8, perf: 4 }, { p: .4, t: 'I delayed the launch. Management was furious about the lost revenue.', perf: -8, r: 3 }]],
    ['Launch anyway', [{ p: .55, t: 'We launched with the flaw. Nobody noticed, and we patched it later.', perf: 5, stress: 8 }, { p: .45, t: 'We launched with the flaw and it blew up in public. I took the blame.', c: 'bad', perf: -18, r: -12 }]],
    ['Pull an all-nighter to patch it', { t: 'I stayed up all night and patched the flaw before launch.', c: 'good', perf: 10, stress: 15, s: { health: -4 } }]], { cd: 7 });
  E('k_health', 'career', 'Double shift', 'You are 16 hours into a shift and exhausted. A critical case comes in and they are short-staffed.', { cats: ['Health & care'] }, [
    ['Stay', [{ p: .8, t: 'I stayed past the end of a double shift and helped save a life.', c: 'good', k: 8, perf: 8, stress: 12, s: { health: -4 } }, { p: .2, t: 'Exhausted, I made an error. The patient recovered, but I was written up.', c: 'bad', perf: -12, stress: 15, s: { health: -4, happy: -6 } }]],
    ['Hand over and go home', [{ p: .75, t: 'I handed over to a colleague and went home to sleep.', stress: -5 }, { p: .25, t: 'I went home. Things went badly without me, and people noticed I left.', c: 'bad', perf: -8, s: { happy: -6 } }]]], { cd: 6 });
  E('k_edu', 'career', 'Grade pressure', 'An influential parent demands you raise their child’s failing grade. They hint they can make trouble for you.', { cats: ['Education & social'] }, [
    ['Refuse', [{ p: .7, t: 'I refused to change a grade under pressure.', k: 4, r: 4 }, { p: .3, t: 'I refused to change a grade. The parent filed complaints about me all year.', k: 4, stress: 14 }]],
    ['Change the grade', { t: 'I changed a grade to keep an influential parent happy.', k: -8, r: -5, stress: -3 }],
    ['Offer the student extra help', { t: 'I offered the student extra tutoring. They earned the better grade themselves.', c: 'good', k: 6, perf: 5, stress: 5, s: { happy: 3 } }]], { cd: 8 });
  E('k_creative', 'career', 'The client from hell', 'Your biggest client wants a ninth round of revisions, for free, by tomorrow.', { cats: ['Creative & media'] }, [
    ['Push back and charge for it', [{ p: .55, t: 'I told the client that extra revisions cost extra. They paid.', c: 'good', m: { a: 0, x: 1 }, r: 3 }, { p: .45, t: 'The client walked away over my revision fee.', c: 'bad', perf: -8 }]],
    ['Do it for free', { t: 'I did yet another free round of revisions.', stress: 12, s: { happy: -5 }, perf: 3 }],
    ['Drop the client', { t: 'I dropped a nightmare client. I slept well for the first time in months.', s: { happy: 8 }, stress: -15, perf: -6 }]], { cd: 6, amounts: [['sal', 0.08]] });
  E('k_law', 'career', 'Buried evidence', 'You discover a document that would badly hurt your own side. Nobody else knows it exists.', { cats: ['Law & government'] }, [
    ['Disclose it', { t: 'I disclosed a document that hurt my own side. It was the right thing to do.', k: 8, r: 10, perf: -8 }],
    ['Bury it', [{ p: .7, t: 'I buried a damaging document. We won.', k: -12, perf: 10, stress: 10 }, { p: .3, t: 'The buried document came out. I was disciplined and my career is in ruins.', c: 'bad', k: -12, r: -35, fx: () => { X.record(); X.fire('I was dismissed for concealing evidence.'); } }]],
    ['Ask a senior colleague what to do', { t: '{ally} advised me to disclose the document, and backed me when I did.', k: 5, r: 5, perf: -3, bond: [['ally', 8]] }]], { cd: 10 });
  E('k_transport', 'career', 'Over the limit', 'Your dispatcher wants one more run tonight. It would put you well over your legal hours.', { cats: ['Transport'] }, [
    ['Refuse', [{ p: .7, t: 'I refused to work past my legal hours.', r: 2 }, { p: .3, t: 'I refused the extra run and lost the good routes for months.', perf: -8 }]],
    ['Do the run', [{ p: .82, t: 'I did the extra run and earned a bonus of {a0}.', m: { a: 0, x: 1 }, stress: 8, s: { health: -2 } }, { p: .18, t: 'I fell asleep at the controls and crashed.', c: 'bad', s: { health: -25 }, r: -15, fx: () => X.fire('I was dismissed after the accident.') }]]], { cd: 6, amounts: [['sal', 0.05]] });
  E('k_fame', 'career', 'Tell-all', 'A tabloid offers you {a0} for embarrassing stories about a famous colleague.', { cats: ['Fame'] }, [
    ['Sell the stories', { t: 'I sold stories about a famous colleague for {a0}. Nobody in the industry trusts me now.', m: { a: 0, x: 1 }, k: -10, r: -15, f: 3 }],
    ['Refuse', { t: 'I refused to sell out a colleague.', k: 4, r: 4 }],
    ['Warn your colleague', { t: 'I warned my colleague the tabloids were digging. They owe me one.', c: 'good', k: 6, r: 6, bond: [['ally', 10]] }]], { cd: 8, amounts: [['sal', 0.5]] });
  E('k_doping', 'career', 'A little help', 'A trainer quietly offers you something to "give you an edge". Plenty of your rivals use it.', { sp: ['sport', 'race', 'fight'] }, [
    ['Take it', [{ p: .7, t: 'I used a banned substance. My performance jumped.', k: -8, s: { health: -5 }, fx: () => { S.sp.skill = clamp(S.sp.skill + 8); } }, { p: .3, t: 'I failed a drug test and was banned from competition.', c: 'bad', k: -8, r: -30, f: 5, fx: () => spEnd('My career ended in a doping ban.', 'bad') }]],
    ['Refuse', { t: 'I refused to cheat.', k: 4, r: 3 }],
    ['Report the trainer', { t: 'I reported a trainer for pushing banned substances.', k: 8, r: 8, s: { happy: -2 } }]], { cd: 8 });
  E('k_sellout', 'career', 'Art or money', 'A fast-food chain offers you {a0} to be the face of their new campaign. Your fans will groan.', { sp: ['actor', 'music', 'director'] }, [
    ['Take the money', { t: 'I fronted a fast-food campaign for {a0}. Critics called me a sellout.', m: { a: 0, x: 1 }, r: -6, f: 2 }],
    ['Turn it down', { t: 'I turned down a lucrative ad deal to protect my reputation.', r: 6, s: { happy: 2 } }],
    ['Donate the fee to charity', { t: 'I did the ad and gave the whole fee to charity. Everyone won.', c: 'good', k: 12, r: 5, f: 3 }]], { cd: 6, amounts: [W(0.1, 50e3, 20e6)] });
  E('k_debate', 'career', 'The debate', 'A televised debate is tomorrow. Your opponent is a brilliant speaker.', { sp: ['pol'] }, [
    ['Rehearse all night', [{ p: .65, t: 'I prepared hard and won the debate.', c: 'good', f: 3, fx: () => { S.sp.approval = clamp(S.sp.approval + 8); } }, { p: .35, t: 'I over-rehearsed and came across as stiff.', fx: () => { S.sp.approval = clamp(S.sp.approval - 2); } }]],
    ['Trust your instincts', [{ p: .4, t: 'I spoke from the heart and the audience loved it.', c: 'good', f: 4, fx: () => { S.sp.approval = clamp(S.sp.approval + 10); } }, { p: .6, t: 'I made an embarrassing gaffe on live television.', c: 'bad', f: 2, fx: () => { S.sp.approval = clamp(S.sp.approval - 12); } }]],
    ['Attack your opponent personally', [{ p: .45, t: 'My attacks landed. My opponent crumbled.', k: -5, fx: () => { S.sp.approval = clamp(S.sp.approval + 6); } }, { p: .55, t: 'My personal attacks backfired badly.', c: 'bad', k: -5, fx: () => { S.sp.approval = clamp(S.sp.approval - 10); } }]]], { cd: 4 });

  /* owning a business */
  E('b_supplier', 'business', 'Supplier squeeze', 'The main supplier for {biz} is raising prices by 20%.', { biz: 1 }, [
    ['Absorb the cost', { t: '{biz} absorbed a supplier price rise. Margins are thinner.', fx: c => { bz(c.biz).costMult *= 1.05; } }],
    ['Switch suppliers', [{ p: .6, t: '{biz} found a cheaper supplier of the same quality.', c: 'good', fx: c => { bz(c.biz).costMult *= 0.98; } }, { p: .4, t: 'The new supplier for {biz} is cheaper, but quality dropped.', c: 'bad', fx: c => { c.biz.rating = clamp(c.biz.rating - 10); } }]],
    ['Raise your own prices', { t: '{biz} passed the price rise on to customers. Some left.', fx: c => { c.biz.rating = clamp(c.biz.rating - 6); bz(c.biz).revMult *= 1.03; } }]], { cd: 6 });
  E('b_buyout', 'business', 'Buyout offer', 'A competitor offers {a0} in cash for {biz}. That is well above its valuation.', { biz: 1, if: () => S.biz.some(b => b.years >= 2) }, [
    ['Sell', { t: 'I sold {biz} to a competitor for {a0}.', c: 'good', fx: c => { const v = Math.round(c.biz.value * 1.3 * bz(c.biz).own / 100 - c.biz.loan); S.money += v; ECO.capGains(v - (c.biz.basis || 0) * c.biz.own / 100, c.biz.name); S.biz = S.biz.filter(b => b !== c.biz); } }],
    ['Demand more', [{ p: .4, t: 'I held out and sold {biz} for even more than the first offer.', c: 'good', fx: c => { const v = Math.round(c.biz.value * 1.6 * bz(c.biz).own / 100 - c.biz.loan); S.money += v; ECO.capGains(v - (c.biz.basis || 0) * c.biz.own / 100, c.biz.name); S.biz = S.biz.filter(b => b !== c.biz); } }, { p: .6, t: 'I asked for too much and the buyer walked away from {biz}.' }]],
    ['Refuse', { t: 'I refused to sell {biz}.', s: { happy: 2 } }]], { cd: 8, amounts: [0], text: c => `A competitor offers ${fmt(Math.round(c.biz.value * 1.3))} in cash for ${c.biz.name}. That is well above its valuation.` });
  E('b_star', 'business', 'Your best employee', 'The best employee at {biz} has an offer from a rival. They will stay for a big raise.', { biz: 1 }, [
    ['Give them the raise', { t: 'I gave my best employee at {biz} a big raise to stay.', fx: c => { bz(c.biz).costMult *= 1.02; c.biz.morale = clamp(c.biz.morale + 5); } }],
    ['Offer them a 5% stake', { t: 'I gave my best employee 5% of {biz}. They are now fully committed.', c: 'good', fx: c => { bz(c.biz).own = Math.max(1, c.biz.own - 5); c.biz.rating = clamp(c.biz.rating + 6); c.biz.morale = clamp(c.biz.morale + 8); } }],
    ['Let them go', { t: 'My best employee left {biz} for a rival.', c: 'bad', fx: c => { c.biz.rating = clamp(c.biz.rating - 8); bz(c.biz).morale = clamp(c.biz.morale - 10); } }]], { cd: 6 });
  E('b_loan', 'business', 'The bank calls', 'With the economy doing well, the bank offers {biz} a large loan to expand.', { biz: 1, if: () => !ECO.badTimes() }, [
    ['Borrow and expand', [{ p: .65, t: '{biz} borrowed to expand, and the expansion is paying off.', c: 'good', fx: c => { const v = Math.round(c.biz.baseRev * 0.5); bz(c.biz).loan += v; ECO.growBiz(c.biz, 1.25); } }, { p: .35, t: '{biz} borrowed to expand, but the new customers never came.', c: 'bad', fx: c => { const v = Math.round(c.biz.baseRev * 0.5); bz(c.biz).loan += v; ECO.growBiz(c.biz, 1.04); } }]],
    ['Decline', { t: 'I turned down a loan to expand {biz}.' }]], { cd: 8 });
  E('b_inspector', 'business', 'A friendly inspector', 'An inspector visiting {biz} hints that a "processing fee" of {a0} would make his report much kinder.', { biz: 1 }, [
    ['Pay him', [{ p: .85, t: 'I paid an inspector {a0} for a clean report on {biz}.', m: { a: 0 }, k: -6 }, { p: .15, t: 'The "inspector" was part of a corruption sting. I was fined heavily.', c: 'bad', m: { a: 0, x: -10 }, k: -6, r: -10, fx: () => X.record() }], { cost: 0 }],
    ['Refuse', [{ p: .6, t: 'I refused to bribe an inspector. {biz} passed anyway.', k: 3 }, { p: .4, t: 'I refused to bribe an inspector. He found a long list of "violations" at {biz}.', c: 'bad', k: 3, m: { a: 0, x: -3 }, fx: c => { c.biz.rating = clamp(c.biz.rating - 6); } }]],
    ['Report him', { t: 'I reported a corrupt inspector. He was removed.', c: 'good', k: 8, r: 6 }]], { cd: 8, amounts: [['biz', 0.01]] });
  E('b_recession', 'business', 'Hard times', 'The downturn is hitting {biz}. Sales are falling and cash is tight.', { biz: 1, if: () => ECO.badTimes() }, [
    ['Lay off staff', { t: 'I laid off staff at {biz} to survive the downturn.', k: -3, fx: c => { if (c.biz.staff > 1) c.biz.staff--; bz(c.biz).morale = clamp(c.biz.morale - 15); } }],
    ['Cut prices', { t: 'I cut prices at {biz} to keep customers coming.', fx: c => { c.biz.price = 'budget'; c.biz.rating = clamp(c.biz.rating + 4); } }],
    ['Put in {a0} of your own money', { t: 'I put {a0} of my own money into {biz} to keep everyone employed.', c: 'good', m: { a: 0 }, k: 5, fx: c => { bz(c.biz).morale = clamp(c.biz.morale + 12); c.biz.rating = clamp(c.biz.rating + 5); c.biz.value += c.amt[0]; } }, { cost: 0 }],
    ['Ride it out', [{ p: .5, t: '{biz} scraped through the downturn.' }, { p: .5, t: '{biz} lost customers during the downturn.', c: 'bad', fx: c => { c.biz.rating = clamp(c.biz.rating - 8); } }]]], { cd: 3, amounts: [['biz', 0.15]] });
  E('b_recall', 'business', 'Something went wrong', 'A customer was hurt by something {biz} sold. So far only a few people know.', { biz: 1 }, [
    ['Recall and apologize publicly', { t: '{biz} issued a public recall and apology. It was expensive, but people respected it.', m: { a: 0 }, r: 6, k: 6, fx: c => { c.biz.rating = clamp(c.biz.rating + 5); } }],
    ['Settle quietly', [{ p: .7, t: '{biz} settled quietly with the customer.', m: { a: 1 }, k: -2 }, { p: .3, t: 'The quiet settlement leaked. {biz} looks like it was hiding something.', c: 'bad', m: { a: 1 }, r: -8, fx: c => { c.biz.rating = clamp(c.biz.rating - 14); } }]],
    ['Deny everything', [{ p: .45, t: '{biz} denied responsibility and the story died.', k: -8 }, { p: .55, t: '{biz} denied responsibility, then lost in court. It cost far more.', c: 'bad', m: { a: 0, x: -3 }, k: -8, r: -12, fx: c => { c.biz.rating = clamp(c.biz.rating - 18); } }]]], { cd: 10, amounts: [['biz', 0.08], ['biz', 0.03]] });

  /* wealth */
  E('w_loan', 'wealth', 'An old friend', '{friend} is in serious trouble and asks to borrow {a0}.', { wealth: [500e3], has: ['friend'] }, [
    ['Lend it', [{ p: .5, t: 'I lent {friend} {a0}, and they paid back every cent.', c: 'good', k: 5, bond: [['friend', 20]] }, { p: .5, t: 'I lent {friend} {a0}. I never saw it again.', c: 'bad', m: { a: 0 }, k: 5, bond: [['friend', -15]] }], { cost: 0 }],
    ['Give it as a gift', { t: 'I gave {friend} {a0} and told them not to worry about it.', c: 'good', m: { a: 0 }, k: 10, bond: [['friend', 30]] }, { cost: 0 }],
    ['Say no', { t: 'I refused to lend {friend} money. Things are awkward now.', bond: [['friend', -25]] }]], { cd: 8, amounts: [W(0.02, 5e3, 20e6)] });
  E('w_prenup', 'wealth', 'The prenup', 'Your lawyer insists you ask {partner} to sign a prenuptial agreement before the wedding.', { wealth: [1e6], rel: 'partner', if: () => ['Fiancé', 'Fiancée'].includes(partner().rel) && !S.flags.prenup }, [
    ['Ask for a prenup', [{ p: .6, t: '{partner} signed a prenup, though it stung.', bond: [['partner', -12]], fx: () => { S.flags.prenup = 1; } }, { p: .4, t: '{partner} was deeply hurt that I asked for a prenup, and refused.', c: 'bad', bond: [['partner', -25]] }]],
    ['Skip it. This is love.', { t: 'I told my lawyer there would be no prenup.', s: { happy: 3 }, bond: [['partner', 5]] }]], { once: 1 });
  E('w_gala', 'wealth', 'Charity gala', 'At a glittering charity gala, the host asks you, in front of everyone, what you will pledge.', { wealth: [2e6], age: [25, 100] }, [
    ['Pledge {a0}', { t: 'I pledged {a0} at a charity gala. The room applauded.', c: 'good', m: { a: 0 }, k: 12, r: 8, f: 2, s: { happy: 4 } }, { cost: 0 }],
    ['Pledge {a1}', { t: 'I pledged a modest {a1} at a charity gala.', m: { a: 1 }, k: 4 }, { cost: 1 }],
    ['Mumble something and slip away', { t: 'I dodged the pledge at a charity gala. People noticed.', c: 'bad', r: -5 }]], { cd: 6, amounts: [W(0.02, 20e3, 50e6), W(0.002, 2e3, 5e6)] });
  E('w_offshore', 'wealth', 'A clever structure', 'Your advisor proposes an offshore structure that would save you about {a0} in tax. "Perfectly legal. Mostly."', { wealth: [5e6] }, [
    ['Do it', [{ p: .72, t: 'An offshore scheme saved me {a0} in tax.', m: { a: 0, x: 1 }, k: -5 }, { p: .28, t: 'The tax authorities unravelled my offshore scheme. The penalties were brutal.', c: 'bad', m: { a: 0, x: -3 }, k: -5, r: -15, f: 2 }]],
    ['Decline', { t: 'I told my advisor to keep everything above board.', k: 2 }],
    ['Fire the advisor', { t: 'I fired an advisor who wanted me to dodge taxes.', k: 4, r: 2 }]], { cd: 8, amounts: [W(0.02, 50e3, 100e6)] });
  E('w_relatives', 'wealth', 'Family expectations', 'Now that you are wealthy, relatives you barely know keep asking for "a little help".', { wealth: [3e6], age: [25, 100] }, [
    ['Help everyone who asks', { t: 'I gave {a0} to relatives who asked for help. More are asking now.', m: { a: 0 }, k: 5, bond: [['family', 10]] }, { cost: 0 }],
    ['Set up a family education fund', { t: 'I set up a {a1} education fund for the family instead of handing out cash.', c: 'good', m: { a: 1 }, k: 8, bond: [['family', 6]] }, { cost: 1 }],
    ['Say no to everyone', { t: 'I refused to hand out money to relatives. Some no longer speak to me.', bond: [['family', -10]] }]], { cd: 8, amounts: [W(0.03, 20e3, 30e6), W(0.015, 10e3, 15e6)] });
  E('w_tip', 'wealth', 'Inside information', 'Over drinks, an executive tells you his company is about to be bought. "Buy the stock tomorrow. Trust me."', { wealth: [250e3], age: [21, 100] }, [
    ['Trade on it', [{ p: .55, t: 'I traded on an insider tip and made {a0}.', m: { a: 0, x: 1 }, k: -6 }, { p: .25, t: 'The tip was wrong. I lost {a0}.', c: 'bad', m: { a: 0 }, k: -6 }, { p: .2, t: 'Regulators traced my trades. I was fined and now have a record.', c: 'bad', m: { a: 0, x: -2 }, k: -6, r: -20, fx: () => X.record() }]],
    ['Ignore it', { t: 'I ignored an insider stock tip.', k: 2 }],
    ['Report it', { t: 'I reported an executive for leaking inside information.', k: 6, r: 4 }]], { cd: 8, amounts: [W(0.08, 10e3, 50e6)] });

  /* relationships */
  E('r_jealous', 'relationships', 'Jealousy', '{partner} is uncomfortable with how much time you spend with {friend}.', { rel: 'partner', has: ['friend'] }, [
    ['See less of {friend}', { t: 'I pulled back from {friend} to reassure {partner}.', bond: [['partner', 10], ['friend', -15]] }],
    ['Bring them together more', [{ p: .6, t: '{partner} and {friend} got to know each other. The jealousy faded.', c: 'good', bond: [['partner', 8], ['friend', 4]] }, { p: .4, t: 'Dinner with {partner} and {friend} was painfully awkward.', bond: [['partner', -5]] }]],
    ['Tell {partner} they are being unreasonable', { t: 'I told {partner} their jealousy was unreasonable. It did not go well.', c: 'bad', bond: [['partner', -15]] }]], { cd: 8 });
  E('r_abroad', 'relationships', 'The dream job', '{partner} has been offered their dream job, on the other side of the world.', { rel: 'partner', age: [20, 60] }, [
    ['Move with them', { t: 'I moved abroad so {partner} could take their dream job.', bond: [['partner', 25]], s: { happy: 3 }, fx: () => { if (S.job) { L(`I left my job as ${S.job.title}.`); S.job = null; } S.country = P(COUNTRIES.filter(c => c !== S.country)); partner().money += 50e3; } }],
    ['Try long distance', [{ p: .45, t: '{partner} and I are making long distance work.', bond: [['partner', -5]] }, { p: .55, t: 'Long distance wore {partner} and me down.', c: 'bad', bond: [['partner', -25]], s: { happy: -5 } }]],
    ['Ask them to turn it down', [{ p: .5, t: '{partner} turned down their dream job for me. I hope they never resent it.', bond: [['partner', -8]] }, { p: .5, t: '{partner} chose the job over me.', c: 'bad', fx: c => breakUp(c.partner, `${c.tok.partner} left to take their dream job abroad.`) }]]], { once: 1 });
  E('r_inlaws', 'relationships', 'The in-laws', '{partner}’s parents want to move in "for a few months" while their house is renovated.', { rel: 'married', has: ['house'] }, [
    ['Welcome them', [{ p: .5, t: 'My in-laws moved in. It was surprisingly lovely.', c: 'good', bond: [['partner', 12]], s: { happy: 2 } }, { p: .5, t: 'My in-laws moved in and criticized everything for six months.', bond: [['partner', 8]], s: { happy: -8 } }]],
    ['Pay for a rental nearby ({a0})', { t: 'I paid for a rental for my in-laws. Everyone kept their sanity.', m: { a: 0 }, bond: [['partner', 5]] }, { cost: 0 }],
    ['Say no', { t: 'I refused to let my in-laws move in.', c: 'bad', bond: [['partner', -15]] }]], { once: 1, amounts: [W(0.01, 6e3, 200e3)] });
  E('r_kids', 'relationships', 'The big question', '{partner} wants to start a family. They want an answer.', { rel: 'partner', age: [22, 42], if: () => !EVT.people('kid').length }, [
    ['Yes, let’s try', { t: '{partner} and I decided to start a family.', bond: [['partner', 12]], fx: () => { if (C(.7)) haveBaby(); else L('No luck yet, but we are trying for a baby.'); } }],
    ['Not yet', { t: 'I told {partner} I am not ready for children yet.', bond: [['partner', -6]] }],
    ['Never', [{ p: .5, t: 'I told {partner} I never want children. They accepted it, sadly.', bond: [['partner', -18]] }, { p: .5, t: 'I told {partner} I never want children.', c: 'bad', fx: c => breakUp(c.partner, `${c.tok.partner} left me because we wanted different futures.`) }]]], { cd: 6 });
  E('r_ex', 'relationships', 'A message from the past', 'Your ex {ex} messages you out of the blue: "Can we meet? I have been thinking about you."', { rel: 'partner', has: ['ex'] }, [
    ['Meet in secret', [{ p: .5, t: 'I secretly met {ex}. Nothing happened, but I feel guilty.', k: -4 }, { p: .5, t: '{partner} found out I secretly met my ex.', c: 'bad', k: -4, bond: [['partner', -30]] }]],
    ['Tell {partner} about it', { t: 'I told {partner} my ex had been in touch. They appreciated my honesty.', c: 'good', bond: [['partner', 8]] }],
    ['Block the number', { t: 'I blocked my ex’s number.', bond: [['ex', -20]] }]], { cd: 10 });
  E('r_betray', 'relationships', 'Betrayed', '{friend} told other people a secret you trusted them with.', { has: ['friend'], age: [12, 100] }, [
    ['Forgive them', { t: 'I forgave {friend} for sharing my secret.', k: 4, bond: [['friend', -5]] }],
    ['Cut them off', { t: 'I cut {friend} out of my life.', s: { happy: -4 }, fx: c => { c.friend.bond = 0; c.friend.rel = 'Enemy'; } }],
    ['Share one of their secrets', { t: 'I got even with {friend} by sharing a secret of theirs. We are done.', c: 'bad', k: -8, fx: c => { c.friend.bond = 0; c.friend.rel = 'Enemy'; } }]], { cd: 12 });
  E('r_spending', 'relationships', 'The credit card bill', 'The statement arrives. {partner} has spent {a0} without telling you.', { rel: 'married' }, [
    ['Have a calm talk about money', [{ p: .7, t: '{partner} and I agreed on a budget together.', c: 'good', m: { a: 0 }, bond: [['partner', 4]] }, { p: .3, t: 'Our "calm talk" about money became a fight.', m: { a: 0 }, bond: [['partner', -10]] }]],
    ['Blow up', { t: 'I exploded at {partner} over their spending.', c: 'bad', m: { a: 0 }, bond: [['partner', -18]] }],
    ['Say nothing and pay it', { t: 'I paid off {partner}’s spending without a word.', m: { a: 0 }, s: { happy: -4 } }]], { cd: 8, amounts: [W(0.02, 2e3, 5e6)] });

  /* family */
  E('f_estate', 'family', 'Dividing things up', 'After the funeral, {sibling} says your parent "always meant" for them to have the family home.', { has: ['sibling'], if: () => S.people.some(p => !p.alive && (p.rel.startsWith('Mother') || p.rel.startsWith('Father'))) }, [
    ['Insist on an even split', [{ p: .6, t: '{sibling} and I split everything evenly in the end.', m: { a: 0, x: 1 }, bond: [['sibling', -8]] }, { p: .4, t: 'The argument over the estate got ugly.', m: { a: 0, x: 1 }, bond: [['sibling', -30]] }]],
    ['Let them have it', { t: 'I let {sibling} have the family home. Family matters more.', c: 'good', k: 6, bond: [['sibling', 20]] }],
    ['Hire a lawyer', [{ p: .5, t: 'The court sided with me. {sibling} no longer speaks to me.', m: { a: 0, x: 1.5 }, bond: [['sibling', -45]] }, { p: .5, t: 'The lawyers took most of what was left of the estate.', c: 'bad', m: { a: 0, x: 0.2 }, bond: [['sibling', -40]] }]]], { once: 1, amounts: [40e3] });
  E('f_dream', 'family', 'A different path', '{kid} announces they are quitting school to become a musician.', { has: ['kidAge'], kidAge: [16, 19] }, [
    ['Support them', [{ p: .3, t: '{kid} followed their dream and is making it work. They thank me for believing in them.', c: 'good', bond: [['kid', 25]] }, { p: .7, t: '{kid} struggled as a musician, but knows I had their back.', bond: [['kid', 15]] }]],
    ['Forbid it', [{ p: .5, t: 'I made {kid} stay in school. They are furious, but they stayed.', bond: [['kid', -20]] }, { p: .5, t: '{kid} left home after I forbade their plans.', c: 'bad', bond: [['kid', -40]], s: { happy: -8 } }]],
    ['Strike a deal: finish school first', { t: '{kid} agreed to finish school, then give music a real try.', c: 'good', bond: [['kid', 6]] }]], { cd: 5 });
  E('f_treatment', 'family', 'Expensive treatment', '{parent} needs a treatment that insurance will not cover. It costs {a0}.', { has: ['parent'], age: [28, 75], if: () => EVT.people('parent').some(p => p.age >= 60) }, [
    ['Pay for it', { t: 'I paid {a0} for {parent}’s treatment.', c: 'good', m: { a: 0 }, k: 8, bond: [['parent', 20]], fx: c => { c.parent.age -= 0; c.parent.treated = 1; } }, { cost: 0 }],
    ['Ask the family to split it', [{ p: .6, t: 'The family pitched in for {parent}’s treatment.', m: { a: 0, x: -0.4 }, bond: [['parent', 8]] }, { p: .4, t: 'Nobody else in the family could help. I paid what I could.', m: { a: 0, x: -0.6 }, bond: [['parent', 5]], s: { happy: -3 } }]],
    ['Say you cannot afford it', { t: 'I told {parent} I could not pay for the treatment.', c: 'bad', k: -4, bond: [['parent', -15]], s: { happy: -6 } }]], { cd: 10, amounts: [W(0.03, 8e3, 2e6)] });
  E('f_arrest', 'family', 'A call from the station', 'The police call. {kid} has been arrested for shoplifting.', { has: ['kidAge'], kidAge: [13, 20] }, [
    ['Hire a good lawyer ({a0})', { t: 'I hired a lawyer and {kid}’s charges were dropped.', m: { a: 0 }, bond: [['kid', 8]] }, { cost: 0 }],
    ['Let them face the consequences', [{ p: .6, t: '{kid} did community service and learned a hard lesson.', bond: [['kid', -5]] }, { p: .4, t: '{kid} resents that I did not help when they were arrested.', c: 'bad', bond: [['kid', -20]] }]],
    ['Call in a favor', [{ p: .6, t: 'I made a call and {kid}’s arrest quietly went away.', k: -5, bond: [['kid', 5]] }, { p: .4, t: 'My attempt to pull strings for {kid} leaked. It looks bad.', c: 'bad', k: -5, r: -10 }]]], { cd: 6, amounts: [W(0.005, 2e3, 250e3)] });
  E('f_hire', 'family', 'Keep it in the family', '{sibling} asks you to give them a job at {biz}.', { biz: 1, has: ['sibling'] }, [
    ['Hire them', [{ p: .5, t: '{sibling} turned out to be a great hire at {biz}.', c: 'good', bond: [['sibling', 15]], fx: c => { c.biz.rating = clamp(c.biz.rating + 6); c.biz.staff++; } }, { p: .5, t: '{sibling} is a disaster at {biz}, and I cannot fire family.', c: 'bad', bond: [['sibling', 8]], fx: c => { c.biz.rating = clamp(c.biz.rating - 8); bz(c.biz).morale = clamp(c.biz.morale - 10); c.biz.staff++; } }]],
    ['Help them find a job elsewhere', { t: 'I helped {sibling} find a job somewhere else.', bond: [['sibling', 5]] }],
    ['Refuse', { t: 'I told {sibling} I do not hire family.', bond: [['sibling', -15]] }]], { once: 1 });

  /* health */
  E('h_lump', 'health', 'A worrying result', 'At a routine check-up the doctor finds something and recommends more tests, which cost {a0}.', { age: [35, 85] }, [
    ['Do the tests now', [{ p: .75, t: 'The tests came back clear. What a relief.', m: { a: 0 }, s: { happy: 3 } }, { p: .25, t: 'The tests caught something early. It was treated before it became serious.', c: 'good', m: { a: 0, x: -3 }, s: { health: 4 } }], { cost: 0 }],
    ['Wait and see', [{ p: .75, t: 'I skipped the extra tests. Nothing came of it.' }, { p: .25, t: 'I ignored a warning sign and it turned out to be serious.', c: 'bad', s: { health: -12 }, fx: () => X.ill(S.age >= 45 ? 'cancer' : 'pneumonia') }]]], { cd: 10, amounts: [W(0.002, 1500, 100e3)] });
  E('h_lifestyle', 'health', 'Doctor’s orders', 'Your doctor is blunt: change your lifestyle now, or expect serious problems within a few years.', { age: [30, 80], stats: { health: [0, 60] } }, [
    ['Change everything', { t: 'I overhauled my diet and started exercising. It is miserable, but it is working.', c: 'good', s: { health: 12, happy: -5 } }],
    ['Take the pills instead ({a0})', { t: 'I chose medication over lifestyle changes.', m: { a: 0 }, s: { health: 5 } }, { cost: 0 }],
    ['Ignore the doctor', [{ p: .6, t: 'I ignored my doctor’s warning.', s: { happy: 2 } }, { p: .4, t: 'I ignored my doctor, and now I have a chronic condition.', c: 'bad', s: { health: -8 }, fx: () => X.ill(P(['high blood pressure', 'diabetes'])) }]]], { cd: 8, amounts: [W(0.002, 1200, 80e3)] });
  E('h_drinking', 'health', 'One more glass', 'You realize you have been drinking every night to take the edge off.', { age: [21, 80], if: () => (S.job && S.job.stress > 55) || S.stats.happy < 40 }, [
    ['Get professional help ({a0})', { t: 'I got help for my drinking. I feel like myself again.', c: 'good', m: { a: 0 }, s: { health: 6, happy: 8 }, stress: -10 }, { cost: 0 }],
    ['Quit on your own', [{ p: .5, t: 'I quit drinking by sheer willpower.', c: 'good', s: { health: 5, happy: 2 } }, { p: .5, t: 'I tried to quit drinking alone and relapsed within a month.', c: 'bad', s: { health: -4, happy: -5 } }]],
    ['Carry on', { t: 'I told myself the drinking is under control.', s: { health: -8, looks: -3 }, perf: -6 }]], { cd: 10, amounts: [W(0.003, 2500, 150e3)] });
  E('h_knee', 'health', 'The knee', 'Your knee has been getting worse for months. The specialist offers surgery for {a0}.', { age: [25, 75] }, [
    ['Have the surgery', [{ p: .85, t: 'My knee surgery was a success.', c: 'good', m: { a: 0 }, s: { health: 6 } }, { p: .15, t: 'My knee surgery had complications.', c: 'bad', m: { a: 0 }, s: { health: -8 } }], { cost: 0 }],
    ['Try physiotherapy', [{ p: .5, t: 'Months of physiotherapy fixed my knee.', c: 'good', m: -1500, s: { health: 4, happy: -2 } }, { p: .5, t: 'Physiotherapy did not help my knee much.', m: -1500 }]],
    ['Live with it', { t: 'I decided to live with my bad knee.', s: { health: -5, happy: -3 } }]], { once: 1, amounts: [W(0.003, 6e3, 200e3)] });
  E('h_low', 'health', 'A dark stretch', 'Getting out of bed has become hard. Nothing feels worth doing.', { age: [14, 100], stats: { happy: [0, 30] } }, [
    ['See a therapist', { t: 'I started seeing a therapist. Slowly, things are getting lighter.', c: 'good', m: -1200, s: { happy: 12 } }],
    ['Open up to someone close', [{ p: .7, t: 'I told someone close to me how I have been feeling. It helped more than I expected.', c: 'good', s: { happy: 8 }, bond: [['family', 5]] }, { p: .3, t: 'I tried to open up, but they did not really understand.', s: { happy: -2 } }]],
    ['Keep it to yourself', { t: 'I kept my feelings to myself.', c: 'bad', s: { happy: -4, health: -3 }, fx: () => X.ill('depression') }]], { cd: 6 });

  /* crime and the law */
  E('l_witness', 'legal', 'Witness', 'You see a car hit a cyclist and speed away. You got the license plate.', { age: [16, 90] }, [
    ['Call it in and testify', [{ p: .85, t: 'I testified about a hit-and-run. The driver was convicted.', c: 'good', k: 10 }, { p: .15, t: 'After I testified, the driver’s friends threatened me.', k: 10, s: { happy: -8 } }]],
    ['Help the cyclist, but stay out of court', { t: 'I helped an injured cyclist until the ambulance came.', k: 5 }],
    ['Walk away', { t: 'I walked away from a hit-and-run. It haunts me.', c: 'bad', k: -8, s: { happy: -3 } }]], { once: 1 });
  E('l_drive', 'legal', 'Keys in hand', 'It is late, you have had several drinks, and your car is right there. A taxi home costs {a0}.', { age: [18, 80], has: ['car'] }, [
    ['Take a taxi', { t: 'I left my car and took a taxi home.', m: { a: 0 }, k: 2 }],
    ['Drive home', [{ p: .7, t: 'I drove home after drinking. I got lucky.', k: -6 }, { p: .22, t: 'I was arrested for drunk driving. The fine was {a1}.', c: 'bad', m: { a: 1 }, k: -6, r: -10, fx: () => X.record() }, { p: .08, t: 'I crashed my car driving drunk.', c: 'bad', k: -8, s: { health: -25 }, r: -12, fx: () => { X.record(); const c = S.assets.find(a => a.type === 'car'); if (c) S.assets = S.assets.filter(a => a !== c); } }]],
    ['Sleep in the car', { t: 'I slept in my car and woke up with a stiff neck.', s: { health: -1 } }]], { cd: 10, amounts: [60, W(0.01, 2500, 500e3)] });
  E('l_fence', 'legal', 'The fence', 'Your neighbor has built a fence a full meter onto your land and refuses to move it.', { has: ['house'] }, [
    ['Sue', [{ p: .6, t: 'I sued my neighbor over the fence and won.', m: { a: 0 }, s: { happy: 3 } }, { p: .4, t: 'I sued my neighbor over a fence and lost. The legal fees were painful.', c: 'bad', m: { a: 0, x: -2.5 } }], { cost: 0 }],
    ['Offer to split the cost of a survey', { t: 'A surveyor settled the fence dispute. My neighbor moved it.', c: 'good', m: -600, k: 2 }],
    ['Let it go', { t: 'I let my neighbor keep the strip of land.', s: { happy: -3 } }]], { once: 1, amounts: [W(0.005, 4e3, 300e3)] });
  E('l_scheme', 'legal', 'Easy money', 'An acquaintance has a plan: a staged accident and an insurance claim. Your cut would be {a0}.', { age: [18, 70], if: () => S.karma < 50 || S.record > 0 || S.money < 5000 }, [
    ['Join in', [{ p: .6, t: 'The insurance scam worked. My cut was {a0}.', m: { a: 0, x: 1 }, k: -12 }, { p: .4, t: 'The insurance company saw through the scam. I was arrested.', c: 'bad', k: -12, fx: () => arrest('I was convicted of insurance fraud.', R(1, 4)) }]],
    ['Refuse', { t: 'I wanted nothing to do with an insurance scam.', k: 3 }],
    ['Report it', { t: 'I reported a planned insurance scam.', k: 8 }]], { cd: 10, amounts: [W(0.05, 15e3, 2e6)] });
  E('l_accused', 'legal', 'Wrongly accused', 'You are arrested for a crime you did not commit. A witness has picked you out of a lineup.', { age: [18, 80] }, [
    ['Hire the best lawyer ({a0})', [{ p: .9, t: 'My lawyer proved I was innocent.', c: 'good', m: { a: 0 } }, { p: .1, t: 'Even with a good lawyer, I was wrongly convicted.', c: 'bad', m: { a: 0 }, fx: () => arrest('I was convicted of a crime I did not commit.', R(1, 3)) }], { cost: 0 }],
    ['Use the public defender', [{ p: .65, t: 'My overworked public defender got me acquitted.', c: 'good' }, { p: .35, t: 'I was wrongly convicted.', c: 'bad', fx: () => arrest('I was convicted of a crime I did not commit.', R(1, 3)) }]],
    ['Take a plea deal', { t: 'I took a plea deal for something I did not do, to avoid prison.', c: 'bad', m: { a: 1 }, s: { happy: -8 }, fx: () => X.record() }]], { once: 1, w: .5, amounts: [W(0.03, 15e3, 5e6), W(0.005, 2e3, 500e3)] });

  /* old age */
  E('o_retire', 'old age', 'Time to stop?', 'You could retire now. The work still matters to you, but you are tired.', { age: [60, 72], job: 1 }, [
    ['Retire', { t: ctx => 'I retired. The first Monday with nothing to do felt strange and wonderful.', c: 'good', s: { happy: 10, health: 3 }, fx: () => { S.flags.pension = Math.max(15e3, Math.round(S.job.salary * 0.35)); S.job = null; } }],
    ['Keep working', { t: 'I decided to keep working a few more years.', stress: 6, s: { happy: -2 } }],
    ['Negotiate a three-day week', [{ p: .6, t: 'I moved to a three-day week on reduced pay.', c: 'good', stress: -20, s: { happy: 6 }, fx: () => { S.job.salary = Math.round(S.job.salary * 0.65); } }, { p: .4, t: 'My employer refused a shorter week.', s: { happy: -3 } }]]], { cd: 4 });
  E('o_downsize', 'old age', 'Too much house', 'The house feels enormous now. An agent says you could sell and buy something small.', { age: [62, 100], has: ['house'], if: () => S.assets.some(a => a.type === 'house' && !a.rented && a.value > 300e3) }, [
    ['Downsize', { t: 'I sold the big house and moved somewhere smaller. The extra cash helps.', c: 'good', s: { happy: -2 }, fx: () => { const h = S.assets.filter(a => a.type === 'house' && !a.rented).sort((a, b) => b.value - a.value)[0]; const freed = Math.round(h.value * 0.45); ECO.capGains(Math.round(h.value * 0.45 - (h.price || 0) * 0.45), 'my home'); h.value = Math.round(h.value * 0.5); h.price = Math.round((h.price || h.value) * 0.5); h.name = 'Small cottage'; S.money += freed - (h.loan || 0); h.loan = 0; } }],
    ['Stay put', { t: 'I decided to stay in my home. Too many memories to leave.', s: { happy: 3 } }],
    ['Invite family to move in', [{ p: .6, t: 'My family moved in with me. The house is full of life again.', c: 'good', s: { happy: 10 }, bond: [['family', 8]] }, { p: .4, t: 'Nobody in the family wanted to move in.', s: { happy: -4 } }]]], { once: 1 });
  E('o_will', 'old age', 'Putting it in writing', 'Your lawyer asks how you want your estate divided among your children.', { age: [65, 110], if: () => EVT.people('kid').length >= 2 }, [
    ['Equally', { t: 'I wrote my will to divide everything equally among my children.', k: 3, bond: [['kids', 4]] }],
    ['Most to the one who has been there for you', { t: 'I left most of my estate to the child who has cared for me. The others found out.', bond: [['kids', -12]] }],
    ['Half to charity', { t: 'I am leaving half of my estate to charity. My children have mixed feelings.', k: 15, r: 5, bond: [['kids', -8]] }]], { once: 1 });
  E('o_bucket', 'old age', 'The trip of a lifetime', 'You have always wanted to see the world properly. A grand tour would cost {a0}.', { age: [65, 95] }, [
    ['Go', { t: 'I took the trip of a lifetime. No regrets.', c: 'good', m: { a: 0 }, s: { happy: 18, health: -2 } }, { cost: 0 }],
    ['Take a shorter, cheaper trip', { t: 'I took a modest trip. It was lovely.', m: { a: 0, x: -0.25 }, s: { happy: 8 } }],
    ['Save the money for the family', { t: 'I decided the money was better left to my family.', k: 3, s: { happy: -3 } }]], { once: 1, amounts: [W(0.04, 12e3, 3e6)] });
  E('o_memory', 'old age', 'Forgetting', 'You left the stove on twice this week, and yesterday you got lost walking home.', { age: [74, 120] }, [
    ['See a specialist ({a0})', { t: 'I saw a specialist about my memory. Treatment is slowing things down.', c: 'good', m: { a: 0 }, s: { smarts: 3, happy: 2 } }, { cost: 0 }],
    ['Move in with family', [{ p: .7, t: 'I moved in with family. I feel safe.', c: 'good', s: { happy: 5 }, bond: [['family', 6]] }, { p: .3, t: 'I moved in with family, but I miss my independence.', s: { happy: -5 } }]],
    ['Tell no one', { t: 'I hid my memory lapses from everyone.', c: 'bad', s: { smarts: -6, health: -4 } }]], { once: 1, amounts: [W(0.005, 3e3, 300e3)] });
  E('o_romance', 'old age', 'A new friend online', 'Someone charming you met online says they love you. They also need {a0} for an emergency.', { age: [60, 100], rel: 'single' }, [
    ['Send the money', { t: 'I sent {a0} to someone I met online. Their profile vanished the next day.', c: 'bad', m: { a: 0 }, s: { happy: -10 } }, { cost: 0 }],
    ['Ask to video call first', { t: 'I asked my online admirer for a video call. They disappeared. A scammer.', c: 'good', s: { smarts: 1 } }],
    ['Ask a family member what they think', { t: 'My family spotted the online romance scam immediately.', c: 'good', bond: [['family', 4]] }]], { cd: 10, amounts: [W(0.03, 3e3, 2e6)] });
  E('o_grandkid', 'old age', 'A head start', '{grandkid} has been accepted to a wonderful school the family cannot afford. Fees are {a0}.', { age: [58, 110], has: ['grandkid'] }, [
    ['Pay the fees', { t: 'I paid {a0} for {grandkid}’s education.', c: 'good', m: { a: 0 }, k: 8, bond: [['grandkid', 25], ['kids', 8]] }, { cost: 0 }],
    ['Pay half', { t: 'I paid half of {grandkid}’s school fees.', m: { a: 0, x: -0.5 }, k: 4, bond: [['grandkid', 12]] }],
    ['Decline', { t: 'I told the family I could not pay for {grandkid}’s school.', bond: [['kids', -8]] }]], { cd: 8, amounts: [W(0.02, 15e3, 1e6)] });
})();
