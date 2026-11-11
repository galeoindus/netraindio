/**
 * bm25.js — the retrieval half of the brain.
 * A BM25 ranking index over article titles and bodies, built by us.
 * Titles are weighted 3x because a headline is the strongest signal we have.
 */

import { contentTokens } from './text.js';

const K1 = 1.4;
const B = 0.75;
const TITLE_WEIGHT = 3;
const MAX_BODY_TOKENS = 400;

/**
 * @param {Array<{id?:string,title:string,summary?:string,body?:string}>} docs
 */
export function buildIndex(docs) {
  const postings = new Map(); // term -> Map(docIndex -> weight)
  const lengths = [];
  let totalLength = 0;

  docs.forEach((doc, docIndex) => {
    const weights = new Map();
    for (const token of contentTokens(doc.title ?? '')) {
      weights.set(token, (weights.get(token) ?? 0) + TITLE_WEIGHT);
    }
    const bodyTokens = contentTokens(`${doc.summary ?? ''} ${doc.body ?? ''}`).slice(0, MAX_BODY_TOKENS);
    for (const token of bodyTokens) {
      weights.set(token, (weights.get(token) ?? 0) + 1);
    }

    let docLength = 0;
    for (const [term, weight] of weights) {
      docLength += weight;
      if (!postings.has(term)) postings.set(term, new Map());
      postings.get(term).set(docIndex, weight);
    }
    lengths.push(docLength || 1);
    totalLength += docLength || 1;
  });

  return {
    docs,
    postings,
    lengths,
    avgLength: docs.length ? totalLength / docs.length : 1,
    docCount: docs.length,
  };
}

/**
 * Rank documents against a query.
 * @returns {Array<{ doc: object, index: number, score: number, matched: string[] }>}
 */
export function search(index, query, limit = 6) {
  const terms = [...new Set(contentTokens(query))];
  if (!terms.length || !index.docCount) return [];

  const scores = new Map();
  const matched = new Map();

  for (const term of terms) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const df = posting.size;
    const idf = Math.log(1 + (index.docCount - df + 0.5) / (df + 0.5));

    for (const [docIndex, tf] of posting) {
      const dl = index.lengths[docIndex];
      const norm = tf + K1 * (1 - B + (B * dl) / index.avgLength);
      const contribution = idf * ((tf * (K1 + 1)) / norm);
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + contribution);
      if (!matched.has(docIndex)) matched.set(docIndex, []);
      matched.get(docIndex).push(term);
    }
  }

  return [...scores.entries()]
    .map(([docIndex, score]) => ({
      doc: index.docs[docIndex],
      index: docIndex,
      score,
      matched: matched.get(docIndex) ?? [],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** How much of the query the best document actually covers (0..1). */
export function coverage(query, doc) {
  const queryTerms = new Set(contentTokens(query));
  if (!queryTerms.size) return 0;
  const docTerms = new Set(contentTokens(`${doc.title ?? ''} ${doc.summary ?? ''} ${doc.body ?? ''}`));
  let hits = 0;
  for (const term of queryTerms) if (docTerms.has(term)) hits += 1;
  return hits / queryTerms.size;
}
