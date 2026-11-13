/* Lifetimes: number formatting (shared by the whole game).
   money(1234567) -> "$1.2M", num(12345678) -> "12.3M". Values of 10,000 or more carry their exact figure
   in a hidden marker so the screen can show the full amount on hover or tap (see FMT.full / FMT.plain). */
const FMT = (() => {
  const A = '', B = '';
  const UNITS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e4, 'K', 1e3]];
  function short(n) {
    const a = Math.abs(n);
    for (const [min, s, div] of UNITS) if (a >= min) return (a / (div || min)).toFixed(1) + s;
    return Math.round(a).toLocaleString('en-US');
  }
  const tag = (s, n) => Math.abs(n) >= 1e4 ? s + A + n + B : s;
  function money(n) { n = Math.round(+n || 0); return tag((n < 0 ? '-' : '') + '$' + short(n), n); }
  function num(n) { n = Math.round(+n || 0); return tag((n < 0 ? '-' : '') + short(n), n); }
  function full(n, isMoney) { n = Math.round(+n || 0); return (n < 0 ? '-' : '') + (isMoney ? '$' : '') + Math.abs(n).toLocaleString('en-US'); }
  const RE = /(-?\$?[\d.,]+[KMBT]?)(-?\d+)/g;
  const plain = s => String(s).replace(RE, '$1');                                      // "$1.2M"
  const fullText = s => String(s).replace(RE, (m, a, n) => full(+n, a.includes('$'))); // "$1,234,567"
  // Total of the first amount in a piece of text (used to merge repeated log lines).
  function firstAmount(s) {
    const m = String(s).match(/(-?\$?[\d.,]+[KMBT]?)(-?\d+)/);
    if (m) return { value: +m[2], money: m[1].includes('$'), text: m[0] };
    const p = String(s).match(/-?\$[\d,]+/); if (p) return { value: +p[0].replace(/[$,]/g, ''), money: true, text: p[0] };
    return null;
  }
  return { money, num, full, plain, fullText, firstAmount, RE, short };
})();
