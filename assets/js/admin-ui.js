/* admin-ui.js : 학년 관리자 페이지 화면 (입력하면 바로 저장됩니다) */
(function () {
  'use strict';
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

  // ================================================================ 로그인 (페이지에 들어올 때마다 비밀번호를 묻습니다)
  async function tryLogin() {
    const pw = await GP.getPw();
    if ($('pw').value === pw.admin) start(); else $('pwErr').classList.remove('hidden');
  }
  $('login').onclick = tryLogin; $('pw').onkeydown = (e) => { if (e.key === 'Enter') tryLogin(); };
  $('lock').onclick = () => { location.reload(); };

  const TABS = [['time', '시간표 설정'], ['basic', '학년 기초 설정'], ['space', '공간 개방 설정'], ['data', '비밀번호/데이터 관리']];
  let tab = 'basic';
  function start() {
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden');
    $('tabs').innerHTML = TABS.map(([k, l]) => '<button data-t="' + k + '" class="px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 ' + (k === tab ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800') + '">' + l + '</button>').join('');
    $('tabs').querySelectorAll('button').forEach((b) => b.onclick = () => { tab = b.dataset.t; start(); });
    ({ time: renderTime, basic: renderBasic, space: renderSpace, data: renderData })[tab]();
  }

  // ================================================================ 1) 시간표 설정
  async function renderTime() {
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    let subs = (await GP.getSubjectConfig()).map((s) => ({ name: s.name, hours: s.hours, h1: s.hoursSem1, h2: s.hoursSem2, special: s.special, stored: s.stored }));
    let times = (await GP.readList('list_time')).map((i) => i.value); if (!times.length) times = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
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
    const draw = guardDraw(() => {
      const numIn = (i, k, v, ph) => '<input data-i="' + i + '" data-k="' + k + '" type="number" min="0" value="' + esc(v) + '" placeholder="' + ph + '" class="' + INP + ' w-full text-center">';
      view.innerHTML = '<div class="grid lg:grid-cols-3 gap-5"><div class="lg:col-span-2 ' + CARD + '"><h2 class="font-bold text-lg">과목 / 시수 / 전담 설정 <span class="text-xs font-normal text-slate-400">입력하면 바로 저장됩니다</span></h2>' +
        '<table class="w-full text-sm"><thead><tr class="text-slate-500"><th class="text-left p-1">과목</th><th class="p-1 w-24">주당 시수</th><th class="p-1 w-28">1학기 총시수</th><th class="p-1 w-28">2학기 총시수</th><th class="p-1 w-14">전담</th><th class="w-8"></th></tr></thead><tbody>' +
        subs.map((s, i) => '<tr><td class="p-1"><input data-i="' + i + '" data-k="name" value="' + esc(s.name) + '" class="' + INP + ' w-full"></td>' +
          '<td class="p-1">' + numIn(i, 'hours', s.hours, '') + '</td><td class="p-1">' + numIn(i, 'h1', s.h1, '') + '</td><td class="p-1">' + numIn(i, 'h2', s.h2, '') + '</td>' +
          '<td class="p-1 text-center"><input data-i="' + i + '" data-k="special" type="checkbox" ' + (s.special ? 'checked' : '') + ' class="w-4 h-4"></td>' +
          '<td class="p-1"><button data-del="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></td></tr>').join('') +
        '</tbody></table><div class="flex items-center justify-between"><button id="addSub" class="' + BTN_G + '">+ 과목 추가</button>' +
        '<span class="text-sm text-slate-500">주당 시수 합계 <b id="hsum">' + sum() + '</b></span></div></div>' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">교시 설정</h2><div class="space-y-2">' +
        times.map((t, i) => '<div class="flex gap-2"><input data-ti="' + i + '" value="' + esc(t) + '" class="' + INP + ' flex-1"><button data-tdel="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></div>').join('') +
        '</div><button id="addTime" class="' + BTN_G + '">+ 교시 추가</button></div></div>';
      view.querySelectorAll('[data-k]').forEach((el) => el.onchange = () => {
        const s = subs[+el.dataset.i], k = el.dataset.k; s[k] = el.type === 'checkbox' ? el.checked : el.value; if (k === 'hours') $('hsum').textContent = sum(); saveSubs();
      });
      view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { subs.splice(+b.dataset.del, 1); draw(); saveSubs(); });
      $('addSub').onclick = () => { subs.push({ name: '', hours: '', h1: '', h2: '', special: false }); draw(); view.querySelectorAll('[data-k="name"]')[subs.length - 1].focus(); };
      view.querySelectorAll('[data-ti]').forEach((el) => el.onchange = () => { times[+el.dataset.ti] = el.value; saveTimes(); });
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
    const saveGeneralSoon = debounce(saveGeneral, 350);
    const listOf = (kind) => (kind === 'hr' ? g.homerooms : g.specials);

    const termUI = (kind, i, e) => {
      const { min, max } = rr();
      return '<div class="flex flex-wrap items-center gap-2 text-sm">기간 ' + ['1학기', '2학기'].map((t) => '<label class="flex gap-1"><input type="checkbox" data-t="' + kind + '" data-i="' + i + '" value="' + t + '" ' + ((e.terms || []).indexOf(t) >= 0 ? 'checked' : '') + '>' + t + '</label>').join('') +
        '<button data-per="' + kind + '" data-i="' + i + '" class="' + BTN_G + ' !py-1">기간입력</button>' +
        (e.period || e.showPeriod ? '<input type="date" data-d="' + kind + '" data-i="' + i + '" data-k="start" min="' + min + '" max="' + max + '" value="' + esc((e.period || {}).start || '') + '" class="' + INP + '">~<input type="date" data-d="' + kind + '" data-i="' + i + '" data-k="end" min="' + min + '" max="' + max + '" value="' + esc((e.period || {}).end || '') + '" class="' + INP + '">' : '') + '</div>';
    };

    const draw = guardDraw(() => {
      const { min, max } = rr();
      const semHtml = APP.SEM_NAMES.map((n) => '<div class="flex flex-wrap items-center gap-2"><span class="w-20 font-semibold text-sm">' + n + '</span>' +
        '<input type="date" data-sem="' + n + '" data-p="start" min="' + min + '" max="' + max + '" value="' + (sems[n] ? ymd(sems[n].start) : '') + '" class="' + INP + '"><span>~</span>' +
        '<input type="date" data-sem="' + n + '" data-p="end" min="' + min + '" max="' + max + '" value="' + (sems[n] ? ymd(sems[n].end) : '') + '" class="' + INP + '"></div>').join('');
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
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">학년도 설정</h2><div class="flex flex-wrap items-center gap-2"><input id="year" type="number" value="' + g.year + '" class="' + INP + ' w-28"><span class="text-sm">학년도</span>' +
        '<span class="text-sm font-semibold ml-3">학년</span><select id="grade" class="' + INP + '">' + [1, 2, 3, 4, 5, 6].map((n) => '<option value="' + n + '" ' + (n === (g.grade || 6) ? 'selected' : '') + '>' + n + '학년</option>').join('') + '</select>' +
        '<button id="saveYear" class="' + BTN_P + '">이 학년도로 설정하기</button><span class="text-sm text-slate-500">' + appDate(range().start) + ' ~ ' + appDate(range().end) + '</span></div>' +
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
      $('saveYear').onclick = () => guard(async () => {
        const y = parseInt($('year').value, 10); if (!(y >= 2000 && y <= 2100)) throw new Error('올바른 연도를 입력하세요.');
        g.year = y; await APP.saveGeneral(cleanCopy()); await loadYearData(); draw(); notifyMeta();
      }, g.year + '학년도로 설정되었습니다.');

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
  let openQueue = Promise.resolve();
  function mutateOpen(fn) {
    openQueue = openQueue.then(async () => { const c = Object.assign({ sem1: {}, sem2: {}, exceptions: [], closeExceptions: [], colors: {} }, await GP.getCfg('space_open', {})); fn(c); await GP.setCfg('space_open', c); }).catch((e) => toast('저장 실패: ' + e.message, true));
    return openQueue;
  }
  async function renderSpace() {
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    let gym = (await GP.readList('list_gym')).map((i) => ({ orig: i.value, value: i.value }));
    let room = (await GP.readList('list_room')).map((i) => ({ orig: i.value, value: i.value }));
    let times = (await GP.readList('list_time')).map((i) => i.value); if (!times.length) times = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    let cfg = Object.assign({ sem1: {}, sem2: {}, exceptions: [], closeExceptions: [], colors: {} }, await GP.getCfg('space_open', {}));
    const gen = await APP.getGeneral(); const sems = await APP.getSemesterRows(gen.year);
    const today = new Date(); const inS = (n) => sems[n] && today >= sems[n].start && today <= sems[n].end;
    let sub = 'gym', lastDate = ymd(today); const open = { sem1: !inS('2학기'), sem2: !!inS('2학기') };
    const colorOf = (idx, name) => cfg.colors[name] || PALETTE[idx % PALETTE.length];
    const arr = (k) => (k === 'gym' ? gym : room);

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
        '<div class="space-y-1 max-h-64 overflow-auto">' + (cfg[key] || []).map((e, i) => '<div class="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ' + c.item + '"><span>' + esc(e.date) + ' · ' + esc(e.period) + ' · ' + esc(e.space) + '</span><button data-exdel="' + key + '" data-i="' + i + '" class="text-slate-500 hover:text-red-700">✕</button></div>').join('') + '</div></div>';
    };

    const drawLists = () => {
      $('lists').innerHTML = listEditor('체육 공간', gym, 'gym') + listEditor('특별실', room, 'room');
      $('lists').querySelectorAll('[data-l]').forEach((el) => el.onchange = () => { arr(el.dataset.l)[+el.dataset.i].value = el.value; saveList(el.dataset.l); });
      $('lists').querySelectorAll('[data-ldel]').forEach((b) => b.onclick = () => { arr(b.dataset.ldel).splice(+b.dataset.i, 1); drawLists(); saveList(b.dataset.ldel); });
      $('lists').querySelectorAll('[data-ladd]').forEach((b) => b.onclick = () => { const a = arr(b.dataset.ladd); a.push({ orig: '', value: '' }); drawLists(); [...$('lists').querySelectorAll('[data-l="' + b.dataset.ladd + '"]')].pop().focus(); });
    };
    // 공간 목록: 추가·수정·삭제를 바로 data_basic(list_gym / list_room)에 저장하고, 이름이 바뀐 공간의 개방 설정도 함께 옮깁니다.
    const saveList = (key) => autosave(async () => {
      const items = arr(key).map((x) => ({ orig: x.orig, value: x.value.trim() })).filter((x) => x.value);
      if (new Set(items.map((x) => x.value)).size !== items.length) throw new Error('중복된 이름이 있습니다.');
      await GP.writeList(key === 'gym' ? 'list_gym' : 'list_room', items.map((x) => ({ value: x.value })));
      const renamed = {}; items.forEach((x) => { if (x.orig && x.orig !== x.value) renamed[x.orig] = x.value; });
      const removed = arr(key).map((x) => x.orig).filter((o) => o && !items.some((x) => x.orig === o));
      await mutateOpen((c) => {
        const fix = (obj) => Object.keys(obj).forEach((k) => { const m = k.match(/^(.*_\d+_)(.+)$/); if (!m) return; if (renamed[m[2]]) { obj[m[1] + renamed[m[2]]] = obj[k]; delete obj[k]; } else if (removed.indexOf(m[2]) >= 0) delete obj[k]; });
        fix(c.sem1); fix(c.sem2);
        ['exceptions', 'closeExceptions'].forEach((n) => { c[n] = (c[n] || []).map((e) => (renamed[e.space] ? Object.assign({}, e, { space: renamed[e.space] }) : e)).filter((e) => removed.indexOf(e.space) < 0); });
        Object.keys(renamed).forEach((o) => { if (c.colors[o]) { c.colors[renamed[o]] = c.colors[o]; delete c.colors[o]; } });
      });
      cfg = Object.assign(cfg, await GP.getCfg('space_open', {}));
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
        lastDate = date; cfg[k] = (cfg[k] || []).concat([e]); mutateOpen((c) => { c[k] = (c[k] || []).concat([e]); }).then(drawTables);
      });
      root.querySelectorAll('[data-exdel]').forEach((b) => b.onclick = () => { const k = b.dataset.exdel, i = +b.dataset.i; const e = cfg[k][i]; cfg[k].splice(i, 1);
        mutateOpen((c) => { c[k] = (c[k] || []).filter((x) => !(x.date === e.date && x.period === e.period && x.space === e.space)); }).then(drawTables); });
    };
    view.innerHTML = '<div class="space-y-5"><div id="lists" class="grid md:grid-cols-2 gap-5"></div><div id="tables" class="space-y-5"></div></div>';
    drawLists(); drawTables();
  }

  // ================================================================ 4) 비밀번호 / 데이터 관리
  async function renderData() {
    const pw = await GP.getPw(); const years = await APP.detectYears(); const g = await APP.getGeneral();
    if (g.year && years.indexOf(g.year) < 0) years.push(g.year); years.sort((a, b) => a - b);
    view.innerHTML = '<div class="space-y-5"><div class="' + CARD + '"><h2 class="font-bold text-lg">비밀번호 설정</h2><div class="grid sm:grid-cols-2 gap-3">' +
      '<label class="text-sm font-semibold">페이지 접근 비밀번호<span class="block text-xs font-normal text-slate-400">학생 명렬표, 내선번호 등에 공통 적용</span><input id="pwAccess" value="' + esc(pw.access) + '" class="' + INP + ' w-full mt-1"></label>' +
      '<label class="text-sm font-semibold">관리자 페이지 비밀번호<span class="block text-xs font-normal text-slate-400">이 관리자 페이지 접근용</span><input id="pwAdmin" value="' + esc(pw.admin) + '" class="' + INP + ' w-full mt-1"></label></div>' +
      '<div class="text-right"><button id="savePw" class="' + BTN_P + '">비밀번호 저장</button></div></div>' +
      '<div class="' + CARD + ' border-red-200"><h2 class="font-bold text-lg text-red-700">데이터 삭제</h2><p class="text-sm text-slate-500">선택한 학년도의 날짜 데이터(학교 행사, 학년 일정, 각종 시간표, 학기·휴일 설정, 학습준비물)를 삭제합니다.</p>' +
      '<div class="flex gap-2 items-center"><select id="delYear" class="' + INP + '">' + years.map((y) => '<option value="' + y + '">' + y + '학년도</option>').join('') + '</select><button id="delBtn" class="' + BTN + ' bg-red-600 text-white hover:bg-red-700">과거 데이터 삭제</button></div></div></div>' +
      '<div id="dm" class="fixed inset-0 bg-black/40 hidden items-center justify-center p-4 z-50"><div class="bg-white rounded-2xl p-5 w-full max-w-md space-y-3"><h3 class="font-bold text-lg text-red-700">정말 삭제할까요?</h3>' +
      '<p class="text-sm text-slate-600"><b id="dmY"></b> 데이터는 <b>삭제하면 복구할 수 없습니다.</b> 계속하려면 아래에 <b>과거 데이터 삭제</b> 를 입력하세요.</p><input id="dmIn" class="' + INP + ' w-full" placeholder="과거 데이터 삭제">' +
      '<div class="flex justify-end gap-2"><button id="dmNo" class="' + BTN_G + '">취소</button><button id="dmYes" disabled class="' + BTN + ' bg-red-600 text-white disabled:opacity-40">삭제</button></div></div></div>';
    $('savePw').onclick = () => guard(async () => {
      const a = $('pwAccess').value.trim(), b = $('pwAdmin').value.trim(); if (!a || !b) throw new Error('비밀번호를 입력하세요.');
      await GP.setPw({ access: a, admin: b });
    }, '비밀번호가 저장되었습니다.');
    const modal = $('dm'); const show = (v) => { modal.classList.toggle('hidden', !v); modal.classList.toggle('flex', v); };
    $('delBtn').onclick = () => { $('dmY').textContent = $('delYear').value + '학년도'; $('dmIn').value = ''; $('dmYes').disabled = true; show(true); };
    $('dmNo').onclick = () => show(false); $('dmIn').oninput = () => { $('dmYes').disabled = $('dmIn').value.trim() !== '과거 데이터 삭제'; };
    $('dmYes').onclick = () => guard(async () => {
      const s = await APP.deleteYear(parseInt($('delYear').value, 10)); show(false);
      toast('삭제 완료 (' + Object.keys(s).map((k) => k.replace('data_', '') + ' ' + s[k]).join(', ') + ')'); renderData();
    });
  }
})();
