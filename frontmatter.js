const FRONTMATTER = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

function stripComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') quote = quote === char ? null : (quote || char);
    if (char === '#' && !quote && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value.trimEnd();
}

function splitInline(value) {
  const items = [];
  let current = '';
  let quote = null;
  let depth = 0;
  for (const char of value) {
    if ((char === '"' || char === "'") && current.at(-1) !== '\\') quote = quote === char ? null : (quote || char);
    if (!quote && ['[', '{'].includes(char)) depth += 1;
    if (!quote && [']', '}'].includes(char)) depth -= 1;
    if (char === ',' && !quote && depth === 0) { items.push(current.trim()); current = ''; }
    else current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

export function parseYamlScalar(raw) {
  const value = stripComment(String(raw ?? '')).trim();
  if (!value.length) return '';
  if (value === 'null' || value === '~') return null;
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) return splitInline(value.slice(1, -1)).map(parseYamlScalar);
  if (value.startsWith('{') && value.endsWith('}')) {
    return Object.fromEntries(splitInline(value.slice(1, -1)).map((item) => {
      const separator = item.indexOf(':');
      return separator < 0 ? [item, ''] : [item.slice(0, separator).trim(), parseYamlScalar(item.slice(separator + 1))];
    }));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith('"')) {
      try { return JSON.parse(value); } catch { return value.slice(1, -1); }
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

export function parseYaml(source = '') {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = String(source).replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const text = raw.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (text.startsWith('- ')) {
      if (Array.isArray(parent)) parent.push(parseYamlScalar(text.slice(2)));
      continue;
    }
    const separator = text.indexOf(':');
    if (separator < 1 || Array.isArray(parent)) continue;
    const key = text.slice(0, separator).trim();
    const tail = text.slice(separator + 1).trim();
    if (tail === '|' || tail === '>') {
      const parts = [];
      const blockIndent = indent + 2;
      while (index + 1 < lines.length && (lines[index + 1].match(/^\s*/)[0].length >= blockIndent || !lines[index + 1].trim())) {
        index += 1;
        parts.push(lines[index].slice(Math.min(blockIndent, lines[index].length)));
      }
      parent[key] = tail === '>' ? parts.join(' ').replace(/\s+/g, ' ').trim() : parts.join('\n');
      continue;
    }
    if (tail) { parent[key] = parseYamlScalar(tail); continue; }
    const next = lines.slice(index + 1).find((line) => line.trim());
    const child = next && next.match(/^\s*/)[0].length > indent && next.trim().startsWith('- ') ? [] : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }
  return root;
}

function needsQuotes(value) {
  return !value.length || /^[-?:,\[\]{}#&*!|>'"%@`]/.test(value) || /:\s|\s#/.test(value) || /^(null|true|false|~|-?\d+(?:\.\d+)?)$/i.test(value);
}

function scalarToYaml(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  const text = String(value);
  return needsQuotes(text) ? JSON.stringify(text) : text;
}

export function stringifyYaml(value, indent = 0) {
  const padding = ' '.repeat(indent);
  if (Array.isArray(value)) return value.map((item) => `${padding}- ${typeof item === 'object' && item !== null ? `\n${stringifyYaml(item, indent + 2)}` : scalarToYaml(item)}`).join('\n');
  return Object.entries(value || {}).filter(([, item]) => item !== undefined).map(([key, item]) => {
    if (Array.isArray(item)) {
      if (!item.length) return `${padding}${key}: []`;
      return `${padding}${key}:\n${stringifyYaml(item, indent + 2)}`;
    }
    if (item && typeof item === 'object') {
      if (!Object.keys(item).length) return `${padding}${key}: {}`;
      return `${padding}${key}:\n${stringifyYaml(item, indent + 2)}`;
    }
    return `${padding}${key}: ${scalarToYaml(item)}`;
  }).join('\n');
}

export function parseMarkdownDocument(text = '') {
  const normalized = String(text).replace(/\r\n/g, '\n');
  const match = normalized.match(FRONTMATTER);
  if (!match) return { frontmatter: {}, body: normalized, hasFrontmatter: false, rawFrontmatter: '' };
  return {
    frontmatter: parseYaml(match[1]),
    body: normalized.slice(match[0].length),
    hasFrontmatter: true,
    rawFrontmatter: match[1],
  };
}

export function stringifyMarkdownDocument(frontmatter, body = '') {
  const yaml = stringifyYaml(frontmatter).trimEnd();
  return `---\n${yaml}\n---\n\n${String(body).replace(/^\s*\n/, '').trimEnd()}\n`;
}

