/* Lifetimes: quality-of-life layer (screen helpers and a few small systems).
   Hero chips, the "My life" sheet, life goals, net worth history, past lives, fast-forward,
   confirmations for things you cannot undo, a real blackjack table, themes, and backups.
   Uses game globals at call time: S, L, st, kar, popup, sheet, toast, render, save, netWorth, fmt, LEG, ECO, RULES. */
const UX = (() => {
  const store = () => LEG.store();
  const el = s => document.querySelector(s);

  /* ---------- appearance ---------- */
  function applyTheme() {
    const t = store().theme || 'auto', r = document.documentElement;
    if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
  }
  function setTheme(t) { store().theme = t; LEG.persist(); applyTheme(); }
  function themeMenu() {
    sheet('Appearance', api => {
      const cur = store().theme || 'auto';
      [['auto', 'Match my device', 'Follows your phone or computer setting'], ['light', 'Light', 'Bright and airy'], ['dark', 'Dark', 'Easy on the eyes at night']]
        .forEach(([k, l, d]) => api.item(l + (cur === k ? ' <span class="pill">Current</span>' : ''), d, null, () => { setTheme(k); refresh() }, false, ['brush', 'teal']));
    });
  }

  /* ---------- journal filter ---------- */
  const keyOnly = () => store().journal === 'key';
  // Past years can be trimmed to the lines that mattered. The current year always shows everything.
  function lines(ls, now) {
    if (now || !keyOnly()) return ls;
    return ls.filter(l => { const t = FMT.plain(l.t); return MAJOR.test(t) || (!ROUTINE.test(t) && !!l.c); });
  }

  /* ---------- life goals: three per life ---------- */
  const liquidInv = () => (S.invest || 0) + portValue() + (S.inv2 ? inv2Value() : 0);
  const GOALS = [
    { id: 'degree', t: 'Earn a university degree', ok: () => S.edu.level >= 2 },
    { id: 'million', t: 'Reach a net worth of $1 million', ok: () => netWorth() >= 1e6 },
    { id: 'marry', t: 'Get married', ok: () => { const p = partner(); return !!p && p.rel === 'Spouse'; } },
    { id: 'child', t: 'Become a parent', ok: () => S.people.some(p => ['Son', 'Daughter'].includes(p.rel)) },
    { id: 'home', t: 'Own a home', ok: () => S.assets.some(a => a.type === 'house') },
    { id: 'travel', t: 'Visit 5 places around the world', ok: () => (S.flags.visited || []).length >= 5, prog: () => [(S.flags.visited || []).length, 5] },
    { id: 'hobby', t: 'Master a hobby', ok: () => Object.values(S.hob || {}).some(v => v >= 100), prog: () => [Math.max(0, ...Object.values(S.hob || {})), 100] },
    { id: 'biz', t: 'Run a business of your own', ok: () => S.biz.length > 0 },
    { id: 'top', t: 'Reach the top of a career ladder', ok: () => !!S.job && S.job.level >= 4, prog: () => [S.job ? S.job.level + 1 : 0, 5] },
    { id: 'friends', t: 'Have 4 close friends at once', ok: () => closeFriends() >= 4, prog: () => [closeFriends(), 4] },
    { id: 'fame', t: 'Reach 50% fame', ok: () => S.fame >= 50, prog: () => [S.fame, 50] },
    { id: 'pet', t: 'Give a pet a home', ok: () => S.pets.length > 0 },
    { id: 'karma', t: 'Reach 85% karma', ok: () => S.karma >= 85, prog: () => [S.karma, 85] },
    { id: 'eighty', t: 'Live to 80', ok: () => S.age >= 80, prog: () => [S.age, 80] },
    { id: 'give', t: 'Give $50,000 to charity', ok: () => ((S.tally && S.tally.donated) || 0) >= 50e3 },
    { id: 'fit', t: 'Reach 90% health as an adult', ok: () => S.age >= 18 && S.stats.health >= 90 },
    { id: 'invest', t: 'Build $250,000 in investments', ok: () => liquidInv() >= 250e3 },
    { id: 'grand', t: 'Become a grandparent', ok: () => S.people.some(p => ['Grandson', 'Granddaughter'].includes(p.rel)) },
  ];
  const closeFriends = () => S.people.filter(p => p.alive && p.rel === 'Friend' && p.bond >= 60).length;
  const goalDef = id => GOALS.find(g => g.id === id);
  const safe = fn => { try { return fn(); } catch (e) { return false; } };
  function pickGoals() {
    const pool = GOALS.filter(g => !safe(g.ok)).sort(() => Math.random() - 0.5);
    S.goals = pool.slice(0, 3).map(g => ({ id: g.id, done: null }));
  }
  function checkGoals() {
    if (!S.goals) return;
    S.goals.forEach(g => {
      const d = goalDef(g.id); if (g.done != null || !d || !safe(d.ok)) return;
      g.done = S.age; st('happy', 8);
      const t = `Life goal complete: ${d.t}.`; L(t, 'good'); (S.hl || (S.hl = [])).push({ a: S.age, t, c: 'good' }); toast(t);
    });
    if (S.goals.length && S.goals.every(g => g.done != null) && !S.flags.goalsAll) {
      S.flags.goalsAll = S.age; st('happy', 10); kar(3);
      L('I have done everything I set out to do with my life.', 'good');
    }
  }
  function goalRows() {
    const gs = (S.goals || []).filter(g => goalDef(g.id));
    if (!gs.length) return '<p class="sub">No goals in this life.</p>';
    return `<div class="goals">${gs.map(g => {
      const d = goalDef(g.id), done = g.done != null; let pr = '';
      if (!done && d.prog) { const p = safe(d.prog); if (p) pr = `${Math.min(p[0], p[1])} / ${p[1]}`; }
      return `<div class="goal${done ? ' done' : ''}"><i>${done ? '✓' : ''}</i><span>${d.t}</span><small>${done ? 'Age ' + g.done : pr}</small></div>`;
    }).join('')}</div>`;
  }
  LEG.ACH.push(['dreamer', 'Dream Chaser', 'Complete all three life goals in one life.', () => !!S.goals && S.goals.length > 0 && S.goals.every(g => g.done != null)]);

  /* ---------- net worth history ---------- */
  function chart(h) {
    h = h || []; if (h.length < 2) return '<p class="sub" style="margin:4px 2px">Your net worth chart starts after your first year.</p>';
    const w = 320, ht = 84, ns = h.map(p => p.n), lo = Math.min(0, ...ns), top = Math.max(...ns), hi = Math.max(1, top);
    const x = i => i / (h.length - 1) * w, y = v => ht - 4 - (v - lo) / (hi - lo) * (ht - 8);
    const pts = h.map((p, i) => `${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join(' '), zero = y(0).toFixed(1);
    return `<div class="nwc"><svg viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" role="img" aria-label="Net worth over time"><polygon class="nwa" points="0,${zero} ${pts} ${w},${zero}"/>${lo < 0 ? `<line class="nwz" x1="0" x2="${w}" y1="${zero}" y2="${zero}"/>` : ''}<polyline class="nwl" points="${pts}"/></svg>` +
      `<div class="nwx"><span>Age ${h[0].a}</span><span>Peak ${fmt(top)}</span><span>Age ${h[h.length - 1].a}</span></div></div>`;
  }

  /* ---------- hero chips ---------- */
  const ECON = {
    expansion: ['Growing', '', 'The economy is growing steadily. A normal year for jobs, businesses and investments.'],
    boom: ['Booming', 'good', 'Boom times. Investments and businesses do well, but a crash is more likely to follow.'],
    recession: ['Recession', 'bad', 'Recession. Layoffs are far more likely and businesses earn less. Bonds and gold hold up better.'],
    crash: ['Crash', 'bad', 'The market has crashed. Stocks and crypto are down hard, and jobs are at risk. Prices are low if you have cash.'],
  };
  function chips() {
    if (!S) return '';
    const left = Math.max(0, RULES.timeLeft()), tot = RULES.timeBudget(), eco = ECON[ECO.phase()] || ECON.expansion;
    const gs = S.goals || [], gd = gs.filter(g => g.done != null).length;
    let pips = ''; for (let i = 0; i < tot; i++) pips += `<i${i < left ? ' class="f"' : ''}></i>`;
    return `<button type="button" class="chip" data-chip="time" title="Free time left this year">Free time <span class="pips">${pips}</span><b>${left}</b></button>` +
      (gs.length ? `<button type="button" class="chip" data-chip="goals">Goals <b>${gd}/${gs.length}</b></button>` : '') +
      `<button type="button" class="chip" data-chip="karma">Karma <b>${S.karma}%</b></button>` +
      `<button type="button" class="chip ${eco[1]}" data-chip="eco">Economy <b>${eco[0]}</b></button>` +
      `<button type="button" class="chip toggle${keyOnly() ? ' on' : ''}" data-chip="filter" aria-pressed="${keyOnly()}">${keyOnly() ? 'Highlights only' : 'Full journal'}</button>`;
  }
  function side() {
    return `<h2>Life goals</h2>${goalRows()}<h2>Net worth over time</h2><div class="group" style="padding:10px 12px">${chart(S.hist)}</div>`;
  }

  /* ---------- "My life" sheet ---------- */
  function profile() {
    if (!S) return; stack = [];
    sheet('My life', api => {
      api.html(`<div class="tomb"><div class="face${S.alive ? '' : ' dead'}">${face()}</div><h3>${esc(S.name)}</h3><p class="years">Age ${S.age} · ${esc(stage())} · ${esc(S.country)}</p></div>`);
      api.sec('Life goals'); api.html(goalRows());
      api.sec('Net worth over time'); api.html(`<div class="group" style="padding:10px 12px">${chart(S.hist)}</div>`);
      const lv = ECO.living(), pay = S.job ? S.job.salary : S.sp && S.sp.salary ? S.sp.salary : S.flags.pension || 0;
      const rows = [['Net worth', fmt(netWorth())], ['Cash', fmt(S.money)], ['Pay', pay ? fmt(pay) + '/yr' : 'None'], ['Living costs', lv.total ? fmt(lv.total) + '/yr' : 'None yet'], ['Taxes last year', fmt(S.yearTax || 0)],
        ['Education', S.edu.degrees.slice(-1)[0] || 'None yet'], ['Relationship', relStatus()], ['Children', kids().length || 'None'],
        ['Karma', S.karma + '%'], ['Reputation', (S.rep == null ? 50 : S.rep) + '%'], ['Fame', S.fame + '%'], ['Followers', fmtN(S.followers)], ['Convictions', S.record],
        ['Economy', (ECON[ECO.phase()] || ECON.expansion)[0]], ['Free time left', `${Math.max(0, RULES.timeLeft())} of ${RULES.timeBudget()}`], ['Generation', S.gen]];
      api.sec('At a glance'); api.html(`<div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${esc(v)}</span>`).join('')}</div>`);
      if ((S.traits || []).length) { api.sec('Traits'); api.html(`<div class="goals">${S.traits.map(t => { const d = LEG.TRAITS[t]; return d ? `<div class="goal trait ${d.good ? 'done' : 'neg'}"><i>${d.good ? '+' : '−'}</i><span><b>${d.name}</b><br>${d.d}</span></div>` : ''; }).join('')}</div>`); }
      if ((S.history || []).length) { api.sec('Family line'); api.html(`<p class="sub">${S.history.map(esc).join(' → ')} → <b>${esc(S.name)}</b></p>`); }
    });
  }

  /* ---------- past lives ---------- */
  const graves = () => store().graves || (store().graves = []);
  function onDeath() {
    const F = S.final || {};
    const g = { id: S.lifeId, name: S.name, born: S.year0, age: S.age, cause: S.cause || '', ribbon: (F.ribbons && F.ribbons[0] && F.ribbons[0][0]) || 'Ordinary',
      nw: Math.round(F.nw != null ? F.nw : netWorth()), gen: S.gen, job: S.job ? S.job.title : S.sp ? spTitle() : stage(), kids: S.people.filter(p => ['Son', 'Daughter'].includes(p.rel)).length,
      goals: `${(S.goals || []).filter(x => x.done != null).length}/${(S.goals || []).length}`, hl: LEG.timeline(6).map(h => ({ a: h.a, t: h.t })) };
    store().graves = [g].concat(graves().filter(x => x.id !== g.id)).slice(0, 40); LEG.persist();
  }
  function pastLives() {
    sheet('Past lives', api => {
      const gs = graves();
      if (!gs.length) { api.sub('Nobody here yet. Every life you finish is remembered on this page.'); return; }
      api.sub(`${gs.length} ${gs.length === 1 ? 'life' : 'lives'} remembered, most recent first.`);
      gs.forEach(g => api.item(esc(g.name), `${esc(g.ribbon)} · ${g.born}–${g.born + g.age} · died at ${g.age}${g.gen > 1 ? ` · generation ${g.gen}` : ''}`, fmt(g.nw), () => sheet(g.name, a => {
        a.html(`<div class="tomb"><h3>${esc(g.name)}</h3><p class="years">${g.born} – ${g.born + g.age} · age ${g.age}</p><span class="ribbon">${esc(g.ribbon)}</span><p class="sub">${esc(g.cause)}</p></div>` +
          `<div class="kv"><span>Final net worth</span><span>${fmt(g.nw)}</span><span>Last role</span><span>${esc(g.job)}</span><span>Children</span><span>${g.kids}</span><span>Life goals</span><span>${esc(g.goals)}</span><span>Generation</span><span>${g.gen}</span></div>` +
          ((g.hl || []).length ? `<div class="sec">Life story</div><div class="auclog">${g.hl.map(h => `<p style="font-weight:600;color:var(--ink)"><b>Age ${h.a}:</b> ${esc(h.t)}</p>`).join('')}</div>` : ''));
      }), false, ['book', 'purple']));
    });
  }

  /* ---------- fast-forward ---------- */
  let skipping = false, stopSkip = false;
  function skip(n) {
    if (skipping || !S || !S.alive) return; skipping = true; stopSkip = false; let i = 0;
    const step = () => {
      if (stopSkip || !S.alive || queue.length || !ov.hidden || i >= n) { skipping = false; return; }
      ageUp(); i++; setTimeout(step, 340);
    };
    step();
  }
  let lpT = null, lpFired = false;
  // Called by the Age button before it ages you: true means "this tap was part of a long-press or stops a fast-forward".
  function swallow() { if (lpFired) { lpFired = false; return true; } if (skipping) { stopSkip = true; return true; } return false; }

  /* ---------- confirmations for things you cannot undo ---------- */
  function sure(title, text, yes, fn, back) {
    return () => popup(title, text, [[yes, () => {
      fn(); if (back && resume && resume.length > 1) resume.pop();
      const y = S.log[S.log.length - 1], l = y && y.lines[y.lines.length - 1]; if (l) toast(l.t);
    }], ['Cancel', null]]);
  }

  /* ---------- blackjack: a real hand, not a coin flip ---------- */
  function blackjack() {
    const B = { phase: 'bet', bet: 0, me: [], dl: [], msg: '', cls: '', doubled: false };
    const card = () => ({ r: R(1, 13), s: P(['♠', '♥', '♦', '♣']) });
    const val = h => { let t = 0, a = 0; h.forEach(c => { if (c.r === 1) { a++; t += 11; } else t += Math.min(10, c.r); }); while (t > 21 && a) { t -= 10; a--; } return t; };
    const lab = c => (({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' })[c.r] || c.r) + c.s;
    const hand = (h, hide) => `<div class="bj-h">${h.map((c, i) => hide && i === 1 ? '<span class="pc back">?</span>' : `<span class="pc${'♥♦'.includes(c.s) ? ' red' : ''}">${lab(c)}</span>`).join('')}</div>`;
    function finish() {
      const me = val(B.me), nat = me === 21 && B.me.length === 2 && !B.doubled, dnat = val(B.dl) === 21 && B.dl.length === 2;
      if (me <= 21 && !nat) while (val(B.dl) < 17) B.dl.push(card());
      const d = val(B.dl); let win;
      if (me > 21) { win = -B.bet; B.msg = `Bust at ${me}. You lose ${fmt(B.bet)}.`; }
      else if (nat && dnat) { win = 0; B.msg = 'Both of you have blackjack. Your bet is returned.'; }
      else if (nat) { win = Math.round(B.bet * 1.5); B.msg = `Blackjack! You win ${fmt(win)}.`; }
      else if (d > 21) { win = B.bet; B.msg = `Dealer busts at ${d}. You win ${fmt(win)}.`; }
      else if (me > d) { win = B.bet; B.msg = `${me} beats ${d}. You win ${fmt(win)}.`; }
      else if (me === d) { win = 0; B.msg = `Push at ${me}. Your bet is returned.`; }
      else { win = -B.bet; B.msg = `Dealer's ${d} beats your ${me}. You lose ${fmt(B.bet)}.`; }
      S.money += win; B.cls = win > 0 ? 'up' : win < 0 ? 'down' : ''; B.phase = 'done';
      L(win > 0 ? `Casino: I won ${fmt(win)} at blackjack.` : win < 0 ? `Casino: I lost ${fmt(-win)} at blackjack.` : 'Casino: I pushed a hand of blackjack.', win > 0 ? 'good' : win < 0 ? 'bad' : '');
      render(); save();
    }
    function deal(b) {
      if (S.money < b) { toast(`You need ${fmt(b)} in cash to place that bet.`); return; }
      B.bet = b; B.me = [card(), card()]; B.dl = [card(), card()]; B.msg = ''; B.cls = ''; B.doubled = false; B.phase = 'play';
      if (val(B.me) === 21) finish(); refresh();
    }
    sheet('Blackjack', api => {
      api.sub(`You have ${fmt(S.money)}. Get closer to 21 than the dealer without going over. Blackjack pays 3 to 2, and the dealer draws to 17.`);
      if (B.phase === 'bet') { [100, 1e3, 1e4, 1e5, 1e6].forEach(b => api.item(`Bet ${fmt(b)}`, '', null, () => deal(b), S.money < b, ['dice', 'purple'])); return; }
      api.html(`<div class="bj"><small>Dealer${B.phase === 'play' ? '' : ' · ' + val(B.dl)}</small>${hand(B.dl, B.phase === 'play')}<small>You · ${val(B.me)}</small>${hand(B.me)}<p class="bj-msg ${B.cls}">${B.msg || `Your bet: ${fmt(B.bet)}`}</p></div>`);
      if (B.phase === 'play') {
        api.item('Hit', 'Take another card', null, () => { B.me.push(card()); if (val(B.me) >= 21) finish(); refresh(); }, false, ['plus', 'green']);
        api.item('Stand', 'Keep what you have', null, () => { finish(); refresh(); }, false, ['lock', 'blue']);
        if (B.me.length === 2) api.item('Double down', 'Double your bet, take exactly one more card', fmt(B.bet * 2), () => { B.bet *= 2; B.doubled = true; B.me.push(card()); finish(); refresh(); }, S.money < B.bet * 2, ['coin', 'gold']);
      } else {
        api.item('Deal again', `Same bet: ${fmt(B.bet)}`, null, () => deal(B.bet), S.money < B.bet, ['dice', 'purple']);
        api.item('Change your bet', '', null, () => { B.phase = 'bet'; refresh(); }, false, ['coin', 'gold']);
      }
    });
  }

  /* ---------- backup and restore ---------- */
  function backupMenu() {
    sheet('Backup & restore', api => {
      api.sub('Your game is saved in this browser only. Download a backup to keep it safe or to move it to another device.');
      api.item('Download a backup', 'This life, your achievements and your past lives', null, () => {
        try {
          const data = JSON.stringify({ app: 'lifetimes', v: 1, at: Date.now(), save: { S, nextId }, meta: store() });
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
          a.download = `lifetimes-${S.name.replace(/\W+/g, '-').toLowerCase()}-age-${S.age}.json`; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Backup downloaded.');
        } catch (e) { toast('A backup could not be created in this browser.'); }
      }, false, ['box', 'green']);
      api.item('Restore from a backup', 'Replaces the game you have now', null, () => inp.click(), false, ['box', 'orange']);
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json'; inp.hidden = true;
      inp.onchange = () => {
        const f = inp.files && inp.files[0]; if (!f) return; const rd = new FileReader();
        rd.onload = () => {
          let d = null; try { d = JSON.parse(rd.result); } catch (e) { }
          if (!d || d.app !== 'lifetimes' || !d.save || !d.save.S || !d.save.S.name || !d.save.S.stats) { toast('That file is not a Lifetimes backup.'); return; }
          const m = store(); Object.keys(m).forEach(k => delete m[k]); Object.assign(m, d.meta || {});
          m.ach = m.ach || {}; m.challenges = m.challenges || {}; m.best = m.best || { nw: 0, age: 0 }; LEG.persist(); applyTheme();
          S = d.save.S; nextId = d.save.nextId || 99999; migrate(); queue = []; resume = null; afterQ = []; close();
          if (!S.alive) deathScreen(); toast(`Backup restored. Welcome back, ${S.name.split(' ')[0]}.`);
        };
        rd.readAsText(f);
      };
      api.el(inp);
    });
  }

  /* ---------- menu entries ---------- */
  function menuTop(api) {
    api.item('My life', 'Life goals, net worth chart and everything at a glance', null, profile, false, ['smile', 'blue']);
    api.item('Fast-forward 5 years', 'Stops as soon as something needs your decision. You can also hold the +1 button.', null, () => { close(); skip(5); }, !S.alive, ['clock', 'orange']);
  }
  function menu(api) {
    api.item('Past lives', `${graves().length} remembered`, null, pastLives, false, ['book', 'purple']);
    api.item('Appearance', `Theme: ${{ auto: 'matches your device', light: 'light', dark: 'dark' }[store().theme || 'auto']}`, null, themeMenu, false, ['brush', 'teal']);
    api.item('Backup & restore', 'Save your game to a file, or load one', null, backupMenu, false, ['box', 'blue']);
  }

  /* ---------- life cycle hooks ---------- */
  function migrate() {
    if (!S.lifeId) S.lifeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    if (!S.hist) S.hist = [{ a: S.age, n: Math.round(netWorth()) }];
    if (!S.goals) pickGoals();
  }
  function year() {
    S.hist.push({ a: S.age, n: Math.round(netWorth()) }); if (S.hist.length > 150) S.hist.shift();
    checkGoals();
  }
  function deathExtra() {
    return `<div class="sec">Life goals</div>${goalRows()}<div class="sec">Net worth over time</div><div class="group" style="padding:10px 12px">${chart(S.hist)}</div>`;
  }
  function welcome() {
    popup('Welcome to Lifetimes', `You have just been born as <b>${esc(S.name)}</b> in ${esc(S.country)}. Press the big <b>+1</b> button to live a year, and use the four tabs to shape your career, money, relationships and free time. Tap your portrait any time to see your life goals.`, [
      ['Start with this life', null],
      ['Create my own character', () => then(() => newLifeMenu())],
    ]);
  }

  /* ---------- wiring that does not depend on the main script ---------- */
  applyTheme();
  const chipBox = el('#chips');
  if (chipBox) chipBox.addEventListener('click', e => {
    const b = e.target.closest('[data-chip]'); if (!b || !S) return; const k = b.dataset.chip;
    if (k === 'filter') { store().journal = keyOnly() ? 'all' : 'key'; LEG.persist(); render(); toast(keyOnly() ? 'Showing only the moments that mattered in past years.' : 'Showing everything in the journal.'); }
    else if (k === 'goals') profile();
    else if (k === 'time') { if (S.alive) { stack = []; actMenu(); } }
    else if (k === 'karma') toast(`Karma ${S.karma}%. Kind choices raise it, crime and cruelty lower it. Low karma gets you sued and hurts you in court.`);
    else if (k === 'eco') toast((ECON[ECO.phase()] || ECON.expansion)[2]);
  });
  ['.portrait', '.who'].forEach(s => { const n = el(s); if (!n) return; n.classList.add('tap'); n.setAttribute('role', 'button'); n.setAttribute('tabindex', '0'); n.setAttribute('aria-label', 'Open My life');
    n.addEventListener('click', profile); n.addEventListener('keydown', e => { if (e.key === 'Enter') profile(); }); });
  const ab = el('#tAge');
  if (ab) {
    ab.title = 'Age one year. Hold to fast-forward.';
    ab.addEventListener('pointerdown', () => { lpFired = false; clearTimeout(lpT); lpT = setTimeout(() => { if (!S || !S.alive || queue.length) return; lpFired = true; toast('Fast-forwarding. Tap +1 to stop.'); skip(5); }, 600); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => ab.addEventListener(t, () => clearTimeout(lpT)));
    ab.addEventListener('contextmenu', e => e.preventDefault());
  }
  document.addEventListener('keydown', e => {
    if (!S || !ov.hidden || e.ctrlKey || e.metaKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
    const id = { 1: '#tJob', 2: '#tAssets', 3: '#tPeople', 4: '#tDo', m: '#bMenu', M: '#bMenu' }[e.key];
    if (id) { const b = el(id); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
  });

  return { applyTheme, lines, chips, side, profile, onDeath, pastLives, skip, swallow, sure, blackjack, menuTop, menu, migrate, year, deathExtra, welcome, chart, goalRows, GOALS };
})();
