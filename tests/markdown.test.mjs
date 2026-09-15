import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, markdownExcerpt } from '../markdown.js';

test('Markdown renders useful structure', () => {
  const html = renderMarkdown('# Título\n\n**forte** e `código`\n\n- um\n- dois');
  assert.match(html, /<h1>Título<\/h1>/);
  assert.match(html, /<strong>forte<\/strong>/);
  assert.match(html, /<ul>/);
});

test('raw HTML and non-http links are escaped', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test('excerpt removes Markdown syntax', () => {
  assert.equal(markdownExcerpt('## Título\n\n**Texto** útil.'), 'Título Texto útil.');
});
