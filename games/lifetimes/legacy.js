/* Lifetimes: long-term systems (game logic only, no screen code).
   People with their own stats and personalities, inherited traits, life highlights, ribbons,
   achievements that persist across lives, challenge mode, and limits on God Mode and the Time Machine.
   Uses game globals at call time: S, L, popup, toast, netWorth, partner, fmt, P, person, kids, CAR, ECO, BAL. */
const LEG = (() => {
  const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
  const chance = p => Math.random() < p;
  const lim = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)));
  const first = p => p.name.split(' ')[0];

  /* ---------- persistent store (survives across lives, per browser) ---------- */
  const KEY = 'lifetimes-meta-v1';
  let meta = null;
  function store() {
    if (meta) return meta;
    try { meta = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { meta = null; }
    if (!meta) meta = { ach: {}, sandbox: false, lives: 0, best: { nw: 0, age: 0 }, challenges: {} };
    meta.ach = meta.ach || {}; meta.challenges = meta.challenges || {}; meta.best = meta.best || { nw: 0, age: 0 };
    return meta;
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch (e) { } }
  const sandbox = () => !!store().sandbox;
  function setSandbox(on) { store().sandbox = !!on; persist(); }

  /* ---------- traits ---------- */
  const TRAITS = {
    gifted: { name: 'Gifted', d: 'Naturally smart. Higher natural smarts.', good: 1 },
    athletic: { name: 'Athletic', d: 'Strong body. Health settles at a higher level.', good: 1 },
    charming: { name: 'Charming', d: 'People warm to you. Higher natural looks, relationships grow faster.', good: 1 },
    thrifty: { name: 'Thrifty', d: 'Careful with money. Living costs 12% lower.', good: 1 },
    ambitious: { name: 'Ambitious', d: 'Driven. Job performance grows faster.', good: 1 },
    lucky: { name: 'Lucky', d: 'Fewer burglaries, frauds, lawsuits and illnesses.', good: 1 },
    resilient: { name: 'Resilient', d: 'Hard to kill. Lower yearly risk of death.', good: 1 },
    creative: { name: 'Creative', d: 'Hobbies and creative work come easily.', good: 1 },
    spendthrift: { name: 'Spendthrift', d: 'Money burns a hole in your pocket. Living costs 15% higher.', good: 0 },
    fragile: { name: 'Fragile', d: 'Weak constitution. Higher yearly risk of death.', good: 0 },
    lazy: { name: 'Lazy', d: 'Job performance slips more easily.', good: 0 },
    hotheaded: { name: 'Hot-headed', d: 'Quick to anger. Makes enemies more easily.', good: 0 },
  };
  const TRAIT_KEYS = Object.keys(TRAITS);
  const has = k => !!(S && S.traits && S.traits.includes(k));
  function randomTraits(n) {
    const out = []; while (out.length < n) { const k = P(TRAIT_KEYS); if (!out.includes(k)) out.push(k); } return out;
  }
  // A child keeps one trait from the parent most of the time, plus one of their own.
  function inheritTraits(parentTraits) {
    const out = [];
    if (parentTraits && parentTraits.length && chance(0.65)) out.push(P(parentTraits));
    while (out.length < 2) { const k = P(TRAIT_KEYS); if (!out.includes(k)) out.push(k); }
    return out;
  }
  function applyTraitBases() {
    const b = RULES.ensureBase();
    if (has('gifted')) { b.smarts = Math.min(90, b.smarts + 10); S.stats.smarts = Math.max(S.stats.smarts, b.smarts); }
    if (has('charming')) { b.looks = Math.min(90, b.looks + 8); S.stats.looks = Math.max(S.stats.looks, b.looks); }
  }

  /* ---------- people: stats, personality, income ---------- */
  const NPC_TRAITS = ['generous', 'jealous', 'ambitious', 'lazy', 'kind', 'hot-headed', 'wise', 'reckless', 'loyal', 'greedy'];
  function npc(p, parents) {
    if (!p.st) {
      const avg = k => parents && parents.length ? parents.reduce((a, x) => a + ((x.st && x.st[k]) || (x === S ? S.stats[k] : 50)), 0) / parents.length : 50;
      p.st = { happy: rnd(45, 85), health: rnd(55, 95), smarts: lim(avg('smarts') * 0.5 + rnd(10, 60)), looks: lim(avg('looks') * 0.5 + rnd(10, 60)) };
    }
    if (!p.trait) p.trait = P(NPC_TRAITS);
    if (p.income == null && p.age >= 22 && !['Son', 'Daughter', 'Grandson', 'Granddaughter'].includes(p.rel)) p.income = Math.round(rnd(18, 70) * 1000 * (0.5 + p.st.smarts / 100));
    return p;
  }
  function initChild(k) { npc(k, [S, partner()].filter(Boolean)); k.traits = inheritTraits(S.traits); return k; }

  const isEnemy = p => p.alive && (p.rel === 'Enemy' || (p.rel === 'Ex' && p.bond < 15));
  // Turn a work rival who hates you into an enemy you have to deal with.
  function rivalToEnemy() {
    const j = S.job; if (!j || !j.rival || j.rival.heat < 80 || j.rival.enemy) return;
    j.rival.enemy = 1; const e = npc({ id: uid(), rel: 'Enemy', name: j.rival.name, g: 'M', age: S.age + rnd(-5, 5), alive: true, bond: 8, money: rnd(20, 200) * 1000, job: j.title });
    S.people.push(e); L(`My work rival ${e.name} has become a real enemy.`, 'bad');
  }
  function makeEnemy(p, why) { p.rel = 'Enemy'; p.bond = Math.min(p.bond, 10); if (why) L(why, 'bad'); }

  // Each year, the people in your life live their own lives and may help or hurt you. At most two notable actions a year.
  function npcYear() {
    let acts = 0; const note = (t, c) => { if (acts < 2) { L(t, c); acts++; return true; } return false; };
    const alive = S.people.filter(p => p.alive);
    alive.forEach(p => {
      npc(p);
      const s = p.st; s.happy = lim(s.happy + rnd(-4, 4) + (p.bond > 70 ? 1 : p.bond < 30 ? -1 : 0));
      s.health = lim(s.health - (p.age > 60 ? rnd(0, 3) : 0) + rnd(-2, 2));
      if (p.income && p.age < 67) p.money += Math.round(p.income * 0.15);
      if (['Son', 'Daughter'].includes(p.rel) && p.age < 18) { if (p.bond >= 70) s.smarts = lim(s.smarts + rnd(0, 2)); if (p.age === 17) p.traits = p.traits || inheritTraits(S.traits); }
      if (['Son', 'Daughter'].includes(p.rel) && p.age === 22 && p.income == null) {
        p.income = Math.round(rnd(20, 90) * 1000 * (0.4 + s.smarts / 80)); p.job = P(CAREERS.filter(c => !c.fame)).ladder[s.smarts > 70 ? 1 : 0];
        note(`${first(p)} started working as ${p.job}.`, 'good');
      }
      if (S.traits && has('charming') && chance(.3)) p.bond = lim(p.bond + 1);
    });
    // spouse shares the household bills
    const sp = partner(); if (sp && sp.rel === 'Spouse' && sp.income && S.age >= 18 && sp.age < 67) { const c = Math.round(sp.income * 0.35); S.money += c; S.flags.spouseShare = c; }
    // someone who loves you bails you out of debt
    if (S.money < -5000) {
      const helper = alive.filter(p => p.bond >= 75 && p.money > 5000 && !isEnemy(p) && ['generous', 'kind', 'loyal', 'wise'].includes(p.trait)).sort((a, b) => b.money - a.money)[0];
      if (helper && chance(.5)) { const g = Math.round(Math.min(helper.money * 0.3, -S.money)); helper.money -= g; S.money += g; helper.bond = lim(helper.bond - 5); note(`${helper.name} quietly paid off ${fmt(g)} of my debts.`, 'good'); }
    }
    // a good friend helps your career
    const fr = alive.filter(p => p.rel === 'Friend' && p.bond >= 70 && p.st.smarts >= 55);
    if (fr.length && chance(.12)) {
      const f = P(fr);
      if (S.job) { S.job.perf = lim(S.job.perf + 5); note(`${f.name} put in a good word for me at work.`, 'good'); }
      else if (S.age >= 18 && S.age < 65 && !S.sp && !S.edu.school) {
        const ok = CAREERS.filter(c => !c.fame && !eduOk(c)); if (ok.length) { const c = P(ok); popup('A tip from a friend', `${f.name} says their company is hiring a ${c.ladder[0]} and can get you an interview.`, [['Go for it', () => { if (chance(.6)) { hire(c); L(`Thanks to ${f.name}, I was hired as ${an(c.ladder[0])} ${c.ladder[0]}.`, 'good'); } else L(`${f.name} got me an interview, but I did not get the job.`); }], ['No thanks', null]]); acts++; }
      }
    }
    // friends you neglect drift away
    alive.filter(p => p.rel === 'Friend' && p.bond < 15).forEach(p => { if (chance(.4)) { p.alive = false; p.gone = 1; note(`${p.name} and I drifted apart. We do not talk anymore.`); } });
    // grown children support aging parents, or stay away
    if (S.age >= 70) alive.filter(p => ['Son', 'Daughter'].includes(p.rel) && p.age >= 25).forEach(k => {
      if (k.bond >= 75 && chance(.15)) { const g = Math.round(Math.max(2000, (k.income || 30e3) * 0.1)); k.money -= g; S.money += g; st('happy', 4); note(`${first(k)} sent me ${fmt(g)} to help out.`, 'good'); }
      else if (k.bond < 25 && chance(.2)) { st('happy', -6); note(`${first(k)} has not visited in years.`, 'bad'); }
    });
    // children can get into trouble, or make you proud
    alive.filter(p => ['Son', 'Daughter'].includes(p.rel) && p.age >= 12 && p.age <= 30).forEach(k => {
      if (k.trait === 'reckless' && chance(.08)) { const c = Math.max(1000, ECO.amt('fine')); S.money -= c; k.bond = lim(k.bond - 4); note(`${first(k)} got into trouble again. It cost me ${fmt(c)}.`, 'bad'); }
      else if (k.st.smarts >= 80 && k.age === 22 && chance(.5)) { st('happy', 6); note(`${first(k)} graduated top of their class. I am so proud.`, 'good'); }
    });
    // enemies act against you
    alive.filter(isEnemy).forEach(e => {
      npc(e); const hostility = 100 - e.bond; let p = hostility / 400; if (e.restrain) p /= 2; if (e.trait === 'hot-headed') p *= 1.5; if (has('lucky')) p *= 0.7;
      if (!chance(p)) return;
      const opts = [
        () => { CAR.rep(-6); st('happy', -3); return `${e.name} has been spreading lies about me.`; },
        () => { const c = Math.max(500, ECO.amt('burglary')); S.money -= c; return `${e.name} vandalized my property. Repairs cost ${fmt(c)}.`; },
        () => { const b = S.biz.length ? P(S.biz) : null; if (!b) return null; b.rating = lim(b.rating - 10); return `${e.name} posted a flood of fake reviews about ${b.name}.`; },
        () => { const c = Math.max(2000, Math.round(ECO.amt('taxAudit') / 2)); S.money -= c; return `${e.name} reported me to the tax office. Sorting it out cost ${fmt(c)}.`; },
        () => { if (!S.job) return null; S.job.perf = lim(S.job.perf - 8); return `${e.name} went to my boss with stories about me.`; },
        () => { const pt = partner(); if (!pt) return null; pt.bond = lim(pt.bond - 10); return `${e.name} tried to turn ${first(pt)} against me.`; },
      ];
      let t = null; for (let i = 0; i < 4 && !t; i++) t = P(opts)();
      if (t) note(t, 'bad');
    });
    rivalToEnemy();
    if (S.traits && has('hotheaded') && chance(.04)) { const f = alive.filter(p => p.rel === 'Friend'); if (f.length) { const x = P(f); makeEnemy(x, `I lost my temper with ${x.name}. We are enemies now.`); } }
  }

  /* ---------- highlights and running totals ---------- */
  const HL = /graduated|was hired as|promoted to|married|eloped|welcomed a baby|adopted |opened |won the|championship|elected|ascended|sentenced|escaped from prison|divorc|went public|inherited|was diagnosed with (cancer|heart)|cured of|Fountain of Youth|became a vampire|hatched|academy of magic|vigilante|LOTTERY JACKPOT|founded|signed with|was cast in|hit #1|went bankrupt|declared bankruptcy|became a (millionaire|multi-millionaire|billionaire)|turned 100|moved to|relocated|retired|was laid off|was fired|became a real enemy|enemies now|Award|gold medal|title|belt/i;
  const NOISE = /^I (earned|paid|practiced)|Living costs|stocks and crypto|index fund|made a profit|lost \$[\d,]+ this year|rental properties|property tax|interest\.|welcomed [\d,]+ visitors|had [\d,]+ visitors/i;
  function observe(t, c) {
    if (!S || !S.log) return;
    const T = S.tally || (S.tally = {});
    let m; const ft = typeof FMT !== 'undefined' ? FMT.fullText(t) : t;
    if ((m = ft.match(/I (?:donated|pledged|gave) \$([\d,]+)/))) T.donated = (T.donated || 0) + +m[1].replace(/,/g, '');
    if (/high-stakes|roulette|slot machines|poker|blackjack|horse race|sports match|scratch cards|lottery ticket|Casino:/i.test(t)) T.bets = (T.bets || 0) + 1;
    if (/street race|skydiv|bungee|tallest|heist|robbery|wilderness|rafting|marathon|dare|pulled off|stunt|ghost|treasure|alchemy|bear/i.test(t)) T.risks = (T.risks || 0) + 1;
    if (/started dating|began courting|married|eloped/i.test(t)) T.partners = (T.partners || 0) + (/married|eloped/i.test(t) ? 0 : 1);
    if (/LOTTERY JACKPOT/.test(t)) T.jackpot = 1;
    if (/cured of cancer|cancer cleared/i.test(t)) T.beatCancer = 1;
    if (/I opened |I bought [^.]* (Shop|Truck|Parlor|Restaurant|Bakery|Pizzeria|Nightclub|Brewery|Winery|Store|Label|Brand|Company|Salon|Agency|Firm|Studio|Gym|Room|Alley|Cinema|Hotel|Resort|Park|App|Startup|Team|Platform|Dealership|Farm|Factory|Line|Airline)/.test(t)) T.biz = (T.biz || 0) + 1;
    if (/I adopted .* (dog|cat|rabbit|parrot|horse|tortoise|goldfish)|I adopted a stray|hatched/i.test(t)) T.pets = (T.pets || 0) + 1;
    if (c && (c === 'good' || c === 'bad') && HL.test(t) && !NOISE.test(t)) { S.hl = S.hl || []; S.hl.push({ a: S.age, t, c }); if (S.hl.length > 80) S.hl.splice(1, 1); }
  }
  function milestones() {
    const T = S.tally || (S.tally = {}); const nw = netWorth();
    if (nw > (T.peak || 0)) { T.peak = nw; T.peakAge = S.age; }
    [[1e6, 'millionaire'], [10e6, 'multi-millionaire'], [1e9, 'billionaire']].forEach(([v, n]) => { if (nw >= v && !T['m' + v]) { T['m' + v] = S.age; L(`I became a ${n}.`, 'good'); } });
    if (S.job || S.sp) T.work = (T.work || 0) + 1;
    if (S.jail > 0) T.jail = (T.jail || 0) + 1;
    T.rentals = Math.max(T.rentals || 0, S.assets.filter(a => a.rented).length);
    T.collect = Math.max(T.collect || 0, S.assets.filter(a => ['art', 'collect', 'classic'].includes(a.type)).length);
    T.bizMax = Math.max(T.bizMax || 0, S.biz.length);
    T.kidsMax = Math.max(T.kidsMax || 0, S.people.filter(p => ['Son', 'Daughter'].includes(p.rel)).length);
    T.married = T.married || (partner() && partner().rel === 'Spouse' ? 1 : 0);
    T.marriedYears = (T.marriedYears || 0) + (partner() && partner().rel === 'Spouse' ? 1 : 0);
  }

  /* ---------- ribbons: everything this life earned, best first ---------- */
  function ribbons() {
    const nw = netWorth(), sp = S.sp || {}, T = S.tally || {}, kidsN = S.people.filter(p => ['Son', 'Daughter'].includes(p.rel)).length;
    const friends = S.people.filter(p => p.rel === 'Friend' && p.alive).length;
    const R = [
      ['Immortal', 'Outlived centuries.', S.vampire && S.age >= 120],
      ['Sovereign', 'Ruled a kingdom.', S.royal && S.royal.monarch],
      ['Head of State', 'Led the nation.', sp.kind === 'pol' && sp.best >= 5],
      ['Superhero', 'Saved the city, again and again.', S.hero && (S.hero.wins || 0) >= 3],
      ['Archmage', 'Mastered the arcane arts.', S.magic && S.magic.xp >= 90],
      ['Kingpin', 'Ran a criminal empire.', S.gang && S.gang.rank >= 3],
      ['Tycoon', 'Built a billion-dollar fortune.', nw >= 1e9],
      ['Champion', 'A winner, again and again.', (sp.kind === 'sport' && (sp.titles || 0) >= 3) || (sp.kind === 'race' && sp.titles >= 2) || (sp.kind === 'fight' && sp.belt)],
      ['Legend', 'Everyone knew the name.', S.fame >= 80],
      ['Auteur', 'Made films and performances that mattered.', (sp.kind === 'director' || sp.kind === 'actor') && sp.awards >= 1],
      ['Hitmaker', 'Wrote the songs everyone sang.', sp.kind === 'music' && (sp.hits || 0) >= 5],
      ['Spymaster', 'Nobody ever knew.', sp.kind === 'agent' && sp.rank >= 3],
      ['Prophet', 'Thousands followed.', sp.kind === 'cult' && sp.followers >= 1000],
      ['Rags to Riches', 'Started with nothing, ended with a fortune.', S.flags.poorStart && nw >= 10e6],
      ['Mogul', 'Built a hundred-million-dollar fortune.', nw >= 100e6 && nw < 1e9],
      ['Philanthropist', 'Gave generously.', (T.donated || 0) >= Math.max(100e3, (T.peak || 0) * 0.1)],
      ['Entrepreneur', 'Built business after business.', (T.biz || 0) >= 3 || (T.bizMax || 0) >= 3],
      ['Scholar', 'Collected degrees.', S.edu.level >= 3],
      ['Family Person', 'Raised a big, loving family.', kidsN >= 3 && (T.marriedYears || 0) >= 15],
      ['Saint', 'Kind to the end.', S.karma >= 90],
      ['Daredevil', 'Never met a risk they did not take.', (T.risks || 0) >= 8],
      ['Globetrotter', 'Saw the whole world.', (S.flags.visited || []).length >= 15],
      ['Zookeeper', 'Built a wild kingdom.', S.zoo && zooCount(S.zoo) >= 30],
      ['Landlord', 'Collected rent from many tenants.', (T.rentals || 0) >= 3],
      ['Collector', 'Filled rooms with treasures.', (T.collect || 0) >= 8],
      ['Animal Lover', 'Never without a pet.', (T.pets || 0) >= 5],
      ['Casanova', 'Loved many, settled for none.', (T.partners || 0) >= 5],
      ['Workaholic', 'Worked until the very end.', (T.work || 0) >= 45],
      ['Gambler', 'Always one more bet.', (T.bets || 0) >= 15],
      ['Outlaw', 'Lived outside the law.', S.record >= 3],
      ['Jailbird', 'Spent years behind bars.', (T.jail || 0) >= 10],
      ['Villain', 'Left a trail of damage.', S.karma <= 10],
      ['Centenarian', 'Lived to see 100.', S.age >= 100],
      ['Millionaire', 'Built a comfortable fortune.', nw >= 1e6 && nw < 100e6],
      ['Died Broke', 'Ended with nothing left.', nw < 1000],
      ['Lonely Heart', 'Never found their person.', !(T.partners || T.married) && friends === 0 && S.age >= 40],
      ['Content', 'A happy life.', S.stats.happy >= 85],
      ['Miserable', 'Never quite found joy.', S.stats.happy <= 15],
      ['Long-lived', 'Outlived almost everyone.', S.age >= 90 && S.age < 100],
      ['Gone Too Soon', 'A life cut short.', S.age < 25],
    ].filter(r => r[2]).map(([n, d]) => [n, d]);
    if (!R.length) R.push(['Ordinary', 'A quiet, regular life.']);
    return R;
  }
  const RIBBON_COUNT = 41;

  /* ---------- achievements (persist across lives) ---------- */
  const ACH = [
    ['million', 'Millionaire', 'Reach a net worth of $1 million.', () => netWorth() >= 1e6],
    ['tenmillion', 'Eight Figures', 'Reach a net worth of $10 million.', () => netWorth() >= 10e6],
    ['billion', 'Billionaire', 'Reach a net worth of $1 billion.', () => netWorth() >= 1e9],
    ['graduate', 'Graduate', 'Earn a university degree.', () => S.edu.level >= 2],
    ['doctorate', 'Doctorate', 'Finish graduate school.', () => S.edu.level >= 3],
    ['married', 'Tying the Knot', 'Get married.', () => partner() && partner().rel === 'Spouse'],
    ['bigfamily', 'Full House', 'Have four or more children.', () => S.people.filter(p => ['Son', 'Daughter'].includes(p.rel)).length >= 4],
    ['grandparent', 'Grandparent', 'Become a grandparent.', () => S.people.some(p => ['Grandson', 'Granddaughter'].includes(p.rel))],
    ['ninety', 'Golden Years', 'Live to 90.', () => S.age >= 90],
    ['century', 'Centenarian', 'Live to 100.', () => S.age >= 100],
    ['president', 'Head of State', 'Reach the top political office.', () => S.sp && S.sp.kind === 'pol' && S.sp.best >= 5],
    ['crown', 'Long Live the Monarch', 'Take the throne.', () => S.royal && S.royal.monarch],
    ['champion', 'Champion', 'Win a championship, title or belt.', () => S.sp && ((S.sp.titles || 0) >= 1 || S.sp.belt)],
    ['star', 'Star', 'Reach 80% fame.', () => S.fame >= 80],
    ['award', 'Golden Reel', 'Win a major film award.', () => S.sp && ['actor', 'director'].includes(S.sp.kind) && S.sp.awards >= 1],
    ['boss', 'The Boss', 'Run a crime family.', () => S.gang && S.gang.rank >= 4],
    ['jail', 'Doing Time', 'Serve a prison sentence.', () => (S.tally && S.tally.jail) >= 1],
    ['escape', 'Escape Artist', 'Break out of prison.', () => S.flags.fugitive],
    ['globe', 'Globetrotter', 'Visit 10 places around the world.', () => (S.flags.visited || []).length >= 10],
    ['dragon', 'Dragon Tamer', 'Raise a dragon.', () => S.pets.some(p => p.kind === 'dragon')],
    ['archmage', 'Archmage', 'Master magic.', () => S.magic && S.magic.xp >= 90],
    ['hero', 'Superhero', 'Defeat three supervillains.', () => S.hero && (S.hero.wins || 0) >= 3],
    ['vampire', 'Creature of the Night', 'Become a vampire.', () => S.vampire],
    ['giver', 'Philanthropist', 'Give away $1 million in total.', () => (S.tally && S.tally.donated) >= 1e6],
    ['saint', 'Saint', 'Reach 95% karma.', () => S.karma >= 95],
    ['empire', 'Empire Builder', 'Own three businesses at once.', () => S.biz.length >= 3],
    ['zoo', 'Wild Kingdom', 'Keep 20 animals in your zoo.', () => S.zoo && zooCount(S.zoo) >= 20],
    ['jackpot', 'Jackpot', 'Win the lottery jackpot.', () => S.tally && S.tally.jackpot],
    ['survivor', 'Survivor', 'Beat cancer.', () => S.tally && S.tally.beatCancer],
    ['broke', 'Easy Come, Easy Go', 'Die with debts.', (ctx) => ctx && ctx.dead && netWorth() < 0],
    ['dynasty', 'Dynasty', 'Play as the third generation of a family.', () => S.gen >= 3],
    ['enemy', 'Nemesis', 'Make a real enemy.', () => S.people.some(p => p.rel === 'Enemy')],
  ];
  const CHALLENGES = [
    { id: 'rags', name: 'Rags to Riches', d: 'Start with nothing: poor parents, average brains. Reach a net worth of $10 million before age 50.', deadline: 50, setup: () => { S.flags.poorStart = 1; S.people.forEach(p => p.money = 0); S.stats.smarts = rnd(30, 45); RULES.ensureBase().smarts = Math.min(RULES.ensureBase().smarts, 45); }, goal: () => netWorth() >= 10e6 },
    { id: 'billion', name: 'Self-Made Billionaire', d: 'Your family has no money to give you. Reach $1 billion before age 65.', deadline: 65, setup: () => { S.people.forEach(p => p.money = 0); }, goal: () => netWorth() >= 1e9 },
    { id: 'century', name: 'Against the Odds', d: 'You were born fragile, with a family history of poor health. Live to 100.', deadline: null, setup: () => { S.traits = ['fragile', P(['lucky', 'thrifty', 'gifted'])]; S.stats.health = rnd(50, 60); }, goal: () => S.age >= 100 },
    { id: 'clean', name: 'Clean Hands', d: 'Reach age 70 with 80%+ karma, $1 million, and no criminal record.', deadline: 70, setup: () => { }, goal: () => S.age >= 70 && S.karma >= 80 && netWorth() >= 1e6 && S.record === 0, fail: () => S.record > 0 },
    { id: 'family', name: 'Big Happy Family', d: 'By 60, be married with four or more children who all love you (relationship 70%+).', deadline: 60, setup: () => { }, goal: () => { const k = S.people.filter(p => p.alive && ['Son', 'Daughter'].includes(p.rel)); return partner() && partner().rel === 'Spouse' && k.length >= 4 && k.every(x => x.bond >= 70); } },
    { id: 'debt', name: 'Out of the Hole', d: 'You start at 25 owing $250,000 with a high school diploma. Reach $1 million net worth by 45.', deadline: 45, setup: () => { S.age = 25; S.log = [{ age: 25, lines: [] }]; S.money = -250e3; S.edu.level = 1; S.edu.hsDone = 1; S.edu.degrees = ['High school diploma']; S.people.forEach(p => { p.age += 25; p.money = 0; }); S.flags.poorStart = 1; L('I am 25, and I owe $250,000.', 'bad'); }, goal: () => netWorth() >= 1e6 },
    { id: 'leader', name: 'Head of State', d: 'Reach the top political office before age 60.', deadline: 60, setup: () => { }, goal: () => S.sp && S.sp.kind === 'pol' && S.sp.best >= 5 },
    { id: 'polymath', name: 'Polymath', d: 'Earn a bachelor’s degree and two graduate degrees by age 40.', deadline: 40, setup: () => { }, goal: () => (S.edu.grad || []).length >= 2 },
    { id: 'dynasty', name: 'Dynasty', d: 'Carry your family to the third generation with a net worth of $50 million. Continue as your children to keep going.', deadline: null, carry: 1, setup: () => { }, goal: () => S.gen >= 3 && netWorth() >= 50e6 },
  ];
  function startChallenge(id) {
    const c = CHALLENGES.find(x => x.id === id); if (!c) return;
    S.challenge = { id, status: 'active' }; c.setup(); applyTraitBases();
    L(`Challenge: ${c.name}. ${c.d}`, 'good');
  }
  function challengeYear(dead) {
    const ch = S.challenge; if (!ch || ch.status !== 'active') return;
    const c = CHALLENGES.find(x => x.id === ch.id); if (!c) return;
    if (c.goal()) { ch.status = 'won'; L(`Challenge complete: ${c.name}!`, 'good'); toast(`Challenge complete: ${c.name}!`); if (!sandbox() && !S.flags.assisted) { store().challenges[c.id] = { at: Date.now(), name: S.name }; unlock('ch_' + c.id, `Challenge: ${c.name}`); persist(); } return; }
    if ((c.deadline && S.age >= c.deadline) || (c.fail && c.fail()) || (dead && !c.carry)) { ch.status = 'failed'; L(`Challenge failed: ${c.name}.`, 'bad'); }
  }

  function canEarn() { return !sandbox() && !S.flags.assisted; }
  function unlock(id, name) {
    const m = store(); if (m.ach[id]) return false;
    m.ach[id] = { at: Date.now(), life: S.name, age: S.age }; persist();
    S.newAch = (S.newAch || []).concat(name); L(`Achievement unlocked: ${name}`, 'good'); toast(`Achievement unlocked: ${name}`);
    return true;
  }
  function checkAch(ctx) {
    if (!canEarn()) return;
    ACH.forEach(([id, name, , test]) => { if (!store().ach[id]) { let ok = false; try { ok = test(ctx); } catch (e) { } if (ok) unlock(id, name); } });
  }
  const achCount = () => Object.keys(store().ach).length;
  const achTotal = () => ACH.length + CHALLENGES.length;

  /* ---------- God Mode and Time Machine limits ---------- */
  const GOD_UNLOCK = 10;
  const godUnlocked = () => sandbox() || achCount() >= GOD_UNLOCK;
  const godUsesLeft = () => sandbox() ? Infinity : godUnlocked() && !S.flags.godUsed ? 1 : 0;
  function useGod() { if (sandbox()) return; S.flags.godUsed = 1; S.flags.assisted = 1; }
  const rewindsPerLife = () => sandbox() ? Infinity : Math.min(5, 1 + Math.floor(achCount() / 5));
  const rewindsLeft = () => sandbox() ? Infinity : Math.max(0, rewindsPerLife() - (S.flags.rewinds || 0));
  function useRewind() { if (!sandbox()) S.flags.rewinds = (S.flags.rewinds || 0) + 1; }

  /* ---------- life cycle hooks ---------- */
  function initLife(o) {
    S.traits = o.traits || randomTraits(chance(.5) ? 2 : 1);
    S.tally = {}; S.hl = []; RULES.ensureBase(); applyTraitBases();
    if (o.assisted || sandbox()) S.flags.assisted = 1;
    S.people.forEach(p => npc(p));
  }
  function year() { npcYear(); milestones(); checkAch(); challengeYear(false); }
  function onDeath() {
    milestones(); checkAch({ dead: true }); challengeYear(true);
    const m = store(); m.lives = (m.lives || 0) + 1; const nw = netWorth();
    if (!S.flags.assisted && !sandbox()) { if (nw > (m.best.nw || 0)) m.best.nw = nw; if (S.age > (m.best.age || 0)) m.best.age = S.age; }
    persist();
    S.final = { ribbons: ribbons(), nw, peak: (S.tally && S.tally.peak) || nw, peakAge: S.tally && S.tally.peakAge };
  }
  // Pick up to n highlights spread across the life, always keeping the first and last.
  function timeline(n = 12) {
    const h = S.hl || []; if (h.length <= n) return h;
    const out = [h[0]]; const step = (h.length - 1) / (n - 1);
    for (let i = 1; i < n - 1; i++) out.push(h[Math.round(i * step)]);
    out.push(h[h.length - 1]); return out;
  }
  // What a child takes into their own life when you continue as them.
  function inheritInto(oldS, k) {
    S.traits = (k.traits && k.traits.length ? k.traits : inheritTraits(oldS.traits)).slice(0, 2);
    if (k.st) { S.stats.smarts = lim(Math.max(k.st.smarts, 10)); S.stats.looks = lim(Math.max(k.st.looks, 10)); S.stats.health = lim(Math.max(k.st.health, 40)); S.stats.happy = lim(Math.max(k.st.happy, 30)); }
    S.base = { smarts: Math.min(S.stats.smarts, 70), looks: Math.min(S.stats.looks, 70) }; applyTraitBases();
    if (k.money > 0) { S.money += k.money; }
    if (k.income) S.flags.childIncome = k.income;
    if (oldS.challenge && oldS.challenge.status === 'active') { const c = CHALLENGES.find(x => x.id === oldS.challenge.id); if (c && c.carry) S.challenge = { ...oldS.challenge }; }
    if (oldS.flags.assisted) S.flags.assisted = 1;
    S.flags.poorStart = 0;
    L(`I inherited my family's ${S.traits.map(t => TRAITS[t].name.toLowerCase()).join(' and ')} nature.`);
  }
  function migrate() {
    if (!S.traits) S.traits = randomTraits(1);
    if (!S.tally) S.tally = {}; if (!S.hl) S.hl = [];
    (S.people || []).forEach(p => npc(p));
  }

  return { TRAITS, has, npc, initChild, initLife, year, onDeath, observe, ribbons, RIBBON_COUNT, timeline, ACH, CHALLENGES, startChallenge, checkAch, achCount, achTotal,
    store, persist, sandbox, setSandbox, godUnlocked, godUsesLeft, useGod, GOD_UNLOCK, rewindsLeft, rewindsPerLife, useRewind, inheritInto, migrate, makeEnemy, isEnemy, canEarn };
})();
