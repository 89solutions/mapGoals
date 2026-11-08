/*
 * Units: definitions, parsing of user input ("£3.52", "52p", "2st 5lb", "€4,50"),
 * conversion between compatible units, and display formatting.
 * Pure – no DOM. Works as a browser global (window.MapGoalsUnits) and as a CommonJS module.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MapGoalsUnits = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // factor = size of one unit in the category's base unit (weight: kg, distance: km, time: hours).
  // Currencies convert via exchange rates instead of fixed factors.
  const UNITS = {
    lb: { category: 'weight', label: 'Pounds (lbs)', short: 'lbs', singular: 'lb', factor: 0.45359237, decimals: 2 },
    kg: { category: 'weight', label: 'Kilograms (kg)', short: 'kg', factor: 1, decimals: 2 },
    st: { category: 'weight', label: 'Stones (st)', short: 'st', factor: 6.35029318, decimals: 2 },
    g: { category: 'weight', label: 'Grams (g)', short: 'g', factor: 0.001, decimals: 0 },
    oz: { category: 'weight', label: 'Ounces (oz)', short: 'oz', factor: 0.028349523125, decimals: 1 },

    GBP: { category: 'currency', label: 'Pounds Sterling (£)', currency: 'GBP', decimals: 2 },
    USD: { category: 'currency', label: 'US Dollars ($)', currency: 'USD', decimals: 2 },
    EUR: { category: 'currency', label: 'Euros (€)', currency: 'EUR', decimals: 2 },
    CAD: { category: 'currency', label: 'Canadian Dollars (C$)', currency: 'CAD', decimals: 2 },
    AUD: { category: 'currency', label: 'Australian Dollars (A$)', currency: 'AUD', decimals: 2 },
    JPY: { category: 'currency', label: 'Japanese Yen (¥)', currency: 'JPY', decimals: 0 },

    mi: { category: 'distance', label: 'Miles', short: 'miles', singular: 'mile', factor: 1.609344, decimals: 2 },
    km: { category: 'distance', label: 'Kilometres (km)', short: 'km', factor: 1, decimals: 2 },

    h: { category: 'time', label: 'Hours', short: 'hours', singular: 'hour', factor: 1, decimals: 2 },
    min: { category: 'time', label: 'Minutes', short: 'mins', singular: 'min', factor: 1 / 60, decimals: 0 },

    custom: { category: 'custom', label: 'Other (type your own)…', decimals: 2 },
  };

  const CATEGORIES = [
    { id: 'weight', label: 'Weight' },
    { id: 'currency', label: 'Money' },
    { id: 'distance', label: 'Distance' },
    { id: 'time', label: 'Time' },
    { id: 'custom', label: 'Other' },
  ];

  // Approximate EUR-based rates, used only when live rates can't be fetched.
  const FALLBACK_RATES = { EUR: 1, GBP: 0.87, USD: 1.16, CAD: 1.62, AUD: 1.77, JPY: 176 };

  // Words/symbols the user may type. Some are ambiguous ("pounds" = lb or GBP); the
  // candidate matching the expected category wins. `scale` handles minor units (52p = £0.52).
  const ALIASES = {
    lb: ['lb'], lbs: ['lb'], pound: ['lb', 'GBP'], pounds: ['lb', 'GBP'],
    kg: ['kg'], kgs: ['kg'], kilo: ['kg'], kilos: ['kg'], kilogram: ['kg'], kilograms: ['kg'],
    st: ['st'], stone: ['st'], stones: ['st'],
    g: ['g'], gram: ['g'], grams: ['g'],
    oz: ['oz'], ounce: ['oz'], ounces: ['oz'],
    '£': ['GBP'], gbp: ['GBP'], quid: ['GBP'], sterling: ['GBP'],
    p: [{ unit: 'GBP', scale: 0.01 }], pence: [{ unit: 'GBP', scale: 0.01 }], penny: [{ unit: 'GBP', scale: 0.01 }],
    $: ['USD', 'CAD', 'AUD'], usd: ['USD'], 'us$': ['USD'], dollar: ['USD', 'CAD', 'AUD'], dollars: ['USD', 'CAD', 'AUD'],
    c: [{ unit: 'USD', scale: 0.01 }, { unit: 'EUR', scale: 0.01 }, { unit: 'CAD', scale: 0.01 }, { unit: 'AUD', scale: 0.01 }],
    cent: [{ unit: 'USD', scale: 0.01 }, { unit: 'EUR', scale: 0.01 }, { unit: 'CAD', scale: 0.01 }, { unit: 'AUD', scale: 0.01 }],
    cents: [{ unit: 'USD', scale: 0.01 }, { unit: 'EUR', scale: 0.01 }, { unit: 'CAD', scale: 0.01 }, { unit: 'AUD', scale: 0.01 }],
    '€': ['EUR'], eur: ['EUR'], euro: ['EUR'], euros: ['EUR'],
    'c$': ['CAD'], cad: ['CAD'], 'a$': ['AUD'], aud: ['AUD'],
    '¥': ['JPY'], jpy: ['JPY'], yen: ['JPY'],
    mi: ['mi'], mile: ['mi'], miles: ['mi'],
    km: ['km'], kms: ['km'], kilometre: ['km'], kilometres: ['km'], kilometer: ['km'], kilometers: ['km'],
    h: ['h'], hr: ['h'], hrs: ['h'], hour: ['h'], hours: ['h'],
    m: ['min'], min: ['min'], mins: ['min'], minute: ['min'], minutes: ['min'],
  };

  const PREFIX_SYMBOLS = ['us$', 'c$', 'a$', '£', '$', '€', '¥'];

  function getUnit(id) {
    return UNITS[id] || UNITS.custom;
  }

  function categoryOf(id) {
    return getUnit(id).category;
  }

  /** Units an entry can be logged in, given the goal's unit. */
  function compatibleUnits(goalUnitId) {
    const cat = categoryOf(goalUnitId);
    if (cat === 'custom') return ['custom'];
    return Object.keys(UNITS).filter((id) => UNITS[id].category === cat);
  }

  /** Map legacy free-text units (from v1 saved data) onto unit ids. */
  function unitIdFromText(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    if (UNITS[t.toUpperCase()] && UNITS[t.toUpperCase()].category === 'currency') return t.toUpperCase();
    if (UNITS[t] && t !== 'custom') return t;
    const cands = ALIASES[t];
    if (!cands) return null;
    const first = cands[0];
    return typeof first === 'string' ? first : null;
  }

  // ------------------------------------------------------------ conversion ---

  /**
   * Convert `value` from one unit to another. Returns null if they aren't compatible
   * (e.g. kg → £) or a currency rate is missing. `rates` are relative to one base currency.
   */
  function convert(value, fromId, toId, rates) {
    if (fromId === toId) return value;
    const from = UNITS[fromId];
    const to = UNITS[toId];
    if (!from || !to || from.category !== to.category || from.category === 'custom') return null;
    if (from.category === 'currency') {
      const r = rates || FALLBACK_RATES;
      if (!(r[from.currency] > 0) || !(r[to.currency] > 0)) return null;
      return (value / r[from.currency]) * r[to.currency];
    }
    return (value * from.factor) / to.factor;
  }

  /** Remove floating-point noise (0.1 + 0.2 → 0.3) without losing meaningful precision. */
  function clean(n) {
    return Math.round(n * 1e9) / 1e9;
  }

  /**
   * Sum entries ({ amount, unit }) in the goal unit. Entries in incompatible units are
   * skipped and reported. Currency amounts are summed in minor units (pence/cents) so
   * £3.52 + £1.10 is exactly £4.62.
   */
  function sumInUnit(entries, goalUnitId, rates) {
    let total = 0;
    const skipped = [];
    const isCurrency = categoryOf(goalUnitId) === 'currency';
    const minor = 10 ** getUnit(goalUnitId).decimals;
    for (const e of entries || []) {
      const v = convert(Number(e.amount) || 0, e.unit || goalUnitId, goalUnitId, rates);
      if (v === null) {
        skipped.push(e);
        continue;
      }
      total += isCurrency ? Math.round(v * minor) : v;
    }
    return { total: isCurrency ? total / minor : clean(total), skipped };
  }

  // --------------------------------------------------------------- parsing ---

  /** Turn "1,234.56", "3,52" (decimal comma), "1.234,56" or "1 234" into a number. */
  function parseNumber(raw) {
    let s = raw.replace(/[\s ']/g, '');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // Whichever comes last is the decimal separator.
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (lastComma > -1) {
      const after = s.length - lastComma - 1;
      const commas = (s.match(/,/g) || []).length;
      // "3,52" or "4,5" → decimal comma; "1,250" or "1,000,000" → thousands separators.
      if (commas === 1 && after !== 3) s = s.replace(',', '.');
      else s = s.replace(/,/g, '');
    }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /** Resolve a typed unit word/symbol, preferring units in `category`. */
  function resolveAlias(word, defaultUnitId, customLabel) {
    const category = categoryOf(defaultUnitId);
    const w = word.toLowerCase();
    if (customLabel) {
      const c = customLabel.trim().toLowerCase();
      if (c && (w === c || w + 's' === c || w === c + 's')) return { unit: 'custom', scale: 1 };
    }
    const cands = (ALIASES[w] || []).map((c) => (typeof c === 'string' ? { unit: c, scale: 1 } : c));
    if (!cands.length) return null;
    return (
      cands.find((c) => c.unit === defaultUnitId) || // "$" in a CAD goal means CAD
      cands.find((c) => UNITS[c.unit].category === category) ||
      cands[0]
    );
  }

  /**
   * Parse what the user typed into { value, unit } (value expressed in `unit`), or { error }.
   *   parseAmount('£3.52', 'GBP')     → { value: 3.52, unit: 'GBP' }
   *   parseAmount('52p', 'GBP')       → { value: 0.52, unit: 'GBP' }
   *   parseAmount('€4,50', 'GBP')     → { value: 4.5,  unit: 'EUR' }
   *   parseAmount('2st 5lb', 'lb')    → { value: 2.357…, unit: 'st' }
   *   parseAmount('-1.5', 'kg')       → { value: -1.5, unit: 'kg' }
   */
  function parseAmount(text, defaultUnitId, customLabel) {
    let s = String(text == null ? '' : text)
      .replace(/[−–—]/g, '-') // unicode minus / dashes
      .trim();
    if (!s) return { error: 'Please enter an amount.' };

    let sign = 1;
    if (/^[-+]/.test(s)) {
      if (s[0] === '-') sign = -1;
      s = s.slice(1).trim();
    }

    // Each part: optional prefix symbol, number, optional suffix word/symbol.
    const prefixRe = PREFIX_SYMBOLS.map((p) => p.replace(/\$/g, '\\$')).join('|');
    const partRe = new RegExp(
      `^\\s*(${prefixRe})?\\s*(-)?\\s*(\\d[\\d,.\\s'\\u00a0]*\\d|\\d|[.,]\\d+)\\s*([a-z£$€¥]+\\$?\\.?)?\\s*`,
      'i'
    );

    const parts = [];
    let rest = s;
    while (rest.length) {
      const m = rest.match(partRe);
      if (!m || !m[0].trim()) return { error: `Couldn't understand "${text}". Try something like 3.52` };
      const [whole, prefix, innerMinus, numRaw, suffixRaw] = m;
      if (innerMinus) sign = -1;
      const num = parseNumber(numRaw.replace(/^[.,]/, '0.').replace(/^0\.,/, '0.'));
      if (!isFinite(num)) return { error: `"${numRaw.trim()}" isn't a valid number.` };

      let unit = null;
      let scale = 1;
      const words = [prefix, suffixRaw && suffixRaw.replace(/\.$/, '')].filter(Boolean);
      for (const w of words) {
        const r = resolveAlias(w, defaultUnitId, customLabel);
        if (!r) return { error: `Unknown unit "${w}".` };
        if (unit && unit !== r.unit) return { error: `"${whole.trim()}" mixes two different units.` };
        unit = r.unit;
        scale = r.scale;
      }
      parts.push({ value: num * scale, unit: unit || null });
      rest = rest.slice(whole.length);
    }

    // Unlabelled numbers take the default unit; "2st 5" → the 5 is lb in a stones context.
    const unitOf = (p, i) => {
      if (p.unit) return p.unit;
      if (i > 0 && parts[0].unit === 'st') return 'lb';
      return defaultUnitId;
    };
    const resultUnit = unitOf(parts[0], 0);
    let value = 0;
    for (let i = 0; i < parts.length; i++) {
      const v = convert(parts[i].value, unitOf(parts[i], i), resultUnit, FALLBACK_RATES);
      if (v === null) return { error: `Can't combine ${getUnit(unitOf(parts[i], i)).label} with ${getUnit(resultUnit).label}.` };
      value += v;
    }
    if (parts.length > 1 && categoryOf(resultUnit) === 'currency') {
      return { error: 'Please enter a single amount of money.' };
    }
    return { value: sign * clean(value), unit: resultUnit };
  }

  // ------------------------------------------------------------ formatting ---

  /** Human-readable amount, e.g. "£3.52", "-$1,250.00", "10 st 4 lb", "15 lbs", "12 pages". */
  function format(value, unitId, customLabel, opts = {}) {
    const u = getUnit(unitId);
    const signed = opts.signed && value > 0 ? '+' : '';
    if (!isFinite(value)) value = 0;

    if (u.category === 'currency') {
      try {
        const s = new Intl.NumberFormat(opts.locale, {
          style: 'currency',
          currency: u.currency,
          minimumFractionDigits: u.decimals,
          maximumFractionDigits: u.decimals,
        }).format(value);
        return signed + s;
      } catch (e) {
        return `${signed}${value.toFixed(u.decimals)} ${u.currency}`;
      }
    }

    if (unitId === 'st') {
      const neg = value < 0;
      const totalLb = Math.round(Math.abs(value) * 14 * 10) / 10;
      const st = Math.floor(totalLb / 14);
      const lb = Math.round((totalLb - st * 14) * 10) / 10;
      const parts = [];
      if (st) parts.push(`${st} st`);
      if (lb || !st) parts.push(`${num(lb, 1, opts.locale)} lb`);
      return (neg ? '-' : signed) + parts.join(' ');
    }

    const n = num(value, u.decimals, opts.locale);
    let label;
    if (u.category === 'custom') label = (customLabel || '').trim();
    else label = Math.abs(value) === 1 && u.singular ? u.singular : u.short;
    return `${signed}${n}${label ? ' ' + label : ''}`;
  }

  function num(v, decimals, locale) {
    return Number(v).toLocaleString(locale, { maximumFractionDigits: decimals });
  }

  /** Short name for a unit, for labels like "Amount (lbs)". */
  function shortLabel(unitId, customLabel) {
    const u = getUnit(unitId);
    if (u.category === 'currency') return u.currency;
    if (u.category === 'custom') return (customLabel || '').trim() || 'units';
    return u.short;
  }

  return {
    UNITS,
    CATEGORIES,
    FALLBACK_RATES,
    getUnit,
    categoryOf,
    compatibleUnits,
    unitIdFromText,
    convert,
    sumInUnit,
    parseNumber,
    parseAmount,
    format,
    shortLabel,
  };
});
