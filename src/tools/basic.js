/**
 * tools/basic.js — deterministic tools: maths, units, time, text stats.
 * Pure functions, no network, no model. These are the tools the agent can
 * trust completely, because they either compute an answer or fail loudly.
 */

const UNITS = {
  // length -> metres
  m: { kind: 'length', factor: 1 },
  metre: { kind: 'length', factor: 1 },
  meter: { kind: 'length', factor: 1 },
  km: { kind: 'length', factor: 1000 },
  kilometre: { kind: 'length', factor: 1000 },
  kilometer: { kind: 'length', factor: 1000 },
  cm: { kind: 'length', factor: 0.01 },
  mm: { kind: 'length', factor: 0.001 },
  mile: { kind: 'length', factor: 1609.344 },
  miles: { kind: 'length', factor: 1609.344 },
  ft: { kind: 'length', factor: 0.3048 },
  feet: { kind: 'length', factor: 0.3048 },
  foot: { kind: 'length', factor: 0.3048 },
  inch: { kind: 'length', factor: 0.0254 },
  inches: { kind: 'length', factor: 0.0254 },
  yard: { kind: 'length', factor: 0.9144 },
  // mass -> kilograms
  kg: { kind: 'mass', factor: 1 },
  kilo: { kind: 'mass', factor: 1 },
  g: { kind: 'mass', factor: 0.001 },
  gram: { kind: 'mass', factor: 0.001 },
  mg: { kind: 'mass', factor: 1e-6 },
  lb: { kind: 'mass', factor: 0.45359237 },
  lbs: { kind: 'mass', factor: 0.45359237 },
  pound: { kind: 'mass', factor: 0.45359237 },
  oz: { kind: 'mass', factor: 0.028349523125 },
  tonne: { kind: 'mass', factor: 1000 },
  quintal: { kind: 'mass', factor: 100 },
  // data -> bytes
  byte: { kind: 'data', factor: 1 },
  kb: { kind: 'data', factor: 1024 },
  mb: { kind: 'data', factor: 1024 ** 2 },
  gb: { kind: 'data', factor: 1024 ** 3 },
  // speed -> metres per second
  kmh: { kind: 'speed', factor: 1000 / 3600 },
  mph: { kind: 'speed', factor: 1609.344 / 3600 },
};

const TEMPERATURES = new Set(['c', 'celsius', 'f', 'fahrenheit', 'k', 'kelvin']);

const CITY_OFFSETS = {
  delhi: 5.5, mumbai: 5.5, kolkata: 5.5, bengaluru: 5.5, chennai: 5.5, hyderabad: 5.5, patna: 5.5,
  ist: 5.5, india: 5.5,
  dubai: 4, london: 0, paris: 1, berlin: 1, moscow: 3, tokyo: 9, singapore: 8,
  sydney: 11, 'new york': -5, nyc: -5, 'san francisco': -8, 'los angeles': -8, toronto: -5,
};

/** Recursive-descent arithmetic parser. No eval(), no Function(). */
export function evaluate(expression) {
  const source = String(expression ?? '');
  let pos = 0;

  const skip = () => {
    while (pos < source.length && /\s/.test(source[pos])) pos += 1;
  };

  function number() {
    skip();
    const start = pos;
    while (pos < source.length && /[0-9.]/.test(source[pos])) pos += 1;
    if (start === pos) throw new Error(`expected a number at position ${pos}`);
    const value = Number(source.slice(start, pos));
    if (!Number.isFinite(value)) throw new Error('invalid number');
    return value;
  }

  function primary() {
    skip();
    if (source[pos] === '(') {
      pos += 1;
      const value = additive();
      skip();
      if (source[pos] !== ')') throw new Error('missing closing bracket');
      pos += 1;
      return value;
    }
    if (source[pos] === '-') {
      pos += 1;
      return -primary();
    }
    if (source[pos] === '+') {
      pos += 1;
      return primary();
    }
    return number();
  }

  function power() {
    const base = primary();
    skip();
    if (source[pos] === '^') {
      pos += 1;
      return base ** power();
    }
    return base;
  }

  function multiplicative() {
    let value = power();
    for (;;) {
      skip();
      const op = source[pos];
      if (op === '*' || op === '/' || op === '%') {
        pos += 1;
        const right = power();
        if ((op === '/' || op === '%') && right === 0) throw new Error('division by zero');
        value = op === '*' ? value * right : op === '/' ? value / right : value % right;
        continue;
      }
      return value;
    }
  }

  function additive() {
    let value = multiplicative();
    for (;;) {
      skip();
      const op = source[pos];
      if (op === '+' || op === '-') {
        pos += 1;
        const right = multiplicative();
        value = op === '+' ? value + right : value - right;
        continue;
      }
      return value;
    }
  }

  const result = additive();
  skip();
  if (pos !== source.length) throw new Error(`unexpected "${source.slice(pos)}"`);
  return result;
}

