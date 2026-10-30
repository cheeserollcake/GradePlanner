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
  // 기존 데이터가 "2026년 10월 20일 (화)" 문자열이므로 저장할 때도 같은 형식으로 씁니다.
  const toTS = (d) => appDate(d);
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

  // ---------------------------------------------------------------- 대한민국 공휴일 자동 계산
  // 엑셀 data_basic 에는 공휴일이 없어서 법령 기준으로 계산합니다. (양력 고정일 + 음력 명절 + 대체공휴일)
  //  - 음력 명절은 브라우저의 음력(Intl chinese) 변환을 사용합니다.
  //  - 2026년부터 노동절(5/1), 제헌절(7/17)이 공휴일입니다.
  //  - 선거일·임시공휴일처럼 법령으로 계산되지 않는 날은 관리자 페이지(기초 일정, 휴일 체크) 또는 개요 화면에서 입력하며, data_basic 의 holiday 필드에 저장됩니다.
  // 한국 음력(KST 기준) 명절을 천문 계산으로 구합니다. (브라우저 음력 변환은 삭 시각 경계에서 틀릴 수 있어 쓰지 않습니다.)
  //  - 음력 월 시작일 = 삭(朔)이 일어난 날짜(KST)
  //  - 1월은 우수(태양황경 330°), 4월은 소만(60°), 8월은 추분(180°)이 든 달
  const JD_UNIX = 2440587.5, KST = 9 * 3600000;
  const rad = Math.PI / 180;
  function newMoonUTC(k) {   // Meeus ch.49 (단순식, 오차 1분 내외), ΔT 약 71초 보정
    const T = k / 1236.85;
    let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T * T * T + 0.00000000073 * T * T * T * T;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;
    const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * rad, Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * rad;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * rad, Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * rad;
    const sn = Math.sin;
    jde += -0.4072 * sn(Mp) + 0.17241 * E * sn(M) + 0.01608 * sn(2 * Mp) + 0.01039 * sn(2 * F) + 0.00739 * E * sn(Mp - M) - 0.00514 * E * sn(Mp + M) +
      0.00208 * E * E * sn(2 * M) - 0.00111 * sn(Mp - 2 * F) - 0.00057 * sn(Mp + 2 * F) + 0.00056 * E * sn(2 * Mp + M) - 0.00042 * sn(3 * Mp) +
      0.00042 * E * sn(M + 2 * F) + 0.00038 * E * sn(M - 2 * F) - 0.00024 * E * sn(2 * Mp - M) - 0.00017 * sn(Om);
    return (jde - 71 / 86400 - JD_UNIX) * 86400000;
  }
  function sunLongitude(jde) {   // 태양 겉보기 황경(도), Meeus ch.25
    const T = (jde - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T, M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * rad;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) + (0.019993 - 0.000101 * T) * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
    const om = (125.04 - 1934.136 * T) * rad;
    return (((L0 + C - 0.00569 - 0.00478 * Math.sin(om)) % 360) + 360) % 360;
  }
  function solarTermMs(year, deg, md) {   // 태양황경이 deg 가 되는 시각(UTC ms)
    let jd = Date.UTC(year, md[0] - 1, md[1], 12) / 86400000 + JD_UNIX;
    for (let i = 0; i < 6; i++) { const d = ((deg - sunLongitude(jd + 71 / 86400) + 540) % 360) - 180; jd += d / 0.98565; }
    return (jd - JD_UNIX) * 86400000;
  }
  const dayNo = (ms) => Math.floor((ms + KST) / 86400000);            // KST 기준 날짜 번호
  function lunarMonthStart(termMs) {                                    // 절기가 든 음력 달의 초하루(KST 날짜 번호)
    const k0 = Math.round(((termMs / 86400000 + JD_UNIX) - 2451550.09766) / 29.530588861); const td = dayNo(termMs);
    for (let k = k0 - 2; k <= k0 + 2; k++) { const a = dayNo(newMoonUTC(k)), b = dayNo(newMoonUTC(k + 1)); if (a <= td && td < b) return a; }
    return null;
  }
  function lunarHoliday(year, deg, md, plus) {
    const st = lunarMonthStart(solarTermMs(year, deg, md)); if (st === null) return null;
    const d = new Date((st + plus) * 86400000);    // UTC 자정 → 날짜 성분만 사용
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function holidaysOfYear(y) {
    const items = []; // {date, name, group, sub}  sub: 'sun'(일요일/타공휴일) | 'weekend'(토·일) | 'child'(토·일·타공휴일) | null
    const fix = (m, d, name, sub) => items.push({ date: new Date(y, m - 1, d), name, group: name, sub });
    fix(1, 1, '신정', null); fix(3, 1, '삼일절', 'weekend'); fix(5, 5, '어린이날', 'child'); fix(6, 6, '현충일', null);
    fix(8, 15, '광복절', 'weekend'); fix(10, 3, '개천절', 'weekend'); fix(10, 9, '한글날', 'weekend'); fix(12, 25, '성탄절', 'weekend');
    if (y >= 2026) { fix(5, 1, '노동절', 'weekend'); fix(7, 17, '제헌절', 'weekend'); }
    const seol = lunarHoliday(y, 330, [2, 19], 0), chu = lunarHoliday(y, 180, [9, 23], 14), buddha = lunarHoliday(y, 60, [5, 21], 7);
    if (buddha) items.push({ date: buddha, name: '부처님오신날', group: '부처님오신날', sub: 'weekend' });
    [[seol, '설날'], [chu, '추석']].forEach(([c, n]) => { if (!c) return; [-1, 0, 1].forEach((k) => items.push({ date: addDays(c, k), name: k === 0 ? n : n + ' 연휴', group: n, sub: 'sun' })); });
    return items;
  }
  function buildPublicHolidays(y0, y1) {
    const out = {};
    for (let y = y0; y <= y1; y++) {
      const items = holidaysOfYear(y); const cnt = {};
      items.forEach((i) => { cnt[ymd(i.date)] = (cnt[ymd(i.date)] || 0) + 1; });
      const taken = new Set(items.map((i) => ymd(i.date)));
      const isOff = (d) => d.getDay() === 0 || d.getDay() === 6 || taken.has(ymd(d));
      const groups = new Map();
      items.forEach((i) => { if (!groups.has(i.group)) groups.set(i.group, []); groups.get(i.group).push(i); });
      const subs = [];
      groups.forEach((list, name) => {
        const first = list[0], sub = first.sub; if (!sub) return;
        const sun = list.some((i) => i.date.getDay() === 0), wk = list.some((i) => i.date.getDay() === 0 || i.date.getDay() === 6), clash = list.some((i) => cnt[ymd(i.date)] > 1);
        const need = sub === 'sun' ? (sun || clash) : sub === 'child' ? (wk || clash) : wk;
        if (need) subs.push({ after: list[list.length - 1].date, name });
      });
      subs.sort((a, b) => a.after - b.after).forEach((s) => { let d = addDays(s.after, 1); while (isOff(d)) d = addDays(d, 1); taken.add(ymd(d)); out[ymd(d)] = '대체공휴일(' + s.name + ')'; });
      const names = {}; items.forEach((i) => { const k = ymd(i.date); const base = i.name.replace(/ 연휴$/, ''); (names[k] = names[k] || []).push(i.name); });
      Object.keys(names).forEach((k) => { const n = names[k]; const main = n.filter((x) => !/ 연휴$/.test(x)); out[k] = (main.length ? main : n).join(' / '); });
    }
    return out;
  }
  const PUBLIC_HOLIDAYS = buildPublicHolidays(2020, 2045);

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
      classes: uniq('list_class').sort(natural), subs: uniq('list_sub'), times: uniq('list_time').sort(natural),
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


  // ---------------------------------------------------------------- 공통 비밀번호 (관리자 페이지에서 변경)
  const getPw = async () => Object.assign({ access: '0000', admin: '0000' }, await getCfg('passwords', {}));
  const setPw = (pw) => setCfg('passwords', pw);

  // ---------------------------------------------------------------- data_basic 목록 읽기/쓰기
  // data_basic 은 한 문서가 한 행이고 문서 ID 가 무작위라서, 순서를 보존하려고 <필드>_order 를 함께 저장합니다.
  const CANON = {
    list_sub: SUBJECTS_DEFAULT,
    list_gym: ['강당', '다목(2층)', '다목(3층)', '운동장', '나래', 'VR'],
    list_room: ['컴1', '컴2', '음악']
  };
  async function readList(field) {
    const rows = (await getCol('data_basic')).filter((r) => str(r[field]).trim());
    const canon = CANON[field] || [];
    const seen = new Set();
    const items = rows.map((r) => ({
      _id: r._id, value: str(r[field]).trim(), row: r,
      order: (r[field + '_order'] === undefined || r[field + '_order'] === '' || r[field + '_order'] === null) ? null : Number(r[field + '_order'])
    })).filter((i) => (seen.has(i.value) ? false : (seen.add(i.value), true)));
    items.sort((a, b) => {
      if (a.order !== null && b.order !== null) return a.order - b.order;
      if (a.order !== null) return -1;
      if (b.order !== null) return 1;
      const ia = canon.indexOf(a.value), ib = canon.indexOf(b.value);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return natural(a.value, b.value);
    });
    return items;
  }
  // items: [{value, extra:{필드:값}}]  -> data_basic 에 반영(없어진 값은 삭제, 새 값은 추가)
  async function writeList(field, items) {
    invalidate('data_basic');
    const rows = await getCol('data_basic');
    const DEL = firebase.firestore.FieldValue.delete();
    const cur = rows.filter((r) => str(r[field]).trim());
    const holder = new Map();
    cur.forEach((r) => { const v = str(r[field]).trim(); if (!holder.has(v)) holder.set(v, r); });
    const wanted = items.map((i) => i.value);
    const free = cur.filter((r) => { const v = str(r[field]).trim(); return holder.get(v) !== r || wanted.indexOf(v) < 0; });
    const extraKeys = new Set(); items.forEach((i) => Object.keys(i.extra || {}).forEach((k) => extraKeys.add(k)));
    const ops = [];
    items.forEach((it, idx) => {
      const data = Object.assign({ [field]: it.value, [field + '_order']: idx }, it.extra || {});
      const r = holder.get(it.value);
      if (r && wanted.indexOf(str(r[field]).trim()) >= 0 && free.indexOf(r) < 0) ops.push({ type: 'update', col: 'data_basic', id: r._id, data });
      else { const fr = free.shift(); if (fr) ops.push({ type: 'update', col: 'data_basic', id: fr._id, data }); else ops.push({ type: 'set', col: 'data_basic', id: newId('data_basic'), data }); }
    });
    free.forEach((r) => {
      const mine = new Set([field, field + '_order']); extraKeys.forEach((k) => mine.add(k));
      const others = Object.keys(r).filter((k) => k !== '_id' && !mine.has(k) && !/_order$/.test(k));
      if (!others.length) ops.push({ type: 'delete', col: 'data_basic', id: r._id });
      else { const d = {}; mine.forEach((k) => { if (r[k] !== undefined) d[k] = DEL; }); ops.push({ type: 'update', col: 'data_basic', id: r._id, data: d }); }
    });
    await commit(ops); invalidate('data_basic');
  }
  const DEFAULT_HOURS = { 국어: 6, 수학: 4, 사회: 3, 과학: 3, 영어: 3, 음악: 2, 미술: 2, 체육: 2, 실과: 1, 창체: 2, 도덕: 1 };
  const DEFAULT_SPECIAL = ['과학', '영어'];
  async function getSubjectConfig() {
    const items = await readList('list_sub');
    return items.map((i) => {
      const h = i.row.list_sub_hours, sp = i.row.list_sub_special;
      return {
        name: i.value,
        hours: (h === undefined || h === '' || h === null) ? (DEFAULT_HOURS[i.value] === undefined ? '' : DEFAULT_HOURS[i.value]) : num(h),
        stored: !(h === undefined || h === '' || h === null),
        hoursSem1: (i.row.list_sub_hours_sem1 === undefined || i.row.list_sub_hours_sem1 === '' || i.row.list_sub_hours_sem1 === null) ? '' : num(i.row.list_sub_hours_sem1),
        hoursSem2: (i.row.list_sub_hours_sem2 === undefined || i.row.list_sub_hours_sem2 === '' || i.row.list_sub_hours_sem2 === null) ? '' : num(i.row.list_sub_hours_sem2),
        special: (sp === undefined || sp === '' || sp === null) ? DEFAULT_SPECIAL.indexOf(i.value) >= 0 : (sp === true || str(sp) === 'true' || str(sp) === 'Y')
      };
    });
  }

  // 관리자 페이지의 공간 개방 설정(app_config/space_open)을 특별실 시간표 화면에 전달합니다. (공간 이름 기준)
  const PALETTE = ['#CFE2F3', '#FCE5CD', '#D9EAD3', '#FFFEB5', '#E4D7F5'];
  async function specialSettingsForPage07() {
    const cfg = Object.assign({ sem1: {}, sem2: {}, exceptions: [], closeExceptions: [], colors: {} }, await getCfg('space_open', {}));
    const gym = (await readList('list_gym')).map((i) => i.value), room = (await readList('list_room')).map((i) => i.value);
    let times = (await readList('list_time')).map((i) => i.value); if (!times.length) times = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    const colors = {}; [gym, room].forEach((list) => list.forEach((n, i) => { colors[n] = cfg.colors[n] || PALETTE[i % PALETTE.length]; }));
    const fixEx = (arr) => (arr || []).map((e) => ({ date: e.date, period: parseInt(e.period, 10), space: e.space }));
    const g = await generalCfg(); const sems = await semestersOfYear(g.year);
    return { sem1: cfg.sem1 || {}, sem2: cfg.sem2 || {}, exceptions: fixEx(cfg.exceptions), closeExceptions: fixEx(cfg.closeExceptions),
      gymSpaces: gym, roomSpaces: room, times, colors, classNames: g.classNames, year: g.year,
      semesters: sems.map((x) => ({ name: x.name, start: ymd(x.start), end: ymd(x.end) })) };
  }

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
      ops.push({ type: 'set', col: 'data_task_memo', id: newId('data_task_memo'), data: { task_memo_date_start: toTS(d), task_memo_date_end: '', task_memo_name: value } });
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
    const pw = await getPw();
    if ((window.__GP_PAGE__ || '') === 'p10') return a === 'user' ? b === pw.access : a === 'admin' ? b === pw.admin : false; // (type, pwd)
    return a === pw.access ? { success: true } : { success: false, message: '비밀번호가 일치하지 않습니다.' };
  };
  SERVER.verifyAdminPassword = async function (a) {
    const pw = await getPw();
    return a === pw.admin ? { success: true } : { success: false, message: '관리자 비밀번호가 일치하지 않습니다.' };
  };
  SERVER.changePasswords = async function (adminPw, newAccess, newAdmin) {
    const pw = await getPw();
    if (adminPw !== pw.admin) return { success: false, message: '관리자 비밀번호가 일치하지 않습니다.' };
    if (newAccess) pw.access = newAccess; if (newAdmin) pw.admin = newAdmin;
    await setPw(pw);
    return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
  };

  // ===== Page 04 : 기초 시간표 =====
  async function basicCommon() {
    const subs = (await getSubjectConfig()).filter((x) => num(x.hours) > 0);
    const list = subs.length ? subs : SUBJECTS_DEFAULT.map((n) => ({ name: n, hours: DEFAULT_HOURS[n] }));
    return { subjects: list.map((x) => x.name), goals: list.map((x) => num(x.hours)), p12: '', p13: '' };
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
  // 관리자 페이지 > 학년 기초 설정 > 전담교사 의 매칭 정보(app_config/general.specials)를 탭으로 사용합니다.
  //   탭 = 과목 + 교사,  표에 나오는 반 = 그 교사의 담당학급(학기·기간에 해당하는 것만)
  const yearBounds = (y) => ({ start: new Date(y, 1, 1), end: new Date(y + 1, 2, 0) });
  async function generalCfg() {
    const now = new Date();
    const g = Object.assign({ year: now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1, classCount: 10, classNames: [], homeroom: {}, specials: [] }, await getCfg('general', {}));
    g.classNames = Array.from({ length: g.classCount }, (_, i) => (g.classNames && g.classNames[i]) || `${i + 1}반`);
    return g;
  }
  async function semestersOfYear(year) {
    const b = yearBounds(year);
    return (await getSemesters()).filter((x) => x.name.indexOf('방학') < 0 && x.start >= b.start && x.start <= b.end);
  }
  const classLabel = (name) => { const m = str(name).match(/^(\d+)반$/); return m ? m[1] : str(name); };
  const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
  // 학기 시작일이 주말이면 다음 월요일부터 주차를 셉니다.
  const firstMonday = (sem) => mondayOf(addDays(sem.start, sem.start.getDay() === 0 ? 1 : sem.start.getDay() === 6 ? 2 : 0));
  const appliesTo = (sp, semName, sem) => {
    if (sp.period && sp.period.start && sp.period.end) { const a = toDate(sp.period.start), b = toDate(sp.period.end); return !!sem && a <= sem.end && b >= sem.start; }
    return (sp.terms || []).indexOf(semName) >= 0;
  };
  async function specialTabs(g) {
    const tabs = new Map();
    (g.specials || []).forEach((sp) => {
      if (!sp.subject || !sp.teacher) return;
      const label = `${sp.subject}(${sp.teacher})`;
      if (!tabs.has(label)) tabs.set(label, { label, subject: sp.subject, teacher: sp.teacher, entries: [] });
      tabs.get(label).entries.push(sp);
    });
    return tabs;
  }
  const tabClasses = (g, tab, semNo, sems) => {
    const semName = semNo + '학기', sem = sems.find((x) => x.name === semName);
    const set = new Set(); tab.entries.forEach((e) => { if (appliesTo(e, semName, sem)) (e.classes || []).forEach((c) => set.add(c)); });
    return g.classNames.filter((c) => set.has(c));
  };
  async function periodLabels() { const t = (await readList('list_time')).map((i) => i.value); const out = []; for (let i = 0; i < 6; i++) out.push(t[i] || `${i + 1}교시`); return out; }

  async function teacherGrid(g, tab, semNo, sems, times, sub, subCfg) {
    const semName = semNo + '학기', sem = sems.find((x) => x.name === semName);
    const classes = tabClasses(g, tab, semNo, sems); const options = classes.map(classLabel);
    const bottom = []; const counts = {};
    if (sem) {
      const bySlot = new Map();
      sub.forEach((r) => {
        const d = toDate(r.sub_date); if (!d || str(r.sub_name) !== tab.subject || classes.indexOf(str(r.sub_class)) < 0) return;
        bySlot.set(`${ymd(d)}|${str(r.sub_time)}`, classLabel(str(r.sub_class)));
      });
      let w = 1;
      for (let mon = firstMonday(sem); mon <= sem.end; mon = addDays(mon, 7), w++) {
        const fri = addDays(mon, 4);
        const row = [w, `${mon.getMonth() + 1}/${mon.getDate()}~${fri.getMonth() + 1}/${fri.getDate()}`];
        for (let day = 0; day < 5; day++) for (let p = 0; p < 6; p++) row.push(bySlot.get(`${ymd(addDays(mon, day))}|${times[p]}`) || '');
        bottom.push(row);
      }
    }
    bottom.forEach((r) => r.slice(2).forEach((c) => { if (c) counts[c] = (counts[c] || 0) + 1; }));
    const sc = subCfg.find((x) => x.name === tab.subject); const total = sc ? (semNo === 1 ? sc.hoursSem1 : sc.hoursSem2) : '';   // 관리자 > 시간표 설정의 학기 총시수
    const top = [['구분'].concat(options), ['시수'].concat(options.map(() => total)), ['배정'].concat(options.map((o) => counts[o] || 0))];
    return { top, bottom, options, title: `${g.year}학년도 ${semNo}학기 ${tab.subject} ${tab.teacher}${sem ? '' : ' (학기 기간 미설정)'}` };
  }
  SERVER.getAllTimetableData = async function () {
    try {
      invalidate('data_sub_timetable'); invalidate('data_basic');
      const g = await generalCfg(); const tabs = await specialTabs(g); const sems = await semestersOfYear(g.year);
      const times = await periodLabels(); const sub = await getCol('data_sub_timetable'); const subCfg = await getSubjectConfig(); const data = {};
      for (const tab of tabs.values()) data[tab.label] = { sem1: await teacherGrid(g, tab, 1, sems, times, sub, subCfg), sem2: await teacherGrid(g, tab, 2, sems, times, sub, subCfg) };
      const today = new Date(); const s2 = sems.find((x) => x.name === '2학기');
      return JSON.stringify({ success: true, data, currentSemester: s2 && today >= s2.start ? 2 : 1 });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  SERVER.updateBatchSpecialTimetable = async function (list) {
    try {
      invalidate('data_sub_timetable');
      const g = await generalCfg(); const tabs = await specialTabs(g); const sems = await semestersOfYear(g.year); const times = await periodLabels();
      const sub = await getCol('data_sub_timetable'); const ops = [];
      for (const u of list) {
        const tab = tabs.get(u.sheetName); const sem = sems.find((x) => x.name === u.semester + '학기'); if (!tab || !sem) continue;
        const classes = tabClasses(g, tab, u.semester, sems);
        const date = addDays(firstMonday(sem), u.r * 7 + Math.floor((u.c - 2) / 6)); const time = times[(u.c - 2) % 6];
        const existing = sub.filter((r) => { const d = toDate(r.sub_date); return d && ymd(d) === ymd(date) && str(r.sub_time) === time && str(r.sub_name) === tab.subject && classes.indexOf(str(r.sub_class)) >= 0; });
        if (!str(u.value).trim()) { existing.forEach((r) => ops.push({ type: 'delete', col: 'data_sub_timetable', id: r._id })); continue; }
        const cls = classes.find((c) => classLabel(c) === str(u.value).trim()); if (!cls) continue;
        const data = { sub_name: tab.subject, sub_date: toTS(date), sub_time: time, sub_class: cls };
        if (existing.length) { ops.push({ type: 'update', col: 'data_sub_timetable', id: existing[0]._id, data }); existing.slice(1).forEach((r) => ops.push({ type: 'delete', col: 'data_sub_timetable', id: r._id })); }
        else ops.push({ type: 'set', col: 'data_sub_timetable', id: newId('data_sub_timetable'), data });
      }
      await commit(ops); invalidate('data_sub_timetable');
      return JSON.stringify({ success: true, count: list.length });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };

  // ===== Page 07 : 특별실 시간표 =====
  SERVER.getInitialData07 = async function () {
    try {
      const [hol, gym, room, settings, pw] = await Promise.all([getHolidayMap(), getCol('data_gym_timetable'), getCol('data_room_timetable'),
        specialSettingsForPage07(), getCfg('room_passwords', [])]);
      const schedule = [];
      gym.forEach((r) => { const d = toDate(r.gym_date); if (d && str(r.gym_class)) schedule.push({ date: appDate(d), className: str(r.gym_class), period: str(r.gym_time).trim(), space: str(r.gym_place).trim() }); });
      room.forEach((r) => { const d = toDate(r.room_date); if (d && str(r.room_class)) schedule.push({ date: appDate(d), className: str(r.room_class), period: str(r.room_time).trim(), space: str(r.room_place).trim() }); });
      const cpw = await getPw(); settings.adminPwd = cpw.admin; settings.specialPwd = cpw.access;
      return { success: true, holidays: [...hol.keys()].map((k) => appDate(toDate(k))), schedule, settings, roomPasswords: pw };
    } catch (e) { return { success: false, error: e.toString() }; }
  };
  SERVER.saveScheduleData = async function (updates) {
    try {
      const [gym, room] = await Promise.all([getCol('data_gym_timetable'), getCol('data_room_timetable')]);
      const gymNames = (await readList('list_gym')).map((i) => i.value), roomNames = (await readList('list_room')).map((i) => i.value);
      const ops = [];
      for (const u of updates) {
        const isGym = gymNames.indexOf(u.space) >= 0; const isRoom = !isGym && roomNames.indexOf(u.space) >= 0; if (!isGym && !isRoom) continue;
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
  SERVER.saveSettings = async () => ({ success: true }); // 공간 개방 설정은 관리자 페이지에서 관리합니다.
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
    const pw = await getPw();
    if (adminPwd !== pw.admin) return { success: false, message: '관리자 권한이 유효하지 않습니다.' };
    pw.access = newPwd; await setPw(pw);
    return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
  };
  SERVER.uploadFile = async function (adminPwd, base64, fileName, mime) {
    const pw = await getPw();
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
  SERVER.getAppConfig = async () => { const pw = await getPw(); return { userPw: pw.access, adminPw: pw.admin }; };
  SERVER.saveAppConfig = async (c) => { const pw = await getPw(); if (c.userPw) pw.access = c.userPw; if (c.adminPw) pw.admin = c.adminPw; await setPw(pw); return true; };
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
  window.GP = { db, storage, TS, getCol, invalidate, getCfg, setCfg, getLists, toDate, ymd, appDate, isoLocal, addDays, eachDay, mondayOf, DAYS, num, str, natural, classNo, commit, newId, SERVER,
    getPw, setPw, readList, writeList, buildBudgetCards, buildInfo, getSubjectConfig, PUBLIC_HOLIDAYS, getSemesters, DEFAULT_HOURS };
})();
