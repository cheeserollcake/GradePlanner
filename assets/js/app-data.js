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
  async function setYear(year) {
    const cur = await G.loadGeneral(); await G.saveGeneral(cur);   // 이전 형식의 데이터가 있으면 현재 학년도 것으로 먼저 옮김
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
  async function getDayState(d) {
    G.fresh();
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
    if (!G.storage) return []; const hit = [];
    const list = await G.storage.ref(folder).listAll();
    for (const it of list.items) { const m = await it.getMetadata(); if (inRange(toDate(new Date(m.timeCreated)), r)) hit.push(it); }
    return hit;
  }

  async function deleteYear(year) {
    const r = yearRange(year); const ops = []; const summary = {};
    const created = (d) => !!d && inRange(toDate(d), r);
    // 1) 날짜 필드로 구분되는 데이터
    for (const [c, f] of Object.entries(DATE_FIELDS)) {
      const hit = (await getCol(c)).filter((x) => inRange(toDate(x[f]), r));
      hit.forEach((x) => ops.push({ type: 'delete', col: c, id: x._id })); summary[c] = hit.length;
    }
    const basic = await getCol('data_basic');
    const semRows = basic.filter((x) => str(x.semester).trim() && inRange(toDate(x.semester_start_date), r));
    const holRows = basic.filter((x) => str(x.holiday).trim() && inRange(toDate(x.holiday_start_date), r));
    semRows.forEach((x) => ops.push(...basicStripOps([x], ['semester', 'semester_start_date', 'semester_end_date'])));
    holRows.forEach((x) => { if (!semRows.includes(x)) ops.push(...basicStripOps([x], ['holiday', 'holiday_start_date', 'holiday_end_date'])); });
    summary.data_basic = semRows.length + holRows.length;
    const sup = (await getCol('data_supply')).filter((x) => { const m = str(x.supply_year).match(/\d{4}/); return !!m && parseInt(m[0], 10) === year; });   // 예: '2026년'
    sup.forEach((x) => ops.push({ type: 'delete', col: 'data_supply', id: x._id })); summary.data_supply = sup.length;
    ['year_' + year, 'space_open_' + year].forEach((id) => ops.push({ type: 'delete', col: 'app_config', id }));   // 그 학년도의 담임/전담교사, 공간 개방 설정
    summary.app_config = 2;
    // 2) 작성일이 그 학년도인 데이터 (먼저 모두 확인하고, 하나라도 확인하지 못하면 아무것도 지우지 않습니다)
    for (const col of ['data_student', 'data_budget', 'data_overview', 'data_sheet_rows']) {
      const times = await createTimes(col); let n = 0;
      times.forEach((t, id) => { if (created(t)) { ops.push({ type: 'delete', col, id }); n++; } });
      summary[col] = n;
    }
    const groups = await getCfg('course_groups', []);
    const docT = groups.some((g) => !g.createdAt) ? await docCreateTime('app_config', 'course_groups') : null;   // 작성일이 기록되지 않은 범주는 설정 문서의 작성일을 따름
    const keep = groups.filter((g) => !created(g.createdAt ? new Date(g.createdAt) : docT));
    summary.course_groups = groups.length - keep.length;
    if (keep.length !== groups.length) ops.push({ type: 'set', col: 'app_config', id: 'course_groups', data: { json: JSON.stringify(keep), updatedAt: new Date().toISOString() } });
    const imgs = (await GP.db.collection('data_images').get()).docs.filter((d) => created(new Date(d.data().createdAt || 0)));
    summary.data_images = imgs.length;
    const atts = (await GP.db.collection('data_files').get()).docs.filter((d) => created(new Date(d.data().createdAt || 0)));
    summary.data_files = atts.length;
    const files = []; for (const folder of ['special_room', 'classroom', 'extension', 'budget']) (await storageFilesIn(folder, r)).forEach((it) => files.push(it));
    summary.files = files.length;
    const ext = await getCfg('ext_file', null); if (ext && files.some((it) => it.fullPath === ext.path)) ops.push({ type: 'delete', col: 'app_config', id: 'ext_file' });
    // 3) 실제 삭제
    await commit(ops);
    for (const d of imgs.concat(atts)) await d.ref.delete();
    for (const it of files) await it.delete();
    return summary;
  }

  window.APP = { dday, fmtDate, setYear, getVacations, renderDayCards, yearRange, yearOf, inRange, getGeneral, saveGeneral, holidayMap, buildSchedule, getDayState, saveDay, SEM_NAMES, getSemesterRows, saveSemesters,
    listBaseItems, addBaseItems, updateBaseItem, deleteBaseItem, clearSemester, entryApplies, homeroomFor, syncTeachers, teacherNames, setTeacherNames, ensureTeachers, detectYears, deleteYear };
})();
