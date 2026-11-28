/* 사이트 공통 아이콘 (배경 없는 검은 선 아이콘) · 아이콘 버튼 · 마우스를 올리면 뜨는 기능 이름
 *  GPI.svg(이름, 크기)  → <svg> 문자열
 *  GPI.btn(이름, 기능이름, 속성문자열) → 아이콘만 있는 버튼 문자열 (마우스를 올리면 기능 이름이 뜸)
 *  HTML 에 <button data-gpi="download" data-tip="내보내기"></button> 처럼 두면 아이콘을 자동으로 채움
 *  이름: gear · calendar · chevron · wide · download · upload · template · trash · clipboard · grid · sheets · excel · refresh
 */
(function () {
  if (window.GPI) return;
  const S = (body, sw) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  const ICONS = {
    gear: S('<path d="M12.2 2.5h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7v-.2a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>'),
    chevron: S('<path d="m6 9 6 6 6-6"/>', 2),
    wide: S('<path d="M7 7 2 12l5 5M17 7l5 5-5 5M2 12h20"/>', 2),
    download: S('<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 14.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3"/>', 2.2),
    upload: S('<path d="M12 14.5v-11M7.5 8 12 3.5 16.5 8"/><path d="M4.5 14.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3"/>', 2.2),
    template: S('<path d="M13 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2H11"/><path d="M13 2.5V7h4.5"/><path d="M13 2.5 17.5 7v4"/><circle cx="16.5" cy="17" r="4.5"/><path d="M16.5 19.2v-4.4M14.6 16.7l1.9-1.9 1.9 1.9"/>'),
    trash: S('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>'),
    clipboard: S('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m8.5 14 2.5 2.5 5-5"/>', 2),
    edit: S('<path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/><path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.9.9-3.6z"/>'),
    grid: S('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
    calendar: S('<rect x="3.5" y="4.5" width="17" height="16" rx="2.2"/><path d="M8 2.5v4M16 2.5v4M3.5 10h17"/>'),
    refresh: S('<path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8"/><path d="M21 3v5h-5"/>'),
    // 색이 있는 아이콘
    sheets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 1.5h8.5L20 7v13.5A2 2 0 0 1 18 22.5H6a2 2 0 0 1-2-2v-17a2 2 0 0 1 2-2z" fill="#23A566"/><path d="M14.5 1.5V7H20z" fill="#8ED1B1"/><rect x="7.5" y="10.5" width="9" height="8" rx=".8" fill="#fff"/><path d="M7.5 13.2h9M7.5 15.8h9M11 10.5v8" stroke="#23A566" stroke-width="1.1"/></svg>',
    excel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="15" height="20" rx="2.2" fill="#21A366"/><path d="M7 2h7.5v6.7H7z" fill="#33C481"/><path d="M14.5 2H19.8A2.2 2.2 0 0 1 22 4.2v4.5h-7.5z" fill="#7FD8A9"/><path d="M7 15.3h15v4.5a2.2 2.2 0 0 1-2.2 2.2H7z" fill="#185C37"/><rect x="2" y="6.5" width="11" height="11" rx="1.8" fill="#107C41"/><path d="m5 9.3 5 5.4m0-5.4-5 5.4" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>'
  };
  const svg = (name, size) => { const s = ICONS[name] || ''; return size ? s.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ') : s; };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const btn = (name, tip, attrs) => '<button type="button" class="gpi-btn" data-tip="' + esc(tip) + '" aria-label="' + esc(tip) + '" ' + (attrs || '') + '>' + svg(name) + '</button>';
  const CSS = '.gpi-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:8px;background:transparent;color:#1e293b;cursor:pointer;flex-shrink:0;transition:background .15s}' +
    '.gpi-btn:hover{background:rgba(15,23,42,.06)}.gpi-btn:disabled{opacity:.35;cursor:default;background:transparent}.gpi-btn svg{width:22px;height:22px;display:block}.gpi-btn.gpi-sm{width:28px;height:28px}.gpi-btn.gpi-sm svg{width:18px;height:18px}.gpi-btn.gpi-lg{width:46px;height:46px;border-radius:10px}.gpi-btn.gpi-lg svg{width:34px;height:34px}.gpi-btn.gpi-busy{opacity:.5;cursor:wait}' +
    // 마우스를 올리면 기능 이름 (아래쪽에 작은 말풍선)
    '[data-tip]{position:relative}[data-tip]:hover::after,[data-tip]:focus-visible::after{content:attr(data-tip);position:absolute;left:50%;top:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;background:#1e293b;color:#fff;font-size:12px;font-weight:600;line-height:1;padding:6px 8px;border-radius:6px;z-index:9999;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.18)}' +
    '[data-tip-pos="left"]:hover::after{left:auto;right:0;transform:none}[data-tip-pos="up"]:hover::after{top:auto;bottom:calc(100% + 6px)}' +
    // 불러오는 중 화면 (모든 페이지 같은 모양: 흐린 배경 + 흰 카드 + 파란 원 + 글씨)
    '.gp-busy-ov{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.28)}.gp-busy-box{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;border-radius:20px;padding:26px 34px;box-shadow:0 10px 30px rgba(0,0,0,.18);display:flex;flex-direction:column;align-items:center;gap:14px;min-width:220px;font-size:17px;font-weight:700;color:#1e293b;text-align:center}.gp-spin{width:46px;height:46px;border:4px solid #dfe8fd;border-top-color:#4f78f2;border-radius:50%;animation:gpspin .8s linear infinite}@keyframes gpspin{to{transform:rotate(360deg)}}' +
    // 페이지 윗부분 메뉴줄: 본문과 같은 배경, 경계선·그림자 없음
    '.gp-top{background:#f8fafc!important;border-bottom-width:0!important;border-top-width:0!important;box-shadow:none!important}html[data-gp-theme="neu"] .gp-top{background:var(--neu)!important}html[data-gp-theme="glass"] .gp-top{background:rgba(255,255,255,.3)!important;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}' +
    // 화면 너비 버튼 (↔ 기본)
    '.gp-wide{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:0;border-radius:8px;background:#eef2f7;color:#475569;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0}.gp-wide:hover{background:#e2e8f0}.gp-wide svg{width:15px;height:15px}';
  function addCss() { if (document.getElementById('gpi-css')) return; const st = document.createElement('style'); st.id = 'gpi-css'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
  function hydrate(root) { (root || document).querySelectorAll('[data-gpi]').forEach((el) => { if (el.dataset.gpiDone) return; el.dataset.gpiDone = '1'; el.insertAdjacentHTML('afterbegin', svg(el.dataset.gpi)); if (el.tagName === 'BUTTON' && !el.classList.contains('gp-wide') && !el.className.includes('gpi-')) el.classList.add('gpi-btn'); if (el.dataset.tip && !el.getAttribute('aria-label')) el.setAttribute('aria-label', el.dataset.tip); }); }
  addCss();
  const start = () => { hydrate(); try { new MutationObserver(() => hydrate()).observe(document.body, { childList: true, subtree: true }); } catch (e) { /* 무시 */ } };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // 화면 너비 버튼(#wideBtn): 누를 때마다 기본 → 넓게 → 전체. 단계는 브라우저에 기억(gp_wide_<key>)
  //  GPI.wide(key, apply(n), defStep) — React 처럼 버튼이 나중에 그려져도 동작(클릭은 문서에서 받음)
  const WL = ['기본', '넓게', '전체'];
  function wide(key, apply, defStep) {
    const K = 'gp_wide_' + key;
    const get = () => { let v = null; try { v = localStorage.getItem(K); } catch (e) { v = null; } const n = v === null ? (defStep || 0) : parseInt(v, 10) || 0; return Math.max(0, Math.min(2, n)); };
    const paint = () => { const n = get(); document.querySelectorAll('#wideBtn').forEach((b) => { const l = b.querySelector('#wideLbl'); if (l && l.textContent !== WL[n]) l.textContent = WL[n]; b.title = '화면 너비 — 지금: ' + WL[n] + ' (누를 때마다 기본 → 넓게 → 전체)'; }); };
    const run = () => { apply(get()); paint(); };
    document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('#wideBtn'); if (!b || b.dataset.gpWideOwn) return; const n = (get() + 1) % 3; try { localStorage.setItem(K, n); } catch (x) { /* 무시 */ } run(); });
    run(); try { new MutationObserver(paint).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* 무시 */ }
    window.addEventListener('load', run); window.__gpWideChanged = run;
  }
  const WIDE_BTN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 8 22 12 18 16"></polyline><polyline points="6 8 2 12 6 16"></polyline><line x1="2" y1="12" x2="22" y2="12"></line></svg><span id="wideLbl">기본</span>';
  // 내보내기 창: 엑셀 / 구글 스프레드시트 아이콘 중 고름. o = { title, extra(창 안에 넣을 HTML), onExcel(box), onSheets(box) }
  //  onExcel/onSheets 가 문자열을 돌려주면 창 아래에 안내로 보여 줌(성공), 오류를 던지면 빨간 글씨
  function exportDialog(o) {
    const old = document.getElementById('gpExDlg'); if (old) old.remove();
    const m = document.createElement('div'); m.id = 'gpExDlg';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.4);display:flex;align-items:center;justify-content:center;padding:16px;z-index:300';
    m.innerHTML = '<div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;padding:20px;width:100%;max-width:' + (o.extra ? 440 : 340) + 'px;box-shadow:0 20px 40px rgba(15,23,42,.2);font-family:inherit">' +
      '<h3 style="margin:0 0 12px;font-size:17px;font-weight:800;color:#0f172a">' + esc(o.title || '내보내기') + '</h3>' + (o.extra || '') +
      '<div style="display:flex;justify-content:center;gap:18px;margin:14px 0 6px">' + btn('sheets', '구글 스프레드시트로 내보내기', 'data-ex="gs" data-tip-pos="up" style="width:56px;height:56px"') + btn('excel', '엑셀로 내보내기', 'data-ex="xl" data-tip-pos="up" style="width:56px;height:56px"') + '</div>' +
      '<p data-ex-msg style="margin:8px 0 0;font-size:13px;color:#475569;text-align:center;min-height:1em"></p>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:10px"><button type="button" data-ex="no" style="padding:8px 16px;border:0;border-radius:10px;background:#f1f5f9;font-weight:600;cursor:pointer">닫기</button></div></div>';
    document.body.appendChild(m);
    m.querySelectorAll('[data-ex="gs"] svg,[data-ex="xl"] svg').forEach((x) => { x.style.width = '40px'; x.style.height = '40px'; });
    const msg = m.querySelector('[data-ex-msg]'), say = (t, bad) => { msg.style.color = bad ? '#dc2626' : '#475569'; msg.innerHTML = t || ''; };
    const close = () => { document.removeEventListener('keydown', key); m.remove(); }, key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key); m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
    m.querySelector('[data-ex="no"]').onclick = close;
    const run = (fn) => async (e) => { const b = e.currentTarget; if (!fn) return; b.disabled = true; b.classList.add('gpi-busy'); say('만드는 중...');
      try { const r = await fn(m, say); say(r || ''); } catch (err) { console.error(err); say(esc(err && err.message ? err.message : err), true); } b.disabled = false; b.classList.remove('gpi-busy'); };
    const gs = m.querySelector('[data-ex="gs"]'), xl = m.querySelector('[data-ex="xl"]');
    if (o.onSheets) gs.onclick = run(o.onSheets); else gs.style.display = 'none';
    if (o.onExcel) xl.onclick = run(o.onExcel); else xl.style.display = 'none';
    return m;
  }
  // React 페이지용: GPI.busyEl(React, '불러오는 중...') → 불러오는 중 화면 요소
  const busyEl = (R, msg) => R.createElement('div', { className: 'gp-busy-ov', role: 'status' }, R.createElement('div', { className: 'gp-busy-box' }, R.createElement('div', { className: 'gp-spin' }), msg || '불러오는 중...'));
  // 일반 페이지용: GPI.busy(true/false, 글씨)
  function busy(on, msg) { let el = document.getElementById('gp-busy2'); if (!el) { el = document.createElement('div'); el.id = 'gp-busy2'; el.className = 'gp-busy-ov'; el.innerHTML = '<div class="gp-busy-box"><div class="gp-spin"></div><span></span></div>'; document.body.appendChild(el); } el.querySelector('span').textContent = msg || '불러오는 중...'; el.style.display = on ? 'block' : 'none'; }
  window.GPI = { svg, btn, hydrate, ICONS, wide, WIDE_BTN, exportDialog, busyEl, busy };
})();
