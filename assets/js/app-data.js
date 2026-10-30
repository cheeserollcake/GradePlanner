/*
 * app-data.js : 홈 / 6학년 개요 / 관리자 페이지가 함께 쓰는 데이터 처리 (window.APP)
 * gas-shim.js(window.GP) 뒤에 불러옵니다.
 */
(function () {
  'use strict';
  const G = window.GP;
  const { getCol, invalidate, getCfg, setCfg, toDate, ymd, appDate, addDays, eachDay, num, str, natural, commit, newId, readList, writeList } = G;
  const DEL = () => firebase.firestore.FieldValue.delete();

  // ------------------------------------------------------------ 학년도 / 일반 설정
  const yearRange = (y) => ({ start: new Date(y, 1, 1), end: new Date(y + 1, 2, 0) }); // 2/1 ~ 다음해 2월 말일
  const yearOf = (d) => (d.getMonth() >= 1 ? d.getFullYear() : d.getFullYear() - 1);
  const inRange = (d, r) => d && d >= r.start && d <= r.end;

  async function getGeneral() {
    const today = new Date();
    const g = Object.assign({ year: yearOf(today), classCount: 10, classNames: [], homeroom: {}, specials: [] }, await getCfg('general', {}));
    g.classNames = Array.from({ length: g.classCount }, (_, i) => (g.classNames && g.classNames[i]) || `${i + 1}반`);
    return g;
  }
  async function saveGeneral(g) { await setCfg('general', g); }

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
  function lecturerText(rows) {
    const by = new Map();
    rows.forEach((r) => {
      const c = str(r.add_class).trim(); if (!by.has(c)) by.set(c, { times: new Set(), names: new Set() });
      const o = by.get(c); if (str(r.add_time).trim()) o.times.add(str(r.add_time).trim()); if (str(r.add_name).trim()) o.names.add(str(r.add_name).trim());
    });
    return [...by.entries()].sort((a, b) => natural(a[0], b[0]))
      .map(([c, o]) => [c, [...o.times].sort(natural).join(', '), [...o.names].join(', ')].filter(Boolean).join(' ')).join('\n');
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
  async function getDayState(d) {
    ['data_task_school', 'data_task_memo', 'data_basic'].forEach(invalidate);
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
  async function clearHolidayRows(rows) {
    const ops = rows.map((r) => {
      const others = Object.keys(r).filter((k) => !['_id', 'holiday', 'holiday_start_date', 'holiday_end_date'].includes(k) && !/_order$/.test(k));
      return others.length ? { type: 'update', col: 'data_basic', id: r._id, data: { holiday: DEL(), holiday_start_date: DEL(), holiday_end_date: DEL() } } : { type: 'delete', col: 'data_basic', id: r._id };
    });
    await commit(ops);
  }
  async function saveDay(d, v) {
    const st = await getDayState(d);
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

  // ------------------------------------------------------------ 학기(1학기, 여름방학, 2학기, 겨울방학)
  const SEM_NAMES = ['1학기', '여름방학', '2학기', '겨울방학'];
  async function getSemesterRows(year) {
    invalidate('data_basic'); const r = yearRange(year);
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

  // ------------------------------------------------------------ 기초 일정 (학교 행사)
  async function listBaseEvents(year) {
    invalidate('data_task_school'); const r = yearRange(year);
    return (await getCol('data_task_school')).map((x) => ({ id: x._id, name: str(x.task_school_name), start: toDate(x.task_school_date_start), end: toDate(x.task_school_date_end) }))
      .filter((x) => inRange(x.start, r)).sort((a, b) => a.start - b.start || natural(a.name, b.name));
  }
  const eventDoc = (e) => ({ task_school_name: e.name, task_school_date_start: appDate(e.start), task_school_date_end: e.end && !sameDay(e.start, e.end) ? appDate(e.end) : '' });
  async function addBaseEvents(list) {
    await commit(list.map((e) => ({ type: 'set', col: 'data_task_school', id: newId('data_task_school'), data: eventDoc(e) }))); invalidate('data_task_school');
  }
  async function updateBaseEvent(id, e) { await commit([{ type: 'update', col: 'data_task_school', id, data: eventDoc(e) }]); invalidate('data_task_school'); }
  async function deleteBaseEvent(id) { await commit([{ type: 'delete', col: 'data_task_school', id }]); invalidate('data_task_school'); }

  // ------------------------------------------------------------ 교사
  async function teacherNames() { return (await readList('list_t')).map((i) => i.value); }
  async function setTeacherNames(names) { await writeList('list_t', [...new Set(names.map((n) => n.trim()).filter(Boolean))].map((v) => ({ value: v }))); }
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
  async function deleteYear(year) {
    const r = yearRange(year); const ops = []; const summary = {};
    for (const [c, f] of Object.entries(DATE_FIELDS)) {
      invalidate(c); const hit = (await getCol(c)).filter((x) => inRange(toDate(x[f]), r));
      hit.forEach((x) => ops.push({ type: 'delete', col: c, id: x._id })); summary[c] = hit.length;
    }
    invalidate('data_basic'); const basic = await getCol('data_basic');
    const semRows = basic.filter((x) => str(x.semester).trim() && inRange(toDate(x.semester_start_date), r));
    const holRows = basic.filter((x) => str(x.holiday).trim() && inRange(toDate(x.holiday_start_date), r));
    const strip = (x, keys) => {
      const others = Object.keys(x).filter((k) => k !== '_id' && !keys.includes(k) && !/_order$/.test(k));
      return others.length ? { type: 'update', col: 'data_basic', id: x._id, data: Object.fromEntries(keys.map((k) => [k, DEL()])) } : { type: 'delete', col: 'data_basic', id: x._id };
    };
    semRows.forEach((x) => ops.push(strip(x, ['semester', 'semester_start_date', 'semester_end_date'])));
    holRows.forEach((x) => { if (!semRows.includes(x)) ops.push(strip(x, ['holiday', 'holiday_start_date', 'holiday_end_date'])); });
    summary.data_basic = semRows.length + holRows.length;
    invalidate('data_supply'); const sup = (await getCol('data_supply')).filter((x) => num(x.supply_year) === year);
    sup.forEach((x) => ops.push({ type: 'delete', col: 'data_supply', id: x._id })); summary.data_supply = sup.length;
    await commit(ops); Object.keys(DATE_FIELDS).concat(['data_basic', 'data_supply']).forEach(invalidate);
    return summary;
  }

  window.APP = { yearRange, yearOf, inRange, getGeneral, saveGeneral, holidayMap, buildSchedule, getDayState, saveDay, SEM_NAMES, getSemesterRows, saveSemesters,
    listBaseEvents, addBaseEvents, updateBaseEvent, deleteBaseEvent, teacherNames, setTeacherNames, ensureTeachers, detectYears, deleteYear };
})();
