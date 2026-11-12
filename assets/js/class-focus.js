/* 학급 선택(상단 바의 1반 2반 … 버튼) — 고른 학급에 해당하는 내용만 굵게 강조합니다.
 *  - 바깥 화면(index.html)이 window.__gpSel = { n: 학급 번호, name: 학급 이름 } 을 넣고 window.__gpClassFocus.apply() 를 부릅니다.
 *  - 글자 칸: 띄어쓰기·쉼표 등으로 나눈 낱말 중에 학급 이름(예: 3반, 사과반)이 있으면 굵게.
 *  - 표의 줄 머리(첫 칸)가 학급 이름이면 그 줄 전체를 굵게. 입력칸·선택칸의 값, 예산의 학급별 수량(data-raw)도 봅니다.
 *  - 전담 시간표처럼 칸에 학급 번호만 적는 곳(선택칸)은 번호(예: 3)도 같은 학급으로 봅니다.
 */
(function () {
  if (window.__gpClassFocus) return;
  const st = document.createElement('style');
  st.textContent = '.gp-cf-hit{font-weight:800 !important}.gp-cf-row>td,.gp-cf-row>th,.gp-cf-row td *,.gp-cf-row input,.gp-cf-row select{font-weight:800 !important}';
  document.head.appendChild(st);
  const SPLIT = /[^0-9A-Za-z가-힣]+/;
  const page = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
  let busy = false, timer = 0;
  function tokens(t) { return String(t || '').split(SPLIT).filter(Boolean); }
  function apply() {
    busy = true;
    try {
      document.querySelectorAll('.gp-cf-hit').forEach((e) => e.classList.remove('gp-cf-hit'));
      document.querySelectorAll('.gp-cf-row').forEach((e) => e.classList.remove('gp-cf-row'));
      const sel = window.__gpSel; if (!sel || !sel.name) return;
      const name = String(sel.name), num = /^\d+반$/.test(name) ? String(parseInt(name, 10)) : null;
      const has = (t, allowNum) => { const k = tokens(t); return k.indexOf(name) >= 0 || (allowNum && num && k.indexOf(num) >= 0); };
      // 1) 글자만 있는 칸(자식 요소가 없는 요소)
      document.body.querySelectorAll('body *:not(script):not(style):not(svg):not(svg *):not(option)').forEach((el) => {
        if (el.childElementCount) return; const t = el.textContent; if (!t || t.length > 200) return;
        if (!has(t, false)) return; el.classList.add('gp-cf-hit');
        const cell = el.closest('td,th'); const tr = cell && cell.parentElement;
        if (tr && tr.tagName === 'TR' && tr.firstElementChild === cell && cell.textContent.trim() === name) tr.classList.add('gp-cf-row');   // 줄 머리가 학급 이름 → 그 줄 전체
      });
      // 2) 입력칸·선택칸 값 (전담 시간표의 선택칸은 번호도 인정)
      document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]),select,textarea').forEach((el) => {
        if (has(el.value, el.tagName === 'SELECT' && page === 'timetable-special')) el.classList.add('gp-cf-hit');
      });
      // 3) 예산 학급별 수량 등 data-raw → 그 줄 전체
      document.querySelectorAll('[data-raw]').forEach((el) => { if (has(el.getAttribute('data-raw'), false)) { const tr = el.closest('tr'); if (tr) tr.classList.add('gp-cf-row'); else el.classList.add('gp-cf-hit'); } });
    } finally { setTimeout(() => { busy = false; }, 0); }
  }
  function later() { if (busy) return; clearTimeout(timer); timer = setTimeout(apply, 120); }
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'value'] });   // 화면이 다시 그려져 표시가 지워져도 다시 칠함 (내가 바꾼 class 는 busy 동안이라 무시)
  document.addEventListener('change', later, true); document.addEventListener('input', later, true);
  window.__gpClassFocus = { apply };
  apply();
})();
