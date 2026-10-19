/*
 * gas-shim.js
 * ------------------------------------------------------------------
 * 기존 구글 앱스스크립트(Code.gs)의 서버 함수들을 Firebase(Firestore/Storage)로 대체하는
 * 호환 레이어입니다. 기존 화면 코드는 google.script.run.xxx() 를 그대로 호출하고,
 * 이 파일이 Firestore 컬렉션(= 스프레드시트 탭) 데이터를 기존 화면이 기대하던 모양으로
 * 바꿔서 돌려줍니다.
 *
 * Firestore 컬렉션(= 시트 탭 이름)과 필드(= 1행 필드명)는 업로드된 엑셀과 동일하다고 가정합니다.
 *   data_basic, data_task_school, data_task_memo, data_student, data_sub_timetable,
 *   data_add_timetable, data_gym_timetable, data_room_timetable, data_budget, data_supply
 * 엑셀에 없던 기능(개요 표 수기 입력, 기초시간표, 쇼핑몰 ID, 설정/비밀번호, 파일 등)은
 * 아래의 새 컬렉션을 사용합니다.
 *   app_config, data_overview, data_basic_timetable, data_mall, data_links
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- 초기화
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const db = firebase.firestore();
  const storage = firebase.storage ? firebase.storage() : null;
  const TS = firebase.firestore.Timestamp;

  // ---------------------------------------------------------------- 날짜 유틸
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = (n) => String(n).padStart(2, '0');
  const strip = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function toDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'object' && typeof v.toDate === 'function') return strip(v.toDate());
    if (v instanceof Date) return isNaN(v) ? null : strip(v);
    if (typeof v === 'object' && typeof v.seconds === 'number') return strip(new Date(v.seconds * 1000));
    if (typeof v === 'number') {
      if (v > 1e11) return strip(new Date(v));                       // epoch ms
      if (v > 20000 && v < 80000) {                                   // 엑셀 일련번호
        const d = new Date(Math.round((v - 25569) * 86400000));
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      return null;
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return isNaN(d) ? null : strip(d); }
    const m = s.match(/(\d{4})\s*[년.\-\/]\s*(\d{1,2})\s*[월.\-\/]\s*(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d) ? null : strip(d);
  }
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoLocal = (d) => `${ymd(d)}T00:00:00`;
  const appDate = (d) => `${d.getFullYear()}년 ${pad(d.getMonth() + 1)}월 ${pad(d.getDate())}일 (${DAYS[d.getDay()]})`;
  const toTS = (d) => TS.fromDate(d);
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  function* eachDay(a, b) { for (let d = a; d <= b; d = addDays(d, 1)) yield d; }
  const num = (v) => { const n = Number(String(v === undefined || v === null ? '' : v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  const classNo = (s) => { const m = str(s).match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
  const natural = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

  // ---------------------------------------------------------------- Firestore 유틸
  const cache = {};
  function getCol(name, force) {
    if (!force && cache[name]) return cache[name];
    cache[name] = db.collection(name).get().then((snap) =>
      snap.docs.map((d) => Object.assign({ _id: d.id }, d.data()))
        .sort((a, b) => natural(a._id, b._id)));
    return cache[name];
  }
  const invalidate = (name) => { delete cache[name]; };

  async function getCfg(key, def) {
    try {
      const s = await db.collection('app_config').doc(key).get();
      if (s.exists && s.data() && s.data().json) return JSON.parse(s.data().json);
    } catch (e) { console.warn('config read failed', key, e); }
    return def;
  }
  async function setCfg(key, obj) {
    await db.collection('app_config').doc(key).set({ json: JSON.stringify(obj), updatedAt: TS.now() });
    return true;
  }

  async function commit(ops) {
    // ops: [{type:'set'|'update'|'delete', col, id, data}]
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach((o) => {
        const ref = db.collection(o.col).doc(o.id);
        if (o.type === 'delete') batch.delete(ref);
        else if (o.type === 'update') batch.update(ref, o.data);
        else batch.set(ref, o.data, { merge: !!o.merge });
      });
      await batch.commit();
    }
  }
  const newId = (col) => db.collection(col).doc().id;

  // ---------------------------------------------------------------- 기본 설정 / 휴일
  const SUBJECTS_DEFAULT = ['국어', '수학', '사회', '도덕', '음악', '미술', '체육', '실과', '창체', '영어', '과학'];

  // 엑셀 data_basic 에는 공휴일이 없으므로 2026~2027학년도 공휴일을 코드에 둡니다(확인 필요).
  const PUBLIC_HOLIDAYS = {
    '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)', '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)', '2026-06-03': '전국동시지방선거',
    '2026-06-06': '현충일', '2026-08-15': '광복절', '2026-08-17': '대체공휴일(광복절)',
    '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
    '2026-10-03': '개천절', '2026-10-05': '대체공휴일(개천절)', '2026-10-09': '한글날', '2026-12-25': '성탄절',
    '2027-01-01': '신정', '2027-02-05': '설날 연휴', '2027-02-06': '설날', '2027-02-07': '설날 연휴',
    '2027-02-08': '대체공휴일(설날)', '2027-03-01': '삼일절'
  };

  async function getBasicRows() { return getCol('data_basic'); }

  async function getSemesters() {
    const rows = await getBasicRows();
    return rows.filter((r) => r.semester && toDate(r.semester_start_date) && toDate(r.semester_end_date))
      .map((r) => ({ name: str(r.semester), start: toDate(r.semester_start_date), end: toDate(r.semester_end_date) }))
      .sort((a, b) => a.start - b.start);
  }

  async function getHolidayMap() {
    const map = new Map();
    Object.keys(PUBLIC_HOLIDAYS).forEach((k) => map.set(k, PUBLIC_HOLIDAYS[k]));
    const rows = await getBasicRows();
    rows.forEach((r) => {
      if (r.holiday && toDate(r.holiday_start_date)) {
        const a = toDate(r.holiday_start_date);
        const b = toDate(r.holiday_end_date) || a;
        for (const d of eachDay(a, b)) map.set(ymd(d), str(r.holiday));
      }
    });
    const sems = await getSemesters();
    sems.filter((s) => s.name.indexOf('방학') >= 0).forEach((s) => {
      for (const d of eachDay(s.start, s.end)) map.set(ymd(d), s.name);
    });
    return map;
  }

  async function getLists() {
    const rows = await getBasicRows();
    const uniq = (f) => [...new Set(rows.map((r) => str(r[f]).trim()).filter(Boolean))];
    return {
      classes: uniq('list_class'), subs: uniq('list_sub'), times: uniq('list_time'),
      gyms: uniq('list_gym'), rooms: uniq('list_room'), teachers: uniq('list_t'),
      budgets: rows.filter((r) => str(r.list_budget).trim())
        .map((r) => ({ name: str(r.list_budget).trim(), amount: num(r.list_budget_amount) })),
      budgetHeaders: uniq('list_budget_header')
    };
  }

  // ---------------------------------------------------------------- 일정(Page 01, 02)
  async function buildSchedule() {
    const [ts, tm] = await Promise.all([getCol('data_task_school'), getCol('data_task_memo')]);
    const byDate = new Map();
    const slot = (d) => { const k = ymd(d); if (!byDate.has(k)) byDate.set(k, { d, ev: [], memo: [] }); return byDate.get(k); };
    ts.forEach((r) => { const d = toDate(r.task_school_date_start); if (d && str(r.task_school_name).trim()) slot(d).ev.push(str(r.task_school_name)); });
    tm.forEach((r) => { const d = toDate(r.task_memo_date_start); if (d && str(r.task_memo_name).trim()) slot(d).memo.push(str(r.task_memo_name)); });
    const schedule = [...byDate.values()].sort((a, b) => a.d - b.d).map((x) => ({
      rowIndex: ymd(x.d), date: isoLocal(x.d), event: x.ev.join('\n'), grade: '', manual: x.memo.join('\n')
    }));
    const find = (kw) => { const hit = ts.find((r) => str(r.task_school_name).indexOf(kw) >= 0); return hit ? isoLocal(toDate(hit.task_school_date_start)) : ''; };
    return { schedule, dates: { summer: find('여름방학식'), winter: find('겨울방학식') } };
  }

  async function buildInfo() {
    const students = await getCol('data_student');
    const ov = await getCol('data_overview');
    const ovMap = {}; ov.forEach((r) => { ovMap[r._id] = r; });
    const cnt = { all: Array(10).fill(0), m: Array(10).fill(0), f: Array(10).fill(0) };
    students.forEach((s) => {
      const c = num(s.student_class); if (c < 1 || c > 10 || !str(s.student_name).trim()) return;
      cnt.all[c - 1]++; if (str(s.student_gender) === '남성') cnt.m[c - 1]++; if (str(s.student_gender) === '여성') cnt.f[c - 1]++;
    });
    const row = (id, label, arr, editable) => {
      const o = { id, label, total: arr.reduce((a, b) => a + (Number(b) || 0), 0), isEditable: editable };
      arr.forEach((v, i) => { o['c' + (i + 1)] = v; });
      return o;
    };
    const edit = (id, label) => {
      const src = ovMap[id] || {}; const arr = []; for (let i = 1; i <= 10; i++) arr.push(src['c' + i] === undefined ? '' : src['c' + i]);
      const o = { id, label, total: str(src.total), isEditable: true };
      arr.forEach((v, i) => { o['c' + (i + 1)] = v; });
      return o;
    };
    return [row('r2', '학생수', cnt.all, false), row('r3', '남', cnt.m, false), row('r4', '여', cnt.f, false),
      edit('r5', '비고'), edit('r6', '담임')];
  }

  async function buildBudgetCards() {
    const lists = await getLists();
    const rows = await getCol('data_budget');
    const heads = {};
    lists.budgets.forEach((b) => { const h = b.name.split('/')[0]; (heads[h] = heads[h] || []).push(b); });
    const cards = []; const done = new Set();
    lists.budgets.forEach((b) => {
      const h = b.name.split('/')[0];
      if (done.has(h)) return;
      const merged = heads[h].length > 1;
      const name = merged ? h : b.name;
      const assigned = merged ? heads[h].reduce((a, x) => a + x.amount, 0) : b.amount;
      const used = rows.filter((r) => { const n = str(r.budget_name).trim(); return n === name || n === h || n === b.name; })
        .reduce((a, r) => a + num(r.budget_num) * num(r.budget_price), 0);
      cards.push({ name, assigned, used, balance: assigned - used });
      done.add(h);
    });
    return cards;
  }

  // ---------------------------------------------------------------- 비밀번호 기본값 (기존 Code.gs 와 동일)
  const DEFAULT_PW = {
    page03: { access: '1111', admin: '00admin' },
    ext: { user: 'qlcrkdhs01*', admin: '00admin' },
    mall: { userPw: '1111', adminPw: '0000' },
    special: { adminPwd: '0000', specialPwd: '1111', sem1: {}, sem2: {}, exceptions: [], closeExceptions: [] }
  };

  // ---------------------------------------------------------------- 서버 함수들
  const SERVER = {};

  // ===== Page 01 / 02 : 개요 =====
  SERVER.getInitialData = async function () {
    const page = (window.__GP_PAGE__ || '');
    if (page === 'p01') {
      try { const s = await buildSchedule(); return JSON.stringify({ overview: s, error: null }); }
      catch (e) { return JSON.stringify({ error: e.message }); }
    }
    if (page === 'p02') {
      try {
        const [s, info, budget] = await Promise.all([buildSchedule(), buildInfo(), buildBudgetCards()]);
        return JSON.stringify({ overview: { info, dates: s.dates, schedule: s.schedule }, budget });
      } catch (e) { return JSON.stringify({ error: 'Initial Load Failed: ' + e.toString() }); }
    }
    if (page === 'p04') return SERVER.refreshData({ classNum: 1 });
    if (page === 'p07') return SERVER.getInitialData07();
    return JSON.stringify({});
  };
  SERVER.refreshData = async function (request) {
    const page = (window.__GP_PAGE__ || '');
    if (page === 'p04') return basicTimetableResponse(request);
    invalidate('data_task_school'); invalidate('data_task_memo'); invalidate('data_student'); invalidate('data_budget'); invalidate('data_overview');
    return SERVER.getInitialData();
  };

  async function setMemoForDate(dateKey, value) {
    const d = toDate(dateKey); if (!d) return;
    const rows = (await getCol('data_task_memo')).filter((r) => { const x = toDate(r.task_memo_date_start); return x && ymd(x) === ymd(d); });
    const ops = [];
    if (!str(value).trim()) { rows.forEach((r) => ops.push({ type: 'delete', col: 'data_task_memo', id: r._id })); }
    else if (rows.length) {
      ops.push({ type: 'update', col: 'data_task_memo', id: rows[0]._id, data: { task_memo_name: value } });
      rows.slice(1).forEach((r) => ops.push({ type: 'delete', col: 'data_task_memo', id: r._id }));
    } else {
      ops.push({ type: 'set', col: 'data_task_memo', id: newId('data_task_memo'), data: { task_memo_date_start: toTS(d), task_memo_date_end: null, task_memo_name: value } });
    }
    await commit(ops); invalidate('data_task_memo');
  }

  SERVER.updateSheetData = async function (params) {
    try {
      if (params.type === 'overview_edit') {
        const col = parseInt(params.colIndex, 10) + 1;
        await db.collection('data_overview').doc(params.rowId).set({ ['c' + col]: params.value }, { merge: true });
        invalidate('data_overview');
      } else if (params.type === 'overview_schedule_edit') {
        await setMemoForDate(params.rowIndex, params.value);
      } else if (params.type === 'basic_timetable_edit') {
        const id = 'class_' + params.classNum;
        await db.collection('data_basic_timetable').doc(id).set({ class: Number(params.classNum), cells: { [`${params.r}_${params.c}`]: params.value } }, { merge: true });
        invalidate('data_basic_timetable');
      }
      return JSON.stringify({ success: true });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };

  // ===== Page 03 : 명렬표 =====
  const classStudents = async (n) => (await getCol('data_student')).filter((s) => num(s.student_class) === n);
  async function horizontalData() {
    const all = await getCol('data_student');
    const mk = (start) => {
      const rows = [];
      for (let i = 1; i <= 30; i++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
          const s = all.find((x) => num(x.student_class) === start + c && num(x.student_num) === i);
          row.push(i, s ? str(s.student_name) : '', s ? str(s.student_gender) : '', s ? str(s.student_memo) : '');
        }
        rows.push(row);
      }
      return rows;
    };
    return { group1: mk(1), group2: mk(6) };
  }
  SERVER.getGradeData = async () => JSON.stringify({ horizontal: await horizontalData() });
  SERVER.refreshGradeData = async function (request) {
    try {
      invalidate('data_student');
      if (request && request.sub === '가로 명렬표') return JSON.stringify({ type: 'horizontal_namelist', data: await horizontalData() });
      return SERVER.getGradeData();
    } catch (e) { return JSON.stringify({ error: e.toString() }); }
  };
  SERVER.getClassData = async function (classNum) {
    try {
      const list = await classStudents(Number(classNum));
      const data = [['번호', '이름', '성별', '비고', '생년월일']];
      for (let i = 1; i <= 30; i++) {
        const s = list.find((x) => num(x.student_num) === i);
        data.push([i, s ? str(s.student_name) : '', s ? str(s.student_gender) : '', s ? str(s.student_memo) : '', s ? str(s.student_birth) : '']);
      }
      return JSON.stringify({ success: true, data });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  SERVER.updateStudent = async function (params) {
    try {
      const fieldMap = { name: 'student_name', gender: 'student_gender', note: 'student_memo', birth: 'student_birth' };
      const f = fieldMap[params.field]; if (!f) return JSON.stringify({ success: true });
      const n = Number(params.classNum); const no = Number(params.rowIndex);
      const list = await classStudents(n); const s = list.find((x) => num(x.student_num) === no);
      if (s) await db.collection('data_student').doc(s._id).update({ [f]: params.value });
      else await db.collection('data_student').add({ student_class: n, student_num: no, student_name: '', student_gender: '', student_memo: '', student_birth: '', [f]: params.value });
      invalidate('data_student');
      return JSON.stringify({ success: true });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  SERVER.deleteStudent = async function (params) {
    try {
      const list = await classStudents(Number(params.classNum)); const s = list.find((x) => num(x.student_num) === Number(params.rowIndex));
      if (s) await db.collection('data_student').doc(s._id).delete();
      invalidate('data_student');
      return JSON.stringify({ success: true });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  SERVER.verifyPassword = async function (a, b) {
    const page = (window.__GP_PAGE__ || '');
    if (page === 'p10') { // verifyPassword(type, pwd) -> boolean
      const pw = await getCfg('ext_passwords', DEFAULT_PW.ext);
      return a === 'user' ? b === pw.user : a === 'admin' ? b === pw.admin : false;
    }
    const pw = await getCfg('page03_passwords', DEFAULT_PW.page03);
    return a === pw.access ? { success: true } : { success: false, message: '비밀번호가 일치하지 않습니다.' };
  };
  SERVER.verifyAdminPassword = async function (a) {
    const pw = await getCfg('page03_passwords', DEFAULT_PW.page03);
    return a === pw.admin ? { success: true } : { success: false, message: '관리자 비밀번호가 일치하지 않습니다.' };
  };
  SERVER.changePasswords = async function (adminPw, newAccess, newAdmin) {
    const pw = await getCfg('page03_passwords', DEFAULT_PW.page03);
    if (adminPw !== pw.admin) return { success: false, message: '관리자 비밀번호가 일치하지 않습니다.' };
    if (newAccess) pw.access = newAccess; if (newAdmin) pw.admin = newAdmin;
    await setCfg('page03_passwords', pw);
    return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
  };

  // ===== Page 04 : 기초 시간표 =====
  async function basicCommon() {
    const lists = await getLists();
    const common = (await getCfg('basic_timetable_common', {})) || {};
    const subjects = common.subjects || SUBJECTS_DEFAULT.filter((s) => !lists.subs.length || lists.subs.indexOf(s) >= 0);
    const goals = common.goals || subjects.map(() => '');
    return { subjects, goals, p12: common.p12 || '', p13: common.p13 || '' };
  }
  async function basicSchedule(n) {
    const doc = (await getCol('data_basic_timetable')).find((r) => r._id === 'class_' + n);
    const cells = (doc && doc.cells) || {};
    const rows = [];
    for (let r = 0; r < 7; r++) {
      const row = [];
      for (let c = 0; c < 6; c++) {
        const k = `${r}_${c}`;
        if (cells[k] !== undefined) row.push(cells[k]);
        else if (r === 0) row.push(c === 0 ? '교시' : DAYS[c]);
        else if (c === 0) row.push(`${r}교시`);
        else row.push('');
      }
      rows.push(row);
    }
    return rows;
  }
  async function basicTimetableResponse(request) {
    try {
      invalidate('data_basic_timetable');
      const common = await basicCommon();
      if (request && request.classNum === 'all') {
        const allSchedules = []; for (let i = 1; i <= 10; i++) allSchedules.push(await basicSchedule(i));
        return JSON.stringify({ success: true, type: 'basic_timetable_all', data: Object.assign({ allSchedules }, common) });
      }
      const n = parseInt(request && request.classNum, 10) || 1;
      return JSON.stringify({ success: true, type: 'basic_timetable', data: Object.assign({ schedule: await basicSchedule(n) }, common) });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  }
  SERVER.deleteBasicTimetable = async function (params) {
    await db.collection('data_basic_timetable').doc('class_' + params.classNum).set({ class: Number(params.classNum), cells: {} });
    invalidate('data_basic_timetable');
    return JSON.stringify({ success: true });
  };

  // ===== 시간표 데이터 모으기 (Page 05, 08, 09) =====
  const slotRow = (d, cls, per, name) => [isoLocal(d), cls, per, name];
  async function monthlyData() {
    const [hol, gym, sub, add] = await Promise.all([getHolidayMap(), getCol('data_gym_timetable'), getCol('data_sub_timetable'), getCol('data_add_timetable')]);
    const holidays = [...hol.entries()].sort().map(([k, v]) => [isoLocal(toDate(k)), v]);
    const rows = (list, fd, fc, ft, fn) => list.map((r) => ({ d: toDate(r[fd]), r })).filter((x) => x.d && str(x.r[fc]).trim())
      .map((x) => slotRow(x.d, str(x.r[fc]), str(x.r[ft]), str(x.r[fn])));
    return {
      holidays,
      auditorium: rows(gym, 'gym_date', 'gym_class', 'gym_time', 'gym_place'),
      subject: rows(sub, 'sub_date', 'sub_class', 'sub_time', 'sub_name'),
      added: rows(add, 'add_date', 'add_class', 'add_time', 'add_name')
    };
  }
  SERVER.changeMonthAndGetData = async function (month) {
    try { return JSON.stringify({ success: true, data: await monthlyData(), targetMonth: month }); }
    catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };

  // ===== Page 06 : 전담 시간표 =====
  // 엑셀(data_sub_timetable)에는 교사 열이 없으므로 같은 시간대에 겹치지 않는 반 묶음으로 교사를 추정했습니다.
  const TEACHER_TABS = {
    '전담(과학1)': { sub: '과학', classes: [1, 2, 3, 4, 5] },
    '전담(과학2)': { sub: '과학', classes: [6, 7, 8, 9, 10] },
    '전담(영어1)': { sub: '영어', classes: [1, 2, 3, 4, 5] },
    '전담(영어2)': { sub: '영어', classes: [6, 7, 8] },
    '전담(영어3)': { sub: '영어', classes: [9, 10] }
  };
  const classChar = (n) => (n === 10 ? '0' : String(n));
  const charClass = (c) => (c === '0' ? 10 : parseInt(c, 10));
  const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
  // 학기 시작일이 주말이면 다음 월요일부터 주차를 셉니다.
  const firstMonday = (sem) => mondayOf(addDays(sem.start, sem.start.getDay() === 0 ? 1 : sem.start.getDay() === 6 ? 2 : 0));

  async function teacherGrid(tab, semNo) {
    const cfg = TEACHER_TABS[tab];
    const sems = (await getSemesters()).filter((s) => s.name.indexOf('방학') < 0);
    const sem = sems[semNo - 1] || sems[0];
    const sub = await getCol('data_sub_timetable');
    const year = sem ? sem.start.getFullYear() : new Date().getFullYear();
    const options = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    const bottom = []; const counts = {};
    if (sem) {
      let mon = firstMonday(sem); let w = 1;
      const bySlot = new Map();
      sub.forEach((r) => {
        const d = toDate(r.sub_date); const n = classNo(r.sub_class);
        if (!d || str(r.sub_name) !== cfg.sub || cfg.classes.indexOf(n) < 0) return;
        bySlot.set(`${ymd(d)}|${str(r.sub_time)}`, classChar(n));
      });
      for (; mon <= sem.end; mon = addDays(mon, 7), w++) {
        const fri = addDays(mon, 4);
        const row = [w, `${mon.getMonth() + 1}/${mon.getDate()}~${fri.getMonth() + 1}/${fri.getDate()}`];
        for (let day = 0; day < 5; day++) for (let p = 1; p <= 6; p++) {
          row.push(bySlot.get(`${ymd(addDays(mon, day))}|${p}교시`) || '');
        }
        bottom.push(row);
      }
    }
    bottom.forEach((r) => r.slice(2).forEach((c) => { if (c) counts[c] = (counts[c] || 0) + 1; }));
    const targets = (await getCfg('p06_targets', {}))[`${tab}|${semNo}`] || {};
    const top = [['구분'].concat(options), ['목표'].concat(options.map((o) => (targets[o] === undefined ? '' : targets[o]))), ['배정'].concat(options.map((o) => counts[o] || 0))];
    return { top, bottom, options, title: `${year}학년도 ${semNo}학기 ${tab.replace(/[()]/g, ' ').trim()}` };
  }
  async function allTimetableData() {
    const out = {};
    for (const tab of Object.keys(TEACHER_TABS)) out[tab] = { sem1: await teacherGrid(tab, 1), sem2: await teacherGrid(tab, 2) };
    return out;
  }
  SERVER.getAllTimetableData = async function () {
    try { invalidate('data_sub_timetable'); return JSON.stringify({ success: true, data: await allTimetableData() }); }
    catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  SERVER.updateBatchSpecialTimetable = async function (list) {
    try {
      const sub = await getCol('data_sub_timetable');
      const sems = (await getSemesters()).filter((s) => s.name.indexOf('방학') < 0);
      const ops = []; const seen = new Set();
      for (const u of list) {
        const cfg = TEACHER_TABS[u.sheetName]; const sem = sems[u.semester - 1]; if (!cfg || !sem) continue;
        const date = addDays(firstMonday(sem), u.r * 7 + Math.floor((u.c - 2) / 6));
        const time = `${((u.c - 2) % 6) + 1}교시`;
        const existing = sub.filter((r) => { const d = toDate(r.sub_date); return d && ymd(d) === ymd(date) && str(r.sub_time) === time && str(r.sub_name) === cfg.sub && cfg.classes.indexOf(classNo(r.sub_class)) >= 0; });
        if (!str(u.value).trim()) { existing.forEach((r) => ops.push({ type: 'delete', col: 'data_sub_timetable', id: r._id })); continue; }
        const n = charClass(str(u.value).trim()); if (isNaN(n) || cfg.classes.indexOf(n) < 0 && !(n >= 1 && n <= 10)) continue;
        const data = { sub_name: cfg.sub, sub_date: toTS(date), sub_time: time, sub_class: `${n}반` };
        if (existing.length) { ops.push({ type: 'update', col: 'data_sub_timetable', id: existing[0]._id, data }); existing.slice(1).forEach((r) => ops.push({ type: 'delete', col: 'data_sub_timetable', id: r._id })); }
        else ops.push({ type: 'set', col: 'data_sub_timetable', id: newId('data_sub_timetable'), data });
      }
      await commit(ops); invalidate('data_sub_timetable');
      return JSON.stringify({ success: true, count: list.length });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };

  // ===== Page 07 : 특별실 시간표 =====
  const GYM_SPACES = ['강당', '다목(2층)', '다목(3층)', '운동장', '나래', 'VR'];
  const ROOM_SPACES = ['컴1', '컴2', '음악'];
  SERVER.getInitialData07 = async function () {
    try {
      const [hol, gym, room, settings, pw] = await Promise.all([getHolidayMap(), getCol('data_gym_timetable'), getCol('data_room_timetable'),
        getCfg('special_room_settings', DEFAULT_PW.special), getCfg('room_passwords', [])]);
      const schedule = [];
      gym.forEach((r) => { const d = toDate(r.gym_date); if (d && str(r.gym_class)) schedule.push({ date: appDate(d), className: str(r.gym_class), period: str(r.gym_time).trim(), space: str(r.gym_place).trim() }); });
      room.forEach((r) => { const d = toDate(r.room_date); if (d && str(r.room_class)) schedule.push({ date: appDate(d), className: str(r.room_class), period: str(r.room_time).trim(), space: str(r.room_place).trim() }); });
      return { success: true, holidays: [...hol.keys()].map((k) => appDate(toDate(k))), schedule, settings, roomPasswords: pw };
    } catch (e) { return { success: false, error: e.toString() }; }
  };
  SERVER.saveScheduleData = async function (updates) {
    try {
      const [gym, room] = await Promise.all([getCol('data_gym_timetable'), getCol('data_room_timetable')]);
      const ops = [];
      for (const u of updates) {
        const isGym = GYM_SPACES.indexOf(u.space) >= 0; const isRoom = ROOM_SPACES.indexOf(u.space) >= 0; if (!isGym && !isRoom) continue;
        const d = toDate(u.date); if (!d) continue;
        const col = isGym ? 'data_gym_timetable' : 'data_room_timetable'; const p = isGym ? 'gym' : 'room'; const list = isGym ? gym : room;
        const period = str(u.period).trim();
        const found = list.filter((r) => { const x = toDate(r[p + '_date']); return x && ymd(x) === ymd(d) && str(r[p + '_time']).trim() === period && str(r[p + '_place']).trim() === u.space; });
        if (u.className === '') { found.forEach((r) => ops.push({ type: 'delete', col, id: r._id })); continue; }
        const data = { [p + '_date']: toTS(d), [p + '_class']: u.className, [p + '_time']: period, [p + '_place']: u.space };
        if (found.length) { ops.push({ type: 'update', col, id: found[0]._id, data }); found.slice(1).forEach((r) => ops.push({ type: 'delete', col, id: r._id })); }
        else ops.push({ type: 'set', col, id: newId(col), data });
      }
      await commit(ops); invalidate('data_gym_timetable'); invalidate('data_room_timetable');
      return { success: true };
    } catch (e) { return { success: false, error: e.toString() }; }
  };
  SERVER.saveSettings = async (s) => { try { await setCfg('special_room_settings', s); return { success: true }; } catch (e) { return { success: false, error: e.toString() }; } };
  SERVER.saveRoomPasswords = async (p) => { try { await setCfg('room_passwords', p); return { success: true }; } catch (e) { return { success: false, error: e.toString() }; } };

  const safeName = (n) => String(n).replace(/[^\w.\-가-힣]+/g, '_');
  SERVER.getImages = async function () {
    try {
      const res = await storage.ref('special_room').listAll();
      const items = await Promise.all(res.items.map(async (it) => ({ id: it.fullPath, url: await it.getDownloadURL(), name: it.name })));
      return items;
    } catch (e) { console.warn(e); return []; }
  };
  SERVER.uploadImage = async function (data, name, mime) {
    try { await storage.ref(`special_room/${Date.now()}_${safeName(name)}`).putString(data, 'base64', { contentType: mime }); return { success: true }; }
    catch (e) { return { success: false, error: e.toString() }; }
  };
  SERVER.deleteImage = async function (id) {
    try { await storage.ref(id).delete(); return { success: true }; } catch (e) { return { success: false, error: e.toString() }; }
  };

  // ===== Page 08 / 09 : 반별·강좌별 조회 =====
  SERVER.getAllData = async function (isRefresh) {
    const page = (window.__GP_PAGE__ || '');
    try {
      if (isRefresh) ['data_add_timetable', 'data_gym_timetable', 'data_sub_timetable'].forEach(invalidate);
      if (page === 'p08') {
        const m = await monthlyData();
        const holidays = m.holidays.map(([d, n]) => ({ date: d.slice(0, 10), name: n }));
        const toEv = (r) => ({ date: r[0].slice(0, 10), classes: r[1], periods: r[2], course: r[3] });
        return { success: true, holidays, rawEvents: m.added.map(toEv).concat(m.auditorium.map(toEv), m.subject.map(toEv)) };
      }
      // p09
      const [hol, add] = await Promise.all([getHolidayMap(), getCol('data_add_timetable')]);
      const events = add.map((r) => ({ d: toDate(r.add_date), r })).filter((x) => x.d)
        .map((x) => ({ date: ymd(x.d), classNm: str(x.r.add_class), period: str(x.r.add_time), course: str(x.r.add_name).trim() }));
      const dropdowns = [...new Set(events.map((e) => e.course).filter(Boolean))].sort(natural);
      const holidays = {}; hol.forEach((v, k) => { holidays[k] = v; });
      return { success: true, dropdowns, specials: { all: '', partial1: '', partial2: '', partial3: '', partial4: '', partial5: '', partial6: '', partial7: '' }, events, holidays };
    } catch (e) { return { success: false, error: e.toString() }; }
  };
  SERVER.modifyScheduleData = async function (action, oldData, newData) {
    try {
      const add = await getCol('data_add_timetable');
      const sameRow = (r) => { const d = toDate(r.add_date); return d && ymd(d) === ymd(toDate(oldData.date)) && str(r.add_class) === str(oldData.classes) && str(r.add_time) === str(oldData.periods) && str(r.add_name).trim() === str(oldData.course).trim(); };
      const build = (n) => ({ add_date: toTS(toDate(n.date)), add_class: str(n.classes), add_time: str(n.periods), add_name: str(n.course) });
      if (action === 'add') { await db.collection('data_add_timetable').add(build(newData)); }
      else {
        const target = add.filter(sameRow)[0];
        if (!target) return { success: false, error: '해당 일정을 찾을 수 없습니다.' };
        if (action === 'delete') await db.collection('data_add_timetable').doc(target._id).delete();
        else if (action === 'edit') await db.collection('data_add_timetable').doc(target._id).update(build(newData));
      }
      invalidate('data_add_timetable');
      return { success: true };
    } catch (e) { return { success: false, error: e.toString() }; }
  };

  // ===== Page 10 : 내선번호 파일 =====
  SERVER.getFileMetadata = async function () {
    const meta = await getCfg('ext_file', null);
    return meta ? { id: meta.url, mimeType: meta.mimeType, name: meta.name } : { id: '', mimeType: 'image/png', name: '' };
  };
  SERVER.changeUserPassword = async function (adminPwd, newPwd) {
    const pw = await getCfg('ext_passwords', DEFAULT_PW.ext);
    if (adminPwd !== pw.admin) return { success: false, message: '관리자 권한이 유효하지 않습니다.' };
    pw.user = newPwd; await setCfg('ext_passwords', pw);
    return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
  };
  SERVER.uploadFile = async function (adminPwd, base64, fileName, mime) {
    const pw = await getCfg('ext_passwords', DEFAULT_PW.ext);
    if (adminPwd !== pw.admin) return { success: false, message: '관리자 권한이 유효하지 않습니다.' };
    try {
      const old = await getCfg('ext_file', null);
      if (old && old.path) { try { await storage.ref(old.path).delete(); } catch (e) { /* 이미 삭제됨 */ } }
      const path = `extension/${Date.now()}_${safeName(fileName)}`;
      const ref = storage.ref(path); await ref.putString(base64, 'base64', { contentType: mime });
      const url = await ref.getDownloadURL();
      await setCfg('ext_file', { url, path, mimeType: mime, name: fileName });
      return { success: true, message: '새 파일이 정상적으로 교체 업로드되었습니다.', fileId: url };
    } catch (e) { return { success: false, message: '파일 업로드 실패: ' + e.toString() }; }
  };

  // ===== Page 11 : 쇼핑몰 학교 ID =====
  SERVER.getAppConfig = async () => getCfg('mall_config', DEFAULT_PW.mall);
  SERVER.saveAppConfig = async (c) => { await setCfg('mall_config', c); return true; };
  SERVER.getData = async function () {
    invalidate('data_mall');
    return (await getCol('data_mall')).map((r) => ({ rowIndex: Number(r._id), mall: str(r.mall), id: str(r.id), pw: str(r.pw), url: str(r.url), note: str(r.note) }))
      .sort((a, b) => a.rowIndex - b.rowIndex);
  };
  const mallDoc = (f) => {
    let url = str(f.siteUrl).trim(); if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    return { mall: str(f.mallName), id: str(f.mallId), pw: str(f.mallPw), url, note: str(f.note) };
  };
  SERVER.addData = async function (f) {
    const rows = await getCol('data_mall', true);
    const next = rows.reduce((m, r) => Math.max(m, Number(r._id) || 0), 5) + 1;
    await db.collection('data_mall').doc(String(next)).set(mallDoc(f)); invalidate('data_mall');
    return { success: true, message: '저장되었습니다.' };
  };
  SERVER.updateData = async function (rowIndex, f) {
    await db.collection('data_mall').doc(String(rowIndex)).set(mallDoc(f)); invalidate('data_mall');
    return { success: true, message: '저장되었습니다.' };
  };
  SERVER.deleteData = async function (rowIndex) {
    await db.collection('data_mall').doc(String(rowIndex)).delete(); invalidate('data_mall');
    return { success: true, message: '삭제되었습니다.' };
  };

  // ---------------------------------------------------------------- google.script.run 에뮬레이션
  function runner(success, failure) {
    return new Proxy({}, {
      get(_t, prop) {
        if (prop === 'withSuccessHandler') return (fn) => runner(fn, failure);
        if (prop === 'withFailureHandler') return (fn) => runner(success, fn);
        if (prop === 'withUserObject') return () => runner(success, failure);
        if (typeof prop !== 'string' || !SERVER[prop]) return undefined;
        return function () {
          const args = Array.prototype.slice.call(arguments);
          Promise.resolve().then(() => SERVER[prop].apply(null, args))
            .then((r) => { if (success) success(r); })
            .catch((e) => { console.error('[' + prop + ']', e); if (failure) failure(e); });
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null), host: { close() {}, setHeight() {} } } };

  // 직접 Firestore를 쓰는 새 페이지(예산/바로가기/교실배치도)를 위한 공용 도구
  window.GP = { db, storage, TS, getCol, invalidate, getCfg, setCfg, getLists, toDate, ymd, appDate, num, str, natural, commit, newId, SERVER };
})();
