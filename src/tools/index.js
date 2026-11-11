/**
 * tools/index.js — the registry every planner reads.
 * Each tool declares its name, description, arguments, and whether it writes
 * (write tools need approval before they run).
 */

import { readArtifactTool, listArtifactsTool, writeArtifactTool } from './artifacts.js';
import { calculateTool, convertTool, datetimeTool, textStatsTool } from './basic.js';
import { NewsStore, newsTool } from './news.js';
import { noteListTool, noteSaveTool } from './notes.js';
import { fetchUrlTool, summariseTool } from './web.js';

export { NewsStore };

export function createTools(options = {}) {
  const newsStore = options.newsStore ?? new NewsStore({ fetchImpl: options.fetchImpl });
  const tools = [
    fetchUrlTool(),
    summariseTool(),
    newsTool(newsStore),
    calculateTool(),
    convertTool(),
    datetimeTool(),
    textStatsTool(),
    writeArtifactTool(),
    listArtifactsTool(),
    readArtifactTool(),
    noteSaveTool(),
    noteListTool(),
  ];
  const registry = new Map(tools.map((tool) => [tool.name, tool]));
  return { registry, newsStore, tools };
}

export function toolSpecs(registry) {
  return [...registry.values()].map((tool) => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk ?? 'read',
    args: tool.args ?? {},
  }));
}

export function validateArgs(tool, args = {}) {
  const clean = {};
  for (const [key, spec] of Object.entries(tool.args ?? {})) {
    const value = args?.[key];
    if (value === undefined || value === null || value === '') {
      if (spec.required) throw new Error(`missing required argument "${key}"`);
      continue;
    }
    clean[key] = spec.type === 'number' ? Number(value) : String(value);
    if (spec.type === 'number' && !Number.isFinite(clean[key])) throw new Error(`"${key}" must be a number`);
  }
  return clean;
}
