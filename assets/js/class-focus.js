/* 학급 선택(상단 바의 1반 2반 … 버튼) — 고른 학급에 해당하는 내용만 형광펜 + 굵게 강조합니다.
 *  - 바깥 화면(index.html)이 window.__gpSel = { n: 학급 번호, name: 학급 이름 } 을 넣고 window.__gpClassFocus.apply() 를 부릅니다.
 *  - 강조 단위: 글자 칸 안의 '한 줄'. 그 줄에 학급 이름(예: 2반)이 따로 떨어진 낱말로 있으면 그 줄만 강조합니다.
 *    (줄이 '1반, 2반, 3반'처럼 학급 이름만 나열된 경우에는 그 학급 이름만 강조)  → 12반·2반 포함 묶음 일정 전체가 강조되지 않음
 *  - 페이지 글자는 건드리지 않고 브라우저의 '하이라이트' 기능(CSS Custom Highlight)으로 칠합니다(React 화면이 깨지지 않음).
 *  - 표의 줄 머리(첫 칸)가 학급 이름이면 그 줄 전체, 입력칸·선택칸 값이 그 학급이면 그 칸, 예산의 학급별 수량(data-raw)에 그 학급이 있으면 그 줄을 강조합니다.
 *  - 전담 시간표의 선택칸처럼 번호만 적는 곳은 번호(예: 2)도 같은 학급으로 봅니다.
 */
