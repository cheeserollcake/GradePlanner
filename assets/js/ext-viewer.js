/* 내선번호 파일 보기: Firebase Storage 없이 Firestore 에 저장한 파일(data: 주소)을 화면에 보여 줍니다.
 *  - 엑셀(.xlsx): 브라우저에서 직접 읽어 표로 보여 줍니다(여러 시트는 위쪽 탭, 병합·배경색·굵은 글씨·가운데 정렬 지원)
 *  - PDF: 브라우저 PDF 보기, 이미지: 기본 이미지 뷰어(확대/축소)
 */
(function () {
  'use strict';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const mimeOf = (file) => {
    const n = String(file.name || '').toLowerCase(), t = file.type || '';
    if (t) return t;
    if (/\.xlsx$/.test(n)) return XLSX_MIME; if (/\.pdf$/.test(n)) return 'application/pdf';
    if (/\.(png)$/.test(n)) return 'image/png'; if (/\.(jpe?g)$/.test(n)) return 'image/jpeg';
    return '';
  };
  const b64ToBytes = (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const inflateRaw = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const dec = new TextDecoder('utf-8');
  function openZip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
    const n = dv.getUint16(e + 10, true); let off = dv.getUint32(e + 16, true); const files = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true), nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lho = dv.getUint32(off + 42, true);
      files[dec.decode(u8.subarray(off + 46, off + 46 + nl)).replace(/\\/g, '/').replace(/^\//, '')] = { method, csize, lho };
      off += 46 + nl + el + cl;
    }
    const lower = {}; Object.keys(files).forEach((k) => { lower[k.toLowerCase()] = k; });
    const reader = async (name) => {
      const f = files[name] || files[lower[String(name).toLowerCase()]]; if (!f) return null;
      const l = f.lho, start = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true); const data = u8.subarray(start, start + f.csize);
      return dec.decode(f.method === 0 ? data : await inflateRaw(data));
    };
    reader.names = Object.keys(files);
    return reader;
  }
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];   // 이름공간 접두어(x:sheet 등)가 달라도 읽음
  const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const rowIdx = (ref) => parseInt(ref.replace(/[A-Za-z]/g, ''), 10) - 1;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BUILTIN_DATE = [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47];
  const pad = (n) => String(n).padStart(2, '0');
  const serialDate = (v) => { const d = new Date(Math.round((Number(v) - 25569) * 86400000)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };

  async function parseXlsx(u8) {
    const read = openZip(u8);
    const wbText = await read('xl/workbook.xml'); if (!wbText) throw new Error('엑셀 파일 구조를 읽지 못했습니다. (파일 안 목록: ' + read.names.slice(0, 8).join(', ') + ')');
    const wb = xml(wbText); const relText = await read('xl/_rels/workbook.xml.rels'); const rels = xml(relText || '<r/>');
    const relMap = {}; kids(rels, 'Relationship').forEach((r) => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const relOf = (sh) => sh.getAttribute('r:id') || ([...sh.attributes].find((a) => a.localName === 'id') || {}).value;
    const sstXml = await read('xl/sharedStrings.xml'); const sst = [];
    if (sstXml) kids(xml(sstXml), 'si').forEach((si) => { let t = ''; [...si.childNodes].forEach((c) => { if (c.nodeName === 't') t += c.textContent; else if (c.nodeName === 'r') kids(c, 't').forEach((x) => { t += x.textContent; }); }); sst.push(t); });
    // 서식(배경색·굵게·정렬·날짜)
    const st = { xfs: [], fills: [], fonts: [], fmts: {} };
    const stXml = await read('xl/styles.xml');
    if (stXml) {
      const sx = xml(stXml);
      kids(sx, 'numFmt').forEach((n) => { st.fmts[n.getAttribute('numFmtId')] = n.getAttribute('formatCode') || ''; });
      const fillsEl = sx.getElementsByTagNameNS('*', 'fills')[0]; if (fillsEl) [...fillsEl.children].forEach((f) => { const p = f.getElementsByTagNameNS('*', 'patternFill')[0], fg = f.getElementsByTagNameNS('*', 'fgColor')[0]; st.fills.push(p && p.getAttribute('patternType') === 'solid' && fg && fg.getAttribute('rgb') ? '#' + fg.getAttribute('rgb').slice(-6) : ''); });
      const fontsEl = sx.getElementsByTagNameNS('*', 'fonts')[0]; if (fontsEl) [...fontsEl.children].forEach((f) => { const c = f.getElementsByTagNameNS('*', 'color')[0]; st.fonts.push({ b: !!f.getElementsByTagNameNS('*', 'b')[0], color: c && c.getAttribute('rgb') ? '#' + c.getAttribute('rgb').slice(-6) : '' }); });
      const xfsEl = sx.getElementsByTagNameNS('*', 'cellXfs')[0]; if (xfsEl) [...xfsEl.children].forEach((x) => { const al = x.getElementsByTagNameNS('*', 'alignment')[0]; st.xfs.push({ fmt: x.getAttribute('numFmtId') || '0', fill: +x.getAttribute('fillId') || 0, font: +x.getAttribute('fontId') || 0, h: al ? al.getAttribute('horizontal') : '' }); });
    }
    const isDate = (id) => BUILTIN_DATE.indexOf(+id) >= 0 || (st.fmts[id] && /[ymd]/i.test(st.fmts[id].replace(/\[[^\]]*\]|"[^"]*"/g, '')));
    const sheets = [];
    let shEls = kids(wb, 'sheet');
    if (!shEls.length) { const ws = read.names.filter((k) => /^xl\/worksheets\/[^/]+\.xml$/i.test(k)).sort(); shEls = ws.map((k, i) => ({ fallback: k, getAttribute: (a) => (a === 'name' ? '시트' + (i + 1) : null) })); }   // 시트 목록을 못 찾으면 시트 파일을 직접 읽음
    for (const sh of shEls) {
      let path; if (sh.fallback) path = sh.fallback; else { const target = relMap[relOf(sh)] || ''; path = target.charAt(0) === '/' ? target.slice(1) : target.replace(/^\.\.\//, '').replace(/^(?!xl\/)/, 'xl/'); }
      const sText = await read(path); if (!sText) continue;
      const sx = xml(sText); const cells = {}; let maxC = 0, maxR = 0;
      kids(sx, 'c').forEach((c) => {
        const ref = c.getAttribute('r'); const r = rowIdx(ref), ci = colIdx(ref), t = c.getAttribute('t'); const vEl = c.getElementsByTagNameNS('*', 'v')[0]; let v = vEl ? vEl.textContent : '';
        const xf = st.xfs[+c.getAttribute('s') || 0] || {};
        if (t === 's') v = sst[+v] || ''; else if (t === 'inlineStr') v = kids(c, 't').map((x) => x.textContent).join('');
        else if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== '' && (!t || t === 'n')) { if (isDate(xf.fmt)) v = serialDate(v); else { const n = Number(v); if (isFinite(n)) v = (xf.fmt === '3' || xf.fmt === '4') ? n.toLocaleString('ko-KR') : String(Math.round(n * 1e10) / 1e10); } }
        const font = st.fonts[xf.font] || {};
        cells[r + ',' + ci] = { v, bg: st.fills[xf.fill] || '', b: font.b, color: font.color, h: xf.h };
        if (r > maxR) maxR = r; if (ci > maxC) maxC = ci;
      });
      const merges = {}, covered = {};
      kids(sx, 'mergeCell').forEach((m) => { const [a, b] = m.getAttribute('ref').split(':'); if (!b) return; const r1 = rowIdx(a), c1 = colIdx(a), r2 = rowIdx(b), c2 = colIdx(b); merges[r1 + ',' + c1] = { rs: r2 - r1 + 1, cs: c2 - c1 + 1 }; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) covered[r + ',' + c] = 1; if (r2 > maxR) maxR = r2; if (c2 > maxC) maxC = c2; });
      const widths = []; kids(sx, 'col').forEach((c) => { for (let i = +c.getAttribute('min'); i <= +c.getAttribute('max') && i < 200; i++) widths[i - 1] = Math.round((+c.getAttribute('width') || 8.43) * 7 + 5); });
      sheets.push({ name: sh.getAttribute('name') || '시트', cells, merges, covered, widths, rows: maxR + 1, cols: maxC + 1 });
    }
    if (!sheets.length) throw new Error('시트를 찾지 못했습니다. (파일 안 목록: ' + read.names.slice(0, 10).join(', ') + ')');
    return sheets;
  }
  function sheetHtml(s) {
    let h = '<table style="border-collapse:collapse;font-size:14px;background:#fff;color:#0f172a"><colgroup>';
    for (let c = 0; c < s.cols; c++) h += '<col' + (s.widths[c] ? ' style="width:' + s.widths[c] + 'px"' : '') + '>'; h += '</colgroup><tbody>';
    for (let r = 0; r < s.rows; r++) {
      h += '<tr style="height:24px">';
      for (let c = 0; c < s.cols; c++) {
        const k = r + ',' + c; if (s.covered[k]) continue; const cell = s.cells[k] || { v: '' }, m = s.merges[k];
        const num = cell.v !== '' && /^-?[\d,]+(\.\d+)?$/.test(cell.v);
        h += '<td' + (m ? ' rowspan="' + m.rs + '" colspan="' + m.cs + '"' : '') + ' style="border:1px solid #cbd5e1;padding:4px 8px;white-space:pre-wrap;vertical-align:middle;' + (cell.bg ? 'background:' + cell.bg + ';' : '') + (cell.b ? 'font-weight:700;' : '') + 'text-align:' + (cell.h === 'center' || cell.h === 'centerContinuous' ? 'center' : cell.h === 'right' ? 'right' : cell.h === 'left' ? 'left' : num ? 'right' : 'left') + '">' + esc(cell.v) + '</td>';
      }
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }
  async function showXlsx(dataUrl) {
    const zone = document.getElementById('document-viewer-zone'); const ifr = document.getElementById('document-iframe');
    let box = document.getElementById('xlsx-view');
    if (!box) { box = document.createElement('div'); box.id = 'xlsx-view'; box.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;background:#f8fafc'; zone.appendChild(box); }
    ifr.classList.add('hidden'); box.style.display = 'flex'; box.innerHTML = '<div style="padding:24px;color:#64748b;text-align:center">엑셀을 불러오는 중...</div>';
    try {
      const sheets = await parseXlsx(b64ToBytes(dataUrl.split(',')[1]));
      if (!sheets.length) throw new Error('시트가 없습니다.');
      const draw = (i) => {
        box.innerHTML = (sheets.length > 1 ? '<div style="display:flex;gap:6px;padding:8px;overflow-x:auto;background:#fff;border-bottom:1px solid #e2e8f0">' + sheets.map((s, j) => '<button data-sh="' + j + '" style="padding:6px 14px;border-radius:999px;border:0;font-weight:700;font-size:13px;white-space:nowrap;cursor:pointer;' + (j === i ? 'background:#4f46e5;color:#fff' : 'background:#f1f5f9;color:#475569') + '">' + esc(s.name) + '</button>').join('') + '</div>' : '') +
          '<div style="flex:1;overflow:auto;padding:12px;-webkit-overflow-scrolling:touch">' + sheetHtml(sheets[i]) + '</div>';
        box.querySelectorAll('[data-sh]').forEach((b) => { b.onclick = () => draw(+b.dataset.sh); });
      };
      draw(0);
    } catch (e) { console.error(e); box.innerHTML = '<div style="padding:24px;color:#dc2626;text-align:center">엑셀을 표시하지 못했습니다: ' + esc(e.message) + '</div>'; }
  }
  // 파일이 Firestore 에 저장된 경우(data: 주소) 여기서 처리. 처리했으면 true
  function handle(id, mime) {
    if (!/^data:/.test(String(id || ''))) return false;
    const zoom = document.getElementById('zoom-zone'), doc = document.getElementById('document-viewer-zone'), reset = document.getElementById('img-reset-btn'), ifr = document.getElementById('document-iframe');
    const xv = document.getElementById('xlsx-view'); if (xv) xv.style.display = 'none';
    if (!mime || mime.indexOf('image/') === 0) return false;   // 이미지는 기본 보기(확대·축소)
    zoom.classList.add('hidden'); doc.classList.remove('hidden'); reset.classList.add('hidden');
    if (mime.indexOf('pdf') >= 0) { ifr.classList.remove('hidden'); ifr.src = URL.createObjectURL(new Blob([b64ToBytes(id.split(',')[1])], { type: 'application/pdf' })); return true; }
    showXlsx(id); return true;
  }
  window.ExtViewer = { handle, mimeOf, parseXlsx, XLSX_MIME };
})();
