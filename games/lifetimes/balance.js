/* Lifetimes: balance configuration.
   Every economic tuning number lives here. Change a value, reload the game.
   Money is in dollars, rates are fractions (0.25 = 25%), probabilities are per year unless noted. */
window.BAL = {

  /* ---------- taxes ---------- */
  tax: {
    // Progressive income tax. Each pair is [income above this amount, marginal rate on that slice].
    brackets: [[0, 0], [12e3, 0.12], [50e3, 0.22], [120e3, 0.32], [400e3, 0.40], [1e6, 0.45]],
    // Multiplies every tax rate. Countries not listed use "default".
    countryMult: {
      default: 1, 'United States': 1, 'Canada': 1.05, 'United Kingdom': 1.05, 'Ireland': 1.05, 'Australia': 1.05,
      'Germany': 1.1, 'France': 1.15, 'Italy': 1.1, 'Spain': 1.05, 'Sweden': 1.25, 'Japan': 1.05, 'South Korea': 1,
      'India': 0.85, 'Brazil': 0.9, 'Mexico': 0.85, 'Nigeria': 0.8, 'Singapore': 0.6, 'United Arab Emirates': 0.15,
      // fictional kingdoms (royal lives)
      'Valdoria': 0.7, 'Kestrelmark': 0.7, 'Aurenne': 0.7, 'Thornvale': 0.7, 'the Isles of Morrow': 0.7,
    },
    corporate: 0.21,          // on business profits, before your share
    capitalGains: 0.20,       // on profit when you sell stocks, crypto, gold, property, art, businesses
    propertyRate: 0.009,      // yearly, on the value of every home you own
    inheritance: { exempt: 2e6, rate: 0.40 }, // also used for lifetime gifts to heirs
  },

  /* ---------- the economy: market cycle ---------- */
  cycle: {
    expansion: { ret: 0.08, next: { expansion: 0.76, boom: 0.12, recession: 0.10, crash: 0.02 } },
    boom:      { ret: 0.20, next: { boom: 0.45, expansion: 0.33, crash: 0.12, recession: 0.10 } },
    recession: { ret: -0.07, next: { recession: 0.40, expansion: 0.52, crash: 0.08 } },
    crash:     { ret: -0.32, next: { recession: 0.45, expansion: 0.55 } },
  },
  // How each kind of asset reacts. beta = sensitivity to the cycle, drift = its own yearly trend,
  // vol = random yearly swing, cap = biggest possible yearly gain, floor = biggest possible yearly loss.
  assetClass: {
    index:       { beta: 1.0, drift: 0.015, vol: 0.06, cap: 0.45, floor: -0.45 },
    stock:       { beta: 1.15, drift: 0.01, vol: 0.18, cap: 1.2, floor: -0.7 },
    crypto:      { beta: 1.8, drift: 0.06, vol: 0.5, cap: 2.5, floor: -0.85, delistBelow: 0.03 },
    gold:        { beta: -0.3, drift: 0.05, vol: 0.10, cap: 0.5, floor: -0.3 },
    realEstate:  { beta: 0.45, drift: 0.02, vol: 0.04, cap: 0.3, floor: -0.3 },
    art:         { beta: 0.6, drift: 0.02, vol: 0.18, cap: 0.8, floor: -0.5 },
    business:    { beta: 0.9 },   // business demand moves with the cycle
  },
  // Diminishing returns on very large holdings: only this fraction of a gain applies to the slice above each size.
  sizeDamp: [[0, 1], [10e6, 0.85], [100e6, 0.65], [1e9, 0.45], [10e9, 0.3], [100e9, 0.15]],
  bonds: { gov: 0.035, corp: 0.06, junk: 0.11, corpDefault: 0.02, junkDefault: 0.07, badTimesDefaultMult: 2.5 },

  /* ---------- the cost of living ---------- */
  living: {
    // Yearly household spending by net worth. Values in between are interpolated.
    byNetWorth: [[0, 14e3], [100e3, 22e3], [1e6, 60e3], [10e6, 250e3], [100e6, 1.2e6], [1e9, 7e6], [10e9, 35e6], [100e9, 150e6]],
    ownHomeDiscount: 0.35,   // owning a home cuts household costs by this much (you still pay upkeep and property tax)
    withParents: 2e3,        // under 26, single, no home: live with your parents
    perChild: 9e3,           // per child under 18, grows with your lifestyle
    perChildLifestyle: 0.02, // extra per child as a share of your household spending
    perPet: 500,
    debtInterest: 0.08,      // yearly interest on negative cash
  },
  // Wealthy parents help their children at these ages: a share of the parent's money, up to a cap (gift tax applies).
  familyGifts: { ages: [18, 25], minParentWealth: 5e6, share: 0.05, cap: 5e6 },

  /* ---------- things you own ---------- */
  // g = yearly value change range in %, up = yearly upkeep as a share of value, flat = fixed yearly upkeep.
  // Real estate and art also follow the market cycle (see assetClass). resale = value right after you buy it.
  assets: {
    house:   { l: 'Property', g: [-2, 4], up: 0.01, resale: 0.95, cls: 'realEstate' },
    car:     { l: 'Car', g: [-16, -12], up: 0.02, flat: 800, resale: 0.85 },
    moto:    { l: 'Motorcycle', g: [-15, -10], up: 0.03, flat: 200, resale: 0.85 },
    boat:    { l: 'Boat', g: [-12, -6], up: 0.08, resale: 0.85 },
    air:     { l: 'Aircraft', g: [-10, -5], up: 0.10, resale: 0.88 },
    jewel:   { l: 'Jewelry', g: [-2, 4], resale: 0.6 },
    watch:   { l: 'Watch', g: [-3, 6], resale: 0.7 },
    bag:     { l: 'Fashion', g: [-15, -3], resale: 0.5 },
    tech:    { l: 'Electronics', g: [-30, -18], resale: 0.6 },
    sport:   { l: 'Sports gear', g: [-20, -10], resale: 0.6 },
    instr:   { l: 'Instrument', g: [-6, 3], resale: 0.75 },
    item:    { l: 'Home & hobbies', g: [-25, -12], resale: 0.6 },
    art:     { l: 'Art', g: [-2, 6], resale: 0.8, cls: 'art' },
    collect: { l: 'Collectible', g: [-4, 8], resale: 0.85, cls: 'art' },
    classic: { l: 'Classic car', g: [-4, 8], up: 0.02, resale: 0.9 },
  },
  mortgage: { rate: 0.05, yearlyPayment: 0.08 },
  auctionSale: { fee: 0.10, spread: { volatile: [0.6, 1.5], normal: [0.75, 1.2] } },

  /* ---------- businesses ---------- */
  biz: {
    costRate: [[1e6, 0.45], [5e6, 0.6], [Infinity, 0.75]], // running costs as a share of revenue, by business size
    wageShare: 0.3,              // wages at ideal staffing, as a share of base revenue
    maxScale: 10,                // a business can grow to at most this many times its starting revenue
    portfolioFree: 3,            // you can run this many businesses before overhead kicks in
    portfolioOverhead: 0.02,     // each extra business adds this to every business's running costs
    portfolioOverheadMax: 0.2,   // ...up to this much in total
    loanRate: 0.08,
    valueDecay: 0.85, valueProfitMult: 1.8, // valuation ≈ 12× yearly profit
  },

  /* ---------- random gains and losses, scaled to your wealth ---------- */
  // amount = clamp(pct × liquid wealth, floor, cap). liquid wealth = cash + funds + stocks + bonds + gold.
  events: {
    foundMoney:    { pct: 0,      floor: 5,     cap: 300 },
    radioPrize:    { pct: 0.0005, floor: 250,   cap: 10e3 },
    distantWill:   { pct: 0.02,   floor: 5e3,   cap: 2e6 },
    cryptoPitch:   { pct: 0.05,   floor: 5e3,   cap: 5e6 },
    phoneScam:     { pct: 0.01,   floor: 2e3,   cap: 250e3 },
    identityTheft: { pct: 0.005,  floor: 1e3,   cap: 500e3 },
    taxAudit:      { pct: 0.02,   floor: 2e3,   cap: 20e6 },
    burglary:      { pct: 0.004,  floor: 1e3,   cap: 5e6 },
    lawsuit:       { pct: 0.03,   floor: 10e3,  cap: 500e6 },
    fraud:         { pct: 0.02,   floor: 5e3,   cap: 200e6 },
    medicalBill:   { pct: 0.002,  floor: 0,     cap: 2e6 },
    fine:          { pct: 0.005,  floor: 500,   cap: 20e6 },
    divorceShare:  0.4,          // share of liquid wealth and property a spouse takes
  },
  // Yearly chance of the wealth hazards above. Rises with wealth and fame.
  hazards: { burglary: 0.04, lawsuitPerReason: 0.012, lawsuitWealthWeight: 0.3, lawsuitCap: 0.06, lawsuitCooldown: 8, lawsuitFame: 50, fraud: 0.015, minWealth: 250e3 },

  /* ---------- careers (regular jobs, by field) ---------- */
  // peak = ages when performance holds up best, retire = mandatory retirement age,
  // risk = the hazards of that field, stress = extra stress per year.
  career: {
    rules: {
      'Service & retail':   { peak: [22, 55], retire: 67, risk: ['layoff'], stress: 0 },
      'Trades & industry':  { peak: [24, 48], retire: 62, risk: ['injury', 'layoff'], stress: 1 },
      'Public service':     { peak: [25, 48], retire: 62, risk: ['injury', 'scandal'], stress: 2 },
      'Office & business':  { peak: [30, 56], retire: 68, risk: ['layoff', 'burnout'], stress: 2 },
      'Tech & science':     { peak: [26, 52], retire: 68, risk: ['burnout', 'layoff'], stress: 3 },
      'Health & care':      { peak: [32, 60], retire: 70, risk: ['lawsuit', 'burnout'], stress: 4 },
      'Education & social': { peak: [30, 60], retire: 68, risk: ['burnout'], stress: 2 },
      'Creative & media':   { peak: [25, 52], retire: 70, risk: ['layoff', 'scandal'], stress: 1 },
      'Law & government':   { peak: [38, 66], retire: 75, risk: ['scandal', 'lawsuit'], stress: 3 },
      'Transport':          { peak: [25, 55], retire: 65, risk: ['injury'], stress: 1 },
      'Fame':               { peak: [20, 42], retire: 62, risk: ['scandal'], stress: 2 },
    },
    risk: {
      layoff:  { base: 0.02, recession: 4, crash: 7, severance: 0.25 },   // chance multiplies in bad times
      injury:  { p: 0.04, careerEnding: 0.08 },
      scandal: { p: 0.025, perFame: 0.0006 },
      lawsuit: { p: 0.03, minSalary: 0.3, maxSalary: 1.5 },               // claim as a multiple of yearly salary
      burnoutAt: 85,                                                      // stress level that triggers burnout
    },
    insurance: { cost: 0.02, covers: 0.8 },   // professional insurance: yearly cost as share of salary, share of lawsuits covered
    restingStress: 25, stressRecovery: 0.2,   // each year stress moves this share of the way back to its resting level
    promoteAbove: 66,                         // performance needed to be considered for promotion
    rivalWins: 3,                             // how much a rival improves each time they beat you to a promotion
  },

  /* ---------- free time: every year you only have so many hours ---------- */
  time: {
    base: 12, job: -4, school: -3, perYoungKid: -1, maxKidPenalty: -2, assistant: 2,
    // which actions cost free time, matched against the action's internal key: [pattern, cost]
    costs: [['^work$', 2], ['^trip$', 2],
      ['^(gym|lib|med|run|friend|crime|gang|exp|cast|duel|patrol|robbery|villain|study_m)$', 1],
      ['^(hob|comp|x[A-Z]|m[A-Z]|pet\\d)', 1]],
  },

  /* ---------- stats ---------- */
  stats: {
    softCap: 85, hardCap: 95,     // gains are halved above softCap and quartered above hardCap
    decay: 0.12,                  // each year smarts and looks lose this share of the gap above your natural level
    eduBoost: { hs: 3, uni: 6, grad: 4 },  // education permanently raises your natural smarts
    looksAging: 0.5,              // natural looks lost per year after 40
  },

  /* ---------- high-stakes gambling ---------- */
  highStakes: { winChance: 0.47, shares: [0.1, 0.25, 0.5] },
};
