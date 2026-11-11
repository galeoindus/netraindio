/**
 * tools/news.js — the agent's own news index.
 * Same machinery as the Swayam news app: read public RSS, rank with BM25.
 * Kept inside the agent so "what's happening in X" is one tool call away.
 */

import { buildIndex, search } from '../lib/bm25.js';
import { mergeArticles, parseFeed } from '../lib/rss.js';

const FEEDS = [
  { name: 'NDTV', url: 'https://feeds.feedburner.com/ndtvnews-top-stories', topics: ['india'] },
  { name: 'The Hindu', url: 'https://www.thehindu.com/news/national/feeder/default.rss', topics: ['india'] },
  { name: 'Indian Express', url: 'https://indianexpress.com/section/india/feed/', topics: ['india'] },
  { name: 'Hindustan Times', url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml', topics: ['india'] },
  { name: 'BBC News India', url: 'https://feeds.bbci.co.uk/news/world/asia/india/rss.xml', topics: ['india', 'world'] },
  { name: 'ESPNcricinfo', url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml', topics: ['sports'] },
];

const NEWS_TTL = 10 * 60 * 1000; // distinct from memory.js's TTL: the bundle is one scope

export class NewsStore {
  constructor(options = {}) {
    this.feeds = options.feeds ?? FEEDS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.store = { docs: [], index: buildIndex([]), fetchedAt: 0, failures: [] };
    this.inFlight = null;
  }

  isStale() {
    return !this.store.docs.length || Date.now() - this.store.fetchedAt > NEWS_TTL;
  }

  async ensureFresh() {
    if (!this.isStale()) return this.store;
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const results = await Promise.allSettled(
        this.feeds.map(async (feed) => {
          const init = { headers: { 'user-agent': 'netraindio/3.0' } };
          if (AbortSignal?.timeout) init.signal = AbortSignal.timeout(8000);
          const response = await this.fetchImpl(feed.url, init);
          if (!response.ok) throw new Error(`${feed.name}: HTTP ${response.status}`);
          return parseFeed(await response.text(), { sourceName: feed.name }).items.map((item) => ({
            ...item,
            topics: feed.topics,
          }));
        })
      );

      const lists = [];
      const failures = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') lists.push(result.value);
        else failures.push({ feed: this.feeds[index]?.name, error: String(result.reason?.message ?? result.reason) });
      });

      const docs = mergeArticles(lists);
      if (docs.length) this.store = { docs, index: buildIndex(docs), fetchedAt: Date.now(), failures };
      else this.store = { ...this.store, failures };
      this.inFlight = null;
      return this.store;
    })();

    return this.inFlight;
  }

  search(query, limit = 5) {
    if (!query) {
      return this.store.docs
        .slice()
        .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
        .slice(0, limit)
        .map((doc) => ({ doc, score: 1 }));
    }
    return search(this.store.index, query, limit);
  }
}

export function newsTool(store) {
  return {
    name: 'news_search',
    description: 'Search the agent\'s own index of Indian news headlines (NDTV, The Hindu, Indian Express, HT, BBC India, ESPNcricinfo).',
    args: {
      query: { type: 'string', required: false, description: 'topic, e.g. "cricket", "RBI rates", "bihar election". Empty = latest headlines.' },
      limit: { type: 'number', required: false, description: 'how many stories (default 5)' },
    },
    async run({ query, limit }) {
      const store_ = await store.ensureFresh();
      const hits = store.search(String(query ?? '').trim(), Math.min(10, Number(limit) || 5));
      if (!store_.docs.length) {
        const why = store_.failures.map((f) => `${f.feed}: ${f.error}`).join('; ');
        throw new Error(`my news index is empty — the feeds did not respond${why ? ` (${why})` : ''}`);
      }
      if (!hits.length) {
        throw new Error(`no story matched "${query}" in ${store_.docs.length} headlines`);
      }
      const lines = hits.map((hit) => `• ${hit.doc.title} — ${hit.doc.source}`);
      return {
        ok: true,
        answer: `${hits.length} खबरें मिलीं:\n${lines.join('\n')}`,
        data: {
          articles: hits.map((hit) => ({
            title: hit.doc.title,
            link: hit.doc.link,
            source: hit.doc.source,
            publishedAt: hit.doc.publishedAt,
            score: Number(hit.score.toFixed(2)),
          })),
          read: store_.docs.length,
        },
      };
    },
  };
}
