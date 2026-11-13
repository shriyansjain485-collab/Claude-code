/* Lifetimes: stock & crypto market (game logic only, no screen code).
   Stocks by sector, ETFs, penny stocks, crypto (majors, alts, meme coins, a stablecoin), dividends and staking,
   market news, company events, price history, stop-loss / take-profit orders.
   Uses game globals at call time: S, L, fmt, R, P, ECO, BAL. Tuning numbers live in BAL.market. */
const MKT = (() => {
  // kind: stock | etf | penny | coin | meme | stable.  d = own yearly drift, v = volatility, div = dividend or staking yield.
  const LIST = [
    // tech
    { s: 'BYH', n: 'ByteHarbor', sec: 'Tech', kind: 'stock', p: 140, d: .08, v: .25, about: 'Cloud software and the apps everyone uses at work.' },
    { s: 'NWR', n: 'Northwind Robotics', sec: 'Tech', kind: 'stock', p: 84, d: .07, v: .28, about: 'Warehouse robots and self-driving forklifts.' },
    { s: 'QBT', n: 'Qubitline Computing', sec: 'Tech', kind: 'stock', p: 45, d: .10, v: .55, about: 'Quantum computers. Huge promise, no profits yet.' },
    { s: 'CLDX', n: 'Cloudnest', sec: 'Tech', kind: 'stock', p: 66, d: .06, v: .3, div: .005, about: 'Data centers and web hosting.' },
    // energy
    { s: 'HLO', n: 'Helio Solar', sec: 'Energy', kind: 'stock', p: 31, d: .06, v: .35, about: 'Solar panels and home batteries.' },
    { s: 'PTR', n: 'Petrolux', sec: 'Energy', kind: 'stock', p: 58, d: .015, v: .22, div: .045, about: 'Oil and gas giant. Slow growth, fat dividends.' },
    { s: 'WND', n: 'Gale Wind Power', sec: 'Energy', kind: 'stock', p: 24, d: .045, v: .3, div: .01, about: 'Offshore wind farms.' },
    // health
    { s: 'QTX', n: 'Quantix Bio', sec: 'Health', kind: 'stock', p: 22, d: .05, v: .5, about: 'Gene therapy start-up. Lives or dies by its drug trials.' },
    { s: 'MDC', n: 'Meridian Health', sec: 'Health', kind: 'stock', p: 120, d: .035, v: .14, div: .02, about: 'Hospitals and clinics. Steady as they come.' },
    // finance
    { s: 'SVR', n: 'Silverbridge Bank', sec: 'Finance', kind: 'stock', p: 48, d: .025, v: .22, div: .035, about: 'A big high-street bank.' },
    { s: 'PAYL', n: 'Paylane', sec: 'Finance', kind: 'stock', p: 92, d: .06, v: .3, about: 'Phone payments and online checkout.' },
    // consumer
    { s: 'GRN', n: 'Grainline Foods', sec: 'Consumer', kind: 'stock', p: 56, d: .03, v: .12, div: .03, about: 'Cereal, bread and snacks. People always eat.' },
    { s: 'LUXE', n: 'Maison Lumen', sec: 'Consumer', kind: 'stock', p: 210, d: .05, v: .2, div: .01, about: 'Luxury handbags and perfume.' },
    { s: 'BRW', n: 'Copperkettle Coffee', sec: 'Consumer', kind: 'stock', p: 38, d: .035, v: .18, div: .02, about: 'A coffee chain on every corner.' },
    // industry & travel
    { s: 'VLA', n: 'Vela Airlines', sec: 'Industry', kind: 'stock', p: 18, d: .03, v: .3, about: 'Budget airline. Suffers badly in recessions.' },
    { s: 'IRN', n: 'Ironvale Steel', sec: 'Industry', kind: 'stock', p: 27, d: .015, v: .25, div: .03, about: 'Steel mills and mining.' },
    { s: 'ORB', n: 'Orbitform Space', sec: 'Industry', kind: 'stock', p: 15, d: .09, v: .6, about: 'Reusable rockets and satellite launches.' },
    // entertainment
    { s: 'PXL', n: 'Pixelforge Games', sec: 'Media', kind: 'stock', p: 74, d: .06, v: .32, about: 'Video game studio with one giant hit series.' },
    { s: 'STRM', n: 'Streamwave', sec: 'Media', kind: 'stock', p: 110, d: .05, v: .28, about: 'Streaming films and shows.' },
    // property
    { s: 'HAVN', n: 'Haven Property Trust', sec: 'Property', kind: 'stock', p: 40, d: .005, v: .15, div: .05, about: 'Owns apartment blocks and pays out the rent.' },
    // penny stocks: tiny, wild, can go bust
    { s: 'ZAP', n: 'Zapcell Batteries', sec: 'Penny', kind: 'penny', p: 1.2, d: .08, v: .9, about: 'Claims a battery breakthrough. Nobody has seen it.' },
    { s: 'MOON', n: 'Lunar Mining Co.', sec: 'Penny', kind: 'penny', p: .45, d: .08, v: 1, about: 'Plans to mine the Moon. Has one office in a strip mall.' },
    { s: 'HRB', n: 'Herbwell Wellness', sec: 'Penny', kind: 'penny', p: 2.1, d: .05, v: .8, about: 'Supplements and big promises.' },
    // ETFs: a basket of companies, much calmer
    { s: 'TOTL', n: 'Total Market ETF', sec: 'ETF', kind: 'etf', p: 100, d: .01, v: .06, div: .015, about: 'A slice of every big company. The safest stock bet.' },
    { s: 'TECX', n: 'Tech Sector ETF', sec: 'ETF', kind: 'etf', p: 80, d: .03, v: .12, div: .005, follows: 'Tech', about: 'Every big tech company in one fund.' },
    { s: 'DIVX', n: 'Dividend ETF', sec: 'ETF', kind: 'etf', p: 50, d: .0, v: .07, div: .04, about: 'Companies that pay big, steady dividends.' },
    { s: 'GRNX', n: 'Clean Energy ETF', sec: 'ETF', kind: 'etf', p: 35, d: .03, v: .16, div: .01, follows: 'Energy', about: 'Solar, wind and battery companies.' },
    { s: 'EMKT', n: 'Emerging Markets ETF', sec: 'ETF', kind: 'etf', p: 42, d: .02, v: .14, div: .02, about: 'Fast-growing economies around the world.' },
    // crypto
    { s: 'BLC', n: 'Bloccoin', sec: 'Crypto', kind: 'coin', p: 30000, d: .1, v: .55, about: 'The first and biggest coin.' },
    { s: 'ETR', n: 'Aether', sec: 'Crypto', kind: 'coin', p: 2000, d: .1, v: .65, div: .035, about: 'Runs apps and smart contracts. Pays staking rewards.' },
    { s: 'NMB', n: 'Nimbus Chain', sec: 'Crypto', kind: 'coin', p: 310, d: .12, v: .7, div: .05, about: 'A fast rival chain with staking.' },
    { s: 'SOLR', n: 'Solaris', sec: 'Crypto', kind: 'coin', p: 90, d: .12, v: .8, div: .06, about: 'Cheap and fast. Goes down sometimes.' },
    { s: 'LNK', n: 'Linkwork', sec: 'Crypto', kind: 'coin', p: 14, d: .1, v: .75, about: 'Connects blockchains to real-world data.' },
    { s: 'GLM', n: 'Glimcoin', sec: 'Crypto', kind: 'coin', p: 2.4, d: .12, v: .9, about: 'A small coin with a loyal fan club.' },
    { s: 'USDS', n: 'Steady Dollar', sec: 'Crypto', kind: 'stable', p: 1, d: 0, v: 0, div: .04, about: 'Always worth $1, and pays interest. Unless it breaks.' },
    // meme coins
    { s: 'RBL', n: 'Rubble Token', sec: 'Meme', kind: 'meme', p: .08, d: -.25, v: 1.2, about: 'Started as a joke. Still a joke.' },
    { s: 'DOGO', n: 'Dogo Coin', sec: 'Meme', kind: 'meme', p: .12, d: -.25, v: 1.3, about: 'A dog on a coin. Famous people tweet about it.' },
    { s: 'FROG', n: 'Pondfrog', sec: 'Meme', kind: 'meme', p: .0004, d: -.3, v: 1.6, about: 'A frog. That is the whole plan.' },
  ];
  const BY = Object.fromEntries(LIST.map(m => [m.s, m]));
  const isCrypto = m => ['coin', 'meme', 'stable'].includes(m.kind);
  const SECTORS = ['Tech', 'Energy', 'Health', 'Finance', 'Consumer', 'Industry', 'Media', 'Property', 'Crypto'];
  const lim = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ---------- state ---------- */
  function ensure() {
    if (!S.market) S.market = {}; if (!S.port) S.port = {}; if (!S.portBasis) S.portBasis = {};
    if (!S.mhist) S.mhist = {}; if (!S.orders) S.orders = {}; if (!S.mnews) S.mnews = [];
    LIST.forEach(m => { if (S.market[m.s] == null) S.market[m.s] = m.p; if (!S.mhist[m.s]) S.mhist[m.s] = [S.market[m.s]]; });
  }
  const price = s => { ensure(); return S.market[s]; };
  const held = s => (S.port && S.port[s]) || 0;
  const value = () => { ensure(); return Object.entries(S.port).reduce((a, [k, n]) => a + (n > 0 && S.market[k] != null ? n * S.market[k] : 0), 0); };
  const basis = s => (S.portBasis && S.portBasis[s]) || 0;
  // Change over the last year, as a fraction.
  const change = s => { const h = (S.mhist || {})[s]; return h && h.length > 1 && h[h.length - 2] > 0 ? h[h.length - 1] / h[h.length - 2] - 1 : 0; };
  function fmtPrice(p) { return p >= 1 ? fmt(p < 1e4 ? Math.round(p * 100) / 100 : p) : '$' + (p >= 0.01 ? p.toFixed(4) : p.toPrecision(3)); }

  /* ---------- trading ---------- */
  function buy(s, amount) {
    ensure(); const m = BY[s]; amount = Math.floor(amount);
    if (!m || amount <= 0 || S.money < amount) return false;
    const fee = Math.round(amount * BAL.market.fee);
    S.money -= amount; S.port[s] = held(s) + (amount - fee) / S.market[s]; S.portBasis[s] = basis(s) + amount;
    L(`I bought ${fmt(amount)} of ${m.n} (${m.s}).`); return true;
  }
  function sell(s, frac, why) {
    ensure(); const m = BY[s], n = held(s); if (!m || n <= 0) return 0;
    const sh = frac >= 1 ? n : n * frac, gross = Math.round(sh * S.market[s]), fee = Math.round(gross * BAL.market.fee), b = basis(s) * (sh / n);
    S.port[s] = n - sh; S.portBasis[s] = basis(s) - b; if (frac >= 1) { S.port[s] = 0; S.portBasis[s] = 0; delete S.orders[s]; }
    S.money += gross - fee;
    const pnl = gross - fee - b;
    L(`${why ? why + ' ' : ''}I sold ${frac >= 1 ? 'all my' : Math.round(frac * 100) + '% of my'} ${m.n} for ${fmt(gross - fee)} (${pnl >= 0 ? 'a profit of ' + fmt(pnl) : 'a loss of ' + fmt(-pnl)}).`, pnl >= 0 ? 'good' : 'bad');
    ECO.capGains(pnl, m.n); return gross - fee;
  }
  function setOrder(s, o) { ensure(); if (!o || (!o.tp && !o.sl)) delete S.orders[s]; else S.orders[s] = o; }

  /* ---------- day trading: quick in-and-out trades, smarter players do better ---------- */
  function dayTrade(stake) {
    if (S.money < stake) return null;
    const edge = (S.stats.smarts - 55) / 600 + (S.job && /Analyst|Trader|Fund|Banker|Quant/i.test(S.job.title) ? 0.02 : 0);
    const r = lim(edge + ECO.gauss() * BAL.market.dayTradeVol, -0.6, 0.8), g = Math.round(stake * r);
    S.money += g; if (g > 0) S.taxable = (S.taxable || 0) + g;
    L(g >= 0 ? `I day traded ${fmt(stake)} and made ${fmt(g)}.` : `I day traded ${fmt(stake)} and lost ${fmt(-g)}.`, g >= 0 ? 'good' : 'bad');
    return g;
  }

  /* ---------- news ---------- */
  const NEWS = {
    Tech: [['A new AI craze sends tech shares soaring.', .25], ['Chip shortage: tech companies cannot ship enough products.', -.18], ['Governments crack down on big tech.', -.15], ['Record profits across the tech industry.', .15]],
    Energy: [['Oil prices spike after a supply shock.', .22], ['An oil glut sends energy prices tumbling.', -.2], ['Huge clean-energy subsidies are passed into law.', .2], ['A mild winter cuts demand for energy.', -.1]],
    Health: [['A wave of drug approvals lifts health stocks.', .18], ['New price caps on medicines squeeze drug makers.', -.15], ['An aging population drives demand for healthcare.', .1]],
    Finance: [['Interest rates rise and bank profits jump.', .14], ['A banking scare spreads fear through the financial sector.', -.25], ['Mobile payments go mainstream.', .15]],
    Consumer: [['Shoppers are spending freely this year.', .12], ['Prices rise fast and shoppers cut back.', -.12], ['Luxury goods are in fashion again.', .15]],
    Industry: [['A travel boom fills every flight.', .2], ['Fuel costs ground airline profits.', -.2], ['A big infrastructure plan boosts steel and construction.', .16], ['A rocket explodes on the launch pad.', -.15]],
    Media: [['A streaming price war hurts media companies.', -.15], ['A record year for games and films.', .18]],
    Property: [['Rents climb across the country.', .1], ['Rising interest rates cool the property market.', -.12]],
    Crypto: [['Crypto mania: everyone is buying coins.', .6], ['Crypto winter sets in. Coins lose most of their value.', -.5], ['A major crypto exchange collapses and customers lose their deposits.', -.35], ['A big country makes Bloccoin legal tender.', .4], ['Regulators crack down on crypto trading.', -.25], ['Bloccoin halving: new coins get scarcer.', .3]],
  };
  function headline(t, sec) {
    S.mnews = [{ a: S.age, t, sec }].concat(S.mnews || []).slice(0, 10);
    const mine = LIST.filter(m => held(m.s) > 0 && (m.sec === sec || m.follows === sec || (sec === 'Crypto' && m.kind === 'meme')));
    if (mine.length) L(`Market news: ${t}`, '');
  }

  /* ---------- one year of the market ---------- */
  function year() {
    ensure(); const K = BAL.market;
    // 1. sector shocks
    const shock = {};
    SECTORS.forEach(sec => {
      if (Math.random() >= (sec === 'Crypto' ? K.cryptoNews : K.sectorNews)) return;
      const [t, x] = P(NEWS[sec]); shock[sec] = x * (0.7 + Math.random() * 0.6); headline(t, sec);
    });
    let div = 0, stake = 0;
    LIST.forEach(m => {
      const old = S.market[m.s], n = held(m.s);
      // 2. price move
      let r;
      if (m.kind === 'stable') {
        r = 0;
        if (Math.random() < K.stableBreak) { r = -(0.3 + Math.random() * 0.6); headline(`${m.n} lost its link to the dollar and crashed.`, 'Crypto'); }
      } else {
        const cls = isCrypto(m) ? 'crypto' : 'stock';
        r = ECO.ret(cls, m.d * BAL.market.driftShare, m.v / (isCrypto(m) ? 0.9 : 0.3));
        r += shock[m.follows || m.sec] || 0;
        if (m.kind === 'meme') r += shock.Crypto ? shock.Crypto * 0.5 : 0;
        if (m.kind === 'etf') r = ECO.ret('index', m.d * BAL.market.driftShare, m.v / 0.06) + (shock[m.follows] || 0) * 0.6;
        // 3. company events
        if (m.kind === 'stock' || m.kind === 'penny') {
          const e = Math.random();
          if (e < K.companyEvent) {
            const ev = P([['beat its earnings forecast by a mile', .15, .3], ['missed its earnings forecast badly', -.3, -.15], ['was hit by an accounting scandal', -.5, -.25], ['launched a hit new product', .15, .4], ['got a takeover offer at a big premium', .25, .5], ['lost a major lawsuit', -.3, -.1]]);
            const x = ev[1] + Math.random() * (ev[2] - ev[1]); r += x;
            headline(`${m.n} ${ev[0]}.`, m.sec);
          }
        }
        if (m.kind === 'meme' && Math.random() < K.memePump) { const x = 1 + Math.random() * 4; r += x; headline(`${m.n} went viral and shot up ${Math.round(x * 100)}%.`, 'Crypto'); }
        if (m.kind === 'coin' && Math.random() < K.hack) { r -= 0.3 + Math.random() * 0.3; headline(`Hackers exploited a flaw in ${m.n}.`, 'Crypto'); }
      }
      const cap = isCrypto(m) ? 8 : 3;
      r = lim(r, -0.95, cap);
      let np = old * (1 + r);
      // 4. collapse: penny stocks go bust, coins get delisted, then a new listing takes their slot at the starting price
      // only small coins, meme coins and penny stocks can vanish; big coins and companies just fall a long way
      const dead = (m.kind === 'penny' || m.kind === 'meme' || (m.kind === 'coin' && m.p < 50)) && np < m.p * BAL.assetClass.crypto.delistBelow;
      if (!dead && np < m.p * 0.01) np = m.p * 0.01;
      if (dead) {
        const v = n * old; if (n > 0) L(`${m.n} ${m.kind === 'penny' ? 'went bankrupt' : 'collapsed and was delisted'}. My ${fmt(v)} stake is gone.`, 'bad');
        headline(`${m.n} ${m.kind === 'penny' ? 'went bankrupt' : 'collapsed'} and relisted as a new company.`, m.kind === 'penny' ? 'Penny' : 'Crypto');
        S.port[m.s] = 0; S.portBasis[m.s] = 0; delete S.orders[m.s]; S.market[m.s] = m.p; S.mhist[m.s] = [m.p]; return;
      }
      S.market[m.s] = +np.toPrecision(6);
      // big holdings grow a little slower (same rule as the rest of the game)
      if (n > 0 && r > 0) { const v = n * old, want = v + ECO.gain(v, r); S.port[m.s] = want / S.market[m.s]; }
      const h = S.mhist[m.s]; h.push(S.market[m.s]); if (h.length > K.history) h.shift();
      // 5. dividends and staking
      if (n > 0 && m.div) {
        const pay = Math.round(S.port[m.s] * S.market[m.s] * m.div);
        if (pay > 0) {
          if (S.flags.drip) { const add = pay / S.market[m.s]; S.port[m.s] += add; S.portBasis[m.s] = basis(m.s) + pay; S.taxable = (S.taxable || 0) + pay; }
          else ECO.earn(pay);
          if (isCrypto(m)) stake += pay; else div += pay;
        }
      }
    });
    if (div) L(`My stocks paid ${fmt(div)} in dividends${S.flags.drip ? ', reinvested' : ''}.`, 'good');
    if (stake) L(`My crypto earned ${fmt(stake)} in staking rewards${S.flags.drip ? ', reinvested' : ''}.`, 'good');
    // 6. stop-loss and take-profit orders
    Object.entries(S.orders).forEach(([s, o]) => {
      const n = held(s); if (!(n > 0) || !BY[s]) { delete S.orders[s]; return; }
      const avg = basis(s) / n, p = S.market[s];
      if (o.tp && p >= avg * o.tp) sell(s, 1, `My take-profit order triggered.`);
      else if (o.sl && p <= avg * o.sl) sell(s, 1, `My stop-loss order triggered.`);
    });
    const v = value(); if (v > 0) L(`My stocks and crypto are worth ${fmt(v)}.`);
  }

  /* ---------- portfolio summary ---------- */
  function summary() {
    ensure(); const rows = LIST.filter(m => held(m.s) > 0).map(m => ({ m, v: held(m.s) * S.market[m.s], b: basis(m.s) }));
    const v = rows.reduce((a, r) => a + r.v, 0), b = rows.reduce((a, r) => a + r.b, 0);
    const bySec = {}; rows.forEach(r => { const k = isCrypto(r.m) ? 'Crypto' : r.m.sec; bySec[k] = (bySec[k] || 0) + r.v; });
    const yieldY = rows.reduce((a, r) => a + r.v * (r.m.div || 0), 0);
    return { rows, value: v, basis: b, gain: v - b, bySec, yieldY };
  }
  function migrate() {
    ensure();
    // older saves: drop holdings in tickers that no longer exist
    Object.keys(S.port).forEach(k => { if (!BY[k]) { delete S.port[k]; delete S.portBasis[k]; } });
  }

  return { LIST, BY, SECTORS, isCrypto, ensure, price, held, value, basis, change, fmtPrice, buy, sell, setOrder, dayTrade, year, summary, migrate };
})();
