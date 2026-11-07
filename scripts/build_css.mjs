// Tailwind CDN(브라우저에서 매번 CSS를 만들어 모바일에서 느림) 대신 쓸 정적 CSS를 만듭니다.
//   사용: TW=/경로/node_modules/tailwindcss node scripts/build_css.mjs
//   결과: assets/css/tw-base.css (페이지 <style> 앞에 연결), assets/css/tw-util.css (페이지 <style> 뒤에 연결)
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const TW = (process.env.TW || '/opt/npm-tools/node_modules/tailwindcss').replace(/\/$/, '') + '/';
const { compile } = await import(TW + 'dist/lib.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (['node_modules', '.git', 'scripts', 'css'].includes(f)) continue; walk(p); } else if (/\.(html|js)$/.test(f) && !/react\.min/.test(f)) files.push(p); } })(root);
const cand = new Set();
for (const f of files) { const t = fs.readFileSync(f, 'utf8'); for (const m of t.matchAll(/[A-Za-z0-9_\-:\/\.\[\]%#!@\(\),'"=\*&]+/g)) { const w = m[0].replace(/^['"(]+|['"),]+$/g, ''); if (w) cand.add(w); } }
const css = await compile('@import "tailwindcss";', { base: root, loadStylesheet: async (id, base) => {
  const p = id === 'tailwindcss' ? TW + 'index.css' : id.startsWith('tailwindcss/') ? TW + id.slice(12) + (id.endsWith('.css') ? '' : '.css') : path.resolve(base, id);
  return { path: p, base: path.dirname(p), content: fs.readFileSync(p, 'utf8') };
} });
const out = css.build([...cand]);
// 최상위 블록으로 나눈 뒤 @layer 를 풀어(v3처럼 페이지 CSS와 순서로 겨루게) 기초/유틸로 나눔
const blocks = []; let d = 0, st = 0;
for (let i = 0; i < out.length; i++) { const c = out[i]; if (c === '{') d++; else if (c === '}') { d--; if (!d) { blocks.push(out.slice(st, i + 1).trim()); st = i + 1; } } else if (c === ';' && !d) { blocks.push(out.slice(st, i + 1).trim()); st = i + 1; } }
const unwrap = (b) => b.replace(/^@layer\s+[\w-]+\s*\{/, '').replace(/\}\s*$/, '');
let base = '', util = '';
for (const b of blocks) {
  if (/^@layer\s+theme\s*,/.test(b) || /^\/\*/.test(b)) continue;
  if (/^@layer\s+(theme|base)\s*\{/.test(b)) base += unwrap(b) + '\n';
  else if (/^@layer\s+utilities\s*\{/.test(b)) util += unwrap(b) + '\n';
  else base += b + '\n';   // @property 등
}
base += `
/* v3 기본값과 맞추기 */
*,::after,::before,::backdrop,::file-selector-button{border-color:#e5e7eb}
button:not(:disabled),[role=button]:not(:disabled){cursor:pointer}
input[type=date],input[type=time],input[type=datetime-local],input[type=month]{-webkit-appearance:none;appearance:none;display:block;min-height:2.125rem;line-height:1.25rem;text-align:left;background-color:#fff;box-sizing:border-box}
input[type=date]::-webkit-date-and-time-value{text-align:left;min-height:1.25rem}
input[type=date]::-webkit-datetime-edit{padding:0}
input::placeholder,textarea::placeholder{color:#9ca3af;opacity:1}
.bg-opacity-40{--tw-bg-opacity:.4}
`;
util += `.bg-black.bg-opacity-40{background-color:rgb(0 0 0 / .4)}\n`;
fs.mkdirSync(path.join(root, 'assets/css'), { recursive: true });
fs.writeFileSync(path.join(root, 'assets/css/tw-base.css'), base); fs.writeFileSync(path.join(root, 'assets/css/tw-util.css'), util);
console.log('base', base.length, 'util', util.length);
