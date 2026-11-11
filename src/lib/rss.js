/**
 * rss.js — a hand-written RSS 2.0 / Atom reader.
 * Written by us instead of pulling a parser package, so the app has no
 * third-party code in its dependency tree at all.
 */

import { decodeEntities, stripHtml, truncate } from './text.js';

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

function unwrap(raw) {
  const value = String(raw ?? '').trim();
  const cdata = value.match(CDATA);
  return cdata ? cdata[1] : value;
}

function firstTag(block, names) {
  for (const name of names) {
    const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const match = block.match(pattern);
    if (match) return unwrap(match[1]);
  }
  return '';
}

function atomLink(block) {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (alternate) return decodeEntities(alternate[1]);
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (href) return decodeEntities(href[1]);
  return '';
}

function toIso(value) {
  if (!value) return '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

/**
 * Parse an RSS or Atom document into plain article objects.
 * @param {string} xml raw feed text
 * @param {{ sourceName?: string, topic?: string }} options
 */
export function parseFeed(xml, options = {}) {
  const text = String(xml ?? '');
  const feedTitle = stripHtml(firstTag(text, ['title']));
  const sourceName = options.sourceName || feedTitle || 'Unknown source';
  const items = [];
  const blocks = text.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];

  for (const block of blocks) {
    const title = stripHtml(firstTag(block, ['title']));
    const link = stripHtml(firstTag(block, ['link'])) || atomLink(block);
    const rawBody = firstTag(block, ['content:encoded', 'description', 'summary', 'content']);
    const body = stripHtml(rawBody);
    const publishedAt = toIso(
      stripHtml(firstTag(block, ['pubDate', 'published', 'updated', 'dc:date']))
    );
    const inlineSource = stripHtml(firstTag(block, ['source']));
    if (!title || !link) continue;

    items.push({
      id: `${sourceName}:${link}`,
      title,
      link,
      source: inlineSource || sourceName,
      publishedAt,
      summary: truncate(body, 400),
      body: truncate(body, 1600),
      topics: options.topic ? [options.topic] : [],
    });
  }

  return { title: feedTitle, sourceName, items };
}

/** Merge feeds, drop duplicates, newest first. */
export function mergeArticles(articleLists) {
  const seen = new Map();
  for (const article of articleLists.flat()) {
    const key = article.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!seen.has(key)) {
      seen.set(key, article);
      continue;
    }
    // Same story from a second outlet: keep the first, remember the second.
    const existing = seen.get(key);
    if (existing.source !== article.source) {
      existing.alsoReportedBy = existing.alsoReportedBy ?? [];
      if (!existing.alsoReportedBy.includes(article.source)) existing.alsoReportedBy.push(article.source);
    }
  }
  return [...seen.values()].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}
