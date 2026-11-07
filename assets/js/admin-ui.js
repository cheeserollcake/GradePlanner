/* admin-ui.js : 학년 관리자 페이지 화면 (입력하면 바로 저장됩니다) */
(function () {
  'use strict';
  try { GP.getCol('app_config').catch(() => {}); GP.getCol('data_basic').catch(() => {}); } catch (e) {}   // 화면을 그리기 전에 필요한 자료를 미리 요청(모바일 로딩 단축)
  const { str, num, ymd, appDate, toDate, natural } = GP;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BTN = 'px-4 py-2 rounded-lg text-sm font-semibold';
  const BTN_P = BTN + ' bg-indigo-600 text-white hover:bg-indigo-700';
  const BTN_G = BTN + ' bg-slate-100 text-slate-700 hover:bg-slate-200';
  const INP = 'border rounded-lg px-3 py-1.5 text-sm bg-white';
  const CARD = 'bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3';
  const DAYS5 = [['Mon', '월'], ['Tue', '화'], ['Wed', '수'], ['Thu', '목'], ['Fri', '금']];
  const PALETTE = ['#CFE2F3', '#FCE5CD', '#D9EAD3', '#FFFEB5', '#E4D7F5'];
  const view = $('view');

  function toast(msg, bad) {
    const t = $('toast'); t.textContent = msg; t.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm text-white shadow-lg z-50 ' + (bad ? 'bg-red-600' : 'bg-slate-800');
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'hidden'; }, 1800);
  }
  async function guard(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { console.error(e); toast('실패: ' + e.message, true); } }
  // 입력하면 바로 저장: 저장 요청을 한 줄로 세워 순서대로 처리합니다.
  let queue = Promise.resolve();
  function autosave(fn, msg) { queue = queue.then(fn).then(() => toast(msg || '저장되었습니다.')).catch((e) => { console.error(e); toast('저장 실패: ' + e.message, true); }); return queue; }
  // 화면을 다시 그리는 도중 blur/change 이벤트가 겹쳐 다시 그리기가 중첩되는 것을 막습니다.
  const guardDraw = (fn) => { let busy = false; return () => { if (busy) return; busy = true; try { fn(); } finally { busy = false; } }; };
  const notifyMeta = () => { try { parent.postMessage('gp-meta-changed', '*'); } catch (e) { /* 단독 실행 */ } };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // 공간에 입력된 시간표 목록을 보여 주고, 고른 것만 삭제합니다. (삭제한 건수를 돌려줍니다. 취소하면 0)
  function spaceDataDialog(place, rows, title) {
    return new Promise((resolve) => {
      const kindName = (c) => (c === 'data_gym_timetable' ? '체육 공간' : '특별실');
      const wrap = document.createElement('div'); wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
      wrap.innerHTML = '<div class="bg-white rounded-2xl p-5 w-full max-w-lg space-y-3 max-h-[90vh] flex flex-col"><h3 class="font-bold text-lg">' + esc(title || ('‘' + place + '’ 공간에 입력된 시간표')) + '</h3>' +
        '<p class="text-sm text-slate-500">삭제하지 않고 남긴 데이터는 월간·반별 시간표에 계속 표시됩니다. 지울 항목을 선택하세요.</p>' +
        '<label class="text-sm font-semibold flex items-center gap-2"><input type="checkbox" id="sdAll" checked> 전체 선택 <span class="font-normal text-slate-400" id="sdCnt"></span></label>' +
        '<div class="border rounded-lg overflow-auto flex-1 divide-y text-sm">' + rows.map((r, i) => '<label class="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50"><input type="checkbox" class="sdi" data-i="' + i + '" checked><span class="w-28 whitespace-nowrap">' + esc(r.date) + '</span><span class="w-16">' + esc(r.period) + '</span><span class="flex-1">' + esc(r.cls) + (/^\d+$/.test(r.cls) ? '반' : '') + '</span><span class="text-xs text-slate-400">' + kindName(r.col) + '</span></label>').join('') + '</div>' +
        '<div class="flex justify-end gap-2"><button id="sdKeep" class="px-4 py-2 rounded-lg bg-slate-100 text-sm font-semibold">남겨 두기</button><button id="sdDel" class="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold">선택 삭제</button></div></div>';
      document.body.appendChild(wrap);
      const boxes = () => [...wrap.querySelectorAll('.sdi')];
      const upd = () => { const n = boxes().filter((b) => b.checked).length; wrap.querySelector('#sdCnt').textContent = '(' + n + '/' + rows.length + '건)'; wrap.querySelector('#sdDel').disabled = !n; wrap.querySelector('#sdDel').style.opacity = n ? 1 : .4; };
      wrap.querySelector('#sdAll').onchange = (e) => { boxes().forEach((b) => { b.checked = e.target.checked; }); upd(); };
      boxes().forEach((b) => { b.onchange = upd; }); upd();
      const done = (n) => { wrap.remove(); resolve(n); };
      wrap.querySelector('#sdKeep').onclick = () => done(0);
      wrap.querySelector('#sdDel').onclick = async () => {
        const sel = boxes().filter((b) => b.checked).map((b) => rows[+b.dataset.i]);
        try { await GP.deleteSpaceRows(sel); toast(sel.length + '건을 삭제했습니다.'); done(sel.length); } catch (e) { toast('삭제 실패: ' + e.message, true); }
      };
    });
  }

  // ================================================================ 로그인 (페이지에 들어올 때마다 비밀번호를 묻습니다)
  async function tryLogin() {
    const pw = await GP.getPw();
    if ($('pw').value === pw.admin) start(); else $('pwErr').classList.remove('hidden');
  }
  $('login').onclick = tryLogin; $('pw').onkeydown = (e) => { if (e.key === 'Enter') tryLogin(); };
  $('lock').onclick = () => { location.reload(); };

  const TABS = [['time', '시간표 설정'], ['basic', '학년 기초 설정'], ['space', '공간 개방 설정'], ['budget', '예산 설정'], ['data', '비밀번호/데이터 관리']];
  let tab = 'basic';
  const TABS_KEYS = TABS.map((t) => t[0]);
  // 예산 페이지에서 비밀번호를 확인하고 넘어온 경우에는 다시 묻지 않습니다.
  try { const jump = sessionStorage.getItem('gp_admin_open'); if (jump) { sessionStorage.removeItem('gp_admin_open'); if (TABS_KEYS.indexOf(jump) >= 0) tab = jump; setTimeout(() => start(), 0); } } catch (e) { /* 무시 */ }
  function start() {
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
    $('tabs').innerHTML = TABS.map(([k, l]) => '<button data-t="' + k + '" class="px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 ' + (k === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800') + '">' + l + '</button>').join('');
    $('tabs').querySelectorAll('button').forEach((b) => b.onclick = () => { tab = b.dataset.t; start(); });
    const go = ({ time: renderTime, basic: renderBasic, space: renderSpace, budget: renderBudget, data: renderData })[tab];
    const fail = (e) => { console.error(e); view.innerHTML = '<div class="' + CARD + ' border-red-200"><p class="text-red-700 font-semibold">불러오지 못했습니다.</p><p class="text-sm text-slate-500 break-all">' + esc(String((e && e.message) || e).slice(0, 300)) + '</p><button id="retry" class="' + BTN_P + '">다시 시도</button></div>'; $('retry').onclick = () => { GP.fresh(); start(); }; };
    let done = false; Promise.resolve().then(go).then(() => { done = true; }, (e) => { done = true; fail(e); });
    setTimeout(() => { if (!done && /불러오는 중/.test(view.textContent)) { const m = document.createElement('p'); m.className = 'text-xs text-amber-600 mt-2'; m.innerHTML = '오래 걸리고 있습니다. 인터넷 연결을 확인하거나 <button class="underline" id="slowRetry">다시 시도</button>를 눌러 주세요.'; view.appendChild(m); $('slowRetry').onclick = () => { GP.fresh(); start(); }; } }, 8000);
  }

  // ================================================================ 1) 시간표 설정
  async function renderTime() {
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    let subs = (await GP.getSubjectConfig()).map((s) => ({ name: s.name, hours: s.hours, h1: s.hoursSem1, h2: s.hoursSem2, special: s.special, stored: s.stored }));
    let times = (await GP.readList('list_time')).map((i) => i.value); if (!times.length) times = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    const slotCfg = await GP.getCfg('basic_slots', {}); const off = new Set(Array.isArray(slotCfg.off) ? slotCfg.off : []);   // 꺼 둔 칸: '<요일1~5>_<교시1~>'
    const saveSlots = () => autosave(() => GP.setCfg('basic_slots', { off: [...off] }));
    const blank = (v) => (v === '' || v === null || v === undefined ? '' : num(v));
    const saveSubs = () => autosave(async () => {
      const list = subs.map((s) => ({ ...s, name: s.name.trim() })).filter((s) => s.name);
      if (new Set(list.map((s) => s.name)).size !== list.length) throw new Error('중복된 과목명이 있습니다.');
      await GP.writeList('list_sub', list.map((s) => ({ value: s.name, extra: { list_sub_hours: blank(s.hours), list_sub_hours_sem1: blank(s.h1), list_sub_hours_sem2: blank(s.h2), list_sub_special: !!s.special } })));
    });
    const saveTimes = () => autosave(async () => {
      const list = times.map((t) => t.trim()).filter(Boolean); if (new Set(list).size !== list.length) throw new Error('중복된 교시가 있습니다.');
      await GP.writeList('list_time', list.map((v) => ({ value: v })));
    });
    const sum = () => subs.reduce((a, s) => a + num(s.hours), 0);
    const SLOT_DAYS = ['월', '화', '수', '목', '금'];
    const slotCard = () => '<div class="' + CARD + '"><h2 class="font-bold text-lg">주간시수배정 <span class="text-xs font-normal text-slate-400">체크한 칸에만 기초시간표 과목을 넣을 수 있습니다</span></h2>' +
      '<table class="w-full text-center border-collapse text-sm" style="table-layout:fixed"><thead><tr><th class="border bg-slate-100 p-1"></th>' +
      SLOT_DAYS.map((d, c) => '<th class="border bg-slate-100 p-1"><button data-sday="' + (c + 1) + '" title="요일 전체 선택/해제" class="font-bold w-full">' + d + '</button></th>').join('') + '</tr></thead><tbody>' +
      times.map((t, r) => '<tr><th class="border bg-slate-50 p-1 text-xs"><button data-sper="' + (r + 1) + '" title="교시 전체 선택/해제" class="font-semibold w-full">' + esc(t) + '</button></th>' +
        SLOT_DAYS.map((d, c) => '<td class="border p-1"><input type="checkbox" class="w-4 h-4" data-slot="' + (c + 1) + '_' + (r + 1) + '" ' + (off.has((c + 1) + '_' + (r + 1)) ? '' : 'checked') + '></td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
    const draw = guardDraw(() => {
      const numIn = (i, k, v, ph) => '<input data-i="' + i + '" data-k="' + k + '" type="number" min="0" value="' + esc(v) + '" placeholder="' + ph + '" class="' + INP + ' w-full text-center">';
      view.innerHTML = '<div class="grid lg:grid-cols-3 gap-5"><div class="lg:col-span-2 ' + CARD + '"><h2 class="font-bold text-lg">과목 / 시수 / 전담 설정 <span class="text-xs font-normal text-slate-400">입력하면 바로 저장됩니다</span></h2>' +
        '<div class="overflow-x-auto"><table class="w-full text-sm" style="min-width:540px"><thead><tr class="text-slate-500"><th class="text-left p-1">과목</th><th class="p-1 w-24">주당 시수</th><th class="p-1 w-28">1학기 총시수</th><th class="p-1 w-28">2학기 총시수</th><th class="p-1 w-14">전담</th><th class="w-8"></th></tr></thead><tbody>' +
        subs.map((s, i) => '<tr><td class="p-1"><input data-i="' + i + '" data-k="name" value="' + esc(s.name) + '" class="' + INP + ' w-full" style="min-width:104px"></td>' +
          '<td class="p-1">' + numIn(i, 'hours', s.hours, '') + '</td><td class="p-1">' + numIn(i, 'h1', s.h1, '') + '</td><td class="p-1">' + numIn(i, 'h2', s.h2, '') + '</td>' +
          '<td class="p-1 text-center"><input data-i="' + i + '" data-k="special" type="checkbox" ' + (s.special ? 'checked' : '') + ' class="w-4 h-4"></td>' +
          '<td class="p-1"><button data-del="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></td></tr>').join('') +
        '</tbody></table></div><div class="flex items-center justify-between"><button id="addSub" class="' + BTN_G + '">+ 과목 추가</button>' +
        '<span class="text-sm text-slate-500">주당 시수 합계 <b id="hsum">' + sum() + '</b></span></div></div>' +
        '<div class="space-y-5"><div class="' + CARD + '"><h2 class="font-bold text-lg">교시 설정</h2><div class="space-y-2">' +
        times.map((t, i) => '<div class="flex gap-2"><input data-ti="' + i + '" value="' + esc(t) + '" class="' + INP + ' flex-1"><button data-tdel="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></div>').join('') +
        '</div><button id="addTime" class="' + BTN_G + '">+ 교시 추가</button></div>' + slotCard() + '</div></div>';
      view.querySelectorAll('[data-k]').forEach((el) => el.onchange = () => {
        const s = subs[+el.dataset.i], k = el.dataset.k; s[k] = el.type === 'checkbox' ? el.checked : el.value; if (k === 'hours') $('hsum').textContent = sum(); saveSubs();
      });
      view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { subs.splice(+b.dataset.del, 1); draw(); saveSubs(); });
      $('addSub').onclick = () => { subs.push({ name: '', hours: '', h1: '', h2: '', special: false }); draw(); view.querySelectorAll('[data-k="name"]')[subs.length - 1].focus(); };
      view.querySelectorAll('[data-slot]').forEach((el) => el.onchange = () => { if (el.checked) off.delete(el.dataset.slot); else off.add(el.dataset.slot); saveSlots(); });
      const toggleGroup = (keys) => { const allOn = keys.every((k) => !off.has(k)); keys.forEach((k) => (allOn ? off.add(k) : off.delete(k))); draw(); saveSlots(); };
      view.querySelectorAll('[data-sday]').forEach((b) => b.onclick = () => toggleGroup(times.map((_, r) => b.dataset.sday + '_' + (r + 1))));
      view.querySelectorAll('[data-sper]').forEach((b) => b.onclick = () => toggleGroup(SLOT_DAYS.map((_, c) => (c + 1) + '_' + b.dataset.sper)));
      view.querySelectorAll('[data-ti]').forEach((el) => el.onchange = () => { times[+el.dataset.ti] = el.value; saveTimes(); draw(); });
      view.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = () => { times.splice(+b.dataset.tdel, 1); draw(); saveTimes(); });
      $('addTime').onclick = () => { times.push((times.length + 1) + '교시'); draw(); saveTimes(); };
    });
    draw();
    if (subs.some((s) => !s.stored && s.hours !== '')) saveSubs();   // 기본 시수를 처음 한 번 저장해 둡니다.
  }

  // ================================================================ 2) 학년 기초 설정
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
    }
    row.push(cell); rows.push(row); return rows.filter((r) => r.some((x) => x.trim()));
  }
  async function readCsvFile(file) {
    const buf = await file.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, ''); } catch (e) { return new TextDecoder('euc-kr').decode(buf); }
  }
  const isHolidayWord = (v) => /^(휴일|y|yes|o|1|true|예|공휴일)$/i.test(str(v).trim());

  async function renderBasic() {
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    let g = await APP.getGeneral();
    const subs = (await GP.getSubjectConfig()).filter((s) => s.special).map((s) => s.name);
    let items = [], sems = {}, editItem = null;
    const range = () => APP.yearRange(g.year);
    const rr = () => { const r = range(); return { min: ymd(r.start), max: ymd(r.end) }; };
    const blankHr = (c) => ({ className: c, teacher: '', terms: ['1학기', '2학기'], period: null });
    const ensureHr = () => { g.homerooms = g.homerooms.filter((e) => g.classNames.indexOf(e.className) >= 0); g.classNames.forEach((c) => { if (!g.homerooms.some((e) => e.className === c)) g.homerooms.push(blankHr(c)); }); };
    const loadYearData = async () => { sems = await APP.getSemesterRows(g.year); items = await APP.listBaseItems(g.year); };

    // ---- 학급·교사 자동 저장
    const rangesOf = (e) => {
      if (e.period && toDate(e.period.start) && toDate(e.period.end)) return [[toDate(e.period.start), toDate(e.period.end)]];
      return (e.terms || []).map((n) => (sems[n] ? [sems[n].start, sems[n].end] : n === '1학기' ? [new Date(g.year, 2, 1), new Date(g.year, 6, 31)] : [new Date(g.year, 7, 1), new Date(g.year + 1, 1, 28)]));
    };
    const overlap = (a, b) => rangesOf(a).some(([s1, e1]) => rangesOf(b).some(([s2, e2]) => s1 <= e2 && s2 <= e1));
    const cleanCopy = () => {   // 저장용 사본: 입력이 덜 끝난 기간은 제외
      const gs = JSON.parse(JSON.stringify(g)); const fix = (e) => { delete e.showPeriod; if (e.period && !(toDate(e.period.start) && toDate(e.period.end))) e.period = null; e.teacher = str(e.teacher).trim(); return e; };
      gs.homerooms = gs.homerooms.map(fix); gs.specials = gs.specials.map(fix); return gs;
    };
    const validate = (gs) => {
      const r = range(); const all = gs.homerooms.concat(gs.specials);
      all.forEach((e) => { if (e.period) { const a = toDate(e.period.start), b = toDate(e.period.end); if (a > b) throw new Error('기간의 종료 날짜가 시작 날짜보다 빠릅니다.'); if (a < r.start || b > r.end) throw new Error('기간이 학년도 범위를 벗어났습니다.'); } });
      const hr = gs.homerooms.filter((e) => e.teacher);
      hr.forEach((e) => { if (!e.period && !(e.terms || []).length) throw new Error(e.teacher + ': 기간(학기)을 선택하세요.'); });
      for (let i = 0; i < hr.length; i++) for (let j = i + 1; j < hr.length; j++) {
        const a = hr[i], b = hr[j]; if (!overlap(a, b)) continue;
        if (a.teacher === b.teacher && a.className !== b.className) throw new Error(a.teacher + ': 같은 기간에 두 학급(' + a.className + ', ' + b.className + ')의 담임으로 입력되어 있습니다.');
        if (a.className === b.className && a.teacher !== b.teacher) throw new Error(a.className + ': 같은 기간에 담임이 둘 이상입니다.');
      }
    };
    const saveGeneral = () => autosave(async () => {
      const gs = cleanCopy(); validate(gs); const old = await APP.getGeneral();
      gs.specials.forEach((e) => { if (!e.space) { const m = old.specials.find((o) => o.subject === e.subject && o.teacher === e.teacher); if (m && m.space) e.space = m.space; } });   // 전담 시간표에서 입력한 공간 이름 보존
      await APP.syncTeachers(old, gs); await APP.saveGeneral(gs);
    });
    let pendingTimer = null;
    const saveGeneralSoon = () => { clearTimeout(pendingTimer); pendingTimer = setTimeout(saveGeneral, 350); };
    const listOf = (kind) => (kind === 'hr' ? g.homerooms : g.specials);

    const termUI = (kind, i, e) => {
      const { min, max } = rr();
      return '<div class="flex flex-wrap items-center gap-2 text-sm">기간 ' + ['1학기', '2학기'].map((t) => '<label class="flex gap-1"><input type="checkbox" data-t="' + kind + '" data-i="' + i + '" value="' + t + '" ' + ((e.terms || []).indexOf(t) >= 0 ? 'checked' : '') + '>' + t + '</label>').join('') +
        '<button data-per="' + kind + '" data-i="' + i + '" class="' + BTN_G + ' !py-1">기간입력</button>' +
        (e.period || e.showPeriod ? '<input type="date" data-d="' + kind + '" data-i="' + i + '" data-k="start" min="' + min + '" max="' + max + '" value="' + esc((e.period || {}).start || '') + '" class="' + INP + '">~<input type="date" data-d="' + kind + '" data-i="' + i + '" data-k="end" min="' + min + '" max="' + max + '" value="' + esc((e.period || {}).end || '') + '" class="' + INP + '">' : '') + '</div>';
    };

    const draw = guardDraw(() => {
      const { min, max } = rr();
      // 제목과 날짜 칸: 넓은 화면에서는 한 줄, 좁은 화면에서는 제목 아래에 두 날짜 칸을 나란히
      const semHtml = APP.SEM_NAMES.map((n) => '<div class="grid gap-1 sm:grid-cols-[6rem_1fr] sm:items-center"><span class="font-semibold text-sm text-slate-700">' + n + '</span>' +
        '<div class="flex items-center gap-2 max-w-md"><input type="date" data-sem="' + n + '" data-p="start" min="' + min + '" max="' + max + '" value="' + (sems[n] ? ymd(sems[n].start) : '') + '" class="' + INP + ' flex-1 min-w-0"><span class="text-slate-400">~</span>' +
        '<input type="date" data-sem="' + n + '" data-p="end" min="' + min + '" max="' + max + '" value="' + (sems[n] ? ymd(sems[n].end) : '') + '" class="' + INP + ' flex-1 min-w-0"></div></div>').join('');
      const evHtml = items.map((e, i) => '<tr class="border-t"><td class="p-1.5 whitespace-nowrap">' + ymd(e.start) + (e.end && ymd(e.end) !== ymd(e.start) ? ' ~ ' + ymd(e.end) : '') + '</td>' +
        '<td class="p-1.5 whitespace-pre-wrap">' + (e.kind === 'holiday' ? '<span class="text-xs px-1.5 py-0.5 rounded bg-pink-100 text-red-600 mr-1">휴일</span>' : '') + esc(e.name) + '</td>' +
        '<td class="p-1.5 whitespace-nowrap text-right"><button data-eedit="' + i + '" class="text-slate-500 hover:text-indigo-600 mr-2">수정</button><button data-edel="' + i + '" class="text-slate-400 hover:text-red-600">삭제</button></td></tr>').join('');
      const ed = editItem;
      const classHtml = g.classNames.map((n, i) => '<span class="inline-flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 text-sm"><span data-cn="' + i + '">' + esc(n) + '</span><button data-cedit="' + i + '" title="이름 수정">✏️</button></span>').join(' ');
      const homeHtml = g.classNames.map((n) => {
        const idx = g.homerooms.map((e, i) => (e.className === n ? i : -1)).filter((i) => i >= 0);
        return '<div class="border rounded-lg p-2 bg-slate-50 space-y-2"><div class="font-semibold text-sm">' + esc(n) + '</div>' + idx.map((i) => '<div class="space-y-1"><div class="flex gap-2"><input data-f="hr" data-i="' + i + '" data-k="teacher" value="' + esc(g.homerooms[i].teacher) + '" placeholder="담임교사 이름" class="' + INP + ' flex-1">' +
          (idx.length > 1 ? '<button data-hrdel="' + i + '" class="text-slate-400 hover:text-red-600">✕</button>' : '') + '</div>' + termUI('hr', i, g.homerooms[i]) + '</div>').join('') +
          '<button data-hradd="' + esc(n) + '" class="text-xs text-indigo-600 hover:underline">+ 담임 추가 (기간별)</button></div>';
      }).join('');
      const spHtml = g.specials.map((s, i) => '<div class="border rounded-lg p-2 space-y-2 bg-slate-50"><div class="flex flex-wrap gap-2 items-center">' +
        '<select data-f="sp" data-i="' + i + '" data-k="subject" class="' + INP + '"><option value="">과목</option>' + subs.concat(s.subject && subs.indexOf(s.subject) < 0 ? [s.subject] : []).map((x) => '<option ' + (s.subject === x ? 'selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
        '<details class="relative"><summary class="' + INP + ' cursor-pointer list-none">담당학급 (' + (s.classes || []).length + ')</summary><div class="absolute z-20 bg-white border rounded-lg shadow p-2 mt-1 w-40 max-h-52 overflow-auto">' +
        g.classNames.map((c) => '<label class="flex gap-2 text-sm py-0.5"><input type="checkbox" data-spc="' + i + '" value="' + esc(c) + '" ' + ((s.classes || []).indexOf(c) >= 0 ? 'checked' : '') + '>' + esc(c) + '</label>').join('') + '</div></details>' +
        '<input data-f="sp" data-i="' + i + '" data-k="teacher" value="' + esc(s.teacher || '') + '" placeholder="교사 이름" class="' + INP + ' w-32">' +
        '<button data-spdel="' + i + '" class="text-slate-400 hover:text-red-600 ml-auto">✕</button></div>' + termUI('sp', i, s) + '</div>').join('');

      view.innerHTML = '<div class="space-y-5">' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">학년도 설정</h2><div class="flex flex-wrap items-end gap-3">' +
        '<label class="text-xs font-semibold text-slate-500">학년도<span class="flex items-center gap-1.5 mt-1 text-sm font-normal text-slate-700"><input id="year" type="number" value="' + g.year + '" class="' + INP + ' w-24">학년도</span></label>' +
        '<label class="text-xs font-semibold text-slate-500">학년<select id="grade" class="' + INP + ' block mt-1">' + [1, 2, 3, 4, 5, 6].map((n) => '<option value="' + n + '" ' + (n === (g.grade || 6) ? 'selected' : '') + '>' + n + '학년</option>').join('') + '</select></label>' +
        '<button id="saveYear" class="' + BTN_P + '">이 학년도로 설정하기</button></div>' +
        '<p class="text-sm text-slate-500">' + appDate(range().start) + ' ~ ' + appDate(range().end) + '</p>' +
        '<div class="space-y-2 pt-2 border-t"><p class="text-xs text-slate-400">날짜를 입력하면 바로 저장됩니다. (시작·종료를 모두 지우면 삭제됩니다)</p>' + semHtml + '</div></div>' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">기초 일정</h2><div class="flex flex-wrap gap-2 items-center">' +
        '<input id="evName" placeholder="학교 행사" value="' + esc(ed ? ed.name : '') + '" class="' + INP + ' flex-1 min-w-[10rem]"><input id="evStart" type="date" min="' + min + '" max="' + max + '" value="' + (ed ? ymd(ed.start) : '') + '" class="' + INP + '">' +
        '<span>~</span><input id="evEnd" type="date" min="' + min + '" max="' + max + '" value="' + (ed && ed.end ? ymd(ed.end) : '') + '" class="' + INP + '" title="종료일(선택)">' +
        '<label class="flex items-center gap-1 text-sm"><input id="evHol" type="checkbox" ' + (ed && ed.kind === 'holiday' ? 'checked' : '') + '> 휴일</label>' +
        '<button id="evSave" class="' + BTN_P + '">' + (ed ? '수정 저장' : '추가') + '</button>' + (ed ? '<button id="evCancel" class="' + BTN_G + '">취소</button>' : '') + '</div>' +
        '<p class="text-xs text-slate-400">종료일을 비워 두면 하루짜리 일정입니다. 휴일(선거일, 임시공휴일 등)로 체크하면 data_basic 의 holiday 필드에 저장됩니다.</p>' +
        '<div class="flex flex-wrap gap-2 items-center"><button id="tpl" class="' + BTN_G + '">CSV 양식 다운로드</button><label class="' + BTN_G + ' cursor-pointer">CSV 업로드<input id="csv" type="file" accept=".csv,text/csv" class="hidden"></label></div>' +
        '<div class="max-h-72 overflow-auto border rounded-lg"><table class="w-full text-sm"><tbody>' + (evHtml || '<tr><td class="p-4 text-center text-slate-400">이 학년도에 등록된 일정이 없습니다.</td></tr>') + '</tbody></table></div></div>' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">학급 및 교사 설정 <span class="text-xs font-normal text-slate-400">입력하면 바로 저장됩니다</span></h2>' +
        '<div class="space-y-2"><h3 class="font-semibold text-sm text-slate-600">학급 설정</h3><div class="flex flex-wrap items-center gap-2"><span class="text-sm">학급 수</span><input id="cc" type="number" min="1" max="30" value="' + g.classCount + '" class="' + INP + ' w-20"></div><div class="flex flex-wrap gap-2">' + classHtml + '</div></div>' +
        '<div class="grid lg:grid-cols-2 gap-5 pt-3 border-t"><div class="space-y-2"><h3 class="font-semibold text-sm text-slate-600">담임교사</h3><div class="grid sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-2">' + homeHtml + '</div></div>' +
        '<div class="space-y-2"><h3 class="font-semibold text-sm text-slate-600">전담교사</h3>' + (spHtml || '<p class="text-sm text-slate-400">등록된 전담교사가 없습니다. (과목은 시간표 설정에서 \'전담\'으로 체크한 과목만 선택됩니다.)</p>') +
        '<button id="addSp" class="' + BTN_G + '">+ 전담교사 추가</button></div></div></div></div>';
      bind();
    });

    const bind = () => {
      $('grade').onchange = () => { g.grade = parseInt($('grade').value, 10) || 6; saveGeneral().then(() => notifyMeta()); };
      $('saveYear').onclick = async () => {
        try {
          const y = parseInt($('year').value, 10); if (!(y >= 2000 && y <= 2100)) throw new Error('올바른 연도를 입력하세요.');
          if (y !== g.year) {
            clearTimeout(pendingTimer); await saveGeneral();            // 이전 학년도 입력을 먼저 저장
            await APP.setYear(y);                                         // 새 학년도: 담임/전담교사, 공간 개방 설정은 빈 상태로 시작
            g = await APP.getGeneral(); ensureHr(); await loadYearData(); draw();
          }
          notifyMeta(); toast(y + '학년도로 설정되었습니다.');
        } catch (e) { console.error(e); toast('실패: ' + e.message, true); }
      };

      // 학기·방학: 날짜를 입력하면 바로 저장
      APP.SEM_NAMES.forEach((n) => {
        const inputs = [...view.querySelectorAll('[data-sem="' + n + '"]')];
        inputs.forEach((inp) => inp.onchange = () => {
          const a = toDate(inputs[0].value), b = toDate(inputs[1].value);
          if (!a && !b) { autosave(async () => { await APP.clearSemester(g.year, n); sems = await APP.getSemesterRows(g.year); }, n + ' 기간이 삭제되었습니다.'); return; }
          if (!a || !b) return;
          const { start, end } = range();
          if (a > b) return toast(n + ': 종료 날짜가 시작 날짜보다 빠릅니다.', true);
          if (a < start || b > end) return toast(n + ': 학년도 기간을 벗어났습니다.', true);
          autosave(async () => { await APP.saveSemesters(g.year, { [n]: { start: a, end: b } }); sems = await APP.getSemesterRows(g.year); }, n + ' 기간이 저장되었습니다.');
        });
      });

      // 기초 일정 (학교 행사 / 휴일)
      const readEv = () => {
        const name = $('evName').value.trim(), a = toDate($('evStart').value), b = toDate($('evEnd').value), r = range();
        if (!name) throw new Error('학교 행사를 입력하세요.'); if (!a) throw new Error('시작 날짜를 입력하세요.');
        if (a < r.start || a > r.end || (b && (b < r.start || b > r.end))) throw new Error('학년도 기간을 벗어난 날짜입니다.');
        if (b && b < a) throw new Error('종료 날짜가 시작 날짜보다 빠릅니다.'); return { name, start: a, end: b, holiday: $('evHol').checked };
      };
      $('evSave').onclick = () => guard(async () => {
        const e = readEv(); if (editItem) await APP.updateBaseItem(editItem, e); else await APP.addBaseItems([e]);
        editItem = null; await loadYearData(); draw();
      }, '저장되었습니다.');
      if ($('evCancel')) $('evCancel').onclick = () => { editItem = null; draw(); };
      view.querySelectorAll('[data-eedit]').forEach((b) => b.onclick = () => { editItem = items[+b.dataset.eedit]; draw(); });
      view.querySelectorAll('[data-edel]').forEach((b) => b.onclick = () => { if (confirm('이 일정을 삭제할까요?')) guard(async () => { await APP.deleteBaseItem(items[+b.dataset.edel]); await loadYearData(); draw(); }, '삭제되었습니다.'); });
      $('tpl').onclick = () => {
        const blob = new Blob(['\uFEFF학교 행사,시작 날짜,종료 날짜,휴일 여부\n개학식,' + g.year + '-03-02,,\n중간고사,' + g.year + '-04-20,' + g.year + '-04-24,\n전국동시지방선거,' + (g.year + 1) + '-06-03,,휴일\n'], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '기초일정_양식.csv'; a.click();
      };
      $('csv').onchange = (ev) => guard(async () => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; const rows = parseCSV(await readCsvFile(f)); const r = range();
        const body = rows.length && /학교|행사|일정/.test(rows[0][0]) ? rows.slice(1) : rows; const ok = [], bad = [];
        body.forEach((c, i) => {
          const name = str(c[0]).trim(), a = toDate(c[1]), b = toDate(c[2]);
          if (!name || !a || a < r.start || a > r.end || (b && (b < a || b > r.end))) bad.push((i + 1) + '행'); else ok.push({ name, start: a, end: b, holiday: isHolidayWord(c[3]) });
        });
        if (ok.length) await APP.addBaseItems(ok); await loadYearData(); draw();
        toast(ok.length + '건 추가' + (bad.length ? ', 건너뜀: ' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? ' 외' : '') : ''), bad.length > 0);
      });

      // 학급 설정
      $('cc').onchange = () => {
        const n = parseInt($('cc').value, 10); if (!(n >= 1 && n <= 30)) return toast('학급 수는 1~30 사이로 입력하세요.', true);
        g.classCount = n; g.classNames = Array.from({ length: n }, (_, i) => g.classNames[i] || (i + 1) + '반'); ensureHr(); g.specials.forEach((s) => { s.classes = (s.classes || []).filter((c) => g.classNames.indexOf(c) >= 0); });
        draw(); saveGeneral();
      };
      view.querySelectorAll('[data-cedit]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.cedit; const span = view.querySelector('[data-cn="' + i + '"]');
        span.innerHTML = '<input class="border rounded px-1 w-20 text-sm" value="' + esc(g.classNames[i]) + '">'; const inp = span.firstChild; inp.focus();
        inp.onblur = () => {
          const v = inp.value.trim(); const old = g.classNames[i];
          if (v && v !== old && g.classNames.indexOf(v) < 0) {
            g.classNames[i] = v; g.homerooms.forEach((e) => { if (e.className === old) e.className = v; }); g.specials.forEach((s) => { s.classes = (s.classes || []).map((c) => (c === old ? v : c)); }); saveGeneral();
          }
          draw();
        };
        inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
      });

      // 담임/전담 공통 입력 (입력하면 바로 저장)
      view.querySelectorAll('[data-f]').forEach((el) => el.onchange = () => { listOf(el.dataset.f)[+el.dataset.i][el.dataset.k] = el.value; saveGeneralSoon(); });
      view.querySelectorAll('[data-t]').forEach((cb) => cb.onchange = () => {
        const e = listOf(cb.dataset.t)[+cb.dataset.i]; e.terms = [...view.querySelectorAll('[data-t="' + cb.dataset.t + '"][data-i="' + cb.dataset.i + '"]:checked')].map((x) => x.value); saveGeneralSoon();
      });
      view.querySelectorAll('[data-per]').forEach((b) => b.onclick = () => { listOf(b.dataset.per)[+b.dataset.i].showPeriod = true; draw(); });
      view.querySelectorAll('[data-d]').forEach((el) => el.onchange = () => {
        const e = listOf(el.dataset.d)[+el.dataset.i]; e.period = e.period || { start: '', end: '' }; e.period[el.dataset.k] = el.value; saveGeneralSoon();
      });
      view.querySelectorAll('[data-hradd]').forEach((b) => b.onclick = () => { g.homerooms.push({ className: b.dataset.hradd, teacher: '', terms: [], period: null }); draw(); });
      view.querySelectorAll('[data-hrdel]').forEach((b) => b.onclick = () => { g.homerooms.splice(+b.dataset.hrdel, 1); ensureHr(); draw(); saveGeneral(); });
      view.querySelectorAll('[data-spc]').forEach((cb) => cb.onchange = () => {
        g.specials[+cb.dataset.spc].classes = [...view.querySelectorAll('[data-spc="' + cb.dataset.spc + '"]:checked')].map((x) => x.value); saveGeneralSoon();
      });
      $('addSp').onclick = () => { g.specials.push({ subject: '', classes: [], teacher: '', terms: ['1학기', '2학기'], period: null }); draw(); };
      view.querySelectorAll('[data-spdel]').forEach((b) => b.onclick = () => { g.specials.splice(+b.dataset.spdel, 1); draw(); saveGeneral(); });
    };

    ensureHr(); await loadYearData(); draw();
  }

  // ================================================================ 3) 공간 개방 설정
  let openQueue = Promise.resolve(), openYear = null;
  function mutateOpen(fn) {   // 공간 개방 설정은 학년도별로 저장됩니다.
    openQueue = openQueue.then(async () => { const c = await GP.loadOpen(openYear); fn(c); await GP.saveOpen(openYear, c); }).catch((e) => toast('저장 실패: ' + e.message, true));
    return openQueue;
  }
  async function renderSpace() {
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    let gym = (await GP.readList('list_gym')).map((i) => ({ orig: i.value, value: i.value }));
    let room = (await GP.readList('list_room')).map((i) => ({ orig: i.value, value: i.value }));
    let times = (await GP.readList('list_time')).map((i) => i.value); if (!times.length) times = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    const gen = await APP.getGeneral(); openYear = gen.year; let cfg = await GP.loadOpen(openYear); const sems = await APP.getSemesterRows(gen.year);
    const today = new Date(); const inS = (n) => sems[n] && today >= sems[n].start && today <= sems[n].end;
    let sub = 'gym', lastDate = ymd(today); const open = { sem1: !inS('2학기'), sem2: !!inS('2학기') };
    const colorOf = (idx, name) => cfg.colors[name] || PALETTE[idx % PALETTE.length];
    const arr = (k) => (k === 'gym' ? gym : room);
    const removedNames = [];   // 방금 지운 공간 이름 (개방 설정 정리용)

    const listEditor = (title, a, key) => '<div class="' + CARD + '"><h2 class="font-bold text-lg">' + title + ' <span class="text-xs font-normal text-slate-400">바로 저장</span></h2><div class="space-y-2">' +
      a.map((x, i) => '<div class="flex gap-2"><input data-l="' + key + '" data-i="' + i + '" value="' + esc(x.value) + '" class="' + INP + ' flex-1"><button data-ldel="' + key + '" data-i="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></div>').join('') +
      '</div><button data-ladd="' + key + '" class="' + BTN_G + '">+ 추가</button></div>';

    const table = (semKey, semName, spaces) => {
      const n = spaces.length;
      const sepL = 'border-left:2px solid #94a3b8;';
      const hdr = DAYS5.map(([, d]) => '<th colspan="' + n + '" class="border p-1 bg-slate-100" style="' + sepL + '">' + d + '</th>').join('');
      const sub2 = DAYS5.map(() => spaces.map((s, i) => '<th class="border p-0.5 leading-tight" style="font-size:10px;overflow-wrap:anywhere;word-break:break-all;background:' + colorOf(i, s) + ';' + (i === 0 ? sepL : '') + '"><div>' + esc(s) + '</div><input type="color" data-color="' + esc(s) + '" value="' + colorOf(i, s) + '" style="width:14px;height:12px;padding:0;border:0;background:transparent;cursor:pointer"></th>').join('')).join('');
      const body = times.map((t, p) => '<tr><td class="border bg-slate-50 font-semibold text-xs text-center" style="white-space:nowrap">' + esc(t) + '</td>' + DAYS5.map(([dk]) => spaces.map((s, i) => {
        const k = dk + '_' + (p + 1) + '_' + s, on = !!cfg[semKey][k];
        return '<td class="border text-center p-0" style="' + (on ? 'background:' + colorOf(i, s) + ';' : '') + (i === 0 ? sepL : '') + '"><input type="checkbox" style="width:14px;height:14px" data-sem="' + semKey + '" data-k="' + esc(k) + '" data-sp="' + esc(s) + '" ' + (on ? 'checked' : '') + '></td>';
      }).join('')).join('') + '</tr>').join('');
      return '<div class="' + CARD + ' !p-3"><div class="flex items-center justify-between"><h3 class="font-bold">' + semName + '</h3><button data-fold="' + semKey + '" class="' + BTN_G + ' !py-1">' + (open[semKey] ? '접기' : '펼치기') + '</button></div>' +
        (open[semKey] ? (n ? '<div class="overflow-x-auto"><table class="text-center border-collapse text-xs" style="table-layout:fixed;width:100%;min-width:' + (56 + n * 5 * 26) + 'px"><colgroup><col style="width:3.6rem"></colgroup><thead><tr><th rowspan="2" class="border bg-slate-100 text-xs" style="white-space:nowrap">교시</th>' + hdr + '</tr><tr>' + sub2 + '</tr></thead><tbody>' + body + '</tbody></table></div>' : '<p class="text-sm text-slate-400">공간을 먼저 추가하세요.</p>') : '') + '</div>';
    };

    const exPanel = (key, title, blue) => {
      const c = blue ? { btn: 'bg-blue-600 hover:bg-blue-700', item: 'bg-sky-100' } : { btn: 'bg-red-600 hover:bg-red-700', item: 'bg-pink-100' };
      const all = gym.map((x) => x.value).concat(room.map((x) => x.value)).filter(Boolean);
      return '<div class="' + CARD + '"><h3 class="font-bold">' + title + '</h3><div class="flex flex-wrap gap-2 sticky top-0 bg-white">' +
        '<input type="date" data-exd="' + key + '" value="' + lastDate + '" class="' + INP + '"><select data-exp="' + key + '" class="' + INP + '">' + times.map((t) => '<option>' + esc(t) + '</option>').join('') + '</select>' +
        '<select data-exs="' + key + '" class="' + INP + '">' + all.map((s) => '<option>' + esc(s) + '</option>').join('') + '</select><button data-exadd="' + key + '" class="' + BTN + ' text-white ' + c.btn + '">추가</button></div>' +
        '<div class="space-y-1 max-h-64 overflow-auto">' + (cfg[key] || []).map((e, i) => '<div class="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ' + c.item + '"><span>' + esc(e.date) + ' · ' + esc(e.period) + ' · ' + esc(e.space) + '</span><button data-exdel="' + key + '" data-i="' + i + '" class="text-slate-500 hover:text-red-700 px-2 py-1 -my-1 -mr-2 text-base leading-none" aria-label="삭제">✕</button></div>').join('') + '</div></div>';
    };

    const drawLists = () => {
      $('lists').innerHTML = listEditor('체육 공간', gym, 'gym') + listEditor('특별실', room, 'room');
      $('lists').querySelectorAll('[data-l]').forEach((el) => el.onchange = () => { arr(el.dataset.l)[+el.dataset.i].value = el.value; saveList(el.dataset.l); });
      $('lists').querySelectorAll('[data-ldel]').forEach((b) => b.onclick = async () => {
        const key = b.dataset.ldel, item = arr(key)[+b.dataset.i]; if (!item) return;
        arr(key).splice(+b.dataset.i, 1); if (item.orig) removedNames.push(item.orig); drawLists();
        await saveList(key);
        if (item.orig) {   // 이 공간에 입력해 둔 시간표가 있으면 목록을 보여 주고 고른 것만 삭제
          let rows = []; try { rows = await GP.listSpaceData(item.orig); } catch (e) { /* 목록을 못 읽어도 공간 삭제는 끝난 상태 */ }
          if (rows.length) await spaceDataDialog(item.orig, rows);
        }
        drawOrphans();
      });
      $('lists').querySelectorAll('[data-ladd]').forEach((b) => b.onclick = () => { const a = arr(b.dataset.ladd); a.push({ orig: '', value: '' }); drawLists(); [...$('lists').querySelectorAll('[data-l="' + b.dataset.ladd + '"]')].pop().focus(); });
    };
    // 공간 목록: 추가·수정·삭제를 바로 data_basic(list_gym / list_room)에 저장하고, 이름이 바뀐 공간의 개방 설정도 함께 옮깁니다.
    const saveList = (key) => autosave(async () => {
      const items = arr(key).map((x) => ({ orig: x.orig, value: x.value.trim() })).filter((x) => x.value);
      if (new Set(items.map((x) => x.value)).size !== items.length) throw new Error('중복된 이름이 있습니다.');
      await GP.writeList(key === 'gym' ? 'list_gym' : 'list_room', items.map((x) => ({ value: x.value })));
      const renamed = {}; items.forEach((x) => { if (x.orig && x.orig !== x.value) renamed[x.orig] = x.value; });
      const removed = removedNames.filter((o) => !items.some((x) => x.value === o)); removedNames.length = 0;
      for (const o of Object.keys(renamed)) await GP.renameSpaceData(o, renamed[o]);
      await mutateOpen((c) => {
        const fix = (obj) => Object.keys(obj).forEach((k) => { const m = k.match(/^(.*_\d+_)(.+)$/); if (!m) return; if (renamed[m[2]]) { obj[m[1] + renamed[m[2]]] = obj[k]; delete obj[k]; } else if (removed.indexOf(m[2]) >= 0) delete obj[k]; });
        fix(c.sem1); fix(c.sem2);
        ['exceptions', 'closeExceptions'].forEach((n) => { c[n] = (c[n] || []).map((e) => (renamed[e.space] ? Object.assign({}, e, { space: renamed[e.space] }) : e)).filter((e) => removed.indexOf(e.space) < 0); });
        Object.keys(renamed).forEach((o) => { if (c.colors[o]) { c.colors[renamed[o]] = c.colors[o]; delete c.colors[o]; } });
      });
      cfg = await GP.loadOpen(openYear);
      arr(key).forEach((x) => { if (x.value.trim()) x.orig = x.value.trim(); });
      drawTables();
    });

    const drawTables = () => {
      const spaces = (sub === 'gym' ? gym : room).map((x) => x.value).filter(Boolean);
      $('tables').innerHTML = '<div class="flex gap-2"><button data-sub="gym" class="' + BTN + ' ' + (sub === 'gym' ? 'bg-indigo-600 text-white' : 'bg-white border') + '">체육 공간 개방 설정</button><button data-sub="room" class="' + BTN + ' ' + (sub === 'room' ? 'bg-indigo-600 text-white' : 'bg-white border') + '">특별실 개방 설정</button></div>' +
        table('sem1', '1학기', spaces) + table('sem2', '2학기', spaces) +
        '<h2 class="font-bold text-lg pt-2">예외 설정</h2><div class="grid md:grid-cols-2 gap-5">' + exPanel('exceptions', '닫힌 곳 열기', true) + exPanel('closeExceptions', '열린 곳 닫기', false) + '</div>';
      bindTables(spaces);
    };
    const bindTables = () => {
      const root = $('tables');
      root.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => { sub = b.dataset.sub; drawTables(); });
      root.querySelectorAll('[data-fold]').forEach((b) => b.onclick = () => { open[b.dataset.fold] = !open[b.dataset.fold]; drawTables(); });
      root.querySelectorAll('input[data-sem]').forEach((cb) => cb.onchange = () => {
        const { sem, k, sp } = cb.dataset; const idx = (sub === 'gym' ? gym : room).filter((x) => x.value).findIndex((x) => x.value === sp);
        cb.parentElement.style.background = cb.checked ? colorOf(idx, sp) : ''; if (cb.checked) cfg[sem][k] = true; else delete cfg[sem][k];
        mutateOpen((c) => { if (cb.checked) c[sem][k] = true; else delete c[sem][k]; });
      });
      root.querySelectorAll('input[data-color]').forEach((inp) => inp.onchange = () => { cfg.colors[inp.dataset.color] = inp.value; mutateOpen((c) => { c.colors[inp.dataset.color] = inp.value; }).then(drawTables); });
      root.querySelectorAll('[data-exadd]').forEach((b) => b.onclick = () => {
        const k = b.dataset.exadd; const date = root.querySelector('[data-exd="' + k + '"]').value; if (!date) return toast('날짜를 입력하세요.', true);
        const e = { date, period: root.querySelector('[data-exp="' + k + '"]').value, space: root.querySelector('[data-exs="' + k + '"]').value };
        lastDate = date; cfg[k] = (cfg[k] || []).concat([e]); drawTables();   // 화면은 바로 고치고 저장은 뒤에서 진행(모바일에서 반응이 없어 보이던 문제)
        mutateOpen((c) => { c[k] = (c[k] || []).concat([e]); }).then(() => toast('저장되었습니다.'));
      });
      root.querySelectorAll('[data-exdel]').forEach((b) => b.onclick = () => { const k = b.dataset.exdel, i = +b.dataset.i; const e = cfg[k][i]; if (!e) return; cfg[k].splice(i, 1); drawTables();
        mutateOpen((c) => { c[k] = (c[k] || []).filter((x) => !(x.date === e.date && x.period === e.period && x.space === e.space)); }).then(() => toast('삭제되었습니다.')); });
    };
    const drawOrphans = async () => {
      let list = []; try { list = await GP.spaceOrphans(); } catch (e) { /* 무시 */ }
      const box = $('orphans'); if (!box) return;
      box.innerHTML = list.length ? '<div class="' + CARD + ' border-amber-300 bg-amber-50"><h2 class="font-bold text-lg">삭제된 공간의 남은 데이터 <span class="text-xs font-normal text-slate-500">삭제하기 전까지 월간·반별 시간표에 계속 표시됩니다</span></h2>' +
        '<p class="text-sm text-slate-600">공간 목록에서 지운 공간 이름으로 입력된 시간표가 남아 있습니다. 필요 없으면 삭제하세요.</p>' +
        list.map((o, i) => '<div class="flex items-center justify-between bg-white border rounded-lg px-3 py-1.5 text-sm"><span><b>' + esc(o.place || '(이름 없음)') + '</b> · ' + (o.col === 'data_gym_timetable' ? '체육 공간' : '특별실') + ' · ' + o.count + '건</span><button data-orph="' + i + '" class="text-red-600 font-semibold">내용 보기·삭제</button></div>').join('') +
        '<div class="text-right"><button id="orphAll" class="' + BTN + ' text-white bg-red-600 hover:bg-red-700">모두 삭제</button></div></div>' : '';
      box.querySelectorAll('[data-orph]').forEach((b) => b.onclick = async () => { const o = list[+b.dataset.orph]; const rows = await GP.listSpaceData(o.place); if (rows.length) await spaceDataDialog(o.place, rows); drawOrphans(); });
      const all = $('orphAll'); if (all) all.onclick = () => { if (!confirm('남은 데이터 ' + list.reduce((a, o) => a + o.count, 0) + '건을 모두 삭제할까요?')) return; autosave(() => GP.purgeSpaceData(null), '삭제했습니다.').then(drawOrphans); };
    };
    view.innerHTML = '<div class="space-y-5"><div id="orphans"></div><div id="lists" class="grid md:grid-cols-2 gap-5"></div><div id="tables" class="space-y-5"></div></div>';
    drawLists(); drawTables(); drawOrphans();
  }

  // ================================================================ 4) 비밀번호 / 데이터 관리
  // ================================================================ 예산 설정
  let bdSel = 'all';   // 예산 설정에서 보고 있는 예산 페이지 ('all' = 전체)
  async function renderBudget() {
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    try { const j = sessionStorage.getItem('gp_admin_budget_page'); if (j) { sessionStorage.removeItem('gp_admin_budget_page'); bdSel = j; } } catch (e) { /* 무시 */ }
    const rowsB = await GP.getCol('data_budget');
    const sheetCfg = await GP.getCfg('budget_sheets', { sheets: [] });
    const PAGES = [['budget', '학년 예산'], ['supply', '학습준비물']].concat((Array.isArray(sheetCfg.sheets) ? sheetCfg.sheets : []).map((x) => ['sheet:' + x.id, x.name]));
    if (bdSel !== 'all' && !PAGES.some((x) => x[0] === bdSel)) bdSel = 'all';
    const pageName = (id) => (PAGES.find((x) => x[0] === id) || [id, id])[1];
    let layout = await GP.getCfg('budget_layout', {}); if (!layout || typeof layout !== 'object') layout = {};
    let items = (await GP.readList('list_budget')).map((i) => ({ name: i.value, amount: num(i.row.list_budget_amount), color: str(i.row.list_budget_color).trim(), pages: str(i.row.list_budget_pages).trim() ? str(i.row.list_budget_pages).split(',').filter(Boolean) : ['budget'] }));
    const used = (name) => rowsB.filter((r) => str(r.budget_name).trim() === name).reduce((a, r) => a + num(r.budget_num) * num(r.budget_price), 0);
    const colorOf = (it) => it.color || PALETTE[items.indexOf(it) % PALETTE.length];   // 색을 정하지 않은 카드는 전체 순서 기준의 기본 색
    const fmt = (n) => Number(n).toLocaleString();
    const save = () => autosave(() => GP.writeList('list_budget', items.map((i) => ({ value: i.name, extra: { list_budget_amount: i.amount, list_budget_color: i.color || '', list_budget_pages: i.pages.join(',') } }))));
    const saveLayout = () => autosave(() => GP.setCfg('budget_layout', layout));
    const shown = () => {   // 지금 화면에 보이는 카드(그 페이지에서 정한 순서)
      if (bdSel === 'all') return items.slice();
      const lay = Array.isArray(layout[bdSel]) ? layout[bdSel] : []; const pos = (n) => { const i = lay.indexOf(n); return i < 0 ? 1e6 : i; };
      return items.filter((i) => i.pages.indexOf(bdSel) >= 0).map((it, k) => ({ it, k })).sort((x, y) => pos(x.it.name) - pos(y.it.name) || x.k - y.k).map((x) => x.it);
    };
    // 이름·배정액·표시할 페이지 입력창 (수정/추가 공통)
    function editDialog(it) {
      return new Promise((resolve) => {
        const pages = it ? it.pages : [bdSel === 'all' ? 'budget' : bdSel];
        const wrap = document.createElement('div'); wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
        wrap.innerHTML = '<div class="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3"><h3 class="font-bold text-lg">' + (it ? '예산 수정' : '예산 추가') + '</h3>' +
          '<label class="text-sm font-semibold block">예산 이름<input id="bdN" class="' + INP + ' w-full mt-1" value="' + esc(it ? it.name : '') + '" placeholder="예: 체험학습비"></label>' +
          '<label class="text-sm font-semibold block">배정액<input id="bdA" inputmode="numeric" class="' + INP + ' w-full mt-1 text-right" value="' + (it ? fmt(it.amount) : '') + '" placeholder="0"></label>' +
          '<div class="text-sm font-semibold">표시할 예산 페이지<div class="flex flex-wrap gap-x-4 gap-y-1 mt-1 font-normal">' + PAGES.map((x) => '<label class="flex items-center gap-1.5"><input type="checkbox" class="bdP" value="' + esc(x[0]) + '" ' + (pages.indexOf(x[0]) >= 0 ? 'checked' : '') + '>' + esc(x[1]) + '</label>').join('') + '</div></div>' +
          '<p id="bdE" class="text-sm font-semibold text-red-600 hidden"></p>' +
          '<div class="flex justify-between gap-2 pt-1"><div>' + (it ? '<button id="bdDel" class="px-4 py-2 rounded-lg bg-white border border-red-200 text-red-600 text-sm font-semibold">삭제</button>' : '') + '</div>' +
          '<div class="flex gap-2"><button id="bdNo" class="' + BTN_G + '">취소</button><button id="bdOk" class="' + BTN_P + '">' + (it ? '저장' : '추가') + '</button></div></div></div>';
        document.body.appendChild(wrap);
        const done = (v) => { wrap.remove(); resolve(v); };
        const A = wrap.querySelector('#bdA'); A.onblur = () => { const n = num(A.value.replace(/,/g, '')); A.value = A.value.trim() ? fmt(n) : ''; };
        wrap.querySelector('#bdNo').onclick = () => done(null);
        if (it) wrap.querySelector('#bdDel').onclick = () => { if (confirm('[' + it.name + '] 예산을 삭제할까요?\n예산 표에 입력된 내역은 그대로 남습니다.')) done({ del: true }); };
        const ok = () => {
          const name = wrap.querySelector('#bdN').value.trim(), amount = num(A.value.replace(/,/g, '')), err = wrap.querySelector('#bdE');
          const pg = [...wrap.querySelectorAll('.bdP')].filter((c) => c.checked).map((c) => c.value);
          const bad = !name ? '예산 이름을 입력하세요.' : items.some((x) => x !== it && x.name === name) ? '같은 이름의 예산이 이미 있습니다.' : /[\/,]/.test(name) ? '예산 이름에는 / 와 , 를 쓸 수 없습니다.' : '';
          if (bad) { err.textContent = bad; err.classList.remove('hidden'); return; } done({ name, amount, pages: pg });
        };
        wrap.querySelector('#bdOk').onclick = ok; wrap.onkeydown = (e) => { if (e.key === 'Enter') ok(); else if (e.key === 'Escape') done(null); };
        wrap.querySelector('#bdN').focus();
      });
    }
    let dragFrom = -1;
    const draw = guardDraw(() => {
      const list = shown();
      const tabBtn = (id, name) => '<button data-bp="' + esc(id) + '" class="px-3 py-1.5 rounded-full text-sm font-bold ' + (bdSel === id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200') + '">' + esc(name) + '</button>';
      view.innerHTML = '<div class="' + CARD + '"><h2 class="font-bold text-lg">예산 카드 <span class="text-xs font-normal text-slate-400">카드를 끌어서 순서를 바꾸고, 🎨 로 배경색을, ✏️ 로 이름·배정액·표시할 예산 페이지를 바꿉니다. 바꾼 내용은 예산 페이지에 바로 반영됩니다.</span></h2>' +
        '<div class="flex flex-wrap items-center gap-2"><span class="text-sm font-semibold text-slate-500 mr-1">보기</span>' + tabBtn('all', '전체') + PAGES.map((x) => tabBtn(x[0], x[1])).join('') + '</div>' +
        (bdSel === 'all' ? '<p class="text-xs text-slate-400">전체 보기에서는 모든 예산 카드가 보이고, 끌어서 바꾼 순서가 기본 순서가 됩니다. 예산 페이지별로 순서를 따로 정하려면 위에서 그 페이지를 고르세요.</p>' : '<p class="text-xs text-slate-400">[' + esc(pageName(bdSel)) + '] 페이지에 표시되는 카드입니다. 여기서 끌어서 바꾼 순서는 이 페이지에만 적용됩니다.</p>') +
        '<div id="bdCards" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">' + list.map((it, i) => {
          const u = used(it.name), bal = it.amount - u;
          const where = it.pages.length ? it.pages.map(pageName).join(' · ') : '표시 안 함';
          return '<div class="bdc relative border border-slate-300 rounded-xl p-3 shadow-sm cursor-grab" draggable="true" data-i="' + i + '" style="background:' + colorOf(it) + '">' +
            '<div class="flex items-center justify-between gap-1 border-b border-black/10 pb-1 mb-1"><span class="font-bold text-sm break-all">' + esc(it.name) + '</span>' +
            '<span class="flex shrink-0 gap-1"><label class="cursor-pointer relative" title="배경색">🎨<input type="color" data-color="' + i + '" value="' + colorOf(it) + '" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full"></label><button data-edit="' + i + '" title="수정">✏️</button></span></div>' +
            '<div class="flex justify-between text-xs"><span>배정액</span><b>' + fmt(it.amount) + '</b></div><div class="flex justify-between text-xs"><span>사용액</span><b>' + fmt(u) + '</b></div>' +
            '<div class="flex justify-between text-sm mt-1 pt-1 border-t border-black/10"><span>잔액</span><b class="' + (bal < 0 ? 'text-red-600' : 'text-blue-700') + '">' + fmt(bal) + '</b></div>' +
            '<div class="text-[11px] text-slate-500 mt-1 pt-1 border-t border-black/10 leading-tight">표시: ' + esc(where) + '</div></div>';
        }).join('') + '<button id="bdAdd" class="border-2 border-dashed border-slate-300 rounded-xl text-3xl font-bold text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 min-h-[110px]" title="예산 추가">+</button></div>' +
        (list.length ? '' : '<p class="text-sm text-slate-400">이 페이지에 표시되는 예산 카드가 없습니다. + 로 추가하거나, 전체 보기에서 카드의 ✏️ 로 표시할 페이지를 고르세요.</p>') + '</div>';
      view.querySelectorAll('[data-bp]').forEach((b) => b.onclick = () => { bdSel = b.dataset.bp; draw(); });
      const box = $('bdCards');
      box.querySelectorAll('[data-edit]').forEach((b) => b.onclick = async () => {
        const it = list[+b.dataset.edit], r = await editDialog(it); if (!r) return;
        if (r.del) { items.splice(items.indexOf(it), 1); Object.keys(layout).forEach((k) => { if (Array.isArray(layout[k])) layout[k] = layout[k].filter((n) => n !== it.name); }); await save(); await saveLayout(); return draw(); }
        const old = it.name; it.name = r.name; it.amount = r.amount; it.pages = r.pages;
        if (old !== r.name) Object.keys(layout).forEach((k) => { if (Array.isArray(layout[k])) layout[k] = layout[k].map((n) => (n === old ? r.name : n)); });
        await save(); if (old !== r.name) await saveLayout();
        if (old !== r.name) {   // 예산 표에 이미 입력한 내역도 새 이름으로 맞춤
          const hit = rowsB.filter((x) => str(x.budget_name).trim() === old);
          if (hit.length) { await GP.commit(hit.map((x) => ({ type: 'update', col: 'data_budget', id: x._id, data: { budget_name: r.name } }))); GP.invalidate('data_budget'); hit.forEach((x) => { x.budget_name = r.name; }); }
        }
        draw();
      });
      box.querySelectorAll('input[data-color]').forEach((inp) => { inp.onchange = () => { list[+inp.dataset.color].color = inp.value; save(); draw(); }; });
      $('bdAdd').onclick = async () => { const r = await editDialog(null); if (!r || r.del) return; const it = { name: r.name, amount: r.amount, color: '', pages: r.pages }; items.push(it); await save(); draw(); };
      // 끌어서 순서 바꾸기
      const clear = () => box.querySelectorAll('.bdc').forEach((c) => { c.style.boxShadow = ''; c.style.opacity = ''; });
      box.querySelectorAll('.bdc').forEach((c) => {
        c.ondragstart = (e) => { dragFrom = +c.dataset.i; c.style.opacity = '.4'; try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (x) { /* 무시 */ } };
        c.ondragend = () => { dragFrom = -1; clear(); };
        c.ondragover = (e) => { if (dragFrom < 0) return; e.preventDefault(); const r = c.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; clear(); c.style.boxShadow = after ? 'inset -4px 0 0 #4f46e5' : 'inset 4px 0 0 #4f46e5'; c._after = after; };
        c.ondrop = (e) => {
          e.preventDefault(); if (dragFrom < 0) return; const to = +c.dataset.i; let dest = to + (c._after ? 1 : 0); const order = list.slice(); const [m] = order.splice(dragFrom, 1); if (dragFrom < dest) dest--; order.splice(dest, 0, m);
          dragFrom = -1;
          if (bdSel === 'all') { items = order; save(); } else { layout[bdSel] = order.map((x) => x.name); saveLayout(); }
          draw();
        };
      });
    });
    draw();
  }

  async function renderData() {
    const pw = await GP.getPw(); const years = await APP.detectYears(); const g = await APP.getGeneral();
    if (g.year && years.indexOf(g.year) < 0) years.push(g.year); years.sort((a, b) => a - b);
    view.innerHTML = '<div class="space-y-5"><div class="' + CARD + '"><h2 class="font-bold text-lg">비밀번호 설정</h2><div class="grid sm:grid-cols-2 gap-3">' +
      '<label class="text-sm font-semibold">페이지 접근 비밀번호<span class="block text-xs font-normal text-slate-400">학생 명렬표, 내선번호 등에 공통 적용</span><input id="pwAccess" value="' + esc(pw.access) + '" class="' + INP + ' w-full mt-1"></label>' +
      '<label class="text-sm font-semibold">관리자 페이지 비밀번호<span class="block text-xs font-normal text-slate-400">이 관리자 페이지 접근용</span><input id="pwAdmin" value="' + esc(pw.admin) + '" class="' + INP + ' w-full mt-1"></label></div>' +
      '<div class="text-right"><button id="savePw" class="' + BTN_P + '">비밀번호 저장</button></div></div>' +
      '<div class="' + CARD + ' border-red-200"><h2 class="font-bold text-lg text-red-700">데이터 삭제</h2><p class="text-sm text-slate-500">선택한 학년도(2월 1일~다음 해 2월 말일)의 데이터를 삭제합니다.<br><b>날짜로 구분되는 데이터:</b> 학교 행사, 학년 일정, 추가된 일정, 체육 공간·특별실·전담 시간표, 학기·방학·휴일 설정, 학습준비물(연도), 담임·전담교사 매칭, 공간 개방 설정<br><b>작성일이 그 학년도인 데이터:</b> 학생 명렬표, 개요 비고, 예산(추가한 예산 페이지 포함), 강좌 범주, 이미지·파일(특별실·교실배치도·내선번호·예산 비고 첨부)<br><b>삭제되지 않음:</b> 쇼핑몰 ID, 바로가기, 비밀번호, 학급·과목·교시·공간 목록</p>' +
      '<div class="flex gap-2 items-center"><select id="delYear" class="' + INP + '">' + years.map((y) => '<option value="' + y + '">' + y + '학년도</option>').join('') + '</select><button id="delBtn" class="' + BTN + ' bg-red-600 text-white hover:bg-red-700">과거 데이터 삭제</button></div></div>' +
      '<div class="' + CARD + '"><h2 class="font-bold text-lg">임시 저장 데이터 새로고침</h2><p class="text-sm text-slate-500">속도와 사용량을 줄이려고 기기에 저장해 둔 데이터는 앱에서 저장할 때마다 자동으로 갱신됩니다. 파이어베이스 콘솔에서 데이터를 직접 고쳤다면 이 버튼으로 모든 기기가 새로 받게 하세요.</p><button id="resetCache" class="' + BTN_G + '">모든 기기 데이터 새로고침</button></div></div>' +
      '<div id="dm" class="fixed inset-0 bg-black/40 hidden items-center justify-center p-4 z-50"><div class="bg-white rounded-2xl p-5 w-full max-w-md space-y-3"><h3 class="font-bold text-lg text-red-700">정말 삭제할까요?</h3>' +
      '<p class="text-sm text-slate-600"><b id="dmY"></b> 데이터는 <b>삭제하면 복구할 수 없습니다.</b> 계속하려면 아래에 <b>과거 데이터 삭제</b> 를 입력하세요.</p><input id="dmIn" class="' + INP + ' w-full" placeholder="과거 데이터 삭제">' +
      '<div class="flex justify-end gap-2"><button id="dmNo" class="' + BTN_G + '">취소</button><button id="dmYes" disabled class="' + BTN + ' bg-red-600 text-white disabled:opacity-40">삭제</button></div></div></div>';
    $('savePw').onclick = () => guard(async () => {
      const a = $('pwAccess').value.trim(), b = $('pwAdmin').value.trim(); if (!a || !b) throw new Error('비밀번호를 입력하세요.');
      await GP.setPw({ access: a, admin: b });
    }, '비밀번호가 저장되었습니다.');
    $('resetCache').onclick = () => guard(() => GP.resetCaches(), '모든 기기가 다음에 열 때 데이터를 새로 받습니다.');
    const modal = $('dm'); const show = (v) => { modal.classList.toggle('hidden', !v); modal.classList.toggle('flex', v); };
    $('delBtn').onclick = () => { $('dmY').textContent = $('delYear').value + '학년도'; $('dmIn').value = ''; $('dmYes').disabled = true; show(true); };
    $('dmNo').onclick = () => show(false); $('dmIn').oninput = () => { $('dmYes').disabled = $('dmIn').value.trim() !== '과거 데이터 삭제'; };
    $('dmYes').onclick = () => guard(async () => {
      const s = await APP.deleteYear(parseInt($('delYear').value, 10)); show(false);
      toast('삭제 완료 (' + Object.keys(s).map((k) => k.replace('data_', '') + ' ' + s[k]).join(', ') + ')'); renderData();
    });
  }
})();
