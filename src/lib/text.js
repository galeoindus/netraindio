/**
 * text.js — the lowest layer of Swayam's own brain.
 * Tokenising, sentence splitting, HTML cleanup and language detection.
 * No dependencies, no network, no model. Just code that we own.
 */

const STOPWORDS_EN = new Set(
  `a an the and or but if then than that this these those of in on at to for from by with
   without into over under about as is are was were be been being am do does did doing have
   has had having will would shall can could should may might must not no nor so such own same
   too very just don now i you he she it we they me him her them my your his its our their what
   which who whom whose when where why how all any both each few more most other some only also
   there here up down out off again further once ever never still yet per via amid after before
   during since while because get gets got make makes made say says said tell told new news
   today yesterday tomorrow week month year latest update updates`
    .split(/\s+/)
    .filter(Boolean)
);

const STOPWORDS_HI = new Set(
  `का के की को में से पर और है हैं था थे थी यह वह एक हो हुआ हुई गया गई कि भी तो ने जो कर करने
   लिए साथ अपने अपनी कुछ कोई नहीं बहुत ही वाले वाली रहा रही रहे तक सा सी से हम आप वो ये क्या
   कौन कब कहाँ क्यों कैसे कितना अब अभी आज कल समाचार खबर ख़बर ताज़ा ताजा बताओ बताइए चाहिए
   मुझे मेरा मेरी हमारा हमारी उसका उसकी इसका इसकी कोई भी कृपया`
    .split(/\s+/)
    .filter(Boolean)
);

export const STOPWORDS = new Set([...STOPWORDS_EN, ...STOPWORDS_HI]);

/** Lowercase, trim. Works for Devanagari too (case is a no-op there). */
export function normalize(value) {
  return String(value ?? '').toLowerCase().trim();
}

/** Raw tokens: letters and digits only, unicode aware. */
export function tokens(value) {
  // \p{M} matters: Devanagari matras (ौ, ी, ु) are combining marks, not letters.
  // Without it "मौसम" would split into "म" + "सम".
  return normalize(value).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** Tokens worth indexing: no stopwords, no bare numbers, length > 1. */
export function contentTokens(value) {
  const out = [];
  for (const token of tokens(value)) {
    if (token.length < 2) continue;
    if (/^\d+$/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}

/** Split a paragraph into sentences. Handles the Devanagari danda (।) as well. */
export function sentences(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?।])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#8217': '\u2019',
  '#8216': '\u2018',
  '#8220': '\u201c',
  '#8221': '\u201d',
  '#8211': '\u2013',
  '#8212': '\u2014',
};

export function decodeEntities(text) {
  return String(text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name) => {
    if (ENTITIES[name] !== undefined) return ENTITIES[name];
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    return whole;
  });
}

/** Strip HTML tags and decode entities — feeds are full of markup. */
export function stripHtml(html) {
  const text = String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

export function truncate(text, max = 240) {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}

/** Very small language check: is this question written in Devanagari? */
export function detectLang(text) {
  const devanagari = (String(text ?? '').match(/[\u0900-\u097F]/g) ?? []).length;
  const latin = (String(text ?? '').match(/[A-Za-z]/g) ?? []).length;
  return devanagari > 0 && devanagari >= latin * 0.25 ? 'hi' : 'en';
}

/** Jaccard similarity of two token sets — used for de-duplication. */
export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}
