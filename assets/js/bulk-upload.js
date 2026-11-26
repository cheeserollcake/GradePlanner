/* 일괄 업로드 도우미 (쇼핑몰 ID · 특별실 비밀번호)
 *  BulkUpload.template({ file, sheet, cols:[{label, w, ex}] })  → 업로드 양식(.xlsx) 내려받기 (1행 머리글, 2행 작성 예시, 칸은 '텍스트' 서식)
 *  BulkUpload.pick({ cols:[{key, label, alias:[...] , req}] }) → 파일을 골라 읽고 [{key: 값}] 를 돌려줌 (.xlsx / .csv)
 *  필요: xlsx-lite.js(양식 만들기), ext-viewer.js(엑셀 읽기)
 */
(function () {
  'use strict';
  const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
  const normH = (s) => str(s).replace(/\s+/g, '').replace(/[()（）]/g, '').replace(/\(필수\)|필수/g, '').toLowerCase();
  const EX = '예시';

  function template(o) {
    const head = o.cols.map((c) => ({ v: c.label + (c.req ? ' (필수)' : ''), s: 'header' }));
    const ex = o.cols.map((c, i) => ({ v: i === 0 ? EX + ') ' + (c.ex || '') : (c.ex || ''), s: 'text' }));
    const blank = Array.from({ length: 60 }, () => o.cols.map(() => ({ v: '', s: 'text' })));
    const sheets = [{ name: o.sheet || '업로드', widths: o.cols.map((c) => c.w || 20), freezeRow: 1, rows: [head, ex].concat(blank) }];
    const a = document.createElement('a'); a.href = URL.createObjectURL(window.XlsxLite.toBlob(sheets)); a.download = (o.file || '업로드_양식') + '.xlsx';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // CSV 한 줄씩 (따옴표 안의 쉼표·줄바꿈 처리)
  function parseCsv(t) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  async function readGrid(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (/\.csv$/i.test(file.name)) {
      let t = new TextDecoder('utf-8').decode(buf); if (t.indexOf('�') >= 0) { try { t = new TextDecoder('euc-kr').decode(buf); } catch (e) { /* 그대로 */ } }
      return [parseCsv(t.replace(/^﻿/, ''))];
    }
    if (!window.ExtViewer || !window.ExtViewer.parseXlsx) throw new Error('엑셀 읽기 도구를 불러오지 못했습니다.');
    const shs = await window.ExtViewer.parseXlsx(buf);
    return shs.map((sh) => { const rows = []; for (let r = 0; r < sh.rows; r++) { const row = []; for (let c = 0; c < sh.cols; c++) { const x = sh.cells[r + ',' + c]; row.push(x ? x.v : ''); } rows.push(row); } return rows; });
  }
  // 머리글 줄을 찾아 열을 맞춤 (못 찾으면 양식의 열 순서로 읽음)
  function toRecords(grids, cols) {
    const names = cols.map((c) => [c.label].concat(c.alias || []).map(normH));
    for (const g of grids) {
      let h = -1, map = null;
      for (let r = 0; r < Math.min(g.length, 10) && h < 0; r++) {
        const m = {}; g[r].forEach((cell, ci) => { const n = normH(cell); const k = names.findIndex((a) => a.indexOf(n) >= 0); if (n && k >= 0 && m[k] === undefined) m[k] = ci; });
        if (Object.keys(m).length >= Math.min(2, cols.length)) { h = r; map = m; }
      }
      if (h < 0) { if (!g.some((r) => r.some((c) => str(c)))) continue; h = -1; map = {}; cols.forEach((_, i) => { map[i] = i; }); }
      const out = [];
      g.slice(h + 1).forEach((r, j) => {
        const rec = {}; cols.forEach((c, i) => { rec[c.key] = map[i] === undefined ? '' : str(r[map[i]]); });
        Object.defineProperty(rec, '__row', { value: h + 2 + j });   // 엑셀에서 보이는 행 번호
        if (!cols.some((c) => rec[c.key])) return;   // 빈 줄
        if (str(r[map[0]]).indexOf(EX + ')') === 0) return;   // 양식의 작성 예시 줄
        out.push(rec);
      });
      if (out.length) return out;
    }
    return [];
  }
  function pick(o) {
    return new Promise((resolve, reject) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.csv'; inp.style.display = 'none';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; inp.remove(); if (!f) return resolve(null);
        try { resolve(toRecords(await readGrid(f), o.cols)); } catch (e) { reject(e); }
      };
      document.body.appendChild(inp); inp.click();
    });
  }
  window.BulkUpload = { template, pick, toRecords };
})();
