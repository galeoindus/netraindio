/**
 * summarize.js — extractive summarisation, written from scratch.
 * Scores every sentence by information weight, query overlap and position,
 * then drops near-duplicates. No model, no API, fully explainable.
 */

import { contentTokens, jaccard, sentences } from './text.js';

export function summarize(text, options = {}) {
  const { maxSentences = 3, query = '' } = options;
  const all = sentences(text).filter((sentence) => sentence.length > 25);
  if (!all.length) return String(text ?? '').trim();
  if (all.length <= maxSentences) return all.join(' ');

  const queryTerms = new Set(contentTokens(query));

  // Term weights: frequent-in-this-text terms matter, but log-damped.
  const frequency = new Map();
  for (const sentence of all) {
    for (const token of contentTokens(sentence)) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const weights = new Map();
  for (const [term, count] of frequency) {
    weights.set(term, 1 + Math.log(1 + count));
  }

  const scored = all.map((sentence, index) => {
    const terms = contentTokens(sentence);
    if (!terms.length) return { sentence, index, score: 0, terms: new Set() };
    let score = 0;
    for (const term of terms) score += weights.get(term) ?? 0;
    score /= Math.sqrt(terms.length); // length normalisation
    const unique = new Set(terms);
    let overlap = 0;
    for (const term of unique) if (queryTerms.has(term)) overlap += 1;
    score += overlap * 2.5; // a sentence answering the question wins
    score += Math.max(0, 1 - index / all.length) * 1.5; // lead sentences carry the point
    if (sentence.length > 380) score *= 0.85; // long sentences are usually quotes
    return { sentence, index, score, terms: unique };
  });

  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const candidate of scored) {
    if (picked.length >= maxSentences) break;
    const redundant = picked.some((chosen) => jaccard(candidate.terms, chosen.terms) > 0.45);
    if (!redundant && candidate.score > 0) picked.push(candidate);
  }

  if (!picked.length) picked.push(scored[0]);
  picked.sort((a, b) => a.index - b.index);
  return picked.map((item) => item.sentence.trim()).join(' ');
}

/** Pull only the sentences of a document that mention the asked-about terms. */
export function relevantSentences(text, query, limit = 2) {
  const queryTerms = new Set(contentTokens(query));
  const parts = sentences(text);
  const seen = new Set();
  const hits = parts
    .map((sentence, index) => {
      const terms = new Set(contentTokens(sentence));
      let overlap = 0;
      for (const term of queryTerms) if (terms.has(term)) overlap += 1;
      return { sentence, index, overlap };
    })
    .filter((item) => {
      if (item.overlap <= 0) return false;
      const key = item.sentence.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false; // a summary often repeats the body
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.overlap - a.overlap || a.index - b.index)
    .slice(0, limit);
  return hits.length ? hits.map((hit) => hit.sentence).join(' ') : '';
}