(function () {
  if (window.__gpClassFocus) return;
  const MARK = 'rgba(253, 224, 71, .55)';   // 형광펜(노랑)
  const st = document.createElement('style');
  st.textContent = '::highlight(gp-cls){background-color:' + MARK + ';color:inherit;text-shadow:.35px 0 0 currentColor,-.35px 0 0 currentColor}' +
    '.gp-cf-hit{font-weight:800 !important;background-image:linear-gradient(' + MARK + ',' + MARK + ') !important}' +
    '.gp-cf-box,.gp-cf-box *{font-weight:800 !important}.gp-cf-box{outline:2px solid #4f46e5 !important;outline-offset:-2px;position:relative;z-index:1}' +
    '.gp-cf-row>td,.gp-cf-row>th{font-weight:800 !important;background-image:linear-gradient(' + MARK + ',' + MARK + ') !important}.gp-cf-row td *,.gp-cf-row input,.gp-cf-row select{font-weight:800 !important}';
  document.head.appendChild(st);
  const WORD = /[0-9A-Za-z가-힣]+/g;
  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  // 페이지마다 강조 방법: hl = 형광펜+굵게(기본), box = 굵게+칸 테두리(형광펜 없음), both = 형광펜+굵게+칸 테두리
  const MODE = { 'timetable-special': 'box', 'timetable-room': 'box', 'lookup-course': 'both' }[page] || 'hl';
  const SKIP_HEAD = page === 'timetable-basic';   // 기초 시간표: 표 머리글(N반, 월~금)은 강조하지 않음
  const cellOf = (el) => el && el.closest('td,th,.grid-col');
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
  let busy = false, timer = 0;
  const tokens = (t) => String(t || '').match(WORD) || [];
  // 학급 이름만 나열된 줄인지 (예: "1반, 2반, 3반")
  const onlyClasses = (line) => { const t = tokens(line); return t.length > 0 && t.every((w) => /^\d+반$/.test(w) || (window.__CN || []).indexOf(w) >= 0); };
  function apply() {
    busy = true;
    try {
      document.querySelectorAll('.gp-cf-hit').forEach((e) => e.classList.remove('gp-cf-hit'));
      document.querySelectorAll('.gp-cf-row').forEach((e) => e.classList.remove('gp-cf-row'));
      document.querySelectorAll('.gp-cf-box').forEach((e) => e.classList.remove('gp-cf-box'));
      if (HL) CSS.highlights.delete('gp-cls');
      const sel = window.__gpSel; if (!sel || !sel.name) return;
      const name = String(sel.name), num = /^\d+반$/.test(name) ? String(parseInt(name, 10)) : null;
      const has = (t, allowNum) => { const k = tokens(t); return k.indexOf(name) >= 0 || (allowNum && num && k.indexOf(num) >= 0); };
      // 1) 글자: 줄 단위로 찾아 하이라이트
      const ranges = [];
      // 0) 반·교시·내용을 나눠 그린 일정 한 줄(.gp-ln) → 그 학급이 들어 있으면 줄 전체 (data-cls 에 "1반,4반"처럼 모든 학급 이름이 있음)
      document.querySelectorAll('.gp-ln').forEach((ln) => {
        const cl = (ln.getAttribute('data-cls') || '').split(',').map((x) => x.trim());
        if (cl.indexOf(name) < 0 && !has(ln.textContent, false)) return;
        if (MODE !== 'hl') { const c = cellOf(ln); if (c) c.classList.add('gp-cf-box'); }
        if (MODE === 'box') return;
        if (HL) { const r = new Range(); r.selectNodeContents(ln); ranges.push(r); } else ln.classList.add('gp-cf-hit');
      });
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
        const p = n.parentElement; if (!p || !n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (p.closest('script,style,option,svg,textarea,#gp-none,.gp-ln')) return NodeFilter.FILTER_REJECT;
        if (SKIP_HEAD && p.closest('thead')) return NodeFilter.FILTER_REJECT;
        return n.nodeValue.indexOf(name) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue; let pos = 0;
        text.split('\n').forEach((line) => {
          const start = pos; pos += line.length + 1;
          if (!has(line, false)) return;
          if (MODE !== 'hl') { const c = cellOf(n.parentElement); if (c) c.classList.add('gp-cf-box'); }
          if (MODE === 'box') return;   // 형광펜 없이 칸 테두리+굵게만
          const add = (a, b) => { if (HL) { const r = new Range(); r.setStart(n, a); r.setEnd(n, b); ranges.push(r); } };
          if (onlyClasses(line)) {   // 학급 이름 목록이면 그 이름만
            let m; const re = new RegExp('(^|[^0-9A-Za-z가-힣])(' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![0-9A-Za-z가-힣])', 'g');
            while ((m = re.exec(line))) { const s = start + m.index + m[1].length; add(s, s + m[2].length); }
          } else {   // 일정 한 줄(예: "2반 4교시 튜터") → 그 줄 전체(앞뒤 공백 제외)
            const lead = line.length - line.replace(/^\s+/, '').length, trail = line.replace(/\s+$/, '').length;
            if (trail > lead) add(start + lead, start + trail);
          }
          if (!HL && n.parentElement && n.parentElement.childElementCount === 0 && n.parentElement.textContent.trim().split('\n').length === 1) n.parentElement.classList.add('gp-cf-hit');   // 하이라이트를 못 쓰는 오래된 브라우저
          const cell = n.parentElement.closest('td,th'); const tr = cell && cell.parentElement;
          if (tr && tr.tagName === 'TR' && !tr.closest('thead') && tr.querySelector('td') && tr.firstElementChild === cell && cell.textContent.trim() === name) tr.classList.add('gp-cf-row');   // 줄 머리가 학급 이름 → 그 줄 전체 (머리글 줄은 제외)
        });
      }
      if (HL && ranges.length) CSS.highlights.set('gp-cls', new Highlight(...ranges));
      // 2) 입력칸·선택칸 값 (전담 시간표의 선택칸은 번호도 인정)
      document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]),select').forEach((el) => {
        if (el.closest('#clsSel')) return;
        if (!has(el.value, el.tagName === 'SELECT' && page === 'timetable-special')) return;
        if (MODE === 'hl') el.classList.add('gp-cf-hit'); else { const c = cellOf(el); (c || el).classList.add('gp-cf-box'); if (MODE === 'both') el.classList.add('gp-cf-hit'); }
      });
      // 3) 예산 학급별 수량 등 data-raw → 그 줄 전체
      document.querySelectorAll('[data-raw]').forEach((el) => { if (has(el.getAttribute('data-raw'), false)) { const tr = el.closest('tr'); if (tr) tr.classList.add('gp-cf-row'); else el.classList.add('gp-cf-hit'); } });
    } finally { setTimeout(() => { busy = false; }, 0); }
  }
  function later() { if (busy) return; clearTimeout(timer); timer = setTimeout(apply, 120); }
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'value'] });   // 화면이 다시 그려져 표시가 지워져도 다시 칠함
  document.addEventListener('change', later, true); document.addEventListener('input', later, true);
  window.__gpClassFocus = { apply };
  apply();
})();
