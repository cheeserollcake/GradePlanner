/*
 * app-data.js : 홈 / 6학년 개요 / 관리자 페이지가 함께 쓰는 데이터 처리 (window.APP)
 * gas-shim.js(window.GP) 뒤에 불러옵니다.
 */
(function () {
  'use strict';
  const G = window.GP;
  const { getCol, invalidate, getCfg, setCfg, toDate, ymd, appDate, addDays, eachDay, num, str, natural, commit, newId, readList, writeList } = G;
  const DEL = () => G.DELETE;

  // ------------------------------------------------------------ 학년도 / 일반 설정
  const yearRange = (y) => ({ start: new Date(y, 1, 1), end: new Date(y + 1, 2, 0) }); // 2/1 ~ 다음해 2월 말일
  const yearOf = (d) => (d.getMonth() >= 1 ? d.getFullYear() : d.getFullYear() - 1);
  const inRange = (d, r) => d && d >= r.start && d <= r.end;

  const getGeneral = () => G.loadGeneral();                      // 학년도별 담임/전담교사 포함
  const saveGeneral = (g) => G.saveGeneral(g);
  // 학년도 변경: 이전 학년도 설정은 그대로 보관하고, 새 학년도의 담임/전담교사/공간 개방 설정은 비어 있는 상태로 시작
  // 이 기능이 생기기 전에 이미 학년도를 바꿔 둔 경우: 문서를 처음 만든 시각(REST createTime)으로 학년도를 추정해 한 번만 표시를 붙입니다.
  async function migrateYearTags() {
    const flag = await getCfg('year_tag', null); if (flag && flag.done) return false;
    const cur = (await G.loadGeneral()).year; const ops = [];
    for (const col of G.YEARED) {
      const rows = (await G.getColAll(col)).filter((r) => r._year === undefined || r._year === null); if (!rows.length) continue;
      const times = await createTimes(col);   // 확인하지 못하면 오류 → 아무것도 하지 않고 나중에 다시 시도
      rows.forEach((r) => { const t = times.get(r._id); if (t) { const y = yearOf(t); if (y !== cur) { if (col === BT && /^class_\d+$/.test(r._id)) ops.push(...archiveOps(r, y)); else ops.push({ type: 'update', col, id: r._id, data: { _year: y } }); } } });
    }
    await commit(ops); await setCfg('year_tag', { done: true, at: new Date().toISOString() }); return ops.length > 0;
  }
  // 학년도 표시(_year)가 없는 문서는 '지금 학년도' 것입니다. 학년도를 바꾸기 직전에 그 문서들에 지금 학년도를 적어 둡니다.
  // 기초시간표는 학급마다 문서 하나(class_N)라서, 학년도가 바뀌면 지난 학년도 문서를 class_N__y<학년도> 로 옮겨 두고 새 학년도의 보관본이 있으면 되돌립니다.
  const BT = 'data_basic_timetable';
  const archiveOps = (row, y) => { const d = Object.assign({}, row); delete d._id; d._year = y; return [{ type: 'set', col: BT, id: row._id + '__y' + y, data: d }, { type: 'delete', col: BT, id: row._id }]; };
  async function tagYear(y, newYear) {
    const ops = [];
    for (const col of G.YEARED) (await G.getColAll(col)).forEach((r) => {
      if (r._year !== undefined && r._year !== null) return;
      if (col === BT && /^class_\d+$/.test(r._id)) ops.push(...archiveOps(r, y)); else ops.push({ type: 'update', col, id: r._id, data: { _year: y } });
    });
    if (newYear) (await G.getColAll(BT)).forEach((r) => { const m = r._id.match(/^(class_\d+)__y(\d+)$/); if (m && Number(m[2]) === newYear) { const d = Object.assign({}, r); delete d._id; delete d._year; ops.push({ type: 'set', col: BT, id: m[1], data: d }, { type: 'delete', col: BT, id: r._id }); } });
    await commit(ops);
    const groups = await getCfg('course_groups', []);
    if (groups.some((g) => g.year === undefined || g.year === null)) await setCfg('course_groups', groups.map((g) => (g.year === undefined || g.year === null ? Object.assign({}, g, { year: y }) : g)));
  }
  async function setYear(year) {
    const cur = await G.loadGeneral(); await G.saveGeneral(cur);   // 이전 형식의 데이터가 있으면 현재 학년도 것으로 먼저 옮김
    if (year !== cur.year) await tagYear(cur.year, year);   // 지금까지의 명렬표·기초시간표·예산 등에 '이전 학년도' 표시를 붙여 새 학년도에서는 빈 화면으로 보이게 함(삭제 아님)
    cur.year = year; await G.setCfg('general', { year, grade: cur.grade, classCount: cur.classCount, classNames: cur.classNames, legacyMigrated: true });
  }
  // 학기/기간 매칭: entry = {terms:[...], period:{start,end}|null}, sems = {학기이름:{start,end}}
  function entryApplies(e, date, sems) {
    if (e.period && e.period.start && e.period.end) { const a = toDate(e.period.start), b = toDate(e.period.end); return !!a && !!b && date >= a && date <= b; }
    return (e.terms || []).some((n) => sems[n] && date >= sems[n].start && date <= sems[n].end);
  }
  function homeroomFor(g, className, date, sems) {
    const list = g.homerooms.filter((e) => e.className === className && str(e.teacher).trim());
    const now = list.filter((e) => entryApplies(e, date, sems));
    return [...new Set((now.length ? now : list).map((e) => str(e.teacher).trim()))].join(' / ');
  }

  // ------------------------------------------------------------ 휴일 (공휴일 + data_basic.holiday)
  async function holidayMap() {
    const m = new Map();
    Object.keys(G.PUBLIC_HOLIDAYS).forEach((k) => m.set(k, { name: G.PUBLIC_HOLIDAYS[k], custom: false }));
    (await getCol('data_basic')).forEach((r) => {
      const a = toDate(r.holiday_start_date); if (!str(r.holiday).trim() || !a) return;
      const b = toDate(r.holiday_end_date) || a;
      for (const d of eachDay(a, b)) {
        const prev = m.get(ymd(d));
        m.set(ymd(d), { name: prev && prev.custom ? prev.name + ' / ' + str(r.holiday) : str(r.holiday), custom: true });
      }
    });
    return m;
  }

  // ------------------------------------------------------------ 일정 만들기 (홈, 개요)
  // 같은 이름의 일정끼리만 묶습니다. (같은 이름 + 같은 교시 구성인 반은 "1, 4반"처럼 합칩니다.)
  // 정렬: 교시가 빠른 것 → 반이 빠른 것 순서. 예) 6반 1교시 튜터 → 2반 4교시 튜터
  function lecturerText(rows) {
    const num = (v) => { const m = str(v).match(/\d+/); return m ? Number(m[0]) : 9999; };
    const byName = new Map();
    rows.forEach((r) => {
      const name = str(r.add_name).trim(), c = str(r.add_class).trim(), t = str(r.add_time).trim();
      const o = byName.get(name) || byName.set(name, new Map()).get(name);
      if (!o.has(c)) o.set(c, new Set()); if (t) o.get(c).add(t);
    });
    const items = [];
    byName.forEach((classes, name) => {
      const groups = new Map();   // 교시 구성이 같은 반끼리 묶기
      classes.forEach((times, c) => {
        const ts = [...times].sort((a, b) => num(a) - num(b) || natural(a, b)); const k = ts.join(',');
        if (!groups.has(k)) groups.set(k, { ts, cls: [] }); groups.get(k).cls.push(c);
      });
      groups.forEach((g) => {
        g.cls.sort((a, b) => num(a) - num(b) || natural(a, b));
        const clsText = g.cls.filter(Boolean).map((c, i, arr) => (i < arr.length - 1 ? c.replace(/반$/, '') : c)).join(', ');
        items.push({ p: g.ts.length ? num(g.ts[0]) : 9999, c: g.cls.length ? num(g.cls[0]) : 9999, text: [clsText, g.ts.join(', '), name].filter(Boolean).join(' ') });
      });
    });
    return items.sort((a, b) => a.p - b.p || a.c - b.c || natural(a.text, b.text)).map((x) => x.text).join('\n');
  }

  // from~to 사이의 모든 날짜를 순서대로 돌려줍니다. (해당 일정이 없어도 날짜는 항상 나옵니다.)
  async function buildSchedule(from, to) {
    const [ts, tm, add, hol] = await Promise.all([getCol('data_task_school'), getCol('data_task_memo'), getCol('data_add_timetable'), holidayMap()]);
    const spread = (rows, fs, fe, fn, bucket) => rows.forEach((r) => {
      const a = toDate(r[fs]); const name = str(r[fn]); if (!a || !name.trim()) return;
      const b = toDate(r[fe]) || a;
      for (let d = a < from ? from : a; d <= (b > to ? to : b); d = addDays(d, 1)) { const k = ymd(d); (bucket[k] = bucket[k] || []).push(name); }
    });
    const ev = {}, memo = {}, lec = {};
    spread(ts, 'task_school_date_start', 'task_school_date_end', 'task_school_name', ev);
    spread(tm, 'task_memo_date_start', 'task_memo_date_end', 'task_memo_name', memo);
    add.forEach((r) => { const d = toDate(r.add_date); if (d && d >= from && d <= to) (lec[ymd(d)] = lec[ymd(d)] || []).push(r); });
    const out = [];
    for (const d of eachDay(from, to)) {
      const k = ymd(d); const h = hol.get(k);
      const lines = []; if (h) lines.push(h.name);
      (ev[k] || []).forEach((t) => { if (!h || t.trim() !== h.name.trim()) lines.push(t); });
      out.push({ date: d, key: k, dow: d.getDay(), holiday: h ? h.name : '', isHoliday: !!h, school: lines.join('\n'), lecturer: lecturerText(lec[k] || []), memo: (memo[k] || []).join('\n') });
    }
    return out;
  }

  // ------------------------------------------------------------ 하루 일정 수정 (연필 아이콘)
  const sameDay = (a, b) => a && b && ymd(a) === ymd(b);
  async function getDayState(d, fresh) {   // fresh: 저장 직전에만 서버 최신 상태를 확인(수정 창을 열 때는 이미 받아 둔 데이터를 씀 — 모바일에서 수정 창이 늦게 뜨던 원인)
    if (fresh) G.fresh();
    const [ts, tm, basic] = await Promise.all([getCol('data_task_school'), getCol('data_task_memo'), getCol('data_basic')]);
    const single = (rows, fs, fe, fn) => rows.filter((r) => { const a = toDate(r[fs]), b = toDate(r[fe]); return sameDay(a, d) && (!b || sameDay(b, d)) && str(r[fn]).trim(); });
    const range = (rows, fs, fe, fn) => rows.filter((r) => { const a = toDate(r[fs]), b = toDate(r[fe]); return a && b && !sameDay(a, b) && a <= d && b >= d && str(r[fn]).trim(); });
    const hol = basic.filter((r) => str(r.holiday).trim() && sameDay(toDate(r.holiday_start_date), d) && (!toDate(r.holiday_end_date) || sameDay(toDate(r.holiday_end_date), d)));
    return {
      school: single(ts, 'task_school_date_start', 'task_school_date_end', 'task_school_name'),
      schoolRange: range(ts, 'task_school_date_start', 'task_school_date_end', 'task_school_name'),
      holiday: hol,
      memo: single(tm, 'task_memo_date_start', 'task_memo_date_end', 'task_memo_name'),
      memoRange: range(tm, 'task_memo_date_start', 'task_memo_date_end', 'task_memo_name'),
      publicName: G.PUBLIC_HOLIDAYS[ymd(d)] || ''
    };
  }
  function basicStripOps(rows, keys) {
    return rows.map((r) => {
      const others = Object.keys(r).filter((k) => k !== '_id' && !keys.includes(k) && !/_order$/.test(k));
      return others.length ? { type: 'update', col: 'data_basic', id: r._id, data: Object.fromEntries(keys.map((k) => [k, DEL()])) } : { type: 'delete', col: 'data_basic', id: r._id };
    });
  }
  async function clearHolidayRows(rows) {
    const ops = rows.map((r) => {
      const others = Object.keys(r).filter((k) => !['_id', 'holiday', 'holiday_start_date', 'holiday_end_date'].includes(k) && !/_order$/.test(k));
      return others.length ? { type: 'update', col: 'data_basic', id: r._id, data: { holiday: DEL(), holiday_start_date: DEL(), holiday_end_date: DEL() } } : { type: 'delete', col: 'data_basic', id: r._id };
    });
    await commit(ops);
  }
  async function saveDay(d, v) {
    const st = await getDayState(d, true);
    const ops = [];
    if (st.holiday.length) await clearHolidayRows(st.holiday); else st.school.forEach((r) => ops.push({ type: 'delete', col: 'data_task_school', id: r._id }));
    st.memo.forEach((r) => ops.push({ type: 'delete', col: 'data_task_memo', id: r._id }));
    const text = String(v.schoolText || '').replace(/\r\n/g, '\n').trim();
    if (text) {
      if (v.isHoliday) ops.push({ type: 'set', col: 'data_basic', id: newId('data_basic'), data: { holiday: text, holiday_start_date: appDate(d), holiday_end_date: appDate(d) } });
      else ops.push({ type: 'set', col: 'data_task_school', id: newId('data_task_school'), data: { task_school_date_start: appDate(d), task_school_date_end: '', task_school_name: text } });
    }
    const memo = String(v.memoText || '').replace(/\r\n/g, '\n').trim();
    if (memo) ops.push({ type: 'set', col: 'data_task_memo', id: newId('data_task_memo'), data: { task_memo_date_start: appDate(d), task_memo_date_end: '', task_memo_name: memo } });
    await commit(ops);
    ['data_task_school', 'data_task_memo', 'data_basic'].forEach(invalidate);
  }


  // ------------------------------------------------------------ 오늘 날짜 / 여름방학식 / 겨울방학식 카드 (홈, 개요)
  //  방학식 날짜는 data_task_school 에서 task_school_name 에 '여름방학식', '겨울방학식'이 들어 있는 행의 task_school_date_start 입니다.
  async function getVacations(year) {
    const r = yearRange(year); const ts = await getCol('data_task_school');
    const find = (kw) => ts.filter((x) => str(x.task_school_name).indexOf(kw) >= 0).map((x) => toDate(x.task_school_date_start)).filter((d) => d && inRange(d, r)).sort((a, b) => a - b)[0] || null;
    return { summer: find('여름방학식'), winter: find('겨울방학식') };
  }
  const DAYK = ['일', '월', '화', '수', '목', '금', '토'];
  const fmtDate = (d) => d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0') + ' (' + DAYK[d.getDay()] + ')';
  const dday = (target, now) => { const t = now || new Date(); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()); const d = Math.round((target - today) / 86400000); return d === 0 ? 'D-Day' : d > 0 ? 'D-' + d : 'D+' + (-d); };
  const clockText = () => { const t = new Date(); const h = t.getHours(); return (h % 12 || 12) + ':' + String(t.getMinutes()).padStart(2, '0') + ' (' + (h < 12 ? '오전' : '오후') + ')'; };
  async function renderDayCards(box, year) {
    const v = await getVacations(year); const today = new Date();
    const card = (cls, title, main, sub, subId) => '<div class="gpcard ' + cls + '"><div class="gpt">' + title + '</div><div class="gpd">' + main + '</div>' + sub + '</div>';
    const vac = (title, cls, d) => card(cls, title, d ? fmtDate(d) : '-', d ? '<span class="gpp">' + dday(d) + '</span>' : '<span class="gpp">일정 없음</span>');
    box.innerHTML = '<style>.gpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}' +
      '.gpcard{border-radius:18px;padding:18px 10px;text-align:center;box-shadow:0 2px 10px rgba(15,23,42,.06);border:1px solid rgba(255,255,255,.8)}' +
      '.gpt{font-size:13px;font-weight:600;margin-bottom:6px}.gpd{font-size:22px;font-weight:800;letter-spacing:-.3px}' +
      '.gpp{display:inline-block;margin-top:8px;padding:2px 12px;border-radius:999px;background:rgba(255,255,255,.8);font-size:12px;font-weight:700}' +
      '.gptime{margin-top:6px;font-size:14px;font-weight:700}' +
      '.gpc1{background:linear-gradient(135deg,#ecfdf5,#ccfbf1);color:#134e4a}.gpc1 .gpt{color:#3f6f6a}' +
      '.gpc2{background:linear-gradient(135deg,#fff7ed,#fef3c7);color:#7c2d12}.gpc2 .gpt{color:#9a5b3a}' +
      '.gpc3{background:linear-gradient(135deg,#eff6ff,#e0e7ff);color:#312e81}.gpc3 .gpt{color:#5b5fa8}</style>' +
      '<div class="gpgrid">' + card('gpc1', '오늘 날짜', fmtDate(today), '<div class="gptime" id="gp-clock">' + clockText() + '</div>') +
      vac('여름방학식', 'gpc2', v.summer) + vac('겨울방학식', 'gpc3', v.winter) + '</div>';
    clearInterval(box._t); box._t = setInterval(() => { const c = box.querySelector('#gp-clock'); if (c) c.textContent = clockText(); }, 15000);
  }

  // ------------------------------------------------------------ 학기(1학기, 여름방학, 2학기, 겨울방학)
  const SEM_NAMES = ['1학기', '여름방학', '2학기', '겨울방학'];
  async function getSemesterRows(year) {
    const r = yearRange(year);
    const rows = (await getCol('data_basic')).filter((x) => str(x.semester).trim() && inRange(toDate(x.semester_start_date), r));
    const out = {}; rows.forEach((x) => { out[str(x.semester).trim()] = { id: x._id, start: toDate(x.semester_start_date), end: toDate(x.semester_end_date) }; });
    return out;
  }
  async function saveSemesters(year, vals) {
    const cur = await getSemesterRows(year); const ops = [];
    SEM_NAMES.forEach((n) => {
      const v = vals[n]; if (!v || !v.start || !v.end) return;
      const data = { semester: n, semester_start_date: appDate(v.start), semester_end_date: appDate(v.end) };
      if (cur[n]) ops.push({ type: 'update', col: 'data_basic', id: cur[n].id, data }); else ops.push({ type: 'set', col: 'data_basic', id: newId('data_basic'), data });
    });
    await commit(ops); invalidate('data_basic');
  }

  async function clearSemester(year, name) {
    const cur = await getSemesterRows(year); if (!cur[name]) return;
    const row = (await getCol('data_basic')).find((x) => x._id === cur[name].id);
    if (row) await commit(basicStripOps([row], ['semester', 'semester_start_date', 'semester_end_date'])); invalidate('data_basic');
  }

  // ------------------------------------------------------------ 기초 일정 (학교 행사 + 휴일)
  //  학교 행사 → data_task_school(task_school_name / _date_start / _date_end)
  //  휴일      → data_basic(holiday / holiday_start_date / holiday_end_date)
  async function listBaseItems(year) {
    G.fresh(); const r = yearRange(year);
    const ts = (await getCol('data_task_school')).map((x) => ({ kind: 'school', id: x._id, name: str(x.task_school_name), start: toDate(x.task_school_date_start), end: toDate(x.task_school_date_end) }));
    const hol = (await getCol('data_basic')).filter((x) => str(x.holiday).trim() && toDate(x.holiday_start_date))
      .map((x) => ({ kind: 'holiday', id: x._id, name: str(x.holiday), start: toDate(x.holiday_start_date), end: toDate(x.holiday_end_date) }));
    return ts.concat(hol).filter((x) => inRange(x.start, r)).sort((a, b) => a.start - b.start || natural(a.name, b.name));
  }
  const schoolDoc = (e) => ({ task_school_name: e.name, task_school_date_start: appDate(e.start), task_school_date_end: e.end && !sameDay(e.start, e.end) ? appDate(e.end) : '' });
  const holidayDoc = (e) => ({ holiday: e.name, holiday_start_date: appDate(e.start), holiday_end_date: appDate(e.end || e.start) });
  const addOp = (e) => (e.holiday ? { type: 'set', col: 'data_basic', id: newId('data_basic'), data: holidayDoc(e) } : { type: 'set', col: 'data_task_school', id: newId('data_task_school'), data: schoolDoc(e) });
  async function addBaseItems(list) { await commit(list.map(addOp)); ['data_task_school', 'data_basic'].forEach(invalidate); }
  async function removeOps(item) {
    if (item.kind === 'school') return [{ type: 'delete', col: 'data_task_school', id: item.id }];
    const row = (await getCol('data_basic')).find((x) => x._id === item.id); return row ? basicStripOps([row], ['holiday', 'holiday_start_date', 'holiday_end_date']) : [];
  }
  async function updateBaseItem(item, e) {
    const kind = e.holiday ? 'holiday' : 'school';
    if (item.kind === kind) await commit([{ type: 'update', col: kind === 'school' ? 'data_task_school' : 'data_basic', id: item.id, data: kind === 'school' ? schoolDoc(e) : holidayDoc(e) }]);
    else await commit((await removeOps(item)).concat([addOp(e)]));
    ['data_task_school', 'data_basic'].forEach(invalidate);
  }
  async function deleteBaseItem(item) { await commit(await removeOps(item)); ['data_task_school', 'data_basic'].forEach(invalidate); }

  // ------------------------------------------------------------ 교사
  async function teacherNames() { return (await readList('list_t')).map((i) => i.value); }
  async function setTeacherNames(names) { await writeList('list_t', [...new Set(names.map((n) => n.trim()).filter(Boolean))].map((v) => ({ value: v }))); }
  const namesOf = (g) => [...(g.homerooms || []).map((e) => e.teacher), ...(g.specials || []).map((e) => e.teacher)].map((n) => str(n).trim()).filter(Boolean);
  async function syncTeachers(oldG, newG) {
    const prev = new Set(namesOf(oldG)), now = new Set(namesOf(newG)); const cur = await teacherNames();
    const list = cur.filter((t) => !(prev.has(t) && !now.has(t))); now.forEach((n) => { if (list.indexOf(n) < 0) list.push(n); });
    if (list.length !== cur.length || list.some((t, i) => t !== cur[i])) await setTeacherNames(list);
  }
  async function ensureTeachers(names) {
    const cur = await teacherNames(); const add = [...new Set(names.map((n) => str(n).trim()).filter((n) => n && cur.indexOf(n) < 0))];
    if (add.length) await setTeacherNames(cur.concat(add));
  }

  // ------------------------------------------------------------ 과거 데이터 삭제
  const DATE_FIELDS = { data_task_school: 'task_school_date_start', data_task_memo: 'task_memo_date_start', data_add_timetable: 'add_date', data_gym_timetable: 'gym_date', data_room_timetable: 'room_date', data_sub_timetable: 'sub_date' };
  async function detectYears() {
    const ys = new Set();
    for (const [c, f] of Object.entries(DATE_FIELDS)) (await getCol(c)).forEach((r) => { const d = toDate(r[f]); if (d) ys.add(yearOf(d)); });
    (await getCol('data_basic')).forEach((r) => { const d = toDate(r.semester_start_date); if (d) ys.add(yearOf(d)); });
    return [...ys].sort((a, b) => a - b);
  }
  // ---- 작성일(처음 만든 날짜) 확인: 날짜 필드가 없는 데이터(학생 명렬표, 예산, 개요 비고, 강좌 범주, 이미지·파일)는
  //      작성일이 그 학년도인 것을 지웁니다.
  //      Firestore 문서는 REST API 의 createTime(문서를 처음 만든 시각), Storage 파일은 메타데이터의 timeCreated 를 씁니다.
  const restBase = () => { const c = window.FIREBASE_CONFIG; return 'https://firestore.googleapis.com/v1/projects/' + c.projectId + '/databases/(default)/documents'; };
  async function createTimes(col) {   // 문서 ID -> 작성 시각
    const key = encodeURIComponent(window.FIREBASE_CONFIG.apiKey); const out = new Map(); let token = '';
    do {
      const res = await fetch(restBase() + '/' + col + '?key=' + key + '&pageSize=300&mask.fieldPaths=_' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
      if (!res.ok) throw new Error('작성일을 확인하지 못했습니다. (' + col + ', ' + res.status + ')');
      const j = await res.json();
      (j.documents || []).forEach((d) => out.set(decodeURIComponent(d.name.split('/').pop()), new Date(d.createTime)));
      token = j.nextPageToken || '';
    } while (token);
    return out;
  }
  async function docCreateTime(col, id) {
    const res = await fetch(restBase() + '/' + col + '/' + encodeURIComponent(id) + '?key=' + encodeURIComponent(window.FIREBASE_CONFIG.apiKey) + '&mask.fieldPaths=_');
    if (res.status === 404) return null; if (!res.ok) throw new Error('작성일을 확인하지 못했습니다. (' + col + '/' + id + ', ' + res.status + ')');
    const j = await res.json(); return j.createTime ? new Date(j.createTime) : null;
  }
  async function storageFilesIn(folder, r) {
    if (!G.storage) {   // 이 페이지에는 Storage 도구를 미리 넣지 않았으므로 필요할 때만 불러옴(속도)
      try { await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); G.storage = firebase.storage(); } catch (e) { return []; }
    }
    const hit = [];
    const list = await G.storage.ref(folder).listAll();
    for (const it of list.items) { const m = await it.getMetadata(); if (inRange(toDate(new Date(m.timeCreated)), r)) hit.push(it); }
    return hit;
  }

  // ---- 학년도 데이터 정리 계획: 항목마다 {key,label,count,ops,after} 를 만들고, 고른 항목만 실제로 지웁니다.
  const YEAR_ITEMS = [
    ['school', '학교 행사'], ['memo', '학년 일정'], ['add', '추가된 일정 (강좌별 시간표 조회)'], ['sub', '전담 시간표'], ['gym', '체육 공간 시간표'], ['room', '특별실 시간표'],
    ['sem', '학기·방학·휴일 설정'], ['cfg', '담임·전담교사, 공간 개방 설정'], ['groups', '강좌별 시간표 범주'], ['student', '학년 전체 명렬표'], ['basictt', '기초시간표'], ['budget', '예산 내역 (학년 예산·학년회비·추가한 예산 페이지)'],
    ['supply', '학습준비물'], ['overview', '학년 개요 비고'], ['images', '특별실 시간표 이미지'], ['atts', '예산 첨부 이미지·파일'], ['ext', '내선번호 파일'], ['classroom', '교실 배치도 파일'], ['files', '그 밖에 이전 방식으로 올린 파일']
  ];
  async function planYear(year) {
    const r = yearRange(year); const created = (d) => !!d && inRange(toDate(d), r); const cur = await G.curYear(); const plan = [];
    const add = (key, count, ops, after) => plan.push({ key, label: YEAR_ITEMS.find((x) => x[0] === key)[1], count, ops: ops || [], after });
    const dateCol = { school: ['data_task_school', 'task_school_date_start'], memo: ['data_task_memo', 'task_memo_date_start'], add: ['data_add_timetable', 'add_date'], sub: ['data_sub_timetable', 'sub_date'], gym: ['data_gym_timetable', 'gym_date'], room: ['data_room_timetable', 'room_date'] };
    for (const [k, [c, f]] of Object.entries(dateCol)) { const hit = (await getCol(c)).filter((x) => inRange(toDate(x[f]), r)); add(k, hit.length, hit.map((x) => ({ type: 'delete', col: c, id: x._id }))); }
    const basic = await getCol('data_basic'); const semRows = basic.filter((x) => str(x.semester).trim() && inRange(toDate(x.semester_start_date), r)); const holRows = basic.filter((x) => str(x.holiday).trim() && inRange(toDate(x.holiday_start_date), r));
    const sops = []; semRows.forEach((x) => sops.push(...basicStripOps([x], ['semester', 'semester_start_date', 'semester_end_date']))); holRows.forEach((x) => { if (!semRows.includes(x)) sops.push(...basicStripOps([x], ['holiday', 'holiday_start_date', 'holiday_end_date'])); });
    add('sem', semRows.length + holRows.length, sops);
    const cfgs = (await getCol('app_config')).filter((x) => x._id === 'year_' + year || x._id === 'space_open_' + year); add('cfg', cfgs.length, cfgs.map((x) => ({ type: 'delete', col: 'app_config', id: x._id })));
    const groups = await getCfg('course_groups', []); const mineG = (g) => (g.year === undefined || g.year === null ? cur : Number(g.year)) === year; const keepG = groups.filter((g) => !mineG(g));
    add('groups', groups.length - keepG.length, groups.length !== keepG.length ? [{ type: 'set', col: 'app_config', id: 'course_groups', data: { json: JSON.stringify(keepG), updatedAt: new Date().toISOString() } }] : []);
    const yeared = async (col) => (await G.getColAll(col)).filter((x) => (x._year === undefined || x._year === null ? cur : Number(x._year)) === year);
    const stu = await yeared('data_student'); add('student', stu.length, stu.map((x) => ({ type: 'delete', col: 'data_student', id: x._id })));
    const btt = await yeared('data_basic_timetable'); add('basictt', btt.length, btt.map((x) => ({ type: 'delete', col: 'data_basic_timetable', id: x._id })));
    const bud = await yeared('data_budget'), shr = await yeared('data_sheet_rows'); add('budget', bud.length + shr.length, bud.map((x) => ({ type: 'delete', col: 'data_budget', id: x._id })).concat(shr.map((x) => ({ type: 'delete', col: 'data_sheet_rows', id: x._id }))));
    const sup = (await getCol('data_supply')).filter((x) => { const m = str(x.supply_year).match(/\d{4}/); return !!m && parseInt(m[0], 10) === year; }); add('supply', sup.length, sup.map((x) => ({ type: 'delete', col: 'data_supply', id: x._id })));
    const ovs = (await getCol('data_overview')).filter((x) => x._id === 'r5_' + year); add('overview', ovs.length, ovs.map((x) => ({ type: 'delete', col: 'data_overview', id: x._id })));
    const docsIn = async (col) => { try { return (await GP.db.collection(col).get()).docs.filter((d) => created(new Date(d.data().createdAt || 0))); } catch (e) { return []; } };
    const imgs = await docsIn('data_images'); add('images', imgs.length, [], async () => { for (const d of imgs) await d.ref.delete(); });
    const atts = await docsIn('data_files'); add('atts', atts.length, [], async () => { for (const d of atts) await d.ref.delete(); });
    const ext = await getCfg('ext_file', null); const extHit = !!(ext && ext.updatedAt && created(new Date(ext.updatedAt)));
    add('ext', extHit ? 1 : 0, extHit ? [{ type: 'delete', col: 'app_config', id: 'ext_file' }].concat((ext.chunks || []).map((id) => ({ type: 'delete', col: 'data_files', id }))) : []);
    const cls = await storageFilesIn('classroom', r).catch(() => []); add('classroom', cls.length, [], async () => { for (const it of cls) await it.delete(); });
    const oth = []; for (const folder of ['special_room', 'extension', 'budget']) (await storageFilesIn(folder, r).catch(() => [])).forEach((it) => oth.push(it)); add('files', oth.length, [], async () => { for (const it of oth) await it.delete(); });
    return plan;
  }
  async function previewDelete(year) { return (await planYear(year)).map((x) => ({ key: x.key, label: x.label, count: x.count })); }
  async function deleteYear(year, keys) {   // keys: 지울 항목(없으면 전부)
    const plan = (await planYear(year)).filter((x) => !keys || keys.indexOf(x.key) >= 0); const ops = []; const summary = {};
    plan.forEach((x) => { ops.push(...x.ops); summary[x.label] = x.count; });
    await commit(ops);
    for (const x of plan) if (x.after) await x.after();
    return summary;
  }

  window.APP = { dday, fmtDate, setYear, getVacations, renderDayCards, yearRange, yearOf, inRange, getGeneral, saveGeneral, holidayMap, buildSchedule, getDayState, saveDay, SEM_NAMES, getSemesterRows, saveSemesters,
    listBaseItems, addBaseItems, updateBaseItem, deleteBaseItem, clearSemester, entryApplies, homeroomFor, syncTeachers, teacherNames, setTeacherNames, ensureTeachers, detectYears, deleteYear, previewDelete, migrateYearTags };
})();
