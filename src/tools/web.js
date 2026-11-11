/**
 * tools/web.js — the agent's eyes.
 * fetch_url pulls a page and extracts readable text; summarise_text condenses
 * whatever was fetched (or whatever the user pasted) using our own summariser.
 */

import { stripHtml, truncate } from '../lib/text.js';
import { summarize } from '../lib/summarize.js';

const MAX_TEXT = 12000;
const FETCH_TIMEOUT = 12000;

function extractTitle(html) {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]).slice(0, 200) : '';
}

/** Turn an HTML page into the part a human would actually read. */
export function readableText(html) {
  return stripHtml(
    String(html)
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  ).replace(/\s+/g, ' ').trim();
}

export function fetchUrlTool() {
  return {
    name: 'fetch_url',
    description: 'Download a public web page or RSS feed and extract its readable text. Use whenever the answer lives at a URL.',
    args: {
      url: { type: 'string', required: true, description: 'absolute http(s) URL' },
      sentences: { type: 'number', required: false, description: 'how many sentences to summarise (default 4)' },
    },
    async run({ url, sentences }, ctx) {
      let parsed;
      try {
        parsed = new URL(String(url));
      } catch {
        throw new Error(`"${url}" is not a valid URL`);
      }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('only http and https URLs are allowed');

      const init = {
        headers: { 'user-agent': 'SwayamAgent/1.0 (+https://github.com/galeoindus/swayam-agent)' },
        redirect: 'follow',
      };
      if (AbortSignal?.timeout) init.signal = AbortSignal.timeout(FETCH_TIMEOUT);
      if (ctx.isGlobalFetch) init.cf = { cacheTtl: 300 };

      const response = await ctx.fetch(parsed.toString(), init);
      if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`);

      const type = response.headers.get('content-type') ?? '';
      if (!/text|xml|json|html/i.test(type)) throw new Error(`unsupported content type: ${type}`);

      const raw = await response.text();
      const title = extractTitle(raw);
      const text = truncate(readableText(raw), MAX_TEXT);

      ctx.memory.lastFetchedUrl = parsed.toString();
      ctx.memory.lastFetchedTitle = title;
      ctx.memory.lastFetchedText = text;

      const summary = summarize(text, { maxSentences: Math.min(6, Number(sentences) || 4) });
      return {
        ok: true,
        answer: `${title ? `"${title}" — ` : ''}${summary}`,
        data: { url: parsed.toString(), title, characters: text.length, summary },
      };
    },
  };
}

export function summariseTool() {
  return {
    name: 'summarise_text',
    description: 'Summarise a piece of text, or the last page the agent fetched, into a few key sentences.',
    args: {
      text: { type: 'string', required: false, description: 'text to summarise; defaults to the last fetched page' },
      sentences: { type: 'number', required: false, description: 'number of sentences (default 4)' },
      focus: { type: 'string', required: false, description: 'what to focus the summary on' },
    },
    async run({ text, sentences, focus }, ctx) {
      const content = String(text ?? ctx.memory.lastFetchedText ?? '').trim();
      if (!content) throw new Error('no text to summarise — fetch a URL first or paste the text');
      const count = Math.min(8, Math.max(1, Number(sentences) || 4));
      const summary = summarize(content, { maxSentences: count, query: focus ?? '' });
      return {
        ok: true,
        answer: summary,
        data: { sentences: count, characters: content.length, source: ctx.memory.lastFetchedUrl ?? 'given text' },
      };
    },
  };
}
