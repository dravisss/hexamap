import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownDocument, stringifyMarkdownDocument } from '../frontmatter.js';

test('frontmatter parses common Obsidian YAML values', () => {
  const source = `---\nid: autonomia\ntags:\n  - poder\n  - decisão\nstatus: em-analise\nscore: 4.5\nactive: true\nvisual:\n  mode: icon\n---\n\n# Autonomia\n\nTexto.`;
  const parsed = parseMarkdownDocument(source);
  assert.equal(parsed.frontmatter.id, 'autonomia');
  assert.deepEqual(parsed.frontmatter.tags, ['poder', 'decisão']);
  assert.equal(parsed.frontmatter.score, 4.5);
  assert.equal(parsed.frontmatter.active, true);
  assert.deepEqual(parsed.frontmatter.visual, { mode: 'icon' });
  assert.match(parsed.body, /# Autonomia/);
});

test('frontmatter round-trip preserves unknown structured properties', () => {
  const metadata = { id: 'x', custom: { owner: 'Ravi', active: true }, aliases: ['A', 'B'] };
  const reparsed = parseMarkdownDocument(stringifyMarkdownDocument(metadata, '# Corpo')).frontmatter;
  assert.deepEqual(reparsed, metadata);
});

