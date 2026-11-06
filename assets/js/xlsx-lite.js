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
      const name = enc.encode(f.name), data = f.bytes || enc.encode(f.text), crc = crc32(data), size = data.length;
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
  const STYLE_ID = { default: 0, header: 1, text: 2, int: 3, totalLabel: 4, totalNum: 5, link: 6, title: 7, center: 8, male: 9, female: 10 };
  const norm = (c) => (c && typeof c === 'object' && !Array.isArray(c) ? c : { v: c === undefined || c === null ? '' : c, s: typeof c === 'number' ? 'int' : 'text' });

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="5"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font>' +
    '<font><u/><sz val="11"/><color rgb="FF2563EB"/><name val="맑은 고딕"/></font><font><b/><sz val="14"/><name val="맑은 고딕"/></font></fonts>' +
    '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCFE2F3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFCE5CD"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="3" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function sheetXml(sp) {
    const rows = sp.rows.map((r) => r.map(norm));
    const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    xml += '<sheetViews><sheetView workbookViewId="0">' + (sp.freezeRow ? '<pane ySplit="' + sp.freezeRow + '" topLeftCell="A' + (sp.freezeRow + 1) + '" activePane="bottomLeft" state="frozen"/>' : '') + '</sheetView></sheetViews>';
    xml += '<sheetFormatPr defaultRowHeight="18"/>';
    if (sp.widths && sp.widths.length) xml += '<cols>' + sp.widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
    xml += '<sheetData>';
    rows.forEach((r, ri) => {
      const imgH = Math.max(0, ...r.map((c) => (c.img ? Math.round(c.img.h * 0.75) + 6 : 0)));
      xml += '<row r="' + (ri + 1) + '" ht="' + Math.max(20, imgH) + '" customHeight="1">';
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
    if (sp.merges && sp.merges.length) xml += '<mergeCells count="' + sp.merges.length + '">' + sp.merges.map((m) => '<mergeCell ref="' + m + '"/>').join('') + '</mergeCells>';
    if (rows.some((r) => r.some((c) => c.img))) xml += '<drawing r:id="rId1"/>';
    return xml + '</worksheet>';
  }
  // 이미지가 들어 있는 셀 → 그림(drawing) 파일 묶음
  function drawingParts(sp, n, imgStart) {   // n: 시트 번호, imgStart: 지금까지 쓴 이미지 수
    const pics = []; sp.rows.forEach((r, ri) => r.map(norm).forEach((c, ci) => { if (c.img) pics.push({ r: ri, c: ci, img: c.img }); }));
    if (!pics.length) return null;
    const EMU = 9525;
    const anchors = pics.map((p, i) => '<xdr:oneCellAnchor><xdr:from><xdr:col>' + p.c + '</xdr:col><xdr:colOff>' + 3 * EMU + '</xdr:colOff><xdr:row>' + p.r + '</xdr:row><xdr:rowOff>' + 3 * EMU + '</xdr:rowOff></xdr:from><xdr:ext cx="' + p.img.w * EMU + '" cy="' + p.img.h * EMU + '"/>' +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (i + 2) + '" name="Picture ' + (i + 1) + '"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + (i + 1) + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
      '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + p.img.w * EMU + '" cy="' + p.img.h * EMU + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>').join('');
    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return {
      files: [
        { name: 'xl/drawings/drawing' + n + '.xml', text: head + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + anchors + '</xdr:wsDr>' },
        { name: 'xl/drawings/_rels/drawing' + n + '.xml.rels', text: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + pics.map((p, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + (imgStart + i + 1) + '.jpg"/>').join('') + '</Relationships>' },
        { name: 'xl/worksheets/_rels/sheet' + n + '.xml.rels', text: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + n + '.xml"/></Relationships>' }
      ].concat(pics.map((p, i) => ({ name: 'xl/media/image' + (imgStart + i + 1) + '.jpg', bytes: p.img.bytes }))),
      count: pics.length
    };
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
    let imgN = 0, any = false;
    sheets.forEach((s, i) => { const d = drawingParts(s, i + 1, imgN); if (d) { any = true; imgN += d.count; d.files.forEach((f) => files.push(f)); } });
    if (any) {
      const ct = files[0]; ct.text = ct.text.replace('</Types>', '<Default Extension="jpg" ContentType="image/jpeg"/>' + sheets.map((s, i) => (s.rows.some((r) => r.some((c) => c && c.img)) ? '<Override PartName="/xl/drawings/drawing' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : '')).join('') + '</Types>');
    }
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
    title: { textFormat: { bold: true, fontSize: 14 } },
    male: { backgroundColor: { red: 0.812, green: 0.886, blue: 0.953 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', borders: BORDERS },
    female: { backgroundColor: { red: 0.988, green: 0.898, blue: 0.804 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', borders: BORDERS }
  };
  function cellData(c) {
    const o = {};
    if (c.img) o.userEnteredValue = { formulaValue: '=IMAGE("' + c.img.url + '")' };
    else if (c.f) o.userEnteredValue = { formulaValue: '=' + c.f };
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
          data: [{ startRow: 0, startColumn: 0, rowData: rows.map((r) => ({ values: r.map(cellData) })), rowMetadata: rows.map((r) => { const h = Math.max(0, ...r.map((c) => (c.img ? c.img.h + 8 : 0))); return h ? { pixelSize: h } : {}; }), columnMetadata: (sp.widths || []).map((w) => ({ pixelSize: Math.round(w * 7 + 8) })) }]
        };
        if (sp.merges && sp.merges.length) {
          const cn = (t) => { let n = 0; for (const ch of t.replace(/[0-9]/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }, rn = (t) => Number(t.replace(/[A-Z]/g, '')) - 1;
          sheet.merges = sp.merges.map((m) => { const [x, y] = m.split(':'); return { sheetId: i + 1, startRowIndex: rn(x), endRowIndex: rn(y) + 1, startColumnIndex: cn(x), endColumnIndex: cn(y) + 1 }; });
        }
        if (sp.filter && rows.length > 1) sheet.basicFilter = { range: { sheetId: i + 1, startRowIndex: 0, endRowIndex: sp.filterRows || rows.length, startColumnIndex: 0, endColumnIndex: cols } };
        return sheet;
      })
    };
  }

  const api = { build, toBlob, toBytes, toSheetsRequest, colName, XLSX_MIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.XlsxLite = api;
})(typeof window !== 'undefined' ? window : globalThis);
