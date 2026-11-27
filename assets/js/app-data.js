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
  // 기준 날짜: 오늘이 그 학년도(2/1 ~ 다음 해 2월 말일) 안이면 오늘, 아니면 그 학년도의 첫날(2월 1일)
  const baseDate = (y) => { const t = new Date(), d = new Date(t.getFullYear(), t.getMonth(), t.getDate()); if (!y) return d; const r = yearRange(Number(y)); return d >= r.start && d <= r.end ? d : r.start; };
  const yearOf = (d) => (d.getMonth() >= 1 ? d.getFullYear() : d.getFullYear() - 1);
  const inRange = (d, r) => d && d >= r.start && d <= r.end;

  const getGeneral = () => G.loadGeneral();                      // 학년도별 담임/전담교사 포함
  const saveGeneral = (g) => G.saveGeneral(g);
  // 학년도 변경: 이전 학년도 설정은 그대로 보관하고, 새 학년도의 담임/전담교사/공간 개방 설정은 비어 있는 상태로 시작
  // 이 기능이 생기기 전에 이미 학년도를 바꿔 둔 경우: 문서를 처음 만든 시각(REST createTime)으로 학년도를 추정해 한 번만 표시를 붙입니다.
  async function migrateYearTags() {
    if (G.gradePrefix) return false;   // 새로 만든 학년의 자료에는 예전 형식이 없음
    const flag = await getCfg('year_tag', null); if (flag && flag.done) return false;
    try { if (await G.secured()) { await setCfg('year_tag', { done: true, skipped: 'secured', at: new Date().toISOString() }); return false; } } catch (e) { /* 무시 */ }   // 보안 전환 뒤에는 작성일 조회(REST)가 막혀 매번 실패하며 시간만 씀 → 한 번만 표시하고 끝
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
  async function tagYear(y, newYear) { await commit(await tagYearOps(y, newYear)); }
  async function tagYearOps(y, newYear) {
    const ops = [];
    for (const col of G.YEARED) (await G.getColAll(col)).forEach((r) => {
      if (r._year !== undefined && r._year !== null) return;
      if (col === BT && /^class_\d+$/.test(r._id)) ops.push(...archiveOps(r, y)); else ops.push({ type: 'update', col, id: r._id, data: { _year: y } });
    });
    if (newYear) (await G.getColAll(BT)).forEach((r) => { const m = r._id.match(/^(class_\d+)__y(\d+)$/); if (m && Number(m[2]) === newYear) { const d = Object.assign({}, r); delete d._id; delete d._year; ops.push({ type: 'set', col: BT, id: m[1], data: d }, { type: 'delete', col: BT, id: r._id }); } });
    (await getCol('data_basic')).forEach((r) => { if (str(r.list_budget).trim() && (r.list_budget_year === undefined || r.list_budget_year === null || r.list_budget_year === '')) ops.push({ type: 'update', col: 'data_basic', id: r._id, data: { list_budget_year: y } }); });   // 예산 카드도 이전 학년도 것으로 표시
    const groups = await getCfg('course_groups', []);
    if (groups.some((g) => g.year === undefined || g.year === null)) ops.push(G.cfgOp('course_groups', groups.map((g) => (g.year === undefined || g.year === null ? Object.assign({}, g, { year: y }) : g))));
    return ops;
  }
  // 학년도 바꾸기: 필요한 저장을 모두 모아 한 번에 보냄(예전에는 저장을 15~20번 따로 해서 느렸음)
  async function setYear(year) {
    const cur = await G.loadGeneral(); const ops = await G.generalOps(cur);
    if (year !== cur.year) {
      ops.push(...(await G.freezeOps()));   // 떠나는 학년도의 교시·과목·교사·공간·주간시수를 그 학년도 것으로 고정
      if (!(await G.getCfg('space_open_' + cur.year, null))) ops.push(...G.openOps(cur.year, await G.loadOpen(cur.year)));   // 공간 개방 설정도 떠나는 학년도 것으로 고정
      ops.push(...(await tagYearOps(cur.year, year)));   // 명렬표·기초시간표·예산 등에 '이전 학년도' 표시(삭제 아님)
    }
    const raw = (await G.getCfg('general', {})) || {};
    ops.push(G.cfgOp('general', { year, grade: cur.grade, classCount: raw.classCount !== undefined ? raw.classCount : cur.classCount, classNames: Array.isArray(raw.classNames) ? raw.classNames : cur.classNames, legacyMigrated: true }));   // 학급 값은 학년도별(year_<학년도>)
    await commit(ops);
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
        const tsText = g.ts.join(', ');
        // 화면용: [반] [교시] [내용]을 따로 묶어, 좁은 화면에서 줄이 바뀌어도 교시·내용이 반 이름 오른쪽 칸에 맞춰 내려가게 함
        const html = '<div class="gp-ln lec-ln" data-cls="' + hesc(g.cls.filter(Boolean).join(',')) + '">' + (clsText ? '<span class="lec-c">' + hesc(clsText) + '</span>' : '') +
          '<span class="lec-r">' + (tsText ? '<span class="lec-t">' + hesc(tsText) + '</span> ' : '') + (name ? '<span class="lec-n">' + hesc(name) + '</span>' : '') + '</span></div>';
        items.push({ p: g.ts.length ? num(g.ts[0]) : 9999, c: g.cls.length ? num(g.cls[0]) : 9999, text: [clsText, tsText, name].filter(Boolean).join(' '), html });
      });
    });
    items.sort((a, b) => a.p - b.p || a.c - b.c || natural(a.text, b.text));
    return { text: items.map((x) => x.text).join('\n'), html: items.map((x) => x.html).join('') };
  }
  const hesc = (v) => str(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // 강사 일정 칸 모양 (홈·개요 표에서 사용)
  const LEC_CSS = '.lec-ln{display:flex;align-items:flex-start;gap:.3em;white-space:normal;word-break:keep-all}' +
    '.lec-c{flex:0 1 auto;max-width:45%;white-space:normal}.lec-r{flex:1 1 0;min-width:0}' +
    '.lec-t,.lec-n{display:inline-block;max-width:100%;vertical-align:top;white-space:normal;word-break:keep-all;overflow-wrap:anywhere}';
  if (typeof document !== 'undefined' && !document.getElementById('gp-lec-css')) { const st = document.createElement('style'); st.id = 'gp-lec-css'; st.textContent = LEC_CSS; (document.head || document.documentElement).appendChild(st); }

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
      out.push({ date: d, key: k, dow: d.getDay(), holiday: h ? h.name : '', isHoliday: !!h, school: lines.join('\n'), ...(() => { const L = lecturerText(lec[k] || []); return { lecturer: L.text, lecturerHtml: L.html }; })(), memo: (memo[k] || []).join('\n') });
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
  // 접기 상태(기기마다 기억): key → true 면 접힘
  const foldGet = (k, def) => { try { const v = localStorage.getItem('gp_fold_' + k); return v === null ? def : v === '1'; } catch (e) { return def; } };
  const foldSet = (k, on) => { try { localStorage.setItem('gp_fold_' + k, on ? '1' : '0'); } catch (e) { /* 무시 */ } };
  const CHEV = '<svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M5.2 7.2a.75.75 0 0 1 1.06 0L10 10.94l3.74-3.74a.75.75 0 1 1 1.06 1.06l-4.27 4.27a.75.75 0 0 1-1.06 0L5.2 8.26a.75.75 0 0 1 0-1.06z" clip-rule="evenodd"/></svg>';
  const FOLD_CSS = '<style>.gp-fold{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;color:#64748b;cursor:pointer;flex-shrink:0}.gp-fold:hover{background:#f1f5f9}.gp-fold svg{transition:transform .2s}.is-folded .gp-fold svg{transform:rotate(-90deg)}' +
    '.dc-bar{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:8px 10px 8px 14px;cursor:pointer;box-shadow:0 2px 10px rgba(15,23,42,.04)}.dc-bar b{font-size:14px;color:#0f172a;white-space:nowrap}.dc-sum{flex:1;min-width:0;font-size:12.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-body{margin-top:10px}.is-folded .dc-body{display:none}</style>';
  async function renderDayCards(box, year, opt) {
    const v = await getVacations(year); const today = new Date();
    const card = (cls, title, main, sub, subId) => '<div class="gpcard ' + cls + '"><div class="gpt">' + title + '</div><div class="gpd">' + main + '</div>' + sub + '</div>';
    const vac = (title, cls, d) => card(cls, title, d ? fmtDate(d) : '-', d ? '<span class="gpp">' + dday(d) + '</span>' : '<span class="gpp">일정 없음</span>');
    box.innerHTML = '<style>.gpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}' +
      '.gpcard{border-radius:18px;padding:18px 10px;text-align:center;box-shadow:0 2px 10px rgba(15,23,42,.06);border:1px solid rgba(255,255,255,.8)}' +
      '.gpt{font-size:13px;font-weight:600;margin-bottom:6px}.gpd{font-size:22px;font-weight:800;letter-spacing:-.3px}' +
      '.gpp{display:inline-block;margin-top:8px;padding:2px 12px;border-radius:999px;background:rgba(255,255,255,.8);font-size:12px;font-weight:700}' +
      '.gptime{margin-top:6px;font-size:14px;font-weight:700}' +
      // 좁은 화면: 세 카드를 한 줄에 두고 글자·여백을 줄임 (아주 좁으면 한 줄에 하나씩)
      '@media (max-width:640px){.gpgrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.gpcard{padding:12px 4px;border-radius:14px}.gpt{font-size:11px;margin-bottom:4px}.gpd{font-size:clamp(12px,3.8vw,18px);letter-spacing:-.4px;line-height:1.25;word-break:keep-all}.gpp{margin-top:6px;padding:1px 7px;font-size:10.5px}.gptime{font-size:11.5px;margin-top:4px}}' +
      '@media (max-width:300px){.gpgrid{grid-template-columns:minmax(0,1fr)}.gpd{font-size:18px}}' +
      '.gpc1{background:linear-gradient(135deg,#ecfdf5,#ccfbf1);color:#134e4a}.gpc1 .gpt{color:#3f6f6a}' +
      '.gpc2{background:linear-gradient(135deg,#fff7ed,#fef3c7);color:#7c2d12}.gpc2 .gpt{color:#9a5b3a}' +
      '.gpc3{background:linear-gradient(135deg,#eff6ff,#e0e7ff);color:#312e81}.gpc3 .gpt{color:#5b5fa8}</style>' +
      '<div class="gpgrid">' + card('gpc1', '오늘 날짜', fmtDate(today), '<div class="gptime" id="gp-clock">' + clockText() + '</div>') +
      vac('여름방학식', 'gpc2', v.summer) + vac('겨울방학식', 'gpc3', v.winter) + '</div>';
    if (opt && opt.fold) {   // 홈: 한 줄 막대로 접어 두고 누르면 펼침 (기본 접힘)
      const sum = [fmtDate(today)].concat(v.summer ? ['여름방학식 ' + dday(v.summer)] : [], v.winter ? ['겨울방학식 ' + dday(v.winter)] : []).join(' · ');
      const inner = box.innerHTML; const key = opt.fold;
      box.innerHTML = FOLD_CSS + '<div class="dc-wrap' + (foldGet(key, true) ? ' is-folded' : '') + '"><div class="dc-bar" role="button" tabindex="0" aria-label="날짜 카드 접기/펼치기"><b>📅 날짜</b><span class="dc-sum">' + sum + '</span><span class="gp-fold">' + CHEV + '</span></div><div class="dc-body">' + inner + '</div></div>';
      const w = box.querySelector('.dc-wrap'), bar = box.querySelector('.dc-bar');
      const tg = () => { const on = !w.classList.contains('is-folded'); w.classList.toggle('is-folded', on); foldSet(key, on); bar.setAttribute('aria-expanded', String(!on)); };
      bar.setAttribute('aria-expanded', String(!w.classList.contains('is-folded'))); bar.onclick = tg; bar.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tg(); } };
    }
    clearInterval(box._t); box._t = setInterval(() => { const c = box.querySelector('#gp-clock'); if (c) c.textContent = clockText(); }, 15000);
  }

  // ------------------------------------------------------------ 학년도 진행 현황 (홈: 날짜 카드 아래)
  //  막대: [1학기 시작 ~ 1학기 종료] [여름방학] [2학기 시작 ~ 2학기 종료]. 학기 부분은 날짜 수에 비례, 여름방학은 글씨가 들어가도록 일정한 폭.
  //  수업일 = 학기 기간 안의 평일 중 휴일이 아닌 날. 걸어가는 사람이 오늘 위치에 있습니다.
  // 기본 걷는 사람 (오른쪽을 보고 팔다리를 번갈아 흔듦)
  const DEF_WALKER = '<svg viewBox="0 0 40 56" width="34" height="48" aria-hidden="true"><g class="tp-bob">' +
      '<g class="tp-leg tp-l1"><rect x="16" y="33" width="6" height="16" rx="3" fill="#1d4ed8"/><rect x="15" y="47" width="10" height="5" rx="2.5" fill="#1e3a8a"/></g>' +
      '<g class="tp-leg tp-l2"><rect x="18" y="33" width="6" height="16" rx="3" fill="#2563eb"/><rect x="17" y="47" width="10" height="5" rx="2.5" fill="#1e40af"/></g>' +
      '<g class="tp-arm tp-a1"><rect x="10" y="19" width="5" height="13" rx="2.5" fill="#1d4ed8"/></g>' +
      '<rect x="12" y="17" width="16" height="19" rx="5" fill="#3b82f6"/><rect x="14" y="25" width="12" height="2" rx="1" fill="#fff" opacity=".9"/>' +
      '<g class="tp-arm tp-a2"><rect x="25" y="19" width="5" height="13" rx="2.5" fill="#2563eb"/></g>' +
      '<circle cx="20" cy="9" r="7.5" fill="#fcd9b6"/><path d="M12.5 9.5a7.5 7.5 0 0 1 14.6-3.2c-3.6-.9-7.2.2-9.3 2.9-.6 1.6-1.3 3.4-2.6 4.3-1.3-.9-2.4-2.3-2.7-4z" fill="#1e293b"/><circle cx="24" cy="9.5" r="1" fill="#1e293b"/><path d="M23 13c1 .6 2 .6 3 0" stroke="#c2410c" stroke-width=".9" fill="none" stroke-linecap="round"/></g></svg>';
  // 걷는 사람 그림: 이 브라우저에만 저장(IndexedDB). 사람마다 자기가 올린 그림을 골라 씀 — 다른 사람·다른 기기에는 영향 없음
  //  목록: 기본 그림 + 내가 올린 그림 최대 19개(합쳐서 20개). 고른 그림은 localStorage(gp_walker_sel)에 기억
  const WALK_LIMIT = 19, WALK_MAX = 2 * 1024 * 1024;
  function walkDb() {
    return new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error('이 브라우저는 그림 저장을 지원하지 않습니다.'));
      const r = indexedDB.open('gp_walkers', 1); r.onupgradeneeded = () => { r.result.createObjectStore('items', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('그림 저장소를 열 수 없습니다.')); });
  }
  async function walkTx(mode, fn) { const db = await walkDb(); return new Promise((res, rej) => { const t = db.transaction('items', mode), st = t.objectStore('items'); let out; Promise.resolve(fn(st)).then((v) => { out = v; }); t.oncomplete = () => { db.close(); res(out); }; t.onerror = () => { db.close(); rej(t.error); }; }); }
  const walkList = () => walkTx('readonly', (st) => new Promise((res) => { const q = st.getAll(); q.onsuccess = () => res((q.result || []).sort((a, b) => a.at - b.at)); q.onerror = () => res([]); })).catch(() => []);
  const walkSel = (v) => { try { if (v === undefined) return localStorage.getItem('gp_walker_sel') || 'default'; localStorage.setItem('gp_walker_sel', v); } catch (e) { return 'default'; } return v; };
  async function walkerSrc() { const sel = walkSel(); if (sel === 'default') return ''; const it = (await walkList()).find((x) => x.id === sel); return it ? it.src : ''; }
  const fileToDataUrl = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('파일을 읽을 수 없습니다.')); r.readAsDataURL(f); });
  async function shrinkStill(dataUrl) {   // 움직이지 않는 그림은 높이 120px 로 줄여 저장
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('그림을 열 수 없습니다.')); i.src = dataUrl; });
    const k = Math.min(1, 120 / im.height), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/png');
  }
  function walkerDialog(defSvg, onDone) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const old = document.getElementById('tpDlg'); if (old) old.remove();
    const m = document.createElement('div'); m.id = 'tpDlg'; m.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50'; m.style.zIndex = '250';
    m.innerHTML = '<style>.wk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px;max-height:46vh;overflow-y:auto;padding:2px}' +
      '.wk-t{position:relative;height:84px;border:2px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:repeating-conic-gradient(#f1f5f9 0 25%,#fff 0 50%) 0 0/14px 14px}' +
      '.wk-t:hover{border-color:#a5b4fc}.wk-t.on{border-color:#4f46e5;box-shadow:0 0 0 3px #e0e7ff}.wk-t img{max-height:60px;max-width:66px;object-fit:contain}' +
      '.wk-x{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:999px;border:0;background:rgba(15,23,42,.6);color:#fff;font-size:12px;line-height:20px;cursor:pointer}.wk-x:hover{background:#dc2626}' +
      '.wk-add{border-style:dashed;background:#fff;color:#4f46e5;font-size:12px;font-weight:700;flex-direction:column;gap:2px}.wk-on{position:absolute;left:4px;bottom:3px;font-size:10px;font-weight:800;color:#4f46e5;background:#fff;border-radius:6px;padding:0 4px}</style>' +
      '<div class="bg-white rounded-2xl p-5 w-full max-w-lg space-y-3 shadow-xl" role="dialog" aria-modal="true"><h3 class="font-bold text-lg">걷는 사람 그림</h3>' +
      '<p class="text-sm text-slate-600">누른 그림으로 바로 바뀝니다. <b>이 브라우저에만</b> 저장되어 나에게만 보입니다(다른 사람·다른 기기는 그대로). 움직이는 <b>GIF</b>도 그대로 움직입니다.</p>' +
      '<div class="wk-grid" id="wkGrid"></div><p class="text-xs text-slate-400" id="wkInfo"></p><p id="wkErr" class="text-sm text-red-600" style="display:none"></p>' +
      '<div class="flex justify-end"><button id="wkClose" type="button" class="px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">닫기</button></div></div>';
    document.body.appendChild(m);
    const q = (id) => m.querySelector('#' + id), err = (t) => { q('wkErr').textContent = t || ''; q('wkErr').style.display = t ? '' : 'none'; };
    const close = () => { document.removeEventListener('keydown', key); m.remove(); }; const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key); m.addEventListener('mousedown', (e) => { if (e.target === m) close(); }); q('wkClose').onclick = close;
    async function draw() {
      const list = await walkList(), sel = walkSel(), full = list.length >= WALK_LIMIT;
      q('wkGrid').innerHTML = '<div class="wk-t' + (sel === 'default' || !list.some((x) => x.id === sel) ? ' on' : '') + '" data-id="default" title="기본 그림">' + defSvg + '<span class="wk-on">기본</span></div>' +
        list.map((x) => '<div class="wk-t' + (x.id === sel ? ' on' : '') + '" data-id="' + esc(x.id) + '" title="' + esc(x.name || '') + '"><img src="' + esc(x.src) + '" alt=""><button type="button" class="wk-x" data-del="' + esc(x.id) + '" aria-label="이 그림 지우기">✕</button></div>').join('') +
        (full ? '' : '<div class="wk-t wk-add" id="wkAdd" role="button" tabindex="0"><span style="font-size:22px;line-height:1">＋</span>그림 추가</div>');
      q('wkInfo').textContent = '기본 그림 + 내 그림 ' + list.length + '/' + WALK_LIMIT + '개 · 그림 1개당 2MB까지' + (full ? ' · 목록이 가득 찼습니다(✕로 지우면 더 추가할 수 있음)' : '');
      m.querySelectorAll('.wk-t[data-id]').forEach((t) => { t.onclick = (e) => { if (e.target.closest('.wk-x')) return; walkSel(t.dataset.id); draw(); onDone(); }; });
      m.querySelectorAll('.wk-x').forEach((b) => { b.onclick = async (e) => { e.stopPropagation(); const id = b.dataset.del; await walkTx('readwrite', (st) => { st.delete(id); }); if (walkSel() === id) walkSel('default'); draw(); onDone(); }; });
      const add = q('wkAdd'); if (add) add.onclick = pick;
    }
    function pick() {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      inp.onchange = async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return; err('');
        try {
          const moving = /gif|webp|apng/i.test(f.type) || /\.(gif|webp|apng)$/i.test(f.name);
          if (f.size > WALK_MAX && moving) return err('파일이 너무 큽니다(' + Math.round(f.size / 1024) + 'KB). 2MB 이하로 올려 주세요.');
          let src = await fileToDataUrl(f); if (!moving) src = await shrinkStill(src);
          const id = 'w' + Date.now().toString(36); await walkTx('readwrite', (st) => { st.put({ id, src, name: f.name, at: Date.now() }); });
          walkSel(id); draw(); onDone();
        } catch (e) { err('저장하지 못했습니다: ' + (e.message || e)); } };
      document.body.appendChild(inp); inp.click();
    }
    draw();
  }
  async function renderTermProgress(box, year) {
    if (!box) return;
    const [sem, hol, wsrc] = await Promise.all([getSemesterRows(year), holidayMap(), walkerSrc().catch(() => '')]);
    const s1 = sem['1학기'], s2 = sem['2학기'];
    if (!s1 || !s2 || !s1.start || !s1.end || !s2.start || !s2.end) { box.innerHTML = '<div class="tp-card"><p class="tp-empty">관리자 › 학년도 설정에서 1학기·2학기 기간을 입력하면 학년도 진행 현황이 보입니다.</p></div>' + TP_CSS; return; }
    const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isSchool = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !hol.has(ymd(d));
    const count = (a, b) => { let n = 0; if (b < a) return 0; for (const d of eachDay(a, b)) if (isSchool(d)) n++; return n; };
    const tot1 = count(s1.start, s1.end), tot2 = count(s2.start, s2.end), total = tot1 + tot2;
    const past = count(s1.start, today < s1.end ? today : s1.end) + (today >= s2.start ? count(s2.start, today < s2.end ? today : s2.end) : 0);
    const left = Math.max(0, total - past), pct = total ? Math.round(past / total * 100) : 0;
    const days = (a, b) => Math.round((b - a) / 86400000);
    // 지금 어디쯤인지
    let state, dLabel, dTarget;
    if (today < s1.start) { state = '개학 전'; dLabel = '1학기 개학까지'; dTarget = s1.start; }
    else if (today <= s1.end) { state = '1학기 진행 중'; dLabel = '1학기 종료까지'; dTarget = s1.end; }
    else if (today < s2.start) { state = '여름방학 중'; dLabel = '2학기 개학까지'; dTarget = s2.start; }
    else if (today <= s2.end) { state = '2학기 진행 중'; dLabel = '2학기 종료까지'; dTarget = s2.end; }
    else { state = '2학기 종료'; dLabel = '2학기 종료'; dTarget = s2.end; }
    // 막대 위의 위치(%)
    const GAP = 14, len1 = days(s1.start, s1.end) + 1, len2 = days(s2.start, s2.end) + 1, w1 = (100 - GAP) * len1 / (len1 + len2), w2 = 100 - GAP - w1;
    const clamp = (x) => Math.max(0, Math.min(1, x));
    const pos = today < s1.start ? 0 : today <= s1.end ? w1 * clamp((days(s1.start, today) + 0.5) / len1) : today < s2.start ? w1 + GAP * clamp((days(s1.end, today)) / Math.max(1, days(s1.end, s2.start))) : today <= s2.end ? w1 + GAP + w2 * clamp((days(s2.start, today) + 0.5) / len2) : 100;
    const md = (d) => (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    const dd = today > s2.end ? '종료' : dday(dTarget, now);
    const walker = wsrc ? '<img class="tp-img" src="' + wsrc.replace(/"/g, '&quot;') + '" alt="">' : DEF_WALKER;
    box.innerHTML = TP_CSS + FOLD_CSS + '<div class="tp-card' + (foldGet('tp', false) ? ' is-folded' : '') + '"><div class="tp-head"><div class="tp-title">' + year + '학년도 진행 현황</div><span class="tp-mini">' + pct + '% · ' + state + '</span><button type="button" class="tp-gear" title="걷는 사람 그림 바꾸기" aria-label="진행 현황 설정"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.2 2.5h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7v-.2a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/></svg></button><button type="button" class="gp-fold tp-fold" title="접기/펼치기" aria-label="진행 현황 접기/펼치기">' + CHEV + '</button></div><div class="tp-body">' +
      '<div class="tp-top"><div class="tp-pct"><b>' + pct + '</b><span>%</span><em class="tp-chip">' + state + '</em></div>' +
      '<div class="tp-stats"><div class="tp-stat"><i>지난 수업일</i><b>' + past + '<small>/' + total + '일</small></b></div><div class="tp-stat"><i>남은 수업일</i><b>' + left + '<small>일</small></b></div><div class="tp-stat"><i>' + dLabel + '</i><b>' + dd + '</b></div></div></div>' +
      '<div class="tp-track-wrap"><div class="tp-walker" style="left:' + pos.toFixed(2) + '%">' + walker + '</div>' +
      '<div class="tp-track"><div class="tp-seg tp-s1" style="width:' + w1.toFixed(2) + '%"><i style="width:' + (clamp(pos / w1) * 100).toFixed(2) + '%"></i></div>' +
      '<div class="tp-seg tp-gap" style="width:' + GAP + '%"><i style="width:' + (clamp((pos - w1) / GAP) * 100).toFixed(2) + '%"></i><span>여름방학</span></div>' +
      '<div class="tp-seg tp-s2" style="width:' + w2.toFixed(2) + '%"><i style="width:' + (clamp((pos - w1 - GAP) / w2) * 100).toFixed(2) + '%"></i></div></div></div>' +
      '<div class="tp-labels"><span class="tp-lb" style="left:0"><small>1학기 시작</small>' + md(s1.start) + '</span>' +
      '<span class="tp-lb tp-r" style="right:' + (100 - w1).toFixed(2) + '%"><small>1학기 종료</small>' + md(s1.end) + '</span>' +
      '<span class="tp-lb" style="left:' + (w1 + GAP).toFixed(2) + '%"><small>2학기 시작</small>' + md(s2.start) + '</span>' +
      '<span class="tp-lb tp-r" style="right:0"><small>2학기 종료</small>' + md(s2.end) + '</span></div></div></div>';
    const card = box.querySelector('.tp-card'), fb = box.querySelector('.tp-fold');
    // 윗줄(제목 줄) 어디를 눌러도 접고 펼침 (⚙ 설정 버튼은 제외)
    const head = box.querySelector('.tp-head'), tg = () => { const on = !card.classList.contains('is-folded'); card.classList.toggle('is-folded', on); foldSet('tp', on); if (fb) fb.setAttribute('aria-expanded', String(!on)); };
    if (fb) { fb.setAttribute('aria-expanded', String(!card.classList.contains('is-folded'))); fb.onclick = (e) => { e.stopPropagation(); tg(); }; }
    if (head) { head.style.cursor = 'pointer'; head.onclick = (e) => { if (e.target.closest('.tp-gear')) return; tg(); }; }
    const gear = box.querySelector('.tp-gear'); if (gear) gear.onclick = (e) => { e.stopPropagation(); walkerDialog(DEF_WALKER, () => renderTermProgress(box, year)); };
  }
  const TP_CSS = '<style>' +
    '.tp-card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px 20px 14px;box-shadow:0 2px 10px rgba(15,23,42,.05)}' +
    '.tp-head{display:flex;align-items:center;gap:6px}.tp-fold{margin-left:auto}.tp-mini{display:none;min-width:0;font-size:12.5px;font-weight:700;color:#4f46e5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-gear{flex-shrink:0}.is-folded .tp-mini{display:inline}.is-folded .tp-body{display:none}.tp-card.is-folded{padding-bottom:18px}.tp-gear{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;border:1px solid #e0e7ff;background:#eef2ff;color:#4f46e5;cursor:pointer}.tp-gear:hover{background:#e0e7ff}' +
    '.tp-img{display:block;height:48px;width:auto;max-width:90px;object-fit:contain}' +
    '.tp-title{font-size:16px;font-weight:800;color:#0f172a;white-space:nowrap}.tp-empty{font-size:13px;color:#94a3b8;text-align:center;padding:8px}' +
    '.tp-top{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:12px;margin-top:10px}' +
    '.tp-pct{display:flex;align-items:baseline;gap:4px}.tp-pct b{font-size:44px;font-weight:900;line-height:1;color:#0f172a;letter-spacing:-1px}.tp-pct span{font-size:16px;font-weight:700;color:#475569}' +
    '.tp-chip{font-style:normal;margin-left:10px;align-self:center;padding:3px 10px;border-radius:999px;background:#f1f5f9;border:1px solid #e2e8f0;font-size:12px;font-weight:700;color:#334155;white-space:nowrap}' +
    '.tp-stats{display:flex;gap:8px;flex-wrap:wrap}.tp-stat{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:8px 14px;min-width:96px}' +
    '.tp-stat i{display:block;font-style:normal;font-size:11.5px;color:#64748b;font-weight:600}.tp-stat b{font-size:20px;font-weight:800;color:#0f172a}.tp-stat small{font-size:12px;font-weight:600;color:#64748b;margin-left:1px}' +
    '.tp-track-wrap{position:relative;margin-top:14px;padding-top:50px}' +
    '.tp-track{display:flex;height:22px;border-radius:999px;overflow:hidden;background:#e5e7eb}' +
    '.tp-seg{position:relative;height:100%;background:#e5e7eb}.tp-seg>i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#3b82f6,#2563eb)}' +
    '.tp-gap{background:repeating-linear-gradient(135deg,#fef3c7 0 6px,#fde68a 6px 12px);border-left:2px solid #fff;border-right:2px solid #fff}' +
    '.tp-gap>i{background:repeating-linear-gradient(135deg,#fbbf24 0 6px,#f59e0b 6px 12px);opacity:.75}' +
    '.tp-gap span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#92400e;white-space:nowrap;overflow:hidden}' +
    '.tp-walker{position:absolute;top:2px;transform:translateX(-50%);transition:left .6s ease}' +
    '.tp-labels{position:relative;height:34px;margin-top:6px;font-size:12px;color:#475569;font-weight:600}' +
    '.tp-lb{position:absolute;top:0;white-space:nowrap;line-height:1.25}.tp-lb small{display:block;font-size:10.5px;color:#94a3b8;font-weight:600}.tp-r{text-align:right}' +
    // 걷는 모습: 다리·팔을 번갈아 흔들고 몸을 살짝 위아래로
    '@keyframes tpLeg{0%,100%{transform:rotate(22deg)}50%{transform:rotate(-22deg)}}@keyframes tpBob{0%,50%,100%{transform:translateY(0)}25%,75%{transform:translateY(-1.5px)}}' +
    '.tp-leg,.tp-arm{transform-box:fill-box;transform-origin:50% 0}.tp-l1,.tp-a2{animation:tpLeg .8s ease-in-out infinite}.tp-l2,.tp-a1{animation:tpLeg .8s ease-in-out -.4s infinite}.tp-bob{animation:tpBob .8s ease-in-out infinite}' +
    '@media (prefers-reduced-motion:reduce){.tp-leg,.tp-arm,.tp-bob{animation:none}}' +
    '@media (max-width:640px){.tp-card{padding:14px 12px 10px}.tp-pct b{font-size:36px}.tp-stats{width:100%}.tp-stat{flex:1 1 0;min-width:0;padding:6px 8px}.tp-stat b{font-size:17px}.tp-stat i{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tp-labels{font-size:11px}.tp-lb small{font-size:9.5px}}' +
    '</style>';

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
    const r = yearRange(year);   // (저장할 때마다 사본이 갱신되므로 매번 서버를 다시 확인하지 않음)
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
    try { G.storage.setMaxOperationRetryTime(8000); } catch (e) { /* 무시 */ }   // 저장소가 없거나 막혀 있으면 오래 다시 시도하지 않음
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
    // ex: { rows: 엑셀로 내려받을 줄 목록, files: async () => [{ name, dataUrl | blob }] (내려받을 파일) }
    const add = (key, count, ops, after, ex) => plan.push(Object.assign({ key, label: YEAR_ITEMS.find((x) => x[0] === key)[1], count, ops: ops || [], after, rows: [], files: null }, ex || {}));
    const dateCol = { school: ['data_task_school', 'task_school_date_start'], memo: ['data_task_memo', 'task_memo_date_start'], add: ['data_add_timetable', 'add_date'], sub: ['data_sub_timetable', 'sub_date'], gym: ['data_gym_timetable', 'gym_date'], room: ['data_room_timetable', 'room_date'] };
    for (const [k, [c, f]] of Object.entries(dateCol)) { const hit = (await getCol(c)).filter((x) => inRange(toDate(x[f]), r)); add(k, hit.length, hit.map((x) => ({ type: 'delete', col: c, id: x._id })), null, { rows: hit }); }
    const basic = await getCol('data_basic'); const semRows = basic.filter((x) => str(x.semester).trim() && inRange(toDate(x.semester_start_date), r)); const holRows = basic.filter((x) => str(x.holiday).trim() && inRange(toDate(x.holiday_start_date), r));
    const sops = []; semRows.forEach((x) => sops.push(...basicStripOps([x], ['semester', 'semester_start_date', 'semester_end_date']))); holRows.forEach((x) => { if (!semRows.includes(x)) sops.push(...basicStripOps([x], ['holiday', 'holiday_start_date', 'holiday_end_date'])); });
    add('sem', semRows.length + holRows.length, sops, null, { rows: semRows.map((x) => ({ 구분: '학기', 이름: x.semester, 시작일: x.semester_start_date, 종료일: x.semester_end_date }))
      .concat(holRows.map((x) => ({ 구분: '방학·휴일', 이름: x.holiday, 시작일: x.holiday_start_date, 종료일: x.holiday_end_date }))) });
    const cfgs = (await getCol('app_config')).filter((x) => x._id === 'year_' + year || x._id === 'space_open_' + year); add('cfg', cfgs.length, cfgs.map((x) => ({ type: 'delete', col: 'app_config', id: x._id })), null, { rows: cfgRows(cfgs) });
    const groups = await getCfg('course_groups', []); const mineG = (g) => (g.year === undefined || g.year === null ? cur : Number(g.year)) === year; const keepG = groups.filter((g) => !mineG(g));
    add('groups', groups.length - keepG.length, groups.length !== keepG.length ? [{ type: 'set', col: 'app_config', id: 'course_groups', data: { json: JSON.stringify(keepG), updatedAt: new Date().toISOString() } }] : [], null, { rows: groups.filter(mineG) });
    const yeared = async (col) => (await G.getColAll(col)).filter((x) => (x._year === undefined || x._year === null ? cur : Number(x._year)) === year);
    const stu = await yeared('data_student'); add('student', stu.length, stu.map((x) => ({ type: 'delete', col: 'data_student', id: x._id })), null, { rows: stu });
    const btt = await yeared('data_basic_timetable'); add('basictt', btt.length, btt.map((x) => ({ type: 'delete', col: 'data_basic_timetable', id: x._id })), null, { rows: btt });
    const bud = await yeared('data_budget'), shr = await yeared('data_sheet_rows');
    const cards = (await getCol('data_basic')).filter((x) => str(x.list_budget).trim() && Number(x.list_budget_year) === year && Object.keys(x).every((k) => k === '_id' || /^list_budget/.test(k)));   // 그 학년도 예산 카드(다른 값이 섞인 줄은 건드리지 않음)
    add('budget', bud.length + shr.length + cards.length, bud.map((x) => ({ type: 'delete', col: 'data_budget', id: x._id })).concat(shr.map((x) => ({ type: 'delete', col: 'data_sheet_rows', id: x._id }))).concat(cards.map((x) => ({ type: 'delete', col: 'data_basic', id: x._id }))), null,
      { rows: bud.map((x) => Object.assign({ 구분: '예산 내역' }, x)).concat(shr.map((x) => Object.assign({ 구분: '추가한 예산 페이지' }, x)), cards.map((x) => Object.assign({ 구분: '예산 카드' }, x))) });
    const sup = (await getCol('data_supply')).filter((x) => { const m = str(x.supply_year).match(/\d{4}/); return !!m && parseInt(m[0], 10) === year; }); add('supply', sup.length, sup.map((x) => ({ type: 'delete', col: 'data_supply', id: x._id })), null, { rows: sup });
    const ovs = (await getCol('data_overview')).filter((x) => x._id === 'r5_' + year); add('overview', ovs.length, ovs.map((x) => ({ type: 'delete', col: 'data_overview', id: x._id })), null, { rows: cfgRows(ovs) });
    // 시간이 오래 걸릴 수 있는 확인(이미지·첨부파일·Storage)은 제한 시간을 두고 한꺼번에 돌립니다. 시간이 넘으면 그 항목만 '확인 못 함'.
    const LIMIT = 15000, TIMEOUT = {};
    const within = (p) => Promise.race([p, new Promise((res) => setTimeout(() => res(TIMEOUT), LIMIT))]);
    const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const docsIn = async (col) => {   // 그 학년도 기간에 만든 문서만 서버에서 골라 받음(전부 내려받지 않음). 안 되면 전체를 받아 거름
      try { const q = GP.db.collection(col).where('createdAt', '>=', iso(r.start)).where('createdAt', '<', iso(addDays(r.end, 1))); return (await q.get()).docs.filter((d) => created(new Date(d.data().createdAt || 0))); }
      catch (e) { try { return (await GP.db.collection(col).get()).docs.filter((d) => created(new Date(d.data().createdAt || 0))); } catch (e2) { return []; } }
    };
    const stFiles = (folders) => Promise.all(folders.map((f) => storageFilesIn(f, r).catch(() => []))).then((a) => [].concat(...a));
    const [imgs, atts, cls, oth] = await Promise.all([within(docsIn('data_images')), within(docsIn('data_files')), within(stFiles(['classroom'])), within(stFiles(['special_room', 'extension', 'budget']))]);
    const timedOut = (x) => x === TIMEOUT;
    const docFiles = (list) => ({ rows: list.map((d) => ({ 파일이름: d.data().name || d.id, 올린날짜: d.data().createdAt || '' })), files: async () => list.map((d) => ({ name: d.data().name || d.id, dataUrl: d.data().dataUrl || '' })).filter((f) => f.dataUrl) });
    if (timedOut(imgs)) add('images', -1); else add('images', imgs.length, [], async () => { for (const d of imgs) await d.ref.delete(); }, docFiles(imgs));
    if (timedOut(atts)) add('atts', -1); else add('atts', atts.length, [], async () => { for (const d of atts) await d.ref.delete(); }, docFiles(atts));
    const ext = await getCfg('ext_file', null); const extHit = !!(ext && ext.updatedAt && created(new Date(ext.updatedAt)));
    add('ext', extHit ? 1 : 0, extHit ? [{ type: 'delete', col: 'app_config', id: 'ext_file' }].concat((ext.chunks || []).map((id) => ({ type: 'delete', col: 'data_files', id }))) : [], null,
      extHit ? { rows: [{ 파일이름: ext.name || '', 올린날짜: ext.updatedAt || '' }], files: async () => [await chunkFile(ext)].filter(Boolean) } : null);
    const cf = await getCfg('classroom_file', null); const cfHit = !!(cf && cf.updatedAt && created(new Date(cf.updatedAt)));
    const clsList = timedOut(cls) ? [] : cls;
    add('classroom', cls === TIMEOUT && !cfHit ? -1 : clsList.length + (cfHit ? 1 : 0), cfHit ? [{ type: 'delete', col: 'app_config', id: 'classroom_file' }].concat((cf.chunks || []).map((id) => ({ type: 'delete', col: 'data_files', id }))) : [], async () => { for (const it of clsList) await it.delete(); },
      { rows: (cfHit ? [{ 파일이름: cf.name || '', 올린날짜: cf.updatedAt || '' }] : []).concat(clsList.map((it) => ({ 파일이름: it.name, 올린날짜: '' }))), files: async () => [cfHit ? await chunkFile(cf) : null].concat(await stFetch(clsList)).filter(Boolean) });
    if (timedOut(oth)) add('files', -1); else add('files', oth.length, [], async () => { for (const it of oth) await it.delete(); }, { rows: oth.map((it) => ({ 파일이름: it.name, 위치: it.fullPath })), files: async () => (await stFetch(oth)).filter(Boolean) });
    return plan;
  }
  // 설정 문서(json)를 '문서 · 항목 · 값' 줄로 풀어 씀
  function cfgRows(docs) {
    const out = [];
    docs.forEach((d) => { let j = null; try { j = d.json ? JSON.parse(d.json) : null; } catch (e) { j = null; }
      const o = j && typeof j === 'object' ? j : Object.fromEntries(Object.entries(d).filter(([k]) => k !== '_id'));
      Object.keys(o).forEach((k) => out.push({ 문서: d._id, 항목: k, 값: o[k] })); });
    return out;
  }
  async function chunkFile(meta) {   // data_files 에 조각으로 나눠 둔 파일(내선번호·교실 배치도)을 다시 합침
    if (!meta || !meta.chunks || !meta.chunks.length) return null;
    const parts = await Promise.all(meta.chunks.map((id) => GP.db.collection('data_files').doc(id).get()));
    return { name: meta.name || 'file', dataUrl: 'data:' + (meta.mimeType || 'application/octet-stream') + ';base64,' + parts.map((d) => (d.exists ? d.data().data : '')).join('') };
  }
  async function stFetch(items) {   // 예전 방식(Storage) 파일: 받을 수 없으면 건너뜀
    return Promise.all((items || []).map(async (it) => { try { const u = await it.getDownloadURL(); const res = await fetch(u); if (!res.ok) return null; return { name: it.name, blob: await res.blob() }; } catch (e) { return null; } }));
  }
  // ---- 고른 항목 내려받기: 데이터는 엑셀 한 파일(항목마다 시트), 이미지·파일이 있으면 함께 zip 으로 묶음
  const FIELD = { task_school_name: '행사명', task_school_date_start: '시작일', task_school_date_end: '종료일', task_memo_name: '일정', task_memo_date_start: '시작일', task_memo_date_end: '종료일',
    add_date: '날짜', add_class: '학급', add_time: '교시', add_name: '강좌명', sub_date: '날짜', sub_class: '학급', sub_time: '교시', sub_name: '과목',
    gym_date: '날짜', gym_class: '반', gym_time: '교시', gym_place: '공간', room_date: '날짜', room_class: '반', room_time: '교시', room_place: '공간',
    student_class: '반', student_num: '번호', student_name: '이름', student_gender: '성별', student_birth: '생년월일', student_memo: '기타',
    budget_name: '예산', budget_product: '품명', budget_spec: '규격', budget_price: '단가', budget_num: '수량', budget_link: '링크', budget_memo: '비고', budget_progress: '진행', budget_pumui: '품의',
    supply_year: '학년도', supply_semester: '학기', supply_sub: '과목', supply_product: '품명', supply_spec: '규격', supply_unit: '단위', supply_price: '단가', supply_class: '학급', supply_class_num: '학급 수량', supply_link: '링크',
    list_budget: '예산 카드', list_budget_amount: '금액', list_budget_header: '머리글', list_budget_year: '학년도' };
  const SKIP = { _id: 1, _year: 1, dataUrl: 1, data: 1 };
  function sheetOf(it) {
    const cols = []; it.rows.forEach((r) => Object.keys(r).forEach((k) => { if (!SKIP[k] && cols.indexOf(k) < 0) cols.push(k); }));
    const val = (v) => { if (v === undefined || v === null) return ''; if (typeof v === 'number') return v; let t = typeof v === 'object' ? JSON.stringify(v) : String(v); if (t.length > 32000) t = t.slice(0, 32000) + '…(너무 길어 잘림)'; return t; };
    const name = it.label.replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
    return { name, freezeRow: 1, widths: cols.map((k) => Math.min(40, Math.max(8, (FIELD[k] || k).length * 2 + 4, ...it.rows.slice(0, 50).map((r) => String(val(r[k])).length + 2)))),
      rows: [cols.map((k) => ({ v: FIELD[k] || k, s: 'header' }))].concat(it.rows.map((r) => cols.map((k) => ({ v: val(r[k]), s: typeof r[k] === 'number' ? 'int' : 'text' })))) };
  }
  // ---- 업로드 양식과 같은 모양으로 내려받기 ----
  const NO_DOWNLOAD = ['cfg', 'groups'];   // 담임·전담교사, 공간 개방 설정 · 강좌별 시간표 범주: 체크해도 내려받지 않음
  const H = (v) => ({ v, s: 'header' }), Tx = (v) => ({ v: v === undefined || v === null ? '' : String(v), s: 'text' });
  const reqH = (v) => H(v + ' (필수)');   // 일괄 업로드 양식(체육 공간·강좌 일정)의 머리글과 같게
  const dayStr = (v) => { const d = toDate(v); return d ? appDate(d) : str(v); };
  const splitC = (v) => str(v).split(/[,，、]+/).map((x) => x.trim()).filter(Boolean);
  // 같은 날짜·교시·이름이면 반을 "2반, 3반"으로 묶고, 반 구성이 같으면 교시도 "1교시, 3교시"로 묶음 (업로드할 때 반 × 교시로 다시 풀림)
  function groupSlots(rows, f, order) {
    const pi = (p) => { const i = order.periods.indexOf(p); return i < 0 ? 999 : i; }, ci = (c) => { const i = order.classes.indexOf(c); return i < 0 ? 999 : i; };
    const byP = new Map();
    rows.forEach((r) => { const d = toDate(r[f.d]); if (!d) return; const name = str(r[f.n]).trim();
      splitC(r[f.t]).forEach((p) => { const k = ymd(d) + '|' + p + '|' + name; let g = byP.get(k); if (!g) { g = { d, p, name, cls: [] }; byP.set(k, g); } splitC(r[f.c]).forEach((c) => { if (g.cls.indexOf(c) < 0) g.cls.push(c); }); }); });
    const merged = new Map();
    byP.forEach((g) => { const cls = g.cls.sort((a, b) => ci(a) - ci(b) || natural(a, b)).join(', '); const k = ymd(g.d) + '|' + g.name + '|' + cls; let m = merged.get(k); if (!m) { m = { d: g.d, name: g.name, cls, ps: [] }; merged.set(k, m); } if (m.ps.indexOf(g.p) < 0) m.ps.push(g.p); });
    return [...merged.values()].map((m) => Object.assign(m, { ps: m.ps.sort((a, b) => pi(a) - pi(b)) })).sort((a, b) => a.d - b.d || pi(a.ps[0]) - pi(b.ps[0]) || natural(a.name, b.name));
  }
  async function formatSheets(it, ctx) {
    const order = ctx.order, nm = it.label;
    if (it.key === 'add') return [{ name: '강좌 일정', widths: [22, 24, 16, 20], freezeRow: 1, rows: [['날짜', '학급', '교시', '강좌명'].map(reqH)].concat(groupSlots(it.rows, { d: 'add_date', c: 'add_class', t: 'add_time', n: 'add_name' }, order).map((g) => [Tx(appDate(g.d)), Tx(g.cls), Tx(g.ps.join(', ')), Tx(g.name)])) }];
    if (it.key === 'gym' || it.key === 'room') { const p = it.key;
      return [{ name: nm, widths: [22, 18, 14, 16], freezeRow: 1, rows: [['날짜', '반', '교시', '공간이름'].map(reqH)].concat(groupSlots(it.rows, { d: p + '_date', c: p + '_class', t: p + '_time', n: p + '_place' }, order).map((g) => [Tx(appDate(g.d)), Tx(g.cls), Tx(g.ps.join(', ')), Tx(g.name)])) }]; }
    if (it.key === 'sub') {
      if (ctx.subSheets) { try { const sh = await ctx.subSheets(); if (sh && sh.length) return sh; } catch (e) { console.warn(e); } }   // 지금 학년도: 전담 시간표 업로드 양식(페이지 모양)에 채워서
      return [{ name: nm, widths: [22, 24, 16, 14], freezeRow: 1, rows: [['날짜', '학급', '교시', '과목'].map(H)].concat(groupSlots(it.rows, { d: 'sub_date', c: 'sub_class', t: 'sub_time', n: 'sub_name' }, order).map((g) => [Tx(appDate(g.d)), Tx(g.cls), Tx(g.ps.join(', ')), Tx(g.name)])) }];
    }
    if (it.key === 'school' || it.key === 'memo') {   // 기초 일정 · 학년 일정: 시작일 / 종료일 / 일정
      const p = it.key === 'school' ? 'task_school_' : 'task_memo_';
      return [{ name: it.key === 'school' ? '기초 일정' : '학년 일정', widths: [22, 22, 40], freezeRow: 1, rows: [['시작일', '종료일', '일정'].map(H)].concat(it.rows.slice().sort((a, b) => (toDate(a[p + 'date_start']) || 0) - (toDate(b[p + 'date_start']) || 0))
        .map((r) => [Tx(dayStr(r[p + 'date_start'])), Tx(r[p + 'date_end'] ? dayStr(r[p + 'date_end']) : ''), Tx(r[p + 'name'])])) }];
    }
    if (it.key === 'student') {   // 명렬표 업로드 양식: 학급마다 시트(1행 제목, 2행 번호·이름·성별·기타·생년월일)
      const by = new Map(); it.rows.forEach((r) => { const c = str(r.student_class).trim(); const k = /^\d+$/.test(c) ? c + '반' : c; if (!by.has(k)) by.set(k, []); by.get(k).push(r); });
      const names = [...by.keys()].sort((a, b) => { const i = order.classes.indexOf(a), j = order.classes.indexOf(b); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j) || natural(a, b); });
      return names.map((c) => ({ name: c.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31), widths: [8, 14, 8, 20, 18], freezeRow: 2,
        rows: [[{ v: c + ' 명렬표', s: 'title' }], ['번호', '이름', '성별', '기타', '생년월일'].map((v) => ({ v, s: 'totalLabel' }))]
          .concat(by.get(c).sort((a, b) => num(a.student_num) - num(b.student_num)).map((r) => [{ v: num(r.student_num) || str(r.student_num), s: 'center' }, ...['student_name', 'student_gender', 'student_memo', 'student_birth'].map((k) => ({ v: str(r[k]), s: 'center' }))])) }));
    }
    if (it.key === 'budget' && ctx.budget) { const sh = await ctx.budget('budget', 'orig'); if (sh) return sh; }
    if (it.key === 'supply' && ctx.budget) {   // 학습준비물: 원본 · 제출용 · 수령확인용을 모두 넣음
      const out = [];
      for (const [how, tag] of [['orig', ''], ['submit', ' 제출용'], ['receive', ' 수령확인용']]) (await ctx.budget('supply', how) || []).forEach((sh) => { if (tag) sh.name = (sh.name.slice(0, 31 - tag.length) + tag); out.push(sh); });
      if (out.length) return out;
    }
    return [sheetOf(it)];
  }
  // 예산 페이지를 보이지 않게 열어, 그 페이지의 표 만들기(원본·제출용·수령확인용)를 그대로 씀
  function budgetFrame(year) {
    return new Promise((resolve, reject) => {
      const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1200px;height:800px;border:0;visibility:hidden'; f.setAttribute('aria-hidden', 'true');
      f.src = 'budget.html?export=1&year=' + year + '&v=' + Date.now(); document.body.appendChild(f);
      let n = 0; const t = setInterval(() => { let w = null; try { w = f.contentWindow; } catch (e) { w = null; }
        const r = w && w.__budgetReady; if (r === true) { clearInterval(t); resolve(f); } else if (r || ++n > 300) { clearInterval(t); f.remove(); reject(new Error(r && r !== true ? r : '예산 페이지를 열지 못했습니다.')); } }, 100);
    });
  }
  async function exportYear(year, keys, onStep, opts) {
    opts = opts || {};
    const step = (t, f) => { try { if (onStep) onStep(t, f); } catch (e) { /* 무시 */ } };
    step('내려받을 데이터를 모으는 중...', 0.05);
    const plan = (await planYear(year)).filter((x) => keys.indexOf(x.key) >= 0 && x.count > 0 && NO_DOWNLOAD.indexOf(x.key) < 0);
    let periods = []; try { periods = (await readList('list_time')).map((i) => i.value); } catch (e) { /* 기본 순서 */ }
    const gen = await getGeneral(); let frame = null;
    const ctx = { order: { periods, classes: (gen.classNames || []).slice() }, subSheets: opts.subSheets && Number(gen.year) === Number(year) ? opts.subSheets : null,
      budget: async (part, how) => { if (!frame) { step('예산 표를 만드는 중...', 0.08); frame = await budgetFrame(year); } return frame.contentWindow.__budgetExportAll(part, how || 'orig'); } };
    const sheets = [];
    try { for (const it of plan) { if (it.rows && it.rows.length) sheets.push(...(await formatSheets(it, ctx))); } }
    finally { if (frame) frame.remove(); }
    const used = new Set(); sheets.forEach((sh) => { let n = sh.name, i = 2; while (used.has(n)) n = sh.name.slice(0, 28) + ' ' + i++; used.add(n); sh.name = n; });
    const files = [], missed = []; const withFiles = opts.sheetsOnly ? [] : plan.filter((x) => x.files); let k = 0;
    for (const it of withFiles) {
      step('파일을 모으는 중... (' + it.label + ')', 0.1 + 0.7 * (k++ / Math.max(1, withFiles.length)));
      const folder = it.label.replace(/[\\/:*?"<>|]/g, ' ').trim(); const names = new Set();
      let list = []; try { list = await it.files(); } catch (e) { console.warn(e); }
      if (list.length < it.count && it.key !== 'classroom') missed.push(it.label + ' ' + (it.count - list.length) + '개');
      for (const f of list) {
        let bytes = null;
        if (f.blob) bytes = new Uint8Array(await f.blob.arrayBuffer());
        else if (f.dataUrl) { const b = atob(f.dataUrl.split(',')[1] || ''); bytes = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i); }
        if (!bytes) continue;
        let nm = String(f.name || 'file').replace(/[\\/:*?"<>|]/g, '_'); if (!/\.[a-z0-9]{2,5}$/i.test(nm) && f.dataUrl) { const m = f.dataUrl.match(/^data:([^;,]+)/); const ext = m ? ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf' })[m[1]] || '' : ''; nm += ext; }
        let fin = nm, n = 2; while (names.has(fin)) { fin = nm.replace(/(\.[^.]+)?$/, ' (' + n++ + ')$1'); } names.add(fin);
        files.push({ name: folder + '/' + fin, bytes });
      }
    }
    if (!sheets.length && !files.length) throw new Error('내려받을 내용이 없습니다.');
    step('파일을 만드는 중...', 0.9);
    const base = year + '학년도_데이터';
    if (opts.sheetsOnly) {   // 구글 스프레드시트용: 표만 (이미지·파일은 넣을 수 없음)
      if (!sheets.length) throw new Error('스프레드시트로 보낼 표가 없습니다. (이미지·파일 항목은 엑셀 다운로드로 받아 주세요)');
      return { sheets, name: base, fileItems: plan.filter((x) => x.files).reduce((a, x) => a + x.count, 0) };
    }
    if (!files.length) return { blob: new Blob([window.XlsxLite.toBytes(sheets)], { type: window.XlsxLite.XLSX_MIME }), name: base + '.xlsx', missed };
    const all = (sheets.length ? [{ name: base + '.xlsx', bytes: window.XlsxLite.toBytes(sheets) }] : []).concat(files);
    return { blob: window.XlsxLite.zipBlob(all), name: base + '.zip', missed };
  }
  async function previewDelete(year) { return (await planYear(year)).map((x) => ({ key: x.key, label: x.label, count: x.count })); }
  async function deleteYear(year, keys, onStep) {   // keys: 지울 항목(없으면 전부), onStep(글, 진행 0~1): 진행 상황 알림
    const step = (t, f) => { try { if (onStep) onStep(t, f); } catch (e) { /* 무시 */ } };
    step('지울 데이터를 다시 확인하는 중...', 0.05);
    const plan = (await planYear(year)).filter((x) => !keys || keys.indexOf(x.key) >= 0); const ops = []; const summary = {};
    plan.forEach((x) => { if (x.count < 0) return; ops.push(...x.ops); summary[x.label] = x.count; });
    const afters = plan.filter((x) => x.after && x.count > 0);
    const total = ops.length + afters.length || 1; let done = 0;
    for (let i = 0; i < ops.length; i += 400) {   // 400건씩 나눠 지우며 진행률 표시
      const part = ops.slice(i, i + 400); step('삭제하는 중... (' + Math.min(i + part.length, ops.length) + ' / ' + ops.length + '건)', 0.1 + 0.85 * done / total);
      await commit(part); done += part.length;
    }
    for (const x of afters) { step('파일 삭제하는 중... (' + x.label + ')', 0.1 + 0.85 * done / total); await x.after(); done++; }
    step('마무리하는 중...', 1);
    return summary;
  }

  window.APP = { baseDate, dday, fmtDate, setYear, getVacations, renderDayCards, yearRange, yearOf, inRange, getGeneral, saveGeneral, holidayMap, buildSchedule, getDayState, saveDay, SEM_NAMES, getSemesterRows, saveSemesters,
    listBaseItems, addBaseItems, updateBaseItem, deleteBaseItem, clearSemester, entryApplies, homeroomFor, syncTeachers, teacherNames, setTeacherNames, ensureTeachers, detectYears, deleteYear, exportYear, renderTermProgress, previewDelete, migrateYearTags };
})();
