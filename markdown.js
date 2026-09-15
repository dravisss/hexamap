/**
 * Tiny safe Markdown renderer.
 * The source is escaped before Markdown tokens are interpreted, so raw HTML
 * never reaches the document. This deliberately supports a useful subset.
 */
function escapeMarkdownHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function inline(text) {
  let output = text;
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  output = output.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
  output = output.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return output;
}

export function renderMarkdown(markdown = '') {
  const source = escapeMarkdownHtml(markdown).replaceAll('\r\n', '\n');
  if (!source.trim()) return '<p class="markdown-empty">Sem conteúdo.</p>';

  const lines = source.split('\n');
  const out = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  let code = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map((line) => `<p>${inline(line)}</p>`).join('')}</blockquote>`);
    quote = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (code) {
      if (/^```/.test(line)) {
        out.push(`<pre><code>${code.lines.join('\n')}</code></pre>`);
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }
    const fence = line.match(/^```\s*([\w-]+)?/);
    if (fence) {
      flushParagraph(); flushList(); flushQuote();
      code = { language: fence[1] || '', lines: [] };
      continue;
    }
    if (!line.trim()) {
      flushParagraph(); flushList(); flushQuote();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph(); flushList(); flushQuote();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushParagraph(); flushList(); flushQuote();
      out.push('<hr>');
      continue;
    }
    const blockquote = line.match(/^&gt;\s?(.*)$/);
    if (blockquote) {
      flushParagraph(); flushList();
      quote.push(blockquote[1]);
      continue;
    }
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      flushParagraph(); flushQuote();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(unordered[1]);
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph(); flushQuote();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(ordered[1]);
      continue;
    }
    if (list) flushList();
    if (quote.length) flushQuote();
    paragraph.push(line.trim());
  }
  if (code) out.push(`<pre><code>${code.lines.join('\n')}</code></pre>`);
  flushParagraph(); flushList(); flushQuote();
  return out.join('\n');
}

export function markdownExcerpt(markdown = '', max = 180) {
  const plain = String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_~`\[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trim()}…` : plain;
}
