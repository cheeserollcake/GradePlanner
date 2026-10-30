/* admin-ui.js : 학년 관리자 페이지 화면 */
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
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'hidden'; }, 2200);
  }
  async function guard(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { console.error(e); toast('실패: ' + e.message, true); } }

  // ================================================================ 로그인
  async function tryLogin() {
    const pw = await GP.getPw();
    if ($('pw').value === pw.admin) { sessionStorage.setItem('gp_admin', '1'); start(); } else { $('pwErr').classList.remove('hidden'); }
  }
  $('login').onclick = tryLogin; $('pw').onkeydown = (e) => { if (e.key === 'Enter') tryLogin(); };
  $('lock').onclick = () => { sessionStorage.removeItem('gp_admin'); location.reload(); };
  if (sessionStorage.getItem('gp_admin') === '1') start();

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
    let subs = (await GP.getSubjectConfig()).map((s) => ({ name: s.name, hours: s.hours, special: s.special }));
    let times = (await GP.readList('list_time')).map((i) => i.value); if (!times.length) times = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    const draw = () => {
      view.innerHTML = '<div class="grid lg:grid-cols-3 gap-5"><div class="lg:col-span-2 ' + CARD + '"><h2 class="font-bold text-lg">과목 / 시수 / 전담 설정</h2>' +
        '<table class="w-full text-sm"><thead><tr class="text-slate-500"><th class="text-left p-1">과목</th><th class="p-1 w-24">주당 시수</th><th class="p-1 w-20">전담</th><th class="w-10"></th></tr></thead><tbody>' +
        subs.map((s, i) => '<tr><td class="p-1"><input data-i="' + i + '" data-k="name" value="' + esc(s.name) + '" class="' + INP + ' w-full"></td>' +
          '<td class="p-1"><input data-i="' + i + '" data-k="hours" type="number" min="0" value="' + esc(s.hours) + '" class="' + INP + ' w-full text-center"></td>' +
          '<td class="p-1 text-center"><input data-i="' + i + '" data-k="special" type="checkbox" ' + (s.special ? 'checked' : '') + ' class="w-4 h-4"></td>' +
          '<td class="p-1"><button data-del="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></td></tr>').join('') +
        '</tbody></table><div class="flex items-center justify-between"><button id="addSub" class="' + BTN_G + '">+ 과목 추가</button>' +
        '<span class="text-sm text-slate-500">시수 합계 <b id="hsum">' + subs.reduce((a, s) => a + num(s.hours), 0) + '</b></span></div><div class="text-right"><button id="saveSub" class="' + BTN_P + '">과목 저장</button></div></div>' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">교시 설정</h2><div class="space-y-2">' +
        times.map((t, i) => '<div class="flex gap-2"><input data-ti="' + i + '" value="' + esc(t) + '" class="' + INP + ' flex-1"><button data-tdel="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></div>').join('') +
        '</div><div class="flex justify-between"><button id="addTime" class="' + BTN_G + '">+ 교시 추가</button><button id="saveTime" class="' + BTN_P + '">교시 저장</button></div></div></div>';
      view.querySelectorAll('[data-k]').forEach((el) => el.onchange = () => { const s = subs[el.dataset.i]; s[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; if (el.dataset.k === 'hours') $('hsum').textContent = subs.reduce((a, x) => a + num(x.hours), 0); });
      view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { subs.splice(+b.dataset.del, 1); draw(); });
      view.querySelectorAll('[data-ti]').forEach((el) => el.onchange = () => { times[+el.dataset.ti] = el.value; });
      view.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = () => { times.splice(+b.dataset.tdel, 1); draw(); });
      $('addSub').onclick = () => { subs.push({ name: '', hours: '', special: false }); draw(); };
      $('addTime').onclick = () => { times.push((times.length + 1) + '교시'); draw(); };
      $('saveSub').onclick = () => guard(async () => {
        const list = subs.map((s) => ({ name: s.name.trim(), hours: s.hours, special: s.special })).filter((s) => s.name);
        if (new Set(list.map((s) => s.name)).size !== list.length) throw new Error('중복된 과목명이 있습니다.');
        await GP.writeList('list_sub', list.map((s) => ({ value: s.name, extra: { list_sub_hours: s.hours === '' ? '' : num(s.hours), list_sub_special: !!s.special } })));
      }, '과목이 저장되었습니다.');
      $('saveTime').onclick = () => guard(async () => {
        const list = times.map((t) => t.trim()).filter(Boolean); if (new Set(list).size !== list.length) throw new Error('중복된 교시가 있습니다.');
        await GP.writeList('list_time', list.map((v) => ({ value: v })));
      }, '교시가 저장되었습니다.');
    };
    draw();
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

  async function renderBasic() {
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    let g = await APP.getGeneral();
    let teachers = await APP.teacherNames();
    const subs = (await GP.getSubjectConfig()).filter((s) => s.special).map((s) => s.name);
    let events = [], sems = {}, editId = null;
    const range = () => APP.yearRange(g.year);
    const rr = () => { const r = range(); return { min: ymd(r.start), max: ymd(r.end) }; };

    const loadYearData = async () => { sems = await APP.getSemesterRows(g.year); events = await APP.listBaseEvents(g.year); };
    const refs = (gg, name) => Object.values(gg.homeroom).includes(name) || gg.specials.some((s) => s.teacher === name);

    const draw = () => {
      const { min, max } = rr();
      const semHtml = APP.SEM_NAMES.map((n) => '<div class="flex flex-wrap items-center gap-2"><span class="w-20 font-semibold text-sm">' + n + '</span>' +
        '<input type="date" data-sem="' + n + '" data-p="start" min="' + min + '" max="' + max + '" value="' + (sems[n] ? ymd(sems[n].start) : '') + '" class="' + INP + '"><span>~</span>' +
        '<input type="date" data-sem="' + n + '" data-p="end" min="' + min + '" max="' + max + '" value="' + (sems[n] ? ymd(sems[n].end) : '') + '" class="' + INP + '"></div>').join('');
      const evHtml = events.map((e) => '<tr class="border-t"><td class="p-1.5 whitespace-nowrap">' + ymd(e.start) + (e.end && ymd(e.end) !== ymd(e.start) ? ' ~ ' + ymd(e.end) : '') + '</td><td class="p-1.5 whitespace-pre-wrap">' + esc(e.name) + '</td>' +
        '<td class="p-1.5 whitespace-nowrap text-right"><button data-eedit="' + e.id + '" class="text-slate-500 hover:text-indigo-600 mr-2">수정</button><button data-edel="' + e.id + '" class="text-slate-400 hover:text-red-600">삭제</button></td></tr>').join('');
      const ed = editId ? events.find((x) => x.id === editId) : null;
      const classHtml = g.classNames.map((n, i) => '<span class="inline-flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 text-sm"><span data-cn="' + i + '">' + esc(n) + '</span><button data-cedit="' + i + '" title="이름 수정">✏️</button></span>').join(' ');
      const homeHtml = g.classNames.map((n) => '<div class="flex items-center gap-2"><span class="w-20 text-sm font-semibold">' + esc(n) + '</span><input data-home="' + esc(n) + '" list="tlist" value="' + esc(g.homeroom[n] || '') + '" placeholder="담임 이름" class="' + INP + ' flex-1"></div>').join('');
      const spHtml = g.specials.map((s, i) => '<div class="border rounded-lg p-2 space-y-2 bg-slate-50"><div class="flex flex-wrap gap-2 items-center">' +
        '<select data-sp="' + i + '" data-k="subject" class="' + INP + '"><option value="">과목</option>' + subs.concat(s.subject && subs.indexOf(s.subject) < 0 ? [s.subject] : []).map((x) => '<option ' + (s.subject === x ? 'selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
        '<details class="relative"><summary class="' + INP + ' cursor-pointer list-none">담당학급 (' + (s.classes || []).length + ')</summary><div class="absolute z-20 bg-white border rounded-lg shadow p-2 mt-1 w-40 max-h-52 overflow-auto">' +
        g.classNames.map((c) => '<label class="flex gap-2 text-sm py-0.5"><input type="checkbox" data-spc="' + i + '" value="' + esc(c) + '" ' + ((s.classes || []).indexOf(c) >= 0 ? 'checked' : '') + '>' + esc(c) + '</label>').join('') + '</div></details>' +
        '<input data-sp="' + i + '" data-k="teacher" list="tlist" value="' + esc(s.teacher || '') + '" placeholder="교사 이름" class="' + INP + ' w-32">' +
        '<button data-spdel="' + i + '" class="text-slate-400 hover:text-red-600 ml-auto">✕</button></div>' +
        '<div class="flex flex-wrap items-center gap-3 text-sm">기간 ' + ['1학기', '2학기'].map((t) => '<label class="flex gap-1"><input type="checkbox" data-spt="' + i + '" value="' + t + '" ' + ((s.terms || []).indexOf(t) >= 0 ? 'checked' : '') + '>' + t + '</label>').join('') +
        '<button data-spper="' + i + '" class="' + BTN_G + ' !py-1">기간입력</button>' +
        (s.period || s.showPeriod ? '<input type="date" data-sp="' + i + '" data-k="pstart" min="' + min + '" max="' + max + '" value="' + esc((s.period || {}).start || '') + '" class="' + INP + '">~<input type="date" data-sp="' + i + '" data-k="pend" min="' + min + '" max="' + max + '" value="' + esc((s.period || {}).end || '') + '" class="' + INP + '">' : '') + '</div></div>').join('');

      view.innerHTML = '<datalist id="tlist">' + teachers.map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist><div class="space-y-5">' +
        // 학년도 설정
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">학년도 설정</h2><div class="flex flex-wrap items-center gap-2"><input id="year" type="number" value="' + g.year + '" class="' + INP + ' w-28"><span class="text-sm">학년도</span>' +
        '<button id="saveYear" class="' + BTN_P + '">학년도 저장</button><span class="text-sm text-slate-500">' + appDate(range().start) + ' ~ ' + appDate(range().end) + '</span></div>' +
        '<div class="space-y-2 pt-2 border-t">' + semHtml + '</div><div class="text-right"><button id="saveSem" class="' + BTN_P + '">학기·방학 기간 저장</button></div></div>' +
        // 기초 일정
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">기초 일정</h2><div class="flex flex-wrap gap-2 items-center">' +
        '<input id="evName" placeholder="학교 행사" value="' + esc(ed ? ed.name : '') + '" class="' + INP + ' flex-1 min-w-[10rem]"><input id="evStart" type="date" min="' + min + '" max="' + max + '" value="' + (ed ? ymd(ed.start) : '') + '" class="' + INP + '">' +
        '<span>~</span><input id="evEnd" type="date" min="' + min + '" max="' + max + '" value="' + (ed && ed.end ? ymd(ed.end) : '') + '" class="' + INP + '" title="종료일(선택)">' +
        '<button id="evSave" class="' + BTN_P + '">' + (editId ? '수정 저장' : '추가') + '</button>' + (editId ? '<button id="evCancel" class="' + BTN_G + '">취소</button>' : '') + '</div>' +
        '<p class="text-xs text-slate-400">종료일을 비워 두면 하루짜리 일정입니다.</p>' +
        '<div class="flex flex-wrap gap-2 items-center"><button id="tpl" class="' + BTN_G + '">CSV 양식 다운로드</button><label class="' + BTN_G + ' cursor-pointer">CSV 업로드<input id="csv" type="file" accept=".csv,text/csv" class="hidden"></label></div>' +
        '<div class="max-h-72 overflow-auto border rounded-lg"><table class="w-full text-sm"><tbody>' + (evHtml || '<tr><td class="p-4 text-center text-slate-400">이 학년도에 등록된 일정이 없습니다.</td></tr>') + '</tbody></table></div></div>' +
        // 학급 및 교사
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">학급 및 교사 설정</h2>' +
        '<div class="space-y-2"><h3 class="font-semibold text-sm text-slate-600">학급 설정</h3><div class="flex flex-wrap items-center gap-2"><span class="text-sm">학급 수</span><input id="cc" type="number" min="1" max="30" value="' + g.classCount + '" class="' + INP + ' w-20"><button id="saveClass" class="' + BTN_P + '">학급 저장</button></div><div class="flex flex-wrap gap-2">' + classHtml + '</div></div>' +
        '<div class="space-y-2 pt-3 border-t"><h3 class="font-semibold text-sm text-slate-600">교사 이름 관리</h3><div class="flex flex-wrap gap-2">' +
        (teachers.map((t) => '<span class="inline-flex items-center gap-1 bg-slate-100 rounded-full px-3 py-1 text-sm">' + esc(t) + '<button data-tdel="' + esc(t) + '" class="text-slate-400 hover:text-red-600">✕</button></span>').join('') || '<span class="text-sm text-slate-400">등록된 교사가 없습니다.</span>') + '</div></div>' +
        '<div class="grid lg:grid-cols-2 gap-5 pt-3 border-t"><div class="space-y-2"><h3 class="font-semibold text-sm text-slate-600">담임교사</h3>' + homeHtml + '<div class="text-right"><button id="saveHome" class="' + BTN_P + '">담임 저장</button></div></div>' +
        '<div class="space-y-2"><h3 class="font-semibold text-sm text-slate-600">전담교사</h3>' + (spHtml || '<p class="text-sm text-slate-400">등록된 전담교사가 없습니다. (과목은 시간표 설정에서 \'전담\'으로 체크한 과목만 선택됩니다.)</p>') +
        '<div class="flex justify-between"><button id="addSp" class="' + BTN_G + '">+ 전담교사 추가</button><button id="saveSp" class="' + BTN_P + '">전담 저장</button></div></div></div></div></div>';
      bind();
    };

    const bind = () => {
      $('saveYear').onclick = () => guard(async () => {
        const y = parseInt($('year').value, 10); if (!(y >= 2000 && y <= 2100)) throw new Error('올바른 연도를 입력하세요.');
        g.year = y; await APP.saveGeneral(g); await loadYearData(); draw();
      }, '학년도가 저장되었습니다.');
      $('saveSem').onclick = () => guard(async () => {
        const { start, end } = range(); const vals = {};
        APP.SEM_NAMES.forEach((n) => {
          const a = toDate(view.querySelector('[data-sem="' + n + '"][data-p="start"]').value), b = toDate(view.querySelector('[data-sem="' + n + '"][data-p="end"]').value);
          if (!a && !b) return; if (!a || !b) throw new Error(n + ': 시작과 종료 날짜를 모두 입력하세요.');
          if (a > b) throw new Error(n + ': 종료 날짜가 시작 날짜보다 빠릅니다.');
          if (a < start || b > end) throw new Error(n + ': 학년도 기간(' + ymd(start) + ' ~ ' + ymd(end) + ')을 벗어났습니다.');
          vals[n] = { start: a, end: b };
        });
        await APP.saveSemesters(g.year, vals); await loadYearData(); draw();
      }, '기간이 저장되었습니다.');

      // 기초 일정
      const readEv = () => {
        const name = $('evName').value.trim(), a = toDate($('evStart').value), b = toDate($('evEnd').value), r = range();
        if (!name) throw new Error('학교 행사를 입력하세요.'); if (!a) throw new Error('시작 날짜를 입력하세요.');
        if (a < r.start || a > r.end || (b && (b < r.start || b > r.end))) throw new Error('학년도 기간을 벗어난 날짜입니다.');
        if (b && b < a) throw new Error('종료 날짜가 시작 날짜보다 빠릅니다.'); return { name, start: a, end: b };
      };
      $('evSave').onclick = () => guard(async () => {
        const e = readEv(); if (editId) await APP.updateBaseEvent(editId, e); else await APP.addBaseEvents([e]);
        editId = null; await loadYearData(); draw();
      }, '저장되었습니다.');
      if ($('evCancel')) $('evCancel').onclick = () => { editId = null; draw(); };
      view.querySelectorAll('[data-eedit]').forEach((b) => b.onclick = () => { editId = b.dataset.eedit; draw(); window.scrollTo({ top: 0 }); });
      view.querySelectorAll('[data-edel]').forEach((b) => b.onclick = () => { if (confirm('이 일정을 삭제할까요?')) guard(async () => { await APP.deleteBaseEvent(b.dataset.edel); await loadYearData(); draw(); }, '삭제되었습니다.'); });
      $('tpl').onclick = () => {
        const blob = new Blob(['\uFEFF학교 행사,시작 날짜,종료 날짜\n개학식,' + g.year + '-03-02,\n중간고사,' + g.year + '-04-20,' + g.year + '-04-24\n'], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '기초일정_양식.csv'; a.click();
      };
      $('csv').onchange = (ev) => guard(async () => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; const rows = parseCSV(await readCsvFile(f)); const r = range();
        const body = rows.length && /학교|행사/.test(rows[0][0]) ? rows.slice(1) : rows; const ok = [], bad = [];
        body.forEach((c, i) => {
          const name = str(c[0]).trim(), a = toDate(c[1]), b = toDate(c[2]);
          if (!name || !a || a < r.start || a > r.end || (b && (b < a || b > r.end))) bad.push((i + 1) + '행'); else ok.push({ name, start: a, end: b });
        });
        if (ok.length) await APP.addBaseEvents(ok); await loadYearData(); draw();
        toast(ok.length + '건 추가' + (bad.length ? ', 건너뜀: ' + bad.slice(0, 5).join(', ') + (bad.length > 5 ? ' 외' : '') : ''), bad.length > 0);
      });

      // 학급
      view.querySelectorAll('[data-cedit]').forEach((b) => b.onclick = () => {
        const i = +b.dataset.cedit; const span = view.querySelector('[data-cn="' + i + '"]');
        span.innerHTML = '<input class="border rounded px-1 w-20 text-sm" value="' + esc(g.classNames[i]) + '">'; const inp = span.firstChild; inp.focus();
        const done = () => { const v = inp.value.trim(); if (v && g.classNames.indexOf(v) < 0 || v === g.classNames[i]) { const old = g.classNames[i]; g.classNames[i] = v;
          if (old !== v) { if (g.homeroom[old] !== undefined) { g.homeroom[v] = g.homeroom[old]; delete g.homeroom[old]; } g.specials.forEach((s) => { s.classes = (s.classes || []).map((c) => (c === old ? v : c)); }); guard(() => APP.saveGeneral(g), '학급 이름이 저장되었습니다.'); } } draw(); };
        inp.onblur = done; inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
      });
      $('saveClass').onclick = () => guard(async () => {
        const n = parseInt($('cc').value, 10); if (!(n >= 1 && n <= 30)) throw new Error('학급 수는 1~30 사이로 입력하세요.');
        g.classCount = n; g.classNames = Array.from({ length: n }, (_, i) => g.classNames[i] || (i + 1) + '반');
        g.classNames = g.classNames.map((c, i) => c || (i + 1) + '반'); await APP.saveGeneral(g); draw();
      }, '학급 설정이 저장되었습니다.');

      // 교사 이름 관리
      view.querySelectorAll('[data-tdel]').forEach((b) => b.onclick = () => {
        const name = b.dataset.tdel; const used = refs(g, name);
        if (!confirm(used ? '"' + name + '" 교사는 담임/전담 설정에 사용 중입니다. 삭제하면 해당 설정에서도 지워집니다. 삭제할까요?' : '"' + name + '" 교사를 삭제할까요?')) return;
        guard(async () => {
          Object.keys(g.homeroom).forEach((k) => { if (g.homeroom[k] === name) g.homeroom[k] = ''; }); g.specials.forEach((s) => { if (s.teacher === name) s.teacher = ''; });
          await APP.saveGeneral(g); teachers = teachers.filter((t) => t !== name); await APP.setTeacherNames(teachers); draw();
        }, '삭제되었습니다.');
      });

      // 담임
      $('saveHome').onclick = () => guard(async () => {
        const old = Object.assign({}, g.homeroom); const next = {};
        view.querySelectorAll('[data-home]').forEach((inp) => { next[inp.dataset.home] = inp.value.trim(); });
        const vals = Object.values(next).filter(Boolean); if (new Set(vals).size !== vals.length) throw new Error('같은 교사가 두 학급의 담임으로 입력되어 있습니다.');
        g.homeroom = next; await syncTeachers(old); await APP.saveGeneral(g); draw();
      }, '담임 정보가 저장되었습니다.');

      // 전담
      const collectSp = () => {
        view.querySelectorAll('[data-sp]').forEach((el) => { const s = g.specials[+el.dataset.sp]; const k = el.dataset.k;
          if (k === 'subject' || k === 'teacher') s[k] = el.value.trim(); if (k === 'pstart' || k === 'pend') { s.period = s.period || {}; s.period[k === 'pstart' ? 'start' : 'end'] = el.value; } });
        g.specials.forEach((s, i) => { s.classes = [...view.querySelectorAll('[data-spc="' + i + '"]:checked')].map((x) => x.value); s.terms = [...view.querySelectorAll('[data-spt="' + i + '"]:checked')].map((x) => x.value); });
      };
      $('addSp').onclick = () => { collectSp(); g.specials.push({ subject: '', classes: [], teacher: '', terms: ['1학기', '2학기'], period: null }); draw(); };
      view.querySelectorAll('[data-spdel]').forEach((b) => b.onclick = () => { collectSp(); g.specials.splice(+b.dataset.spdel, 1); draw(); });
      view.querySelectorAll('[data-spper]').forEach((b) => b.onclick = () => { collectSp(); g.specials[+b.dataset.spper].showPeriod = true; draw(); });
      $('saveSp').onclick = () => guard(async () => {
        collectSp(); const old = JSON.parse(JSON.stringify(g)); old.specials = (await APP.getGeneral()).specials;
        g.specials.forEach((s) => {
          if (!s.subject) throw new Error('전담 과목을 선택하세요.'); if (!s.teacher) throw new Error('교사 이름을 입력하세요.'); if (!s.classes.length) throw new Error('담당 학급을 선택하세요.');
          if (s.period && (s.period.start || s.period.end)) { const a = toDate(s.period.start), b = toDate(s.period.end), r = range();
            if (!a || !b || a > b || a < r.start || b > r.end) throw new Error(s.teacher + ': 기간을 올바르게 입력하세요. (학년도 범위 내)'); } else s.period = null;
          if (!s.period && !s.terms.length) throw new Error(s.teacher + ': 기간(학기)을 선택하세요.'); delete s.showPeriod;
        });
        await syncTeachers({}, old); await APP.saveGeneral(g); draw();
      }, '전담교사 정보가 저장되었습니다.');
    };

    // 저장한 교사 이름을 list_t 에 반영(중복 없이). 더 이상 어디에도 쓰이지 않는 이전 이름은 교체합니다.
    async function syncTeachers(oldHome, oldAll) {
      const names = [...Object.values(g.homeroom), ...g.specials.map((s) => s.teacher)].map((n) => str(n).trim()).filter(Boolean);
      const prev = [...Object.values(oldHome || {}), ...(((oldAll || {}).specials || []).map((s) => s.teacher))].map((n) => str(n).trim()).filter(Boolean);
      let list = (await APP.teacherNames()).filter((t) => !(prev.indexOf(t) >= 0 && !refs(g, t)));
      names.forEach((n) => { if (list.indexOf(n) < 0) list.push(n); });
      await APP.setTeacherNames(list); teachers = list;
    }

    await loadYearData(); draw();
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
    const colorOf = (list, idx, name) => cfg.colors[name] || PALETTE[idx % PALETTE.length];

    const listEditor = (title, arr, key) => '<div class="' + CARD + '"><h2 class="font-bold text-lg">' + title + '</h2><div class="space-y-2">' +
      arr.map((x, i) => '<div class="flex gap-2"><input data-l="' + key + '" data-i="' + i + '" value="' + esc(x.value) + '" class="' + INP + ' flex-1"><button data-ldel="' + key + '" data-i="' + i + '" class="text-slate-400 hover:text-red-600">✕</button></div>').join('') +
      '</div><div class="flex justify-between"><button data-ladd="' + key + '" class="' + BTN_G + '">+ 추가</button><button data-lsave="' + key + '" class="' + BTN_P + '">저장</button></div></div>';

    const table = (semKey, semName, spaces) => {
      const hdr = DAYS5.map(([, d]) => '<th colspan="' + (spaces.length + 1) + '" class="border p-2 bg-slate-100">' + d + '</th>').join('');
      const sub2 = DAYS5.map(() => '<th class="border p-1 bg-slate-50 text-xs w-16">교시</th>' + spaces.map((s, i) => '<th class="border p-1 text-xs min-w-[64px]" style="background:' + colorOf(spaces, i, s) + '"><div>' + esc(s) + '</div><input type="color" data-color="' + esc(s) + '" value="' + colorOf(spaces, i, s) + '" class="w-6 h-4 p-0 border-0 bg-transparent cursor-pointer"></th>').join('')).join('');
      const body = times.map((t, p) => '<tr>' + DAYS5.map(([dk]) => '<td class="border bg-slate-50 text-xs font-semibold">' + esc(t) + '</td>' + spaces.map((s, i) => {
        const k = dk + '_' + (p + 1) + '_' + s, on = !!cfg[semKey][k];
        return '<td class="border text-center" data-cell style="' + (on ? 'background:' + colorOf(spaces, i, s) : '') + '"><input type="checkbox" class="w-4 h-4" data-sem="' + semKey + '" data-k="' + esc(k) + '" data-sp="' + esc(s) + '" ' + (on ? 'checked' : '') + '></td>';
      }).join('')).join('') + '</tr>').join('');
      return '<div class="' + CARD + '"><div class="flex items-center justify-between"><h3 class="font-bold">' + semName + '</h3><button data-fold="' + semKey + '" class="' + BTN_G + ' !py-1">' + (open[semKey] ? '접기' : '펼치기') + '</button></div>' +
        (open[semKey] ? '<div class="overflow-x-auto"><table class="text-center border-collapse text-sm"><thead><tr>' + hdr + '</tr><tr>' + sub2 + '</tr></thead><tbody>' + body + '</tbody></table></div>' : '') + '</div>';
    };

    const exPanel = (key, title, blue) => {
      const c = blue ? { btn: 'bg-blue-600 hover:bg-blue-700', item: 'bg-sky-100' } : { btn: 'bg-red-600 hover:bg-red-700', item: 'bg-pink-100' };
      const all = gym.map((x) => x.value).concat(room.map((x) => x.value));
      return '<div class="' + CARD + '"><h3 class="font-bold">' + title + '</h3><div class="flex flex-wrap gap-2 sticky top-0 bg-white">' +
        '<input type="date" data-exd="' + key + '" value="' + lastDate + '" class="' + INP + '"><select data-exp="' + key + '" class="' + INP + '">' + times.map((t) => '<option>' + esc(t) + '</option>').join('') + '</select>' +
        '<select data-exs="' + key + '" class="' + INP + '">' + all.map((s) => '<option>' + esc(s) + '</option>').join('') + '</select><button data-exadd="' + key + '" class="' + BTN + ' text-white ' + c.btn + '">추가</button></div>' +
        '<div class="space-y-1 max-h-64 overflow-auto">' + (cfg[key] || []).map((e, i) => '<div class="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ' + c.item + '"><span>' + esc(e.date) + ' · ' + esc(e.period) + ' · ' + esc(e.space) + '</span><button data-exdel="' + key + '" data-i="' + i + '" class="text-slate-500 hover:text-red-700">✕</button></div>').join('') + '</div></div>';
    };

    const draw = () => {
      const spaces = sub === 'gym' ? gym.map((x) => x.value) : room.map((x) => x.value);
      view.innerHTML = '<div class="space-y-5"><div class="grid md:grid-cols-2 gap-5">' + listEditor('체육 공간', gym, 'gym') + listEditor('특별실', room, 'room') + '</div>' +
        '<div class="flex gap-2"><button data-sub="gym" class="' + BTN + ' ' + (sub === 'gym' ? 'bg-indigo-600 text-white' : 'bg-white border') + '">체육 공간 개방 설정</button><button data-sub="room" class="' + BTN + ' ' + (sub === 'room' ? 'bg-indigo-600 text-white' : 'bg-white border') + '">특별실 개방 설정</button></div>' +
        table('sem1', '1학기', spaces) + table('sem2', '2학기', spaces) +
        '<h2 class="font-bold text-lg pt-2">예외 설정</h2><div class="grid md:grid-cols-2 gap-5">' + exPanel('exceptions', '닫힌 곳 열기', true) + exPanel('closeExceptions', '열린 곳 닫기', false) + '</div></div>';
      bind();
    };

    const bind = () => {
      view.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => { sub = b.dataset.sub; draw(); });
      view.querySelectorAll('[data-fold]').forEach((b) => b.onclick = () => { open[b.dataset.fold] = !open[b.dataset.fold]; draw(); });
      view.querySelectorAll('input[data-sem]').forEach((cb) => cb.onchange = () => {
        const { sem, k, sp } = cb.dataset; const td = cb.parentElement; const idx = (sub === 'gym' ? gym : room).findIndex((x) => x.value === sp);
        td.style.background = cb.checked ? colorOf(null, idx, sp) : ''; cfg[sem][k] = cb.checked; if (!cb.checked) delete cfg[sem][k];
        mutateOpen((c) => { if (cb.checked) c[sem][k] = true; else delete c[sem][k]; });
      });
      view.querySelectorAll('input[data-color]').forEach((inp) => inp.onchange = () => { cfg.colors[inp.dataset.color] = inp.value; mutateOpen((c) => { c.colors[inp.dataset.color] = inp.value; }).then(draw); });
      // 목록 편집
      const arr = (k) => (k === 'gym' ? gym : room);
      view.querySelectorAll('[data-l]').forEach((el) => el.onchange = () => { arr(el.dataset.l)[+el.dataset.i].value = el.value; });
      view.querySelectorAll('[data-ldel]').forEach((b) => b.onclick = () => { arr(b.dataset.ldel).splice(+b.dataset.i, 1); draw(); });
      view.querySelectorAll('[data-ladd]').forEach((b) => b.onclick = () => { arr(b.dataset.ladd).push({ orig: '', value: '' }); draw(); });
      view.querySelectorAll('[data-lsave]').forEach((b) => b.onclick = () => guard(async () => {
        const key = b.dataset.lsave; const items = arr(key).map((x) => ({ orig: x.orig, value: x.value.trim() })).filter((x) => x.value);
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
        cfg = Object.assign(cfg, await GP.getCfg('space_open', {})); const fresh = await GP.readList(key === 'gym' ? 'list_gym' : 'list_room');
        if (key === 'gym') gym = fresh.map((i) => ({ orig: i.value, value: i.value })); else room = fresh.map((i) => ({ orig: i.value, value: i.value })); draw();
      }, '저장되었습니다.'));
      // 예외
      view.querySelectorAll('[data-exadd]').forEach((b) => b.onclick = () => {
        const k = b.dataset.exadd; const date = view.querySelector('[data-exd="' + k + '"]').value; if (!date) return toast('날짜를 입력하세요.', true);
        const e = { date, period: view.querySelector('[data-exp="' + k + '"]').value, space: view.querySelector('[data-exs="' + k + '"]').value };
        lastDate = date; cfg[k] = (cfg[k] || []).concat([e]); mutateOpen((c) => { c[k] = (c[k] || []).concat([e]); }).then(draw);
      });
      view.querySelectorAll('[data-exdel]').forEach((b) => b.onclick = () => { const k = b.dataset.exdel, i = +b.dataset.i; const e = cfg[k][i]; cfg[k].splice(i, 1);
        mutateOpen((c) => { c[k] = (c[k] || []).filter((x) => !(x.date === e.date && x.period === e.period && x.space === e.space)); }).then(draw); });
    };
    draw();
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
