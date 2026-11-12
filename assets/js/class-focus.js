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
    '.gp-cf-row>td,.gp-cf-row>th{font-weight:800 !important;background-image:linear-gradient(' + MARK + ',' + MARK + ') !important}.gp-cf-row td *,.gp-cf-row input,.gp-cf-row select{font-weight:800 !important}';
  document.head.appendChild(st);
  const WORD = /[0-9A-Za-z가-힣]+/g;
  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
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
      if (HL) CSS.highlights.delete('gp-cls');
      const sel = window.__gpSel; if (!sel || !sel.name) return;
      const name = String(sel.name), num = /^\d+반$/.test(name) ? String(parseInt(name, 10)) : null;
      const has = (t, allowNum) => { const k = tokens(t); return k.indexOf(name) >= 0 || (allowNum && num && k.indexOf(num) >= 0); };
      // 1) 글자: 줄 단위로 찾아 하이라이트
      const ranges = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => {
        const p = n.parentElement; if (!p || !n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (p.closest('script,style,option,svg,textarea,#gp-none')) return NodeFilter.FILTER_REJECT;
        return n.nodeValue.indexOf(name) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      } });
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.nodeValue; let pos = 0;
        text.split('\n').forEach((line) => {
          const start = pos; pos += line.length + 1;
          if (!has(line, false)) return;
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
          if (tr && tr.tagName === 'TR' && tr.firstElementChild === cell && cell.textContent.trim() === name) tr.classList.add('gp-cf-row');   // 줄 머리가 학급 이름 → 그 줄 전체
        });
      }
      if (HL && ranges.length) CSS.highlights.set('gp-cls', new Highlight(...ranges));
      // 2) 입력칸·선택칸 값 (전담 시간표의 선택칸은 번호도 인정)
      document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]),select').forEach((el) => {
        if (el.closest('#clsSel')) return;
        if (has(el.value, el.tagName === 'SELECT' && page === 'timetable-special')) el.classList.add('gp-cf-hit');
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
