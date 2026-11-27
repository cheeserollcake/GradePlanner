/* 관리자 > 공간 개방 설정 > 공간 자동 배정
 *  고른 기간 · 고른 공간 · 공간 개방 설정(학기별 + 예외)에 맞춰, 전담(및 다른 일정)과 겹치지 않게 반을 배정합니다.
 *  규칙
 *   1) 한 주 안에서는 모든 반이 고루 (아직 이번 주에 어떤 공간도 못 쓴 반이 먼저)
 *   2) 같은 반은 되도록 하루에 한 번
 *   3) 기간 전체로 보면 공간마다 모든 반이 같은 횟수에 가깝게
 *  [반영하기]를 누르기 전까지는 이 기기에만 임시로 남고, 특별실 사용 시간표에는 저장되지 않습니다.
 */
(function () {
  const DAYK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], DAYN = ['월', '화', '수', '목', '금'];
  const ALL_TOKENS = /공통|전체|학년|전담/;   // 반 대신 이런 말이 적힌 일정은 모든 반에 해당
  const split = (v) => String(v == null ? '' : v).split(/[,，、]+/).map((x) => x.trim()).filter(Boolean);

  // 날짜 글자 해석: 20270302 / 2027-3-2 / 2027.3.2 / 27.3.2
  const parseDay = (t) => { const v = String(t || '').trim(); const m = v.match(/^(\d{4})(\d{2})(\d{2})$/) || v.match(/^(\d{2,4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?$/); if (!m) return null;
    let y = +m[1]; if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[3]); return d.getFullYear() === y && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null; };

  /* ---------------------------------------------------------------- 배정 계산 (화면과 분리: 테스트하기 쉽게)
   * input: { classes, days:[Date], periods:[이름], spaces:[{name, kind}], isOpen(d,p,s), booked:Set('ymd|p|s'), busy(c, ymd, p) }
   * 반환: { items:[{d, p, s, kind, c}], empty:[{d, p, s, why}] }
   */
  function solve(inp) {
    const GP = window.GP; const { classes, days, periods, spaces, isOpen, booked, busy } = inp; const n = classes.length; const usedDay = inp.usedDay || (() => false);   // usedDay: 이미 저장된 체육공간·특별실 일정이 그날 그 반에 있나
    const weeks = new Map();   // 월요일 → 그 주의 빈 칸들
    days.forEach((d) => { const day = GP.ymd(d); periods.forEach((p) => spaces.forEach((sp) => {
      if (!isOpen(d, p, sp.name) || booked.has(day + '|' + p + '|' + sp.name)) return;
      const wk = GP.ymd(GP.mondayOf(d)); if (!weeks.has(wk)) weeks.set(wk, []); weeks.get(wk).push({ d, day, p, s: sp.name, kind: sp.kind });
    })); });
    const spaceCnt = {}, lastUse = {}; spaces.forEach((sp) => { spaceCnt[sp.name] = {}; lastUse[sp.name] = {}; classes.forEach((c) => { spaceCnt[sp.name][c] = 0; lastUse[sp.name][c] = -1; }); });
    const total = {}; classes.forEach((c) => { total[c] = 0; });
    const items = [], empty = []; let seq = 0, wIdx = 0;
    for (const [, slots] of [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const weekCnt = {}, dayCnt = {}, at = new Set();   // at: 'ymd|p|반' (같은 시각 두 공간 금지)
      classes.forEach((c) => { weekCnt[c] = 0; });
      const free = (sl, c) => !busy(c, sl.day, sl.p) && !at.has(sl.day + '|' + sl.p + '|' + c);
      // 넣을 수 있는 반이 적은 칸부터(전담이 많이 겹친 칸을 먼저 채워야 다른 반이 밀리지 않음), 같으면 날짜·교시 순
      const order = slots.map((sl, i) => ({ sl, i, k: classes.filter((c) => !busy(c, sl.day, sl.p)).length })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.sl);
      const rot = (c) => (classes.indexOf(c) - wIdx % n + n) % n;   // 완전히 같으면 주마다 시작 반을 돌려 1반만 앞서지 않게
      for (const sl of order) {
        const cand = classes.filter((c) => free(sl, c));
        if (!cand.length) { empty.push({ d: sl.d, p: sl.p, s: sl.s, why: '모든 반이 이 시간에 다른 일정(전담 등)이 있음' }); continue; }
        const cand2 = cand.filter((c) => !dayCnt[c + '|' + sl.day] && !usedDay(c, sl.day));   // 규칙: 같은 반은 하루에 한 번만 (꼭 지킴)
        if (!cand2.length) { empty.push({ d: sl.d, p: sl.p, s: sl.s, why: '남은 반이 모두 이날 이미 배정됨' }); continue; }
        cand.length = 0; cand.push(...cand2);
        const key = (c) => [weekCnt[c], spaceCnt[sl.s][c] + total[c] / 1000, dayCnt[c + '|' + sl.day] || 0, total[c], lastUse[sl.s][c], rot(c)];
        cand.sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
        const c = cand[0];
        weekCnt[c]++; dayCnt[c + '|' + sl.day] = (dayCnt[c + '|' + sl.day] || 0) + 1; spaceCnt[sl.s][c]++; total[c]++; lastUse[sl.s][c] = seq++; at.add(sl.day + '|' + sl.p + '|' + c);
        items.push({ d: sl.d, day: sl.day, p: sl.p, s: sl.s, kind: sl.kind, c, wk: wIdx });
      }
      wIdx++;
    }
    improve(items, spaces, classes, busy, spaceCnt, usedDay);
    items.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : periods.indexOf(a.p) - periods.indexOf(b.p) || spaces.findIndex((x) => x.name === a.s) - spaces.findIndex((x) => x.name === b.s)));
    return { items, empty };
  }
  // 배정을 다듬어 공간별·전체 횟수 차이를 줄입니다. 주 안의 고른 배정(이번 주 0번인 반이 있는데 2번 쓰는 반이 생기지 않게)은 지킵니다.
  //  ① 바꿔 주기: 한 칸의 반을, 이번 주에 덜 쓴 다른 반으로 바꿈
  //  ② 맞바꾸기: 같은 주의 두 칸에서 반을 서로 바꿈
  function improve(items, spaces, classes, busy, cnt, usedDay) {
    const total = {}; classes.forEach((c) => { total[c] = 0; }); items.forEach((it) => { total[it.c]++; });
    const sqv = (v) => { const m = v.reduce((a, b) => a + b, 0) / (v.length || 1); return v.reduce((a, b) => a + (b - m) * (b - m), 0); };
    const F = () => Object.keys(cnt).reduce((a, s) => a + sqv(classes.map((c) => cnt[s][c])), 0) + 0.5 * sqv(classes.map((c) => total[c]));
    const byWeek = {}; items.forEach((it) => { (byWeek[it.wk] = byWeek[it.wk] || []).push(it); });
    const wkN = {}; items.forEach((it) => { wkN[it.wk + '|' + it.c] = (wkN[it.wk + '|' + it.c] || 0) + 1; });
    const at = new Set(items.map((it) => it.day + '|' + it.p + '|' + it.c));
    const dayN = {}; items.forEach((it) => { dayN[it.c + '|' + it.day] = (dayN[it.c + '|' + it.day] || 0) + 1; });
    const inc = (o, k, d) => { o[k] = (o[k] || 0) + d; };
    const setC = (it, c) => {   // it 칸의 반을 c 로
      at.delete(it.day + '|' + it.p + '|' + it.c); inc(dayN, it.c + '|' + it.day, -1); inc(wkN, it.wk + '|' + it.c, -1); cnt[it.s][it.c]--; total[it.c]--;
      it.c = c; at.add(it.day + '|' + it.p + '|' + c); inc(dayN, c + '|' + it.day, 1); inc(wkN, it.wk + '|' + c, 1); cnt[it.s][c]++; total[c]++;
    };
    const okDay = (c, it) => !(dayN[c + '|' + it.day] || 0) && !usedDay(c, it.day);   // 같은 반 하루 한 번 (꼭 지킴)
    for (let round = 0; round < 80; round++) {
      let changed = false;
      // ① 바꿔 주기
      items.forEach((it) => {
        const x = it.c;
        for (const y of classes) {
          if (y === x || busy(y, it.day, it.p) || at.has(it.day + '|' + it.p + '|' + y)) continue;
          if ((wkN[it.wk + '|' + y] || 0) >= (wkN[it.wk + '|' + x] || 0)) continue;   // 이번 주에 덜 쓴 반으로만
          if (!okDay(y, it)) continue;
          const before = F(); setC(it, y); if (F() < before - 1e-9) { changed = true; return; } setC(it, x);
        }
      });
      // ② 맞바꾸기
      Object.keys(byWeek).forEach((w) => {
        const L = byWeek[w];
        for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
          const a = L[i], b = L[j], ca = a.c, cb = b.c; if (ca === cb || a.s === b.s) continue;
          if (busy(ca, b.day, b.p) || busy(cb, a.day, a.p)) continue;
          const same = a.day === b.day && a.p === b.p;
          if (!same && (at.has(b.day + '|' + b.p + '|' + ca) || at.has(a.day + '|' + a.p + '|' + cb))) continue;
          const before = F(); setC(a, cb); setC(b, ca);
          if ((a.day !== b.day && ((dayN[ca + '|' + b.day] || 0) > 1 || (dayN[cb + '|' + a.day] || 0) > 1 || usedDay(ca, b.day) || usedDay(cb, a.day))) || F() >= before - 1e-9) { setC(b, cb); setC(a, ca); } else changed = true;
        }
      });
      if (!changed) break;
    }
  }

  /* ---------------------------------------------------------------- 화면 */
  // ctx: { el, toast, esc, BTN, BTN_P, BTN_G, INP, CARD, getSpaces():{gym:[], room:[]}, getCfg():공간개방설정, times:[교시] }
  async function render(ctx) {
    const GP = window.GP, APP = window.APP; const { el, toast, esc, BTN, BTN_P, BTN_G, INP, CARD } = ctx; if (!el) return;
    const gen = await APP.getGeneral(); const classes = gen.classNames.slice(); const year = Number(gen.year);
    const KEY = 'gp_autospace_' + (GP.gradePrefix || '') + year;
    let S; try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
    if (!S || typeof S !== 'object') S = {};
    const yr = APP.yearRange(year);
    if (!parseDay(S.start)) { const b = APP.baseDate(year); S.start = GP.ymd(b); S.end = GP.ymd(GP.addDays(b, 27)); }
    if (!parseDay(S.end)) S.end = S.start;
    if (!Array.isArray(S.spaces)) S.spaces = [];
    const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* 저장 못 해도 화면은 동작 */ } };

    // 전담 시간표가 이번 학년도에 하나라도 있나
    GP.invalidate('data_sub_timetable');
    const subRows = await GP.getCol('data_sub_timetable');
    const hasSub = subRows.some((r) => { const d = GP.toDate(r.sub_date); return d && d >= yr.start && d <= yr.end && String(r.sub_class || '').trim(); });

    const sems = await APP.getSemesterRows(year); const s1 = sems['1학기'], s2 = sems['2학기'];
    const semKey = (d) => (s2 && d >= s2.start && d <= s2.end ? 'sem2' : s1 && d >= s1.start && d <= s1.end ? 'sem1' : (d.getMonth() >= 2 && d.getMonth() <= 6 ? 'sem1' : 'sem2'));   // 특별실 사용 시간표와 같은 방식
    const inTerm = (d) => (!s1 && !s2) || (s1 && d >= s1.start && d <= s1.end) || (s2 && d >= s2.start && d <= s2.end);   // 방학은 건너뜀
    const ex = (list, day, p, s) => (list || []).some((e) => e.date === day && String(e.period).trim() === p && e.space === s);
    const isOpen = (d, p, s) => { const cfg = ctx.getCfg(); const day = GP.ymd(d), k = DAYK[(d.getDay() + 6) % 7] + '|' + p + '|' + s; return (!!(cfg[semKey(d)] || {})[k] || ex(cfg.exceptions, day, p, s)) && !ex(cfg.closeExceptions, day, p, s); };
    let known = { booked: new Map(), hol: new Map() };   // 표에 같이 보여 줄 이미 저장된 칸
    const PALETTE = ['#CFE2F3', '#FCE5CD', '#D9EAD3', '#FFFEB5', '#E4D7F5'];
    const colorOf = (name) => { const cfg = ctx.getCfg(); const sp = ctx.getSpaces(); const i = Math.max(sp.gym.indexOf(name), sp.room.indexOf(name), 0); return (cfg.colors || {})[name] || PALETTE[i % PALETTE.length]; };
    const allSpaces = () => { const sp = ctx.getSpaces(); return sp.gym.map((n) => ({ name: n, kind: 'gym' })).concat(sp.room.map((n) => ({ name: n, kind: 'room' }))); };
    const fmt = (d) => (d.getMonth() + 1) + '/' + d.getDate() + '(' + DAYN[(d.getDay() + 6) % 7] + ')';

    function draw() {
      const sp = allSpaces(); const names = sp.map((x) => x.name);
      S.spaces = S.spaces.filter((n) => names.indexOf(n) >= 0);
      const chk = (x) => '<label class="inline-flex items-center gap-1 mr-3 mb-1"><input type="checkbox" data-asp="' + esc(x.name) + '" ' + (S.spaces.indexOf(x.name) >= 0 ? 'checked' : '') + ' style="width:15px;height:15px;accent-color:#4f78f2">' + esc(x.name) + '</label>';
      const group = (label, list) => list.length ? '<div class="flex flex-wrap items-center"><span class="font-semibold w-20 shrink-0 text-slate-600">' + label + '</span>' + list.map(chk).join('') + '</div>' : '';
      const dateBox = (id, v) => '<span class="flex gap-1 mt-1 relative"><input id="' + id + '" type="text" inputmode="numeric" autocomplete="off" placeholder="20270302" class="' + INP + ' w-full min-w-0" value="' + esc(v) + '">' +
        '<button data-pick="' + id + '" type="button" class="' + BTN_G + ' !px-2 shrink-0" title="달력에서 고르기">📅</button><input data-pk="' + id + '" type="date" tabindex="-1" aria-hidden="true" style="position:absolute;right:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none"></span>';
      const R = S.result;
      el.innerHTML = '<div class="' + CARD + '"><h2 class="font-bold text-lg">공간 자동 배정' + (hasSub ? '' : ' <span class="text-sm font-bold text-red-600">전담 시간표가 입력되어 있지 않습니다.</span>') +
        ' <span class="block text-xs font-normal text-slate-400 mt-0.5">위의 개방 설정에 맞춰, 전담 일정을 피해서 모든 반이 고루 쓰도록 배정합니다. [반영하기]를 눌러야 특별실 사용 시간표에 저장됩니다.</span></h2>' +
        '<div class="grid sm:grid-cols-2 gap-3 text-sm" style="max-width:36rem"><label class="font-semibold">시작 날짜' + dateBox('aspStart', S.start) + '</label><label class="font-semibold">종료 날짜' + dateBox('aspEnd', S.end) + '</label></div>' +
        '<div class="border rounded-lg bg-slate-50 p-3 text-sm space-y-1"><div class="font-bold mb-1">배정할 공간</div>' + (sp.length ? group('체육 공간', sp.filter((x) => x.kind === 'gym')) + group('특별실', sp.filter((x) => x.kind === 'room')) : '<p class="text-slate-400">위에서 공간을 먼저 추가하세요.</p>') + '</div>' +
        '<div class="flex flex-wrap gap-2"><button data-asp-act="run" class="' + BTN + ' bg-emerald-600 text-white hover:bg-emerald-700">자동 배정하기</button>' +
        '<button data-asp-act="save" class="' + BTN_P + '"' + (R && R.items.length ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>반영하기</button>' +
        '<button data-asp-act="reset" class="' + BTN_G + '"' + (R ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>초기화하기</button></div>' +
        (R ? resultHtml(R) : '<p class="text-sm text-slate-400">기간과 공간을 고르고 [자동 배정하기]를 누르세요.</p>') + '</div>';
      bind();
    }
    function resultHtml(R) {
      const sps = R.spaces; const cnt = {}; sps.forEach((s) => { cnt[s] = {}; classes.forEach((c) => { cnt[s][c] = 0; }); });
      R.items.forEach((it) => { if (cnt[it.s] && cnt[it.s][it.c] !== undefined) cnt[it.s][it.c]++; });
      const rng = (s) => { const v = classes.map((c) => cnt[s][c]); return { lo: Math.min(...v), hi: Math.max(...v) }; };
      // 가로 = 반, 세로 = 공간 (마지막 줄 = 반별 합계)
      const head = '<tr><th class="border bg-slate-100 px-2 py-1">공간</th>' + classes.map((c) => '<th class="border bg-slate-100 px-2 py-1 whitespace-nowrap">' + esc(c) + '</th>').join('') + '</tr>';
      const body = sps.map((s) => { const r = rng(s); return '<tr><th class="border bg-slate-50 px-2 py-1 whitespace-nowrap">' + esc(s) + '</th>' + classes.map((c) => { const v = cnt[s][c]; const st = r.hi !== r.lo && v === r.lo ? 'background:#fef9c3' : ''; return '<td class="border px-2 py-1 text-center whitespace-nowrap" style="' + st + '">' + v + '회 배정</td>'; }).join('') + '</tr>'; }).join('') +
        '<tr><th class="border bg-slate-100 px-2 py-1">합계</th>' + classes.map((c) => '<td class="border px-2 py-1 text-center font-semibold bg-slate-50">' + sps.reduce((a, s) => a + cnt[s][c], 0) + '회</td>').join('') + '</tr>';
      const weekList = weekTables(R);
      const warn = (R.notes || []).length ? '<div class="text-sm text-amber-700 space-y-0.5">' + R.notes.map((x) => '<div>· ' + esc(x) + '</div>').join('') + '</div>' : '';
      return '<div class="space-y-3"><div class="text-sm"><b>' + esc(R.start) + ' ~ ' + esc(R.end) + '</b> · 배정 ' + R.items.length + '칸 <span class="text-xs text-slate-400">(아직 저장 전 · 노란 칸 = 그 공간을 가장 적게 쓴 반)</span></div>' + warn +
        '<div class="overflow-x-auto"><table class="border-collapse text-sm">' + head + body + '</table></div>' +
        '<details class="text-sm" open><summary class="cursor-pointer font-semibold text-slate-600">주별 배정 내역 <span class="text-xs font-normal text-slate-400">특별실 사용 시간표 모양 · 진한 글씨 = 이번에 배정, 흐린 글씨 = 이미 저장된 일정, 색칸 = 개방, 흰칸 = 닫힘</span></summary>' +
          '<div class="mt-2 overflow-auto border rounded" style="max-height:75vh">' + (weekList || '<p class="text-slate-400">배정된 칸이 없습니다.</p>') + '</div></details></div>';
    }
    // 주별 표: 월~금 5칸, 날마다 [교시 × 고른 공간] 표 (특별실 사용 시간표와 같은 모양)
    function weekTables(R) {
      const a = parseDay(R.start), b = parseDay(R.end); if (!a || !b) return '';
      const sps = R.spaces, times = ctx.times; const mine = new Map(R.items.map((x) => [x.day + '|' + x.p + '|' + x.s, x.c]));
      const cols = 'minmax(38px,1.25fr) repeat(' + sps.length + ', minmax(0,1fr))';
      const cell = 'display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;word-break:break-all;line-height:1.05;border-right:1px solid #e2e8f0;padding:0 1px;';
      const day = (d) => {
        const ymd = GP.ymd(d), hd = known.hol.get(ymd), out = d < a || d > b;
        const head = '<div class="text-center font-bold rounded py-0.5 mb-1 ' + (hd ? 'text-red-500' : 'text-slate-600 bg-slate-100') + '" style="font-size:12px">' + (d.getMonth() + 1) + '/' + d.getDate() + (hd ? ' (휴)' : '') + '</div>';
        if (hd) return '<div class="p-1 border-r">' + head + '<div class="text-center text-red-400 font-bold py-6" style="font-size:12px">휴일</div></div>';
        if (out) return '<div class="p-1 border-r" style="opacity:.45">' + head + '<div class="text-center text-slate-400 py-6" style="font-size:12px">기간 밖</div></div>';
        const vac = !inTerm(d);
        const hrow = '<div style="display:grid;grid-template-columns:' + cols + ';height:30px;font-size:10px;font-weight:700;background:#e2e8f0;border-bottom:1px solid #cbd5e1"><div style="' + cell + '">교시</div>' +
          sps.map((s) => '<div style="' + cell + 'background:' + colorOf(s) + '">' + esc(s) + '</div>').join('') + '</div>';
        const rows = times.map((p) => '<div style="display:grid;grid-template-columns:' + cols + ';height:24px;font-size:11px;border-bottom:1px solid #e2e8f0"><div style="' + cell + 'font-weight:700;background:#fff">' + esc(p) + '</div>' +
          sps.map((s) => { const k = ymd + '|' + p + '|' + s, m = mine.get(k), old = known.booked.get(k), open = !vac && isOpen(d, p, s);
            const bg = open || m || old ? 'background:' + colorOf(s) + ';' : 'background:#fff;';
            const txt = m ? '<b style="color:#1e1b4b">' + esc(m) + '</b>' : old ? '<span style="color:#64748b">' + esc(old) + '</span>' : '';
            return '<div style="' + cell + bg + (m ? 'box-shadow:inset 0 0 0 2px #5f88f3;' : '') + '">' + txt + '</div>'; }).join('') + '</div>').join('');
        return '<div class="p-1 border-r">' + head + '<div style="border:1px solid #cbd5e1;border-radius:4px;overflow:hidden">' + hrow + rows + '</div></div>';
      };
      const weeks = []; for (let m = GP.mondayOf(a); m <= b; m = GP.addDays(m, 7)) weeks.push(m);
      return '<div style="min-width:' + Math.max(640, 5 * (40 + sps.length * 26 + 10)) + 'px"><div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr))" class="bg-slate-100 rounded-t font-bold text-center text-slate-600 py-1">' + DAYN.map((x) => '<div>' + x + '</div>').join('') + '</div>' +
        weeks.map((m) => '<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr))" class="border-b">' + [0, 1, 2, 3, 4].map((i) => day(GP.addDays(m, i))).join('') + '</div>').join('') + '</div>';
    }
    function bind() {
      const $ = (id) => document.getElementById(id);
      const commitDay = (id, field) => { const inp = $(id); if (!inp) return; const raw = inp.value.trim(); const d = parseDay(raw);
        if (!d) { inp.style.boxShadow = '0 0 0 2px #f87171'; if (raw) toast('날짜를 20270302 처럼 숫자 8자리로 입력해 주세요.', true); return; }
        inp.style.boxShadow = ''; inp.value = GP.ymd(d); S[field] = GP.ymd(d); keep(); };
      [['aspStart', 'start'], ['aspEnd', 'end']].forEach(([id, f]) => { const inp = $(id); if (!inp) return;
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); commitDay(id, f); } };
        inp.onblur = () => commitDay(id, f); });
      el.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { const id = b.dataset.pick; const pk = el.querySelector('[data-pk="' + id + '"]'); pk.value = S[id === 'aspStart' ? 'start' : 'end'];
        try { pk.showPicker(); } catch (e) { pk.style.pointerEvents = 'auto'; pk.focus(); pk.click(); } });
      el.querySelectorAll('[data-pk]').forEach((pk) => pk.onchange = () => { const d = GP.toDate(pk.value); if (!d) return; const id = pk.dataset.pk; $(id).value = GP.ymd(d); commitDay(id, id === 'aspStart' ? 'start' : 'end'); });
      el.querySelectorAll('[data-asp]').forEach((cb) => cb.onchange = () => { const n = cb.dataset.asp; S.spaces = S.spaces.filter((x) => x !== n); if (cb.checked) S.spaces.push(n); keep(); });
      el.querySelector('[data-asp-act="run"]').onclick = run;
      el.querySelector('[data-asp-act="save"]').onclick = save;
      el.querySelector('[data-asp-act="reset"]').onclick = () => { if (!S.result) return; if (!confirm('자동 배정한 임시 결과를 지울까요?\n(이미 저장된 특별실 사용 시간표는 그대로입니다)')) return; S.result = null; keep(); draw(); toast('임시 배정을 지웠습니다.'); };
    }

    // 지금 저장된 일정을 읽어 '이미 찬 칸'과 '반이 바쁜 시간'을 만듭니다.
    async function loadBusy() {
      ['data_sub_timetable', 'data_add_timetable', 'data_gym_timetable', 'data_room_timetable'].forEach((c) => GP.invalidate(c));
      const [sub, add, gym, room, hol] = await Promise.all(['data_sub_timetable', 'data_add_timetable', 'data_gym_timetable', 'data_room_timetable'].map((c) => GP.getCol(c)).concat([APP.holidayMap()]));
      const norm = (t) => { if (classes.indexOf(t) >= 0) return t; const m = t.match(/^(\d+)\s*반?$/); if (m && +m[1] >= 1 && +m[1] <= classes.length) return classes[+m[1] - 1]; return ALL_TOKENS.test(t) ? '*' : t; };
      const busySet = new Set(), booked = new Map(), daySet = new Set();
      const put = (d0, cls, time) => { const d = GP.toDate(d0); if (!d) return; const day = GP.ymd(d); const cl = split(cls).map(norm); if (!cl.length) return; split(time).forEach((p) => cl.forEach((c) => busySet.add(day + '|' + p + '|' + c))); };
      sub.forEach((r) => put(r.sub_date, r.sub_class, r.sub_time));
      add.forEach((r) => put(r.add_date, r.add_class, r.add_time));
      gym.forEach((r) => put(r.gym_date, r.gym_class, r.gym_time));
      room.forEach((r) => put(r.room_date, r.room_class, r.room_time));
      const mark = (d0, cls, time, place) => { const d = GP.toDate(d0); if (!d || !String(cls || '').trim()) return; split(time).forEach((p) => booked.set(GP.ymd(d) + '|' + p + '|' + String(place || '').trim(), String(cls).trim())); };
      const dayMark = (d0, cls) => { const d = GP.toDate(d0); if (!d) return; split(cls).map(norm).forEach((c) => daySet.add(GP.ymd(d) + '|' + c)); };
      gym.forEach((r) => dayMark(r.gym_date, r.gym_class)); room.forEach((r) => dayMark(r.room_date, r.room_class));
      gym.forEach((r) => mark(r.gym_date, r.gym_class, r.gym_time, r.gym_place));
      room.forEach((r) => mark(r.room_date, r.room_class, r.room_time, r.room_place));
      known = { booked, hol };
      const usedDay = (c, day) => daySet.has(day + '|' + c);
      return { usedDay, busy: (c, day, p) => busySet.has(day + '|' + p + '|' + c) || busySet.has(day + '|' + p + '|*'), booked, hol };
    }

    async function run() {
      const a = parseDay(S.start), b = parseDay(S.end);
      if (!a || !b) return toast('시작 날짜와 종료 날짜를 입력하세요.', true);
      if (a > b) return toast('종료 날짜가 시작 날짜보다 빠릅니다.', true);
      if (a < yr.start || b > yr.end) return toast('지금 학년도(' + year + ') 안의 날짜로 정해 주세요.', true);
      const sp = allSpaces().filter((x) => S.spaces.indexOf(x.name) >= 0);
      if (!sp.length) return toast('배정할 공간을 하나 이상 고르세요.', true);
      if (!classes.length) return toast('학급이 없습니다. 학년 기초 설정을 확인하세요.', true);
      if (S.result && !confirm('이미 자동 배정한 임시 결과가 있습니다. 새로 배정할까요?')) return;
      const btn = el.querySelector('[data-asp-act="run"]'); if (btn) { btn.disabled = true; btn.textContent = '배정하는 중...'; }
      try {
        const times = ctx.times;
        const { busy, booked, hol, usedDay } = await loadBusy();
        const days = GP.eachDay(a, b).filter((d) => d.getDay() >= 1 && d.getDay() <= 5 && !hol.get(GP.ymd(d)) && inTerm(d));
        const r = solve({ classes, days, periods: times, spaces: sp, isOpen, booked, busy, usedDay });
        // 안내: 한 주에 칸이 반 수보다 적은 주, 비운 칸
        const notes = []; const wk = new Map(); r.items.forEach((it) => { const k = GP.ymd(GP.mondayOf(it.d)); wk.set(k, (wk.get(k) || new Set()).add(it.c)); });
        const short = [...wk.entries()].filter(([, s]) => s.size < classes.length).map(([k]) => fmt(GP.toDate(k)));
        if (short.length) notes.push('열린 칸이 반 수보다 적어 모든 반이 들어가지 못한 주: ' + short.slice(0, 6).join(', ') + (short.length > 6 ? ' 외 ' + (short.length - 6) + '주' : '') + ' (이런 주는 다음 주에 못 들어간 반이 먼저 배정됩니다)');
        if (r.empty.length) notes.push('넣을 반이 없어 비워 둔 칸 ' + r.empty.length + '개(다른 일정과 겹치거나 그날 이미 배정된 반만 남음): ' + r.empty.slice(0, 5).map((x) => fmt(x.d) + ' ' + x.p + ' ' + x.s).join(', ') + (r.empty.length > 5 ? ' …' : ''));
        if (!r.items.length) notes.push('배정할 수 있는 칸이 없습니다. 기간 안에 개방된 칸이 있는지, 이미 시간표가 다 찼는지 확인하세요.');
        S.result = { start: S.start, end: S.end, spaces: sp.map((x) => x.name), items: r.items.map((x) => ({ day: x.day, p: x.p, s: x.s, kind: x.kind, c: x.c })), notes, made: new Date().toISOString() };
        S.result.items.forEach((x) => { x.d = GP.toDate(x.day); });
        keep(); draw(); toast(r.items.length ? '자동 배정을 마쳤습니다. 확인한 뒤 [반영하기]를 누르세요.' : '배정할 칸이 없습니다.', !r.items.length);
      } catch (e) { console.error(e); toast('자동 배정 실패: ' + e.message, true); if (btn) { btn.disabled = false; btn.textContent = '자동 배정하기'; } }
    }

    async function save() {
      const R = S.result; if (!R || !R.items.length) return toast('반영할 배정이 없습니다.', true);
      if (!confirm('자동 배정한 ' + R.items.length + '칸을 특별실 사용 시간표에 저장합니다.\n\n계속할까요?')) return;
      const { booked } = await loadBusy();   // 그사이 다른 사람이 채운 칸은 건너뜀
      const ops = []; let skip = 0;
      R.items.forEach((x) => {
        if (booked.has(x.day + '|' + x.p + '|' + x.s)) { skip++; return; }
        const d = GP.toDate(x.day); const col = x.kind === 'gym' ? 'data_gym_timetable' : 'data_room_timetable', f = x.kind === 'gym' ? 'gym' : 'room';
        ops.push({ type: 'set', col, id: GP.newId(col), data: { [f + '_date']: GP.appDate(d), [f + '_class']: x.c, [f + '_time']: x.p, [f + '_place']: x.s } });
      });
      if (!ops.length) return toast('모든 칸이 이미 다른 일정으로 채워져 있어 저장할 것이 없습니다.', true);
      try { await GP.commit(ops); } catch (e) { return toast('저장 실패: ' + e.message, true); }
      GP.invalidate('data_gym_timetable'); GP.invalidate('data_room_timetable');
      S.result = null; keep(); draw();
      toast(ops.length + '칸을 특별실 사용 시간표에 저장했습니다.' + (skip ? ' (그사이 채워진 ' + skip + '칸은 건너뜀)' : ''));
    }

    if (S.result) { (S.result.items || []).forEach((x) => { x.d = GP.toDate(x.day); }); try { await loadBusy(); } catch (e) { /* 표만 덜 채워짐 */ } }
    draw();
    return { redraw: draw };
  }
  window.GPAutoSpace = { render, solve };
})();
