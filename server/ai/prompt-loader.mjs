import { readFile } from 'node:fs/promises';

const PROMPTS = new Map();

/** The Brief Brain's jobs. Nothing else may be loaded from disk. */
const ALLOWED = new Set([
  'brief-architect', 'content-writer', 'flow-outline', 'concept-designer', 'brief-expander',
  'media-search', 'media-director',
]);

export async function loadPrompt(name) {
  if (!ALLOWED.has(name)) throw new Error(`Unknown Brief Brain prompt: ${name}`);
  if (!PROMPTS.has(name)) {
    const file = new URL(`./prompts/${name}.md`, import.meta.url);
    PROMPTS.set(name, readFile(file, 'utf8'));
  }
  return PROMPTS.get(name);
}
