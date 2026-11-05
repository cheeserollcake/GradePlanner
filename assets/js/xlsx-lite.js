/*
 * xlsx-lite.js : 외부 라이브러리 없이 .xlsx 파일을 만들고, 같은 표를 구글 스프레드시트 API 요청으로 바꿔 주는 도구
 *
 * 표 설명(spec) 하나로 두 가지를 모두 만듭니다.
 *   { name: '예산 내역', widths: [16, 24, ...], freezeRow: 1, filter: true,
 *     rows: [ [ {v:'예산종류', s:'header'}, ... ], [ {v:'교구', s:'text'}, {v:8, s:'int'}, {v:1104000, s:'int', f:'D2*E2'},
 *             {v:'링크', s:'link', f:'HYPERLINK("https://...","링크")'} ] ] }
 *   s(스타일): header | text | center | int | link | totalLabel | totalNum | title
 *   f(수식): 엑셀 수식(맨 앞 = 없이). v 는 수식이 계산된 값(미리 보기용)입니다.
 */
(function (root) {
  'use strict';
  const enc = new TextEncoder();
  const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

  // 압축 없이 묶는(zip store) 간단한 zip 작성기
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data), size = data.length;
      const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, data);
      central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + size;
    });
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    return parts.concat(central, [end]);
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const STYLE_ID = { default: 0, header: 1, text: 2, int: 3, totalLabel: 4, totalNum: 5, link: 6, title: 7, center: 8 };
  const norm = (c) => (c && typeof c === 'object' && !Array.isArray(c) ? c : { v: c === undefined || c === null ? '' : c, s: typeof c === 'number' ? 'int' : 'text' });

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="5"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font>' +
    '<font><u/><sz val="11"/><color rgb="FF2563EB"/><name val="맑은 고딕"/></font><font><b/><sz val="14"/><name val="맑은 고딕"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="3" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function sheetXml(sp) {
    const rows = sp.rows.map((r) => r.map(norm));
    const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    xml += '<sheetViews><sheetView workbookViewId="0">' + (sp.freezeRow ? '<pane ySplit="' + sp.freezeRow + '" topLeftCell="A' + (sp.freezeRow + 1) + '" activePane="bottomLeft" state="frozen"/>' : '') + '</sheetView></sheetViews>';
    xml += '<sheetFormatPr defaultRowHeight="18"/>';
    if (sp.widths && sp.widths.length) xml += '<cols>' + sp.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
    xml += '<sheetData>';
    rows.forEach((r, ri) => {
      xml += '<row r="' + (ri + 1) + '" ht="20" customHeight="1">';
      r.forEach((c, ci) => {
        const ref = colName(ci) + (ri + 1), s = STYLE_ID[c.s] === undefined ? 0 : STYLE_ID[c.s];
        if (c.f) {
          if (typeof c.v === 'number') xml += '<c r="' + ref + '" s="' + s + '"><f>' + esc(c.f) + '</f><v>' + c.v + '</v></c>';
          else xml += '<c r="' + ref + '" s="' + s + '" t="str"><f>' + esc(c.f) + '</f><v>' + esc(c.v) + '</v></c>';
        } else if (typeof c.v === 'number') xml += '<c r="' + ref + '" s="' + s + '"><v>' + c.v + '</v></c>';
        else if (c.v === '' || c.v === null || c.v === undefined) xml += '<c r="' + ref + '" s="' + s + '"/>';
        else xml += '<c r="' + ref + '" s="' + s + '" t="inlineStr"><is><t xml:space="preserve">' + esc(c.v) + '</t></is></c>';
      });
      xml += '</row>';
    });
    xml += '</sheetData>';
    if (sp.filter && rows.length > 1) xml += '<autoFilter ref="A1:' + colName(Math.max(maxCols - 1, 0)) + (sp.filterRows || rows.length) + '"/>';
    return xml + '</worksheet>';
  }
  const safeName = (n) => String(n).replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';

  function build(sheets) {   // -> zip 조각(Uint8Array 배열)
    const files = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(safeName(s.name)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: STYLES }
    ].concat(sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(s) })));
    return zip(files);
  }
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const toBlob = (sheets) => new Blob(build(sheets), { type: XLSX_MIME });
  const toBytes = (sheets) => { const parts = build(sheets); const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out; };

  // ---- 구글 스프레드시트 API(spreadsheets.create) 요청 본문
  const GRAY = { red: 0.8, green: 0.835, blue: 0.882 };
  const border = { style: 'SOLID', color: GRAY };
  const BORDERS = { top: border, bottom: border, left: border, right: border };
  const FORMAT = {
    header: { backgroundColor: { red: 0.31, green: 0.275, blue: 0.9 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', borders: BORDERS },
    text: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', borders: BORDERS },
    center: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', borders: BORDERS },
    int: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, verticalAlignment: 'MIDDLE', borders: BORDERS },
    link: { textFormat: { underline: true, foregroundColor: { red: 0.145, green: 0.388, blue: 0.922 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', borders: BORDERS },
    totalLabel: { backgroundColor: { red: 0.945, green: 0.961, blue: 0.976 }, textFormat: { bold: true }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', borders: BORDERS },
    totalNum: { backgroundColor: { red: 0.945, green: 0.961, blue: 0.976 }, textFormat: { bold: true }, numberFormat: { type: 'NUMBER', pattern: '#,##0' }, verticalAlignment: 'MIDDLE', borders: BORDERS },
    title: { textFormat: { bold: true, fontSize: 14 } }
  };
  function cellData(c) {
    const o = {};
    if (c.f) o.userEnteredValue = { formulaValue: '=' + c.f };
    else if (typeof c.v === 'number') o.userEnteredValue = { numberValue: c.v };
    else if (c.v !== '' && c.v !== null && c.v !== undefined) o.userEnteredValue = { stringValue: String(c.v) };
    if (FORMAT[c.s]) o.userEnteredFormat = FORMAT[c.s];
    return o;
  }
  function toSheetsRequest(title, sheets) {
    return {
      properties: { title, locale: 'ko_KR' },
      sheets: sheets.map((sp, i) => {
        const rows = sp.rows.map((r) => r.map(norm)); const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
        const sheet = {
          properties: { sheetId: i + 1, title: safeName(sp.name), gridProperties: { frozenRowCount: sp.freezeRow || 0 } },
          data: [{ startRow: 0, startColumn: 0, rowData: rows.map((r) => ({ values: r.map(cellData) })), columnMetadata: (sp.widths || []).map((w) => ({ pixelSize: Math.round(w * 7 + 8) })) }]
        };
        if (sp.filter && rows.length > 1) sheet.basicFilter = { range: { sheetId: i + 1, startRowIndex: 0, endRowIndex: sp.filterRows || rows.length, startColumnIndex: 0, endColumnIndex: cols } };
        return sheet;
      })
    };
  }

  const api = { build, toBlob, toBytes, toSheetsRequest, colName, XLSX_MIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XlsxLite = api;
})(typeof window !== 'undefined' ? window : globalThis);