export function calculateTool() {
  return {
    name: 'calculator',
    description: 'Evaluate an arithmetic expression (+ - * / % ^ and brackets). Use for any sum, percentage or comparison of numbers.',
    args: { expression: { type: 'string', required: true, description: 'e.g. "23*47+12" or "(1200-950)/950*100"' } },
    async run({ expression }) {
      const value = evaluate(expression);
      const rounded = Math.round(value * 1e10) / 1e10;
      return {
        ok: true,
        answer: `${expression} = ${rounded}`,
        data: { expression, value: rounded },
      };
    },
  };
}

export function convertTool() {
  return {
    name: 'convert_units',
    description: 'Convert between units of length, mass, data size, speed, or temperature (C/F/K).',
    args: {
      value: { type: 'number', required: true, description: 'amount to convert' },
      from: { type: 'string', required: true, description: 'source unit, e.g. km, miles, kg, lb, c, f, mb' },
      to: { type: 'string', required: true, description: 'target unit, e.g. m, km, f, c, gb' },
    },
    async run({ value, from, to }) {
      const source = String(from).toLowerCase().trim();
      const target = String(to).toLowerCase().trim();
      const amount = Number(value);

      if (TEMPERATURES.has(source) && TEMPERATURES.has(target)) {
        const celsius = source.startsWith('c') ? amount : source.startsWith('f') ? ((amount - 32) * 5) / 9 : amount - 273.15;
        const out = target.startsWith('c') ? celsius : target.startsWith('f') ? (celsius * 9) / 5 + 32 : celsius + 273.15;
        const rounded = Math.round(out * 1000) / 1000;
        return { ok: true, answer: `${amount}°${source.toUpperCase()} = ${rounded}°${target.toUpperCase()}`, data: { value: rounded } };
      }

      const a = UNITS[source];
      const b = UNITS[target];
      if (!a || !b) throw new Error(`unknown unit "${!a ? source : target}"`);
      if (a.kind !== b.kind) throw new Error(`cannot convert ${a.kind} to ${b.kind}`);
      const out = (amount * a.factor) / b.factor;
      const rounded = Math.round(out * 1e8) / 1e8;
      return { ok: true, answer: `${amount} ${source} = ${rounded} ${target}`, data: { value: rounded } };
    },
  };
}

export function datetimeTool() {
  return {
    name: 'datetime',
    description: 'Current date and time in UTC, India (IST) or a named city.',
    args: { city: { type: 'string', required: false, description: 'e.g. delhi, london, tokyo' } },
    async run({ city }) {
      const now = new Date();
      const key = String(city ?? 'india').toLowerCase().trim();
      const offset = CITY_OFFSETS[key];
      if (offset === undefined) {
        throw new Error(`unknown city "${city}". Known: ${Object.keys(CITY_OFFSETS).join(', ')}`);
      }
      const local = new Date(now.getTime() + offset * 3600 * 1000);
      const iso = local.toISOString().replace('T', ' ').slice(0, 19);
      const sign = offset >= 0 ? '+' : '-';
      return {
        ok: true,
        answer: `${key} में अभी ${iso} है (UTC${sign}${Math.abs(offset)}).`,
        data: { utc: now.toISOString(), local: iso, offsetHours: offset, note: 'Fixed offset — daylight saving is not applied.' },
      };
    },
  };
}

export function textStatsTool() {
  return {
    name: 'text_stats',
    description: 'Count words, sentences and characters in a text, and give an estimated reading time.',
    args: { text: { type: 'string', required: false, description: 'text to measure; defaults to the last page fetched' } },
    async run({ text }, ctx) {
      const content = String(text ?? ctx.memory.lastFetchedText ?? '').trim();
      if (!content) throw new Error('no text given and nothing fetched yet');
      const words = content.split(/\s+/).filter(Boolean).length;
      const sentenceCount = (content.match(/[.!?।]+/g) ?? []).length || 1;
      const minutes = Math.max(1, Math.round(words / 200));
      return {
        ok: true,
        answer: `शब्द: ${words}, वाक्य: ${sentenceCount}, अक्षर: ${content.length}, पढ़ने का समय: ~${minutes} मिनट।`,
        data: { words, sentences: sentenceCount, characters: content.length, readingMinutes: minutes },
      };
    },
  };
}
