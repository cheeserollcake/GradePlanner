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
  if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);   // 바깥 틀이 이미 연결해 둔 경우 그대로 사용(fb-boot.js)
  const db = firebase.firestore();
  // 모바일·학교망처럼 기본 연결 방식이 막히거나 느릴 때 자동으로 다른 방식으로 연결합니다.
  if (!window.__GP_SHARED_FB) { try { db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true, merge: true }); } catch (e) { /* 이미 시작됨 */ } }
  const storage = firebase.storage ? firebase.storage() : null;
  // 저장소에 연결이 안 될 때 10분 동안 재시도하며 멈춰 있지 않도록, 20초 안에 실패로 알려 줍니다.
  try { if (storage) { storage.setMaxUploadRetryTime(20000); storage.setMaxOperationRetryTime(20000); } } catch (e) { /* 무시 */ }
  const TS = firebase.firestore.Timestamp;

  // ---------------------------------------------------------------- 날짜 유틸
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const pad = (n) => String(n).padStart(2, '0');
  const strip = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function toDate(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'object' && typeof v.toDate === 'function') return strip(v.toDate());
    if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? null : strip(v);   // 다른 화면에서 만든 Date도 인식
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
    if (dateMemo.has(s)) { const t = dateMemo.get(s); return t === null ? null : new Date(t); }   // 같은 문자열은 한 번만 해석
    const d = parseDateStr(s); dateMemo.set(s, d ? d.getTime() : null); return d;
  }
  const dateMemo = new Map();
  function parseDateStr(s) {
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

  // ---------------------------------------------------------------- Firestore 유틸 (읽기 최소화)
  // Firestore 무료 한도는 "읽은 문서 수"(하루 5만 건)로 줄어듭니다. 컬렉션을 통째로 읽는 이 앱이 화면을 열 때마다 수천 건을
  // 읽지 않도록 다음 방식을 씁니다.
  //  1) 컬렉션별 변경 번호를 app_meta/version 문서 1건에 둡니다.  화면을 열면 이 문서 1건만 읽습니다.
  //  2) 번호가 같으면 이 기기(localStorage)에 저장해 둔 사본을 쓰고, 번호가 달라진 컬렉션만 새로 받습니다.
  //  3) 이 앱에서 저장하면 번호를 올리고 사본도 같이 고쳐서, 저장 직후 다시 읽지 않습니다.
  const cache = {};            // 컬렉션 이름 -> Promise(rows)   (화면이 열려 있는 동안의 메모리 사본)
  const loadedVer = {};        // 컬렉션 이름 -> 메모리 사본이 해당하는 변경 번호
  let versions = null;         // Promise(변경 번호 객체)
  const CACHE_TTL = 6 * 3600 * 1000;   // 안전장치: 6시간이 지나면 번호가 같아도 다시 받습니다.
  const DELETE = firebase.firestore.FieldValue.delete();
  const LS = (() => { try { localStorage.setItem('__gp', '1'); localStorage.removeItem('__gp'); return localStorage; } catch (e) { return null; } })();
  // 이 기기에 저장해 둔 사본: 시크릿/사생활 보호 모드에서는 localStorage 가 막히거나 창을 닫으면 사라지므로,
  // 바깥 틀(index.html)이 열려 있는 동안은 그 메모리에도 함께 두어 페이지를 옮겨 다녀도 다시 내려받지 않게 합니다.
  const MEM = (() => { try { if (window.__GP_SHARED_FB && window.parent && window.parent !== window) return window.parent.__gpMem || (window.parent.__gpMem = {}); } catch (e) { /* 단독 실행 */ } return {}; })();
  const readLocal = (name) => { try { const raw = MEM[name] || (LS && LS.getItem(lsKey(name))); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  const lsKey = (n) => 'gp_c_' + n;
  const idcmp = (a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
  const saveLocal = (name, v, rows) => {
    let raw; try { raw = JSON.stringify({ v, t: Date.now(), rows }); } catch (e) { return; }
    MEM[name] = raw;
    if (LS) { try { LS.setItem(lsKey(name), raw); } catch (e) { /* 용량 초과: 메모리 사본만 사용 */ } }
  };
  const fetchCol = (name) => db.collection(name).get().then((snap) => snap.docs.map((d) => Object.assign({ _id: d.id }, d.data())).sort(idcmp));
  const getVersions = () => versions || (versions = db.collection('app_meta').doc('version').get().then((s) => (s.exists ? s.data() : {})).catch((e) => { console.warn('version read failed', e); return null; }));
  // 다른 사람이 바꿨는지 다시 확인하고 싶을 때(1건 읽기). 바뀐 컬렉션만 새로 받습니다.
  function fresh() { versions = null; Object.keys(cache).forEach((k) => delete cache[k]); Object.keys(loadedVer).forEach((k) => delete loadedVer[k]); }
  const invalidate = () => { /* 저장할 때 사본을 함께 고치므로 따로 비울 필요가 없습니다. 최신 확인은 fresh() */ };

  // 학년도별로 나뉘는 컬렉션: 문서에 _year(학년도) 표시가 있으면 그 학년도에서만 보이고, 표시가 없으면 '지금 학년도' 것으로 봅니다.
  //  학년도를 바꿀 때(app-data setYear) 표시 없는 문서에 이전 학년도 표시를 붙여 둡니다. (데이터는 지우지 않고 감춥니다)
  const YEARED = new Set(['data_student', 'data_basic_timetable', 'data_budget', 'data_sheet_rows']);
  function getCol(name, force) {
    const p = rawCol(name, force); if (!YEARED.has(name)) return p;
    return p.then(async (rows) => { const y = (await loadGeneral()).year; return rows.filter((r) => r._year === undefined || r._year === null || Number(r._year) === y); });
  }
  const yearSpan = (y) => ({ start: new Date(y, 1, 1), end: new Date(y + 1, 2, 0, 23, 59, 59) });   // 학년도: 2월 1일 ~ 다음 해 2월 말일
  function rawCol(name, force) {
    if (!force && cache[name]) return cache[name];
    cache[name] = (async () => {
      const vers = force ? null : await getVersions();
      const want = vers ? Number(vers[name] || 0) : null;
      if (vers) {
        const loc = readLocal(name); if (loc && Number(loc.v) === want && Date.now() - loc.t < CACHE_TTL) { loadedVer[name] = want; return loc.rows; }
      }
      const rows = await fetchCol(name);
      loadedVer[name] = want; if (want !== null) saveLocal(name, want, rows);
      return rows;
    })();
    return cache[name];
  }

  const deepMerge = (t, d) => {
    Object.keys(d).forEach((k) => {
      const v = d[k];
      if (v === DELETE) delete t[k];
      else if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.toDate !== 'function' && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) deepMerge(t[k], v);
      else t[k] = v;
    });
    return t;
  };
  function applyOps(rows, ops) {   // 저장한 내용을 메모리/기기 사본에도 똑같이 반영
    const m = new Map(rows.map((r) => [r._id, r]));
    ops.forEach((o) => {
      const cur = m.get(o.id);
      if (o.type === 'delete') m.delete(o.id);
      else if (o.type === 'update') { if (cur) { const n = Object.assign({}, cur); Object.keys(o.data).forEach((k) => { if (o.data[k] === DELETE) delete n[k]; else n[k] = o.data[k]; }); m.set(o.id, n); } }
      else if (o.merge) { const n = deepMerge(JSON.parse(JSON.stringify(cur || {})), o.data); n._id = o.id; m.set(o.id, n); }
      else { const n = {}; Object.keys(o.data).forEach((k) => { if (o.data[k] !== DELETE) n[k] = o.data[k]; }); n._id = o.id; m.set(o.id, n); }
    });
    return [...m.values()].sort(idcmp);
  }

  async function commit(ops) {
    // ops: [{type:'set'|'update'|'delete', col, id, data, merge}]
    if (!ops || !ops.length) return;
    const cols = [...new Set(ops.map((o) => o.col))];
    const inc = {}; cols.forEach((c) => { inc[c] = firebase.firestore.FieldValue.increment(1); });
    const verRef = db.collection('app_meta').doc('version');
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch(); const last = i + 400 >= ops.length;
      if (last) batch.set(verRef, inc, { merge: true });   // 변경 번호는 같은 묶음(1회 통신)으로 올림 — 모바일에서 저장이 느리던 원인 중 하나(통신 3번 → 2번)
      ops.slice(i, i + 400).forEach((o) => {
        const ref = db.collection(o.col).doc(o.id);
        if (o.type === 'delete') batch.delete(ref);
        else if (o.type === 'update') batch.update(ref, o.data);
        else batch.set(ref, o.data, { merge: !!o.merge });
      });
      try { await batch.commit(); }
      catch (e) {   // 다른 곳에서 이미 지워진 문서를 고치려 한 경우: 없는 문서는 새로 만들며 합쳐서 다시 저장
        if (!/no document to update|not.found/i.test(String(e && (e.message || e.code)))) throw e;
        const b2 = db.batch(); if (last) b2.set(verRef, inc, { merge: true });
        ops.slice(i, i + 400).forEach((o) => { const ref = db.collection(o.col).doc(o.id); if (o.type === 'delete') b2.delete(ref); else b2.set(ref, o.data, { merge: o.type === 'update' || !!o.merge }); });
        await b2.commit();
      }
    }
    let after = null;
    try { after = (await verRef.get()).data() || {}; } catch (e) { console.warn('version read failed', e); }
    versions = after ? Promise.resolve(after) : null;
    for (const c of cols) {
      // 우리가 알던 번호 바로 다음 번호면 그 사이 다른 사람의 저장이 없었던 것 → 사본을 직접 고침. 아니면 다음에 새로 받음.
      if (after && cache[c] && loadedVer[c] !== undefined && loadedVer[c] !== null && Number(after[c] || 0) === loadedVer[c] + 1) {
        const rows = applyOps(await cache[c], ops.filter((o) => o.col === c));
        cache[c] = Promise.resolve(rows); loadedVer[c] = Number(after[c]); saveLocal(c, loadedVer[c], rows);
      } else { delete cache[c]; delete loadedVer[c]; }
    }
  }
  const newId = (col) => db.collection(col).doc().id;
  const ALL_COLS = ['app_config', 'data_basic', 'data_task_school', 'data_task_memo', 'data_student', 'data_sub_timetable', 'data_add_timetable', 'data_gym_timetable', 'data_room_timetable', 'data_budget', 'data_supply', 'data_overview', 'data_basic_timetable', 'data_mall', 'data_links', 'data_sheet_rows'];
  // 파이어베이스 콘솔에서 직접 고친 뒤 모든 기기가 새로 받게 하려면 호출합니다.
  async function resetCaches() {
    const inc = {}; ALL_COLS.forEach((c) => { inc[c] = firebase.firestore.FieldValue.increment(1); });
    await db.collection('app_meta').doc('version').set(inc, { merge: true }); fresh();
  }

  // ---------------------------------------------------------------- 설정 문서(app_config)
  async function getCfg(key, def) {
    try { const r = (await getCol('app_config')).find((x) => x._id === key); if (r && r.json) return JSON.parse(r.json); } catch (e) { console.warn('config read failed', key, e); }
    return def;
  }
  async function setCfg(key, obj) { await commit([{ type: 'set', col: 'app_config', id: key, data: { json: JSON.stringify(obj), updatedAt: new Date().toISOString() } }]); return true; }
  const delCfg = (key) => commit([{ type: 'delete', col: 'app_config', id: key }]);

  // 학년도별로 따로 보관하는 설정: 담임/전담교사 매칭(year_<학년도>), 공간 개방 설정(space_open_<학년도>)
  //  - 학년도를 바꾸면 새 학년도의 담임/전담교사/공간 개방 설정은 비어 있는 상태로 시작합니다.
  //  - 학년도 구분이 없던 이전 데이터는 처음 저장할 때 그 당시 학년도의 것으로 옮깁니다.
  const yearNow = () => { const n = new Date(); return n.getMonth() >= 1 ? n.getFullYear() : n.getFullYear() - 1; };
  window.__cn = (n) => (window.__CN && window.__CN[Number(n) - 1]) || (n + '반');   // 학급 번호 → 관리자에서 정한 학급 이름
  async function loadGeneral() {
    const base = Object.assign({ year: yearNow(), grade: 6, classCount: 10, classNames: [] }, await getCfg('general', {}));
    const yd = await getCfg('year_' + base.year, null);
    let homerooms = [], specials = [];
    if (yd) { homerooms = yd.homerooms || []; specials = yd.specials || []; }
    else if (!base.legacyMigrated) {
      specials = base.specials || []; homerooms = base.homerooms || [];
      if (!homerooms.length && base.homeroom && typeof base.homeroom === 'object') {
        Object.keys(base.homeroom).forEach((c) => { if (str(base.homeroom[c]).trim()) homerooms.push({ className: c, teacher: base.homeroom[c], terms: ['1학기', '2학기'], period: null }); });
      }
    }
    const classNames = Array.from({ length: base.classCount }, (_, i) => (base.classNames && base.classNames[i]) || `${i + 1}반`);
    window.__CN = classNames.slice();   // 화면에서 학급 번호 → 학급 이름(예: 11 → 사과반)으로 바꿀 때 사용 (window.__cn)
    return { year: base.year, grade: base.grade || 6, classCount: base.classCount, classNames, homerooms: Array.isArray(homerooms) ? homerooms : [], specials: Array.isArray(specials) ? specials : [], legacyMigrated: !!base.legacyMigrated };
  }
  async function loadOpen(year) {
    const base = await getCfg('space_open', {}); const yd = await getCfg('space_open_' + year, null);
    const gen = await getCfg('general', {});
    // 학년도 구분 없이 저장돼 있던 예전 설정(space_open)은, 학년도별 설정이 한 번도 만들어진 적 없으면 지금 학년도의 것으로 봅니다.
    const anyYearly = (await getCol('app_config')).some((x) => /^space_open_\d{4}$/.test(x._id));
    const hasBase = !!(base.sem1 && Object.keys(base.sem1).length) || !!(base.sem2 && Object.keys(base.sem2).length) || !!(base.exceptions && base.exceptions.length) || !!(base.closeExceptions && base.closeExceptions.length);
    const src = yd || (!gen.legacyMigrated || (!anyYearly && hasBase) ? base : {});
    // 개방 칸 키는 '<요일>|<교시이름>|<공간>' (교시 이름 기준). 예전 형식 '<요일>_<번호>_<공간>' 은 번호를 'N교시' 이름으로 보고 바꿔 읽습니다.
    const norm = (o) => { const out = {}; Object.keys(o || {}).forEach((k) => { const m = /^(\d)_(\d+)_(.+)$/.exec(k); out[m ? `${m[1]}|${m[2]}교시|${m[3]}` : k] = o[k]; }); return out; };
    const nex = (a) => (a || []).map((e) => (/^\d+$/.test(str(e.period).trim()) ? Object.assign({}, e, { period: str(e.period).trim() + '교시' }) : e));
    return { sem1: norm(src.sem1), sem2: norm(src.sem2), exceptions: nex(src.exceptions), closeExceptions: nex(src.closeExceptions), colors: base.colors || {} };
  }
  async function saveOpen(year, o) {
    const now = new Date().toISOString(), cfgOp = (id, obj) => ({ type: 'set', col: 'app_config', id, data: { json: JSON.stringify(obj), updatedAt: now } });
    await commit([cfgOp('space_open_' + year, { sem1: o.sem1 || {}, sem2: o.sem2 || {}, exceptions: o.exceptions || [], closeExceptions: o.closeExceptions || [] }),
      cfgOp('space_open', { colors: o.colors || {} })]);   // 두 문서를 한 번에 저장. (이전 형식(학년도 구분 없음)의 설정은 여기서 정리됩니다.)
  }
  async function saveGeneral(g) {
    const gen = await getCfg('general', {});
    if (!gen.legacyMigrated) { const o = await loadOpen(g.year); await saveOpen(g.year, o); }   // 이전 데이터 이전
    await setCfg('general', { year: g.year, grade: g.grade || 6, classCount: g.classCount, classNames: g.classNames, legacyMigrated: true });
    await setCfg('year_' + g.year, { homerooms: g.homerooms || [], specials: g.specials || [] });
  }

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
    const rows = await getBasicRows(); const curY = (await loadGeneral()).year;
    const uniq = (f) => [...new Set(rows.map((r) => str(r[f]).trim()).filter(Boolean))];
    return {
      classes: (await loadGeneral()).classNames.slice(),   // 학급 수·이름은 관리자 > 학년 기초 설정을 따릅니다
      subs: uniq('list_sub'), times: (await readList('list_time')).map((i) => i.value),
      gyms: uniq('list_gym'), rooms: uniq('list_room'), teachers: uniq('list_t'),
      budgets: rows.filter((r) => str(r.list_budget).trim() && budgetYearOK(r, curY))
        .map((r, i) => ({ name: str(r.list_budget).trim(), amount: num(r.list_budget_amount), color: str(r.list_budget_color).trim(), kind: str(r.list_budget_kind).trim(), classes: str(r.list_budget_classes).split(',').map((x) => x.trim()).filter(Boolean), common: (r.list_budget_common === undefined || r.list_budget_common === null) ? '' : r.list_budget_common, pages: str(r.list_budget_pages).trim() ? str(r.list_budget_pages).split(',').filter(Boolean).map((p) => (p === 'supply' ? 'supply1' : p)) : ['budget'], _o: (r.list_budget_order === undefined || r.list_budget_order === '' || r.list_budget_order === null) ? 1e6 + i : Number(r.list_budget_order) }))
        .sort((a, b) => a._o - b._o).map(({ _o, ...b }) => { if (/학년회비|친목회비/.test(b.name) && b.pages.indexOf('budget') >= 0 && b.pages.indexOf('fee') < 0) b.pages = b.pages.map((x) => (x === 'budget' ? 'fee' : x)); return b; }),
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

  // pageId 를 주면 그 예산 페이지에 표시하기로 한 카드만, 그 페이지에서 정한 순서대로 돌려줍니다. 주지 않으면 모든 카드.
  // 예산 표(학년 예산 + 추가한 예산 페이지)의 모든 줄: { name, amount, fee }
  //  fee = 학년회비·학교친목회비인데 규격에 학급을 체크한 줄 → 사용액이 아니라 배정액에 더해집니다.
  const FEE_RE = /학년회비|친목회비/;
  async function budgetLines() {
    const lists = await getLists(); const classes = lists.classes.filter((c) => c !== '학년공통'); const out = [];
    const add = (name, spec, n, p, r) => {
      name = str(name).trim(); if (!name) return;
      // 학급별 금액(반별사용액 통계 카드용): 학급별수량이 있으면 학급마다 수량×단가, 없으면 학급 구분 없음('')
      const cls = {}, cl = str(r && r.supply_class).split(',').map((x) => x.trim()).filter(Boolean), ns = str(r && r.supply_class_num).split(',').map((x) => x.trim());
      if (cl.length) cl.forEach((c, i) => { cls[c] = (cls[c] || 0) + num(ns[i]) * num(p); }); else cls[''] = num(n) * num(p);
      out.push({ name, amount: num(n) * num(p), cls, fee: FEE_RE.test(name) && str(spec).split(',').map((x) => x.trim()).some((t) => t === '+' || classes.indexOf(t) >= 0) });
    };
    (await getCol('data_budget')).forEach((r) => add(r.budget_name, r.budget_spec, r.supply_class && str(r.supply_class).trim() ? str(r.supply_class_num).split(',').reduce((a, x) => a + num(x), 0) : r.budget_num, r.budget_price, r));
    const cfg = await getCfg('budget_sheets', { sheets: [] }), sheets = Array.isArray(cfg.sheets) ? cfg.sheets : [];
    if (sheets.length) {
      const rows = await getCol('data_sheet_rows');
      sheets.forEach((s) => {
        const by = (n) => (s.cols || []).find((c) => str(c.name).trim() === n), cn = by('예산종류'), cs = by('규격'), cq = by('수량'), cp = by('단가'), cu = by('학급별수량'); if (!cn || !(cq || cu) || !cp) return;
        const supQ = (r) => { const cl = str(r.supply_class).split(',').map((x) => x.trim()).filter(Boolean), ns = str(r.supply_class_num).split(',').map((x) => x.trim()).filter(Boolean); return cl.length ? cl.reduce((a, _, i) => a + num(ns[i]), 0) : ns.reduce((a, n) => a + num(n), 0); };   // 학급별수량 칸: 학습준비물과 같은 방식
        rows.filter((r) => r.sheet === s.id).forEach((r) => add(r['f_' + cn.id], cs ? r['f_' + cs.id] : '', cu && supQ(r) > 0 ? supQ(r) : cq ? r['f_' + cq.id] : 0, r['f_' + cp.id], cu ? r : null));
      });
    }
    return out;
  }
  async function buildBudgetCards(pageId) {
    const lists = await getLists();
    const lines = await budgetLines();
    const heads = {};
    lists.budgets.forEach((b) => { const h = b.name.split('/')[0]; (heads[h] = heads[h] || []).push(b); });
    const cards = []; const done = new Set();
    let list = lists.budgets;
    if (pageId) {
      const layAll = (await getCfg('budget_layout', {})) || {}; const lay = layAll[pageId] || (pageId === 'supply1' ? layAll.supply : undefined); const pos = (n) => { const i = Array.isArray(lay) ? lay.indexOf(n) : -1; return i < 0 ? 1e6 : i; };
      list = list.filter((b) => (b.pages || ['budget']).indexOf(pageId) >= 0).map((b, i) => ({ b, i })).sort((x, y) => pos(x.b.name) - pos(y.b.name) || x.i - y.i).map((x) => x.b);
    }
    list.forEach((b) => {
      const h = b.name.split('/')[0];
      if (done.has(h)) return;
      const merged = heads[h].length > 1;
      const name = merged ? h : b.name;
      const base = merged ? heads[h].reduce((a, x) => a + x.amount, 0) : b.amount;
      const mine = lines.filter((r) => r.name === name || r.name === h || r.name === b.name);
      const used = mine.filter((r) => !r.fee).reduce((a, r) => a + r.amount, 0);
      const assigned = base + mine.filter((r) => r.fee).reduce((a, r) => a + r.amount, 0);   // 학년회비 등 학급을 체크한 줄은 배정액에 추가
      if (!merged && b.kind === 'classStats') {   // 반별사용액 통계: 총액만 입력 → 학년공통·반별배부액·학급별 사용액·잔액은 자동
        const all = lists.classes.filter((c) => c !== '학년공통'); const cls = (b.classes && b.classes.length ? b.classes : all).filter((c) => all.indexOf(c) >= 0);
        const use = {}; cls.forEach((c) => { use[c] = 0; }); let autoCommon = 0;
        mine.forEach((r) => Object.keys(r.cls || {}).forEach((c) => { if (c in use) use[c] += r.cls[c]; else autoCommon += r.cls[c]; }));   // 학급이 정해지지 않은 금액·'학년공통'은 학년공통사용액
        const hasCommon = b.common !== '' && b.common !== null && b.common !== undefined; const common = hasCommon ? num(b.common) : autoCommon;
        const total = b.amount, alloc = cls.length ? Math.round((total - common) / cls.length) : 0, spent = mine.reduce((a, r) => a + r.amount, 0);
        cards.push({ name, kind: 'classStats', assigned: total, used: spent, balance: total - spent, color: b.color, stats: { total, common, commonManual: hasCommon, alloc, classes: cls, use, spent, remain: total - spent } });
        done.add(h); return;
      }
      cards.push({ name, assigned, used, balance: assigned - used, color: merged ? '' : b.color });
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
  // 예산 카드(list_budget)는 학년도별로 따로 보관합니다. 학년도 표시(list_budget_year)가 없는 카드는 '지금 학년도' 것으로 봅니다.
  const budgetYearOK = (r, y) => { const v = r.list_budget_year; return v === undefined || v === null || v === '' || Number(v) === y; };
  async function readList(field) {
    let rows = (await getCol('data_basic')).filter((r) => str(r[field]).trim());
    if (field === 'list_budget') { const y = (await loadGeneral()).year; rows = rows.filter((r) => budgetYearOK(r, y)); }
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
    const rows = await getCol('data_basic');
    const DEL = DELETE;
    let cur = rows.filter((r) => str(r[field]).trim());
    if (field === 'list_budget') { const y = (await loadGeneral()).year; cur = cur.filter((r) => budgetYearOK(r, y)); items = items.map((i) => Object.assign({}, i, { extra: Object.assign({}, i.extra || {}, { list_budget_year: y }) })); }
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
    const g = await generalCfg(); const cfg = await loadOpen(g.year);
    const gym = (await readList('list_gym')).map((i) => i.value), room = (await readList('list_room')).map((i) => i.value);
    let times = (await readList('list_time')).map((i) => i.value); if (!times.length) times = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    const colors = {}; [gym, room].forEach((list) => list.forEach((n, i) => { colors[n] = cfg.colors[n] || PALETTE[i % PALETTE.length]; }));
    // 특별실 시간표 페이지는 교시를 '표의 몇 번째 줄'로 받으므로, 교시 이름 기준 설정을 지금 교시 목록의 위치로 바꿔 넘깁니다.
    const idxOf = (nm) => times.indexOf(nm);
    const fixEx = (arr) => (arr || []).map((e) => ({ date: e.date, period: idxOf(str(e.period).trim()) + 1, space: e.space })).filter((e) => e.period > 0);
    const openIdx = (o) => { const out = {}; Object.keys(o || {}).forEach((k) => { const m = /^(\d)\|([^|]*)\|(.+)$/.exec(k); if (!m || !o[k]) return; const i = idxOf(m[2]); if (i >= 0) out[`${m[1]}_${i + 1}_${m[3]}`] = true; }); return out; };
    const sems = await semestersOfYear(g.year);
    return { sem1: openIdx(cfg.sem1), sem2: openIdx(cfg.sem2), exceptions: fixEx(cfg.exceptions), closeExceptions: fixEx(cfg.closeExceptions),
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
        await commit([{ type: 'set', merge: true, col: 'data_overview', id: params.rowId, data: { ['c' + col]: params.value } }]);
      } else if (params.type === 'overview_schedule_edit') {
        await setMemoForDate(params.rowIndex, params.value);
      } else if (params.type === 'basic_timetable_edit') {
        const id = 'class_' + params.classNum;
        await commit([{ type: 'set', merge: true, col: 'data_basic_timetable', id, data: { class: Number(params.classNum), cells: { [nameKey(await basicPeriods(), params.r, params.c)]: params.value } } }]);
      }
      return JSON.stringify({ success: true });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };

  // ===== Page 03 : 명렬표 =====
  const classStudents = async (n) => (await getCol('data_student')).filter((s) => num(s.student_class) === n);
  const gNorm = (v) => { const t = str(v).trim(); return /^(남|남자|남성|m|male)$/i.test(t) ? '남성' : /^(여|여자|여성|f|female)$/i.test(t) ? '여성' : t; };
  async function horizontalData() {   // 관리자 > 학급 수 만큼, 5개 반씩 묶어서
    const [all, g] = await Promise.all([getCol('data_student'), generalCfg()]);
    const total = g.classNames.length, groups = [];
    for (let start = 1; start <= total; start += 5) {
      const per = Math.min(5, total - start + 1), rows = [];
      for (let i = 1; i <= 30; i++) {
        const row = [];
        for (let c = 0; c < per; c++) {
          const st = all.find((x) => num(x.student_class) === start + c && num(x.student_num) === i);
          row.push(i, st ? str(st.student_name) : '', st ? gNorm(st.student_gender) : '', st ? str(st.student_memo) : '');
        }
        rows.push(row);
      }
      groups.push({ start, rows });
    }
    return { groups, classCount: total, group1: groups[0] ? groups[0].rows : [], group2: groups[1] ? groups[1].rows : [] };
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
        data.push([i, s ? str(s.student_name) : '', s ? gNorm(s.student_gender) : '', s ? str(s.student_memo) : '', s ? str(s.student_birth) : '']);
      }
      return JSON.stringify({ success: true, data, classCount: (await generalCfg()).classNames.length });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  let stuQ = Promise.resolve();   // 빠르게 연달아 입력해도 같은 학생 문서가 둘로 생기지 않도록 한 줄로 처리
  const inStuQ = (fn) => { const r = stuQ.then(fn); stuQ = r.catch(() => {}); return r; };
  SERVER.updateStudent = (params) => inStuQ(async function () {
    try {
      const fieldMap = { name: 'student_name', gender: 'student_gender', note: 'student_memo', birth: 'student_birth' };
      const f = fieldMap[params.field]; if (!f) return JSON.stringify({ success: true });
      const n = Number(params.classNum); const no = Number(params.rowIndex);
      const list = await classStudents(n); const s = list.find((x) => num(x.student_num) === no);
      if (s) await commit([{ type: 'update', col: 'data_student', id: s._id, data: { [f]: params.value } }]);
      else await commit([{ type: 'set', col: 'data_student', id: newId('data_student'), data: { student_class: n, student_num: no, student_name: '', student_gender: '', student_memo: '', student_birth: '', [f]: params.value } }]);
      return JSON.stringify({ success: true });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  });
  SERVER.deleteStudent = (params) => inStuQ(async function () {
    try {
      const list = await classStudents(Number(params.classNum)); const s = list.find((x) => num(x.student_num) === Number(params.rowIndex));
      if (s) await commit([{ type: 'delete', col: 'data_student', id: s._id }]);
      return JSON.stringify({ success: true });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  });
  // 엑셀로 올린 명단: 파일에 있는 반은 파일 내용으로 바꿉니다. rows: [{cls, no, name, gender, memo, birth}]
  SERVER.importStudents = (rows) => inStuQ(async function () {
    try {
      const classes = [...new Set(rows.map((r) => Number(r.cls)))]; const all = await getCol('data_student'); const ops = []; const used = new Set();
      rows.forEach((r) => {
        const data = { student_class: Number(r.cls), student_num: Number(r.no), student_name: str(r.name).trim(), student_gender: gNorm(r.gender), student_memo: str(r.memo).trim(), student_birth: str(r.birth).trim() };
        const cur = all.find((x) => num(x.student_class) === data.student_class && num(x.student_num) === data.student_num && !used.has(x._id));
        if (cur) { used.add(cur._id); ops.push({ type: 'update', col: 'data_student', id: cur._id, data }); } else ops.push({ type: 'set', col: 'data_student', id: newId('data_student'), data });
      });
      all.forEach((x) => { if (classes.indexOf(num(x.student_class)) >= 0 && !used.has(x._id)) ops.push({ type: 'delete', col: 'data_student', id: x._id }); });
      await commit(ops); return JSON.stringify({ success: true, count: rows.length });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  });
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
  //  - 교시 수/이름은 관리자 > 시간표 설정 > 교시 설정, 학급 수는 학년 기초 설정의 값을 따릅니다.
  //  - 기초시간표에 과목을 넣을 수 있는 칸은 관리자 > 시간표 설정 > 주간시수배정에서 체크한 칸입니다.
  //    (app_config/basic_slots 에는 "꺼 둔 칸"만 저장합니다. 저장된 것이 없으면 모든 칸이 켜져 있습니다.)
  async function basicPeriods() { const t = (await readList('list_time')).map((i) => i.value).filter(Boolean); return t.length ? t : [1, 2, 3, 4, 5, 6].map((n) => n + '교시'); }
  async function basicCommon() {
    const cfg = await getSubjectConfig();
    const subs = cfg.filter((x) => num(x.hours) > 0);
    const list = subs.length ? subs : SUBJECTS_DEFAULT.map((n) => ({ name: n, hours: DEFAULT_HOURS[n], special: DEFAULT_SPECIAL.indexOf(n) >= 0 }));
    const g = await generalCfg(); const periods = await basicPeriods(); const off = await basicSlotsOff();
    return { subjects: list.map((x) => x.name), goals: list.map((x) => num(x.hours)), specials: list.filter((x) => x.special).map((x) => x.name), p12: '', p13: '',
      periods, classCount: g.classNames.length, off: [...off] };
  }
  // 기초시간표는 "몇 번째 교시"가 아니라 "교시 이름"을 기준으로 저장합니다. (칸 키: '<교시이름>|<요일1~5>', 꺼 둔 칸: '<요일>|<교시이름>')
  //  - 예전 데이터('<번호>_<요일>')는 번호를 'N교시' 이름으로 보고 읽습니다. 교시 이름이 바뀌거나 목록 순서가 바뀌어도 이름이 같은 칸은 그대로 따라갑니다.
  //  - 화면(기초시간표 페이지)에는 지금 교시 목록 순서의 번호 키('<번호>_<요일>')로 변환해서 넘기고, 저장할 때 다시 이름 키로 바꿉니다.
  const legacyName = (name) => { const m = /^(\d+)교시$/.exec(name); return m ? m[1] : null; };
  function cellsByIndex(cells, periods) {
    const out = {};
    periods.forEach((name, i) => { for (let c = 1; c <= 5; c++) { let v = cells[`${name}|${c}`]; if (v === undefined) { const n = legacyName(name); if (n) v = cells[`${n}_${c}`]; } if (v !== undefined) out[`${i + 1}_${c}`] = v; } });
    return out;
  }
  const nameKey = (periods, r, c) => `${periods[r - 1]}|${c}`;
  async function basicSlotsOff() {
    const cfg = await getCfg('basic_slots', {}); const periods = await basicPeriods(); const set = new Set();
    (Array.isArray(cfg.off) ? cfg.off : []).forEach((k) => {
      let m = /^(\d)\|(.+)$/.exec(k); let d, i;
      if (m) { d = m[1]; i = periods.indexOf(m[2]); } else if ((m = /^(\d)_(\d+)$/.exec(k))) { d = m[1]; i = periods.indexOf(m[2] + '교시'); }   // 예전 형식
      if (i >= 0) set.add(d + '_' + (i + 1));
    });
    return set;
  }
  async function basicDocs() { const periods = await basicPeriods(); const m = new Map(); (await getCol('data_basic_timetable')).forEach((r) => m.set(r._id, cellsByIndex((r && r.cells) || {}, periods))); return m; }
  function basicRows(cells, nPeriods, labels) {
    const rows = [];
    for (let r = 0; r <= nPeriods; r++) {
      const row = [];
      for (let c = 0; c < 6; c++) {
        const k = `${r}_${c}`;
        if (r === 0) row.push(c === 0 ? '교시' : DAYS[c]);
        else if (c === 0) row.push(labels && labels[r - 1] ? labels[r - 1] : `${r}교시`);
        else row.push(cells[k] !== undefined ? cells[k] : '');
      }
      rows.push(row);
    }
    return rows;
  }
  async function basicTimetableResponse(request) {
    try {
      invalidate('data_basic_timetable');
      const common = await basicCommon(); const docs = await basicDocs(); const np = common.periods.length;
      if (request && request.classNum === 'all') {
        const allSchedules = []; for (let i = 1; i <= common.classCount; i++) allSchedules.push(basicRows(docs.get('class_' + i) || {}, np, common.periods));
        return JSON.stringify({ success: true, type: 'basic_timetable_all', data: Object.assign({ allSchedules }, common) });
      }
      const n = Math.min(Math.max(parseInt(request && request.classNum, 10) || 1, 1), common.classCount);
      return JSON.stringify({ success: true, type: 'basic_timetable', data: Object.assign({ schedule: basicRows(docs.get('class_' + n) || {}, np, common.periods), classNum: n }, common) });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  }
  SERVER.deleteBasicTimetable = async function (params) {
    await commit([{ type: 'set', col: 'data_basic_timetable', id: 'class_' + params.classNum, data: { class: Number(params.classNum), cells: {} } }]);
    return JSON.stringify({ success: true });
  };
  // 빈칸 자동 채우기: 이미 입력된 칸은 그대로 두고, 켜져 있는 빈 칸에 남은 배정시수만큼 과목을 넣습니다.
  //  - 같은 과목이 한 요일에 몰리지 않고, 연속 교시에 겹치지 않도록 흩어 놓습니다.
  //  - 전담 과목은 다른 반이 같은 시간에 이미 쓰고 있는 칸을 피합니다.
  //  채울 수 없는 시수가 남으면 부족한 만큼을 알려 줍니다.
  function planAutoFill(common, mine, others) {
    const np = common.periods.length, off = new Set(common.off);
    const grid = {}; for (let c = 1; c <= 5; c++) for (let r = 1; r <= np; r++) grid[`${r}_${c}`] = mine[`${r}_${c}`] || '';
    const need = common.subjects.map((s, i) => ({ s, n: Math.max(0, common.goals[i] - Object.values(grid).filter((v) => v === s).length) })).filter((x) => x.n > 0);
    const empty = []; for (let c = 1; c <= 5; c++) for (let r = 1; r <= np; r++) if (!grid[`${r}_${c}`] && !off.has(`${c}_${r}`)) empty.push([r, c]);
    const spSet = new Set(common.specials);
    const clash = (s, r, c) => spSet.has(s) && others.some((o) => o[`${r}_${c}`] === s);
    const placed = {}; const left = {}; need.forEach((x) => { left[x.s] = x.n; });
    let guard = 0;
    while (empty.length && Object.values(left).some((v) => v > 0) && guard++ < 1000) {
      // 남은 시수가 가장 많은 과목부터, 가장 덜 겹치는 칸에 배치
      const s = Object.keys(left).filter((k) => left[k] > 0).sort((a, b) => left[b] - left[a] || common.subjects.indexOf(a) - common.subjects.indexOf(b))[0];
      let best = -1, bestScore = Infinity;
      empty.forEach(([r, c], i) => {
        let sc = 0;
        for (let rr = 1; rr <= np; rr++) if (grid[`${rr}_${c}`] === s) sc += 10;                 // 같은 요일에 같은 과목
        if (grid[`${r - 1}_${c}`] === s || grid[`${r + 1}_${c}`] === s) sc += 25;               // 바로 앞뒤 교시
        if (clash(s, r, c)) sc += 1000;                                                          // 전담 과목 시간 겹침
        sc += r * 0.01 + c * 0.001;                                                              // 같으면 앞 교시·앞 요일 먼저
        if (sc < bestScore) { bestScore = sc; best = i; }
      });
      const [r, c] = empty.splice(best, 1)[0]; grid[`${r}_${c}`] = s; placed[`${r}_${c}`] = s; left[s]--;
    }
    const short = Object.keys(left).filter((k) => left[k] > 0).map((k) => ({ subject: k, count: left[k] }));
    return { placed, short };
  }
  SERVER.autoFillBasicTimetable = async function (params) {
    try {
      invalidate('data_basic_timetable');
      const common = await basicCommon(); const docs = await basicDocs(); const n = parseInt(params.classNum, 10);
      if (!(n >= 1 && n <= common.classCount)) throw new Error('학급을 찾을 수 없습니다.');
      const others = []; for (let i = 1; i <= common.classCount; i++) if (i !== n) others.push(docs.get('class_' + i) || {});
      const plan = planAutoFill(common, docs.get('class_' + n) || {}, others);
      const cells = {}, per = await basicPeriods(); Object.keys(plan.placed).forEach((k) => { const [r, c] = k.split('_'); cells[nameKey(per, +r, +c)] = plan.placed[k]; });
      if (Object.keys(cells).length) await commit([{ type: 'set', merge: true, col: 'data_basic_timetable', id: 'class_' + n, data: { class: n, cells } }]);
      invalidate('data_basic_timetable');
      return JSON.stringify({ success: true, filled: Object.keys(cells).length, short: plan.short });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  SERVER.planAutoFill = planAutoFill;

  // ===== 시간표 데이터 모으기 (Page 05, 08, 09) =====
  // ---- 삭제된 공간의 남은 시간표 데이터 관리 ----
  const SPACE_COLS = { gym: { col: 'data_gym_timetable', f: 'gym_place' }, room: { col: 'data_room_timetable', f: 'room_place' } };
  async function validSpaces() { const l = [...(await readList('list_gym')), ...(await readList('list_room'))]; return new Set(l.map((i) => i.value)); }
  async function spaceOrphans() {   // 현재 공간 목록에 없는 공간 이름으로 남아 있는 데이터
    const names = await validSpaces(), out = [];
    for (const k of Object.keys(SPACE_COLS)) {
      const d = SPACE_COLS[k], m = new Map();
      (await getCol(d.col)).forEach((r) => { const p = str(r[d.f]).trim(); if (!names.has(p)) m.set(p, (m.get(p) || 0) + 1); });
      m.forEach((count, place) => out.push({ col: d.col, place, count }));
    }
    return out;
  }
  async function listSpaceData(place) {   // 한 공간에 입력된 시간표 목록 (날짜순)
    const out = [];
    for (const k of Object.keys(SPACE_COLS)) {
      const d = SPACE_COLS[k], pre = k;
      (await getCol(d.col)).forEach((r) => { if (str(r[d.f]).trim() !== place) return; const dt = toDate(r[pre + '_date']); out.push({ col: d.col, id: r._id, date: dt ? ymd(dt) : '', period: str(r[pre + '_time']).trim(), cls: str(r[pre + '_class']).trim() }); });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : natural(a.period, b.period)));
  }
  async function deleteSpaceRows(items) {
    const ops = items.map((x) => ({ type: 'delete', col: x.col, id: x.id }));
    await commit(ops); Object.keys(SPACE_COLS).forEach((k) => invalidate(SPACE_COLS[k].col)); return ops.length;
  }
  async function countSpaceData(place) {
    let n = 0; for (const k of Object.keys(SPACE_COLS)) { const d = SPACE_COLS[k]; n += (await getCol(d.col)).filter((r) => str(r[d.f]).trim() === place).length; } return n;
  }
  async function purgeSpaceData(place) {   // place 가 null 이면 현재 없는 공간의 데이터를 모두 삭제
    const names = await validSpaces(), ops = [];
    for (const k of Object.keys(SPACE_COLS)) {
      const d = SPACE_COLS[k];
      (await getCol(d.col)).forEach((r) => { const p = str(r[d.f]).trim(); if (place === null ? !names.has(p) : p === place) ops.push({ type: 'delete', col: d.col, id: r._id }); });
    }
    await commit(ops); Object.keys(SPACE_COLS).forEach((k) => invalidate(SPACE_COLS[k].col)); return ops.length;
  }
  async function renameSpaceData(oldName, newName) {   // 공간 이름을 바꾸면 이미 입력된 시간표도 새 이름으로 옮깁니다.
    const ops = [];
    for (const k of Object.keys(SPACE_COLS)) { const d = SPACE_COLS[k]; (await getCol(d.col)).forEach((r) => { if (str(r[d.f]).trim() === oldName) ops.push({ type: 'update', col: d.col, id: r._id, data: { [d.f]: newName } }); }); }
    await commit(ops); Object.keys(SPACE_COLS).forEach((k) => invalidate(SPACE_COLS[k].col));
  }
  const slotRow = (d, cls, per, name) => [isoLocal(d), cls, per, name];
  async function monthlyData() {
    const [hol, gym0, room, sub, add] = await Promise.all([getHolidayMap(), getCol('data_gym_timetable'), getCol('data_room_timetable'), getCol('data_sub_timetable'), getCol('data_add_timetable')]);
    const gym = gym0.concat(room.map((r) => ({ gym_date: r.room_date, gym_class: r.room_class, gym_time: r.room_time, gym_place: r.room_place })));   // 컴실 등도 체육 공간과 같은 방식으로 표시
    const holidays = [...hol.entries()].sort().map(([k, v]) => [isoLocal(toDate(k)), v]);
    const gcfg = await generalCfg(); const periods = await basicPeriods();
    // 월간 표는 교시를 번호(표의 몇 번째 줄)로 받으므로, 저장된 교시 '이름'을 지금 교시 목록에서의 위치로 바꿔 넘깁니다.
    const perIdx = (v) => str(v).split(/[,，、]+/).map((t) => t.trim()).filter(Boolean).map((t) => { const i = periods.indexOf(t); return i >= 0 ? i + 1 : null; }).filter(Boolean).join(',');
    const rows = (list, fd, fc, ft, fn) => list.map((r) => ({ d: toDate(r[fd]), r })).filter((x) => x.d && str(x.r[fc]).trim())
      .map((x) => slotRow(x.d, str(x.r[fc]), perIdx(x.r[ft]), str(x.r[fn])));
    return {
      year: gcfg.year, holidays, periods, classCount: gcfg.classNames.length, classNames: gcfg.classNames,   // 표의 반 수·교시 수는 관리자 설정을 따름
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
  async function generalCfg() { return loadGeneral(); }   // 학년도별 담임/전담교사 포함
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
      if (!tabs.has(label)) tabs.set(label, { label, subject: sp.subject, teacher: sp.teacher, space: '', entries: [] });
      const t = tabs.get(label); t.entries.push(sp); if (!t.space && sp.space) t.space = sp.space;
    });
    return tabs;
  }
  const tabClasses = (g, tab, semNo, sems) => {
    const semName = semNo + '학기', sem = sems.find((x) => x.name === semName);
    const set = new Set(); tab.entries.forEach((e) => { if (appliesTo(e, semName, sem)) (e.classes || []).forEach((c) => set.add(c)); });
    return g.classNames.filter((c) => set.has(c));
  };
  async function periodLabels() { const t = (await readList('list_time')).map((i) => i.value); const out = []; for (let i = 0; i < (t.length ? t.length : 6); i++) out.push(t[i] || `${i + 1}교시`); return out; }

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
        for (let day = 0; day < 5; day++) for (let p = 0; p < times.length; p++) row.push(bySlot.get(`${ymd(addDays(mon, day))}|${times[p]}`) || '');
        bottom.push(row);
      }
    }
    bottom.forEach((r) => r.slice(2).forEach((c) => { if (c) counts[c] = (counts[c] || 0) + 1; }));
    const sc = subCfg.find((x) => x.name === tab.subject); const total = sc ? (semNo === 1 ? sc.hoursSem1 : sc.hoursSem2) : '';   // 관리자 > 시간표 설정의 학기 총시수
    const top = [['구분'].concat(options), ['시수'].concat(options.map(() => total)), ['배정'].concat(options.map((o) => counts[o] || 0))];
    return { np: times.length, names: times, top, bottom, options, title: `${g.year}학년도 ${semNo}학기 ${tab.subject} ${tab.teacher}${tab.space ? '/' + tab.space : ''}${sem ? '' : ' (학기 기간 미설정)'}` };
  }
  SERVER.getAllTimetableData = async function () {
    try {
      fresh();
      const g = await generalCfg(); const tabs = await specialTabs(g); const sems = await semestersOfYear(g.year);
      const times = await periodLabels(); const sub = await getCol('data_sub_timetable'); const subCfg = await getSubjectConfig(); const data = {};
      const subjOrder = subCfg.map((x) => x.name);   // 탭 순서: 시간표 설정의 과목 순서 → 같은 과목 안에서는 담당 학급 번호가 작은 순 (정렬은 화면에서 학기별로 합니다)
      for (const tab of tabs.values()) data[tab.label] = { space: tab.space, subject: tab.subject, subjIdx: subjOrder.indexOf(tab.subject) < 0 ? 999 : subjOrder.indexOf(tab.subject), sem1: await teacherGrid(g, tab, 1, sems, times, sub, subCfg), sem2: await teacherGrid(g, tab, 2, sems, times, sub, subCfg) };
      const today = new Date(); const s2 = sems.find((x) => x.name === '2학기');
      return JSON.stringify({ success: true, data, currentSemester: s2 && today >= s2.start ? 2 : 1 });
    } catch (e) { return JSON.stringify({ success: false, error: e.toString() }); }
  };
  SERVER.saveSpaceName = async function (label, space) {
    try {
      const g = await loadGeneral(); const m = str(label).match(/^(.*)\((.*)\)$/); if (!m) return JSON.stringify({ success: false });
      g.specials.forEach((e) => { if (e.subject === m[1] && e.teacher === m[2]) e.space = str(space).trim(); });
      await saveGeneral(g); return JSON.stringify({ success: true });
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
        const date = addDays(firstMonday(sem), u.r * 7 + Math.floor((u.c - 2) / times.length)); const time = times[(u.c - 2) % times.length];
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
  // 시간표 이미지는 Firebase Storage 대신 Firestore(data_images)에 압축한 사진(data URL)으로 저장합니다.
  const IMG_LIMIT = 700 * 1024;   // 문서 1개 한도(1MiB) 안에 들어가도록 base64 변환 전 최대 크기
  const blobToDataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error || new Error('이미지를 읽지 못했습니다.')); fr.readAsDataURL(blob); });
  SERVER.getImages = async function () {
    try {
      const snap = await db.collection('data_images').get(); const sp = yearSpan((await loadGeneral()).year);   // 지금 학년도에 올린 이미지만
      return snap.docs.map((d) => { const x = d.data(); return { id: d.id, url: x.dataUrl, name: x.name || '', t: x.createdAt || '', o: (x.order === undefined || x.order === null) ? null : Number(x.order) }; })
        .filter((x) => { const d = x.t ? new Date(x.t) : null; return !d || (d >= sp.start && d <= sp.end); })
        .sort((p, q) => (p.o !== null && q.o !== null ? p.o - q.o : p.o !== null ? -1 : q.o !== null ? 1 : String(p.t).localeCompare(String(q.t))))   // 끌어서 정한 순서 → 없으면 올린 순서.map(({ id, url, name }) => ({ id, url, name }));
    } catch (e) { console.warn(e); return []; }
  };
  SERVER.uploadImage = async function (data, name, mime) {   // data: Blob(권장) 또는 base64 문자열
    try {
      const size = typeof data === 'string' ? Math.round(data.length * 0.75) : data.size;
      if (size > IMG_LIMIT) return { success: false, error: '이미지가 너무 큽니다(' + Math.round(size / 1024) + 'KB). 더 작은 사진을 선택해 주세요.' };
      const dataUrl = typeof data === 'string' ? 'data:' + (mime || 'image/jpeg') + ';base64,' + data : await blobToDataUrl(data);
      const ref = db.collection('data_images').doc();
      await ref.set({ name: safeName(name), mime: mime || 'image/jpeg', dataUrl, size, createdAt: new Date().toISOString() });
      return { success: true, item: { id: ref.id, url: dataUrl, name: safeName(name) } };
    } catch (e) { console.warn(e); return { success: false, error: String(e && e.message ? e.message : e) }; }
  };
  SERVER.reorderImages = async function (ids) {   // 시간표 이미지 순서 저장 (화면에 보이는 순서대로 0,1,2…)
    try { const batch = db.batch(); (ids || []).forEach((id, i) => { if (id) batch.update(db.collection('data_images').doc(id), { order: i }); }); await batch.commit(); return { success: true }; }
    catch (e) { return { success: false, error: e.toString() }; }
  };
  SERVER.deleteImage = async function (id) {
    try { await db.collection('data_images').doc(id).delete(); return { success: true }; } catch (e) { return { success: false, error: e.toString() }; }
  };

  // ===== Page 08 / 09 : 반별·강좌별 조회 =====
  // 일정 출처: 추가된 일정(add) / 전담 시간표(sub) / 체육 공간(gym)
  const EV_SOURCES = {
    add: { col: 'data_add_timetable', d: 'add_date', c: 'add_class', t: 'add_time', n: 'add_name' },
    sub: { col: 'data_sub_timetable', d: 'sub_date', c: 'sub_class', t: 'sub_time', n: 'sub_name' },
    gym: { col: 'data_gym_timetable', d: 'gym_date', c: 'gym_class', t: 'gym_time', n: 'gym_place' },
    room: { col: 'data_room_timetable', d: 'room_date', c: 'room_class', t: 'room_time', n: 'room_place' }
  };
  const csvList = (v) => str(v).split(',').map((x) => x.trim()).filter(Boolean);
  const josa = (w, pair) => { const [a, b] = pair.split('/'); const code = str(w).trim().slice(-1).charCodeAt(0); return code >= 0xAC00 && code <= 0xD7A3 ? (((code - 0xAC00) % 28) ? a : b) : b; };
  // 같은 날짜·같은 이름의 일정은 하나의 항목으로 묶어서 돌려줍니다.
  //  - 교시마다 학급 구성이 같으면 교시도 합칩니다. (예: 11월 2일 4·5교시 1, 4, 8, 9, 10반 심폐소생술 → 하나)
  //  - 교시마다 학급 구성이 다르면 같은 학급 구성끼리만 묶습니다.
  async function groupedEvents() {
    const byPeriod = new Map();
    for (const [source, def] of Object.entries(EV_SOURCES)) {
      (await getCol(def.col)).forEach((r) => {
        const d = toDate(r[def.d]), cls = str(r[def.c]).trim(); if (!d || !cls) return;
        const per = str(r[def.t]).trim(), name = str(r[def.n]).trim(); const k = source + '|' + ymd(d) + '|' + per + '|' + name;
        let g = byPeriod.get(k); if (!g) { g = { source, date: ymd(d), per, course: name, list: [] }; byPeriod.set(k, g); }
        if (g.list.indexOf(cls) < 0) g.list.push(cls);
      });
    }
    const merged = new Map();
    byPeriod.forEach((g) => {
      const cls = g.list.sort(natural); const k = g.source + '|' + g.date + '|' + g.course + '|' + cls.join(',');
      let m = merged.get(k); if (!m) { m = { source: g.source, date: g.date, course: g.course, classes: cls.join(', '), pers: [] }; merged.set(k, m); }
      csvList(g.per).forEach((p) => { if (m.pers.indexOf(p) < 0) m.pers.push(p); });
      if (!csvList(g.per).length && m.pers.indexOf('') < 0) m.pers.push('');
    });
    return [...merged.values()].map((m) => ({ date: m.date, classes: m.classes, periods: m.pers.sort(natural).join(', '), course: m.course, source: m.source }));
  }
  SERVER.getAllData = async function (isRefresh) {
    const page = (window.__GP_PAGE__ || '');
    try {
      if (isRefresh) fresh();
      const g = await generalCfg();
      if (page === 'p08') {
        const [hol, rawEvents] = await Promise.all([getHolidayMap(), groupedEvents()]);
        return { success: true, holidays: [...hol.entries()].map(([k, v]) => ({ date: k, name: v })), rawEvents, year: g.year, classCount: g.classNames.length, periods: await basicPeriods() };
      }
      // p09
      const [hol, add, allGroups] = await Promise.all([getHolidayMap(), getCol('data_add_timetable'), getCfg('course_groups', [])]);
      const sp = yearSpan(g.year); const groups = allGroups.filter((x) => x.year === undefined || x.year === null || Number(x.year) === g.year);   // 범주도 지금 학년도 것만
      const events = add.map((r) => ({ d: toDate(r.add_date), r })).filter((x) => x.d && x.d >= sp.start && x.d <= sp.end)   // 지금 학년도 날짜의 강좌만
        .map((x) => ({ date: ymd(x.d), classNm: str(x.r.add_class), period: str(x.r.add_time), course: str(x.r.add_name).trim() }));
      const dropdowns = [...new Set(events.map((e) => e.course).filter(Boolean))].sort(natural);
      const holidays = {}; hol.forEach((v, k) => { holidays[k] = v; });
      return { success: true, dropdowns, groups, specials: { all: '', partial1: '', partial2: '', partial3: '', partial4: '', partial5: '', partial6: '', partial7: '' }, events, holidays, year: g.year, periods: await basicPeriods() };
    } catch (e) { return { success: false, error: e.toString() }; }
  };
  SERVER.saveCourseGroups = async function (groups) {
    try {
      const prev = await getCfg('course_groups', []); const yr = (await loadGeneral()).year; const was = {};
      const isMine = (g) => g.year === undefined || g.year === null || Number(g.year) === yr; const others = prev.filter((g) => !isMine(g));
      prev.filter(isMine).forEach((g) => { if (g.createdAt) was[g.name] = g.createdAt; });
      const clean = (groups || []).map((x) => ({ name: str(x.name).trim(), courses: [...new Set((x.courses || []).map((c) => str(c).trim()).filter(Boolean))], createdAt: was[str(x.name).trim()] || x.createdAt || new Date().toISOString(), year: yr })).filter((x) => x.name);   // 학년도 표시
      await setCfg('course_groups', others.concat(clean)); return { success: true, groups: clean };
    } catch (e) { return { success: false, error: e.toString() }; }
  };
  // 수정/삭제/추가: 추가된 일정(add)만 고칩니다. 같은 일정으로 묶인 모든 반이 함께 바뀝니다. (전담·체육 공간 일정은 각자의 시간표 페이지에서 수정)
  SERVER.modifyScheduleData = async function (action, oldData, newData) {
    try {
      const source = (oldData && oldData.source) || 'add'; const def = EV_SOURCES[source]; if (!def) return { success: false, error: '알 수 없는 일정입니다.' };
      if (source === 'sub') return { success: false, error: '전담 시간표는 반별 일정에서 수정할 수 없습니다. 전담 시간표 페이지에서 수정해 주세요.' };
      if (source === 'gym') return { success: false, error: '체육 공간 일정은 특별실 시간표 페이지에서 수정해 주세요.' };
      fresh();
      const rows = await getCol(def.col);
      const tuples = (d) => { const out = []; if (!d) return out; csvList(d.classes).forEach((c) => csvList(d.periods).forEach((p) => out.push({ date: ymd(toDate(d.date)), cls: c, per: p, name: str(d.course).trim() }))); return out; };
      const key = (t) => [t.date, t.cls, t.per, t.name].join('|');
      const rowKey = (r) => { const d = toDate(r[def.d]); return key({ date: d ? ymd(d) : '', cls: str(r[def.c]).trim(), per: str(r[def.t]).trim(), name: str(r[def.n]).trim() }); };
      const byKey = new Map(); rows.forEach((r) => { const k = rowKey(r); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); });
      const oldT = tuples(oldData), newT = action === 'delete' ? [] : tuples(newData);
      const oldKeys = new Set(oldT.map(key)), newKeys = new Set(newT.map(key));
      if ((action === 'edit' || action === 'delete') && !oldT.some((t) => byKey.has(key(t)))) return { success: false, error: '해당 일정을 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.' };
      if (action !== 'delete' && !newT.length) return { success: false, error: '날짜, 학급, 교시, 내용을 모두 입력해 주세요.' };

      const ops = [];
      if (action !== 'add') oldT.forEach((t) => { const k = key(t); if (!newKeys.has(k)) (byKey.get(k) || []).forEach((r) => ops.push({ type: 'delete', col: def.col, id: r._id })); });
      newT.forEach((t) => {
        if (byKey.has(key(t))) return; const d = toDate(t.date);
        ops.push({ type: 'set', col: def.col, id: newId(def.col), data: { [def.d]: toTS(d), [def.c]: t.cls, [def.t]: t.per, [def.n]: t.name } });
      });
      await commit(ops); invalidate(def.col);
      return { success: true, rawEvents: await groupedEvents() };
    } catch (e) { return { success: false, error: e.toString() }; }
  };

  // ===== Page 10 : 내선번호 파일 =====
  // 내선번호 파일은 Firebase Storage 대신 Firestore(data_files)에 조각(약 450KB)으로 나눠 저장합니다. (카드 등록·Blaze 요금제 불필요)
  SERVER.getFileMetadata = async function () {
    const meta = await getCfg('ext_file', null);
    if (!meta) return { id: '', mimeType: 'image/png', name: '' };
    if (meta.updatedAt) { const sp = yearSpan((await loadGeneral()).year), d = new Date(meta.updatedAt); if (d < sp.start || d > sp.end) return { id: '', mimeType: 'image/png', name: '' }; }   // 지금 학년도에 올린 파일만
    if (meta.kind !== 'fs') return { id: meta.url, mimeType: meta.mimeType, name: meta.name };   // 예전에 Storage 에 올린 파일
    const parts = await Promise.all((meta.chunks || []).map((id) => db.collection('data_files').doc(id).get()));
    const b64 = parts.map((d) => (d.exists ? d.data().data : '')).join('');
    return { id: 'data:' + meta.mimeType + ';base64,' + b64, mimeType: meta.mimeType, name: meta.name };
  };
  SERVER.changeUserPassword = async function (adminPwd, newPwd) {
    const pw = await getPw();
    if (adminPwd !== pw.admin) return { success: false, message: '관리자 권한이 유효하지 않습니다.' };
    pw.access = newPwd; await setPw(pw);
    return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
  };
  const shrinkImage = (b64, mime) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { const k = Math.min(1, 2000 / Math.max(im.width, im.height)), w = Math.round(im.width * k), h = Math.round(im.height * k); const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h); res(c.toDataURL('image/jpeg', 0.82).split(',')[1]); };
    im.onerror = () => rej(new Error('이미지를 읽을 수 없습니다.')); im.src = 'data:' + mime + ';base64,' + b64;
  });
  SERVER.uploadFile = async function (adminPwd, base64, fileName, mime) {
    const pw = await getPw();
    if (adminPwd !== pw.admin) return { success: false, message: '관리자 권한이 유효하지 않습니다.' };
    try {
      mime = str(mime); const lower = str(fileName).toLowerCase();
      if (/\.xlsx?$/.test(lower) || /spreadsheetml|ms-excel/.test(mime)) return { success: false, message: '엑셀 파일은 올릴 수 없습니다. PDF나 이미지(캡처)로 저장해서 올려 주세요.' };
      if (!mime) mime = /\.xlsx$/.test(lower) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.pdf$/.test(lower) ? 'application/pdf' : '';
      const isImg = mime.indexOf('image/') === 0, isPdf = mime === 'application/pdf', isXlsx = /spreadsheetml\.sheet$/.test(mime);
      if (!isImg && !isPdf) return { success: false, message: 'PDF나 이미지 파일만 올릴 수 있습니다.' };
      if (isImg) { base64 = await shrinkImage(base64, mime); mime = 'image/jpeg'; }
      if (base64.length > 6000000) return { success: false, message: '파일이 너무 큽니다. (약 4.5MB 이하로 올려 주세요)' };
      const old = await getCfg('ext_file', null); const stamp = Date.now(), CH = 450000, ids = [], ops = [];
      for (let i = 0; i * CH < base64.length; i++) { const id = `ext_${stamp}_${i}`; ids.push(id); ops.push({ type: 'set', col: 'data_files', id, data: { data: base64.slice(i * CH, (i + 1) * CH), i, name: fileName } }); }
      await commit(ops);
      await setCfg('ext_file', { kind: 'fs', chunks: ids, mimeType: mime, name: fileName, size: base64.length, updatedAt: new Date().toISOString() });
      if (old && old.kind === 'fs' && old.chunks && old.chunks.length) { try { await commit(old.chunks.map((id) => ({ type: 'delete', col: 'data_files', id }))); } catch (e) { /* 남은 조각은 무시 */ } }
      else if (old && old.path && storage) { try { await storage.ref(old.path).delete(); } catch (e) { /* 이미 삭제됨 */ } }
      return { success: true, message: '새 파일이 정상적으로 교체 업로드되었습니다.', fileId: ids[0] };
    } catch (e) { return { success: false, message: '파일 업로드 실패: ' + e.toString() }; }
  };

  // ===== 교시 삭제·복원 =====
  //  교시를 지우면 그 교시 이름으로 입력된 데이터(기초시간표·일정·개방 설정)를 '이름〔앞 교시 뒤〕' 로 이름만 바꿔 숨겨 두고,
  //  같은 이름의 교시가 같은 앞 교시 바로 뒤에 다시 생기면 원래 이름으로 되돌립니다. 다른 자리에 같은 이름이 생겨도 숨겨진 데이터는 나오지 않습니다.
  const periodTomb = (name, prev) => `${name}〔${prev ? prev : '맨앞'} 뒤〕`;
  async function renamePeriodData(from, to) {
    if (!from || !to || from === to) return 0;
    const ops = []; const ln = legacyName(from);
    const swap = (v) => { let ch = false; const out = str(v).split(/[,，、]+/).map((t) => t.trim()).map((t) => (t === from ? (ch = true, to) : t)); return ch ? out.join(', ') : null; };
    for (const [col, f] of [['data_sub_timetable', 'sub_time'], ['data_add_timetable', 'add_time'], ['data_gym_timetable', 'gym_time'], ['data_room_timetable', 'room_time']]) {
      (await rawCol(col, true)).forEach((r) => { const n = swap(r[f]); if (n !== null) ops.push({ type: 'update', col, id: r._id, data: { [f]: n } }); });
    }
    (await rawCol('data_basic_timetable', true)).forEach((r) => {
      const cells = Object.assign({}, r.cells || {}); let ch = false;
      for (let c = 1; c <= 5; c++) {
        const nk = `${from}|${c}`, lk = ln ? `${ln}_${c}` : null;
        const has = cells[nk] !== undefined ? nk : (lk && cells[lk] !== undefined ? lk : null); if (!has) continue;
        const v = cells[has]; delete cells[nk]; if (lk) delete cells[lk]; if (cells[`${to}|${c}`] === undefined) cells[`${to}|${c}`] = v; ch = true;
      }
      if (ch) { const d = Object.assign({}, r); delete d._id; d.cells = cells; ops.push({ type: 'set', col: 'data_basic_timetable', id: r._id, data: d }); }
    });
    const snap = await db.collection('app_config').get();
    snap.docs.forEach((doc) => {
      if (!/^space_open_\d+$/.test(doc.id)) return;
      let o; try { o = JSON.parse(doc.data().json || '{}'); } catch (e) { return; } let ch = false;
      ['sem1', 'sem2'].forEach((k) => { const src = o[k] || {}, out = {}; Object.keys(src).forEach((key) => {
        let m = /^(\d)\|([^|]*)\|(.+)$/.exec(key), nk = key;
        if (m && m[2] === from) nk = `${m[1]}|${to}|${m[3]}`; else if (!m && ln && (m = /^(\d)_(\d+)_(.+)$/.exec(key)) && m[2] === ln) nk = `${m[1]}|${to}|${m[3]}`;
        if (nk !== key) ch = true; out[nk] = src[key]; }); o[k] = out; });
      ['exceptions', 'closeExceptions'].forEach((k) => { o[k] = (o[k] || []).map((e) => { const pv = str(e.period).trim(); if (pv === from || (ln && pv === ln)) { ch = true; return Object.assign({}, e, { period: to }); } return e; }); });
      if (ch) ops.push({ type: 'set', col: 'app_config', id: doc.id, data: { json: JSON.stringify(o), updatedAt: new Date().toISOString() } });
    });
    await commit(ops);
    ['data_sub_timetable', 'data_add_timetable', 'data_gym_timetable', 'data_room_timetable', 'data_basic_timetable'].forEach(invalidate);
    return ops.length;
  }

  // ===== 교실 배치도 이미지: Storage 대신 Firestore(data_files)에 조각으로 저장 (내선번호 파일과 같은 방식) =====
  async function classroomGet() {
    const meta = await getCfg('classroom_file', null); if (!meta || !meta.chunks) return '';
    if (meta.updatedAt) { const sp = yearSpan((await loadGeneral()).year), d = new Date(meta.updatedAt); if (d < sp.start || d > sp.end) return ''; }
    const parts = await Promise.all(meta.chunks.map((id) => db.collection('data_files').doc(id).get()));
    return 'data:' + meta.mimeType + ';base64,' + parts.map((d) => (d.exists ? d.data().data : '')).join('');
  }
  async function classroomPut(file) {
    const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = () => rej(new Error('파일을 읽을 수 없습니다.')); fr.readAsDataURL(file); });
    const small = await shrinkImage(b64, file.type || 'image/png');
    const old = await getCfg('classroom_file', null); const stamp = Date.now(), CH = 450000, ids = [], ops = [];
    for (let i = 0; i * CH < small.length; i++) { const id = `cls_${stamp}_${i}`; ids.push(id); ops.push({ type: 'set', col: 'data_files', id, data: { data: small.slice(i * CH, (i + 1) * CH), i, name: file.name } }); }
    await commit(ops);
    await setCfg('classroom_file', { chunks: ids, mimeType: 'image/jpeg', name: file.name, updatedAt: new Date().toISOString() });
    if (old && old.chunks && old.chunks.length) { try { await commit(old.chunks.map((id) => ({ type: 'delete', col: 'data_files', id }))); } catch (e) { /* 남은 조각은 무시 */ } }
  }

  // ===== Page 11 : 쇼핑몰 학교 ID =====
  SERVER.getAppConfig = async () => { const pw = await getPw(); return { userPw: pw.access, adminPw: pw.admin }; };
  SERVER.saveAppConfig = async (c) => { const pw = await getPw(); if (c.userPw) pw.access = c.userPw; if (c.adminPw) pw.admin = c.adminPw; await setPw(pw); return true; };
  SERVER.getData = async function () {
    return (await getCol('data_mall', true)).map((r) => ({ rowIndex: Number(r._id), mall: str(r.mall), id: str(r.id), pw: str(r.pw), url: str(r.url), note: str(r.note) }))
      .sort((a, b) => a.rowIndex - b.rowIndex);
  };
  const mallDoc = (f) => {
    let url = str(f.siteUrl).trim(); if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
    return { mall: str(f.mallName), id: str(f.mallId), pw: str(f.mallPw), url, note: str(f.note) };
  };
  SERVER.addData = async function (f) {
    const rows = await getCol('data_mall', true);
    const next = rows.reduce((m, r) => Math.max(m, Number(r._id) || 0), 5) + 1;
    await commit([{ type: 'set', col: 'data_mall', id: String(next), data: mallDoc(f) }]);
    return { success: true, message: '저장되었습니다.' };
  };
  SERVER.updateData = async function (rowIndex, f) {
    await commit([{ type: 'set', col: 'data_mall', id: String(rowIndex), data: mallDoc(f) }]);
    return { success: true, message: '저장되었습니다.' };
  };
  SERVER.deleteData = async function (rowIndex) {
    await commit([{ type: 'delete', col: 'data_mall', id: String(rowIndex) }]);
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
  window.GP = { periodTomb, parkPeriod: (n, prev) => renamePeriodData(n, periodTomb(n, prev)), restorePeriod: (n, prev) => renamePeriodData(periodTomb(n, prev), n), classroomGet, classroomPut, db, storage, TS, budgetLines, getCol, getColAll: rawCol, YEARED, yearSpan, curYear: async () => (await loadGeneral()).year, invalidate, getCfg, setCfg, getLists, toDate, ymd, appDate, isoLocal, addDays, eachDay, mondayOf, DAYS, num, str, natural, classNo, commit, newId, SERVER,
    getPw, setPw, readList, writeList, spaceOrphans, countSpaceData, purgeSpaceData, renameSpaceData, listSpaceData, deleteSpaceRows, fresh, resetCaches, DELETE, loadGeneral, saveGeneral, loadOpen, saveOpen, delCfg, yearNow, buildBudgetCards, buildInfo, getSubjectConfig, PUBLIC_HOLIDAYS, getSemesters, DEFAULT_HOURS };
})();
