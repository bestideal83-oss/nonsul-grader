// 제시문·답안 표시: 문단, 마크다운 표, 수식($...$, $$...$$)을 렌더링
import katex from 'katex';
import 'katex/dist/katex.min.css';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tex(src, display) {
  try { return katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore' }); }
  catch (e) { return esc(src); }
}

export function inlineHtml(text) {
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    out += m[1] !== undefined ? tex(m[1], true) : tex(m[2], false);
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}

function isTableLine(l) { return /^\s*\|.*\|\s*$/.test(l); }
function cells(l) { return l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()); }

function toHtml(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let html = '';
  for (let i = 0; i < lines.length;) {
    if (isTableLine(lines[i])) {
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) { rows.push(lines[i]); i++; }
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const hasHead = rows.length > 1 && /^\s*\|[\s:|-]+\|\s*$/.test(rows[1]);
      html += '<div class="rt-table-wrap"><table class="rt-table">';
      body.forEach((r, k) => {
        const tag = hasHead && k === 0 ? 'th' : 'td';
        html += '<tr>' + cells(r).map((c) => `<${tag}>${inlineHtml(c)}</${tag}>`).join('') + '</tr>';
      });
      html += '</table></div>';
      continue;
    }
    // $$ 블록이 여러 줄에 걸친 경우
    if (/^\s*\$\$/.test(lines[i]) && !/\$\$[\s\S]*\$\$/.test(lines[i])) {
      const buf = [lines[i]];
      i++;
      while (i < lines.length && !/\$\$/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) { buf.push(lines[i]); i++; }
      html += `<p>${inlineHtml(buf.join('\n'))}</p>`;
      continue;
    }
    const l = lines[i];
    html += l.trim() === '' ? '<p class="rt-gap"></p>' : `<p>${inlineHtml(l)}</p>`;
    i++;
  }
  return html;
}

export default function RichText({ text, className = '' }) {
  return <div className={'rich ' + className} dangerouslySetInnerHTML={{ __html: toHtml(text) }} />;
}
