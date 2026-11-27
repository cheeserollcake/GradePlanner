/* 관리자 > 시간표 배정 > 시간표 일괄 업로드
 *  왼쪽: 체육 공간 시간표 (날짜 · 반 · 교시 · 공간이름)  → 특별실 시간표(체육 공간/특별실)와 같은 방식으로 저장
 *        한 칸(날짜·교시·공간)에는 한 줄만: 이미 있으면 새 내용으로 바꿈. 파일 안에서 같은 칸이 여러 번 나오면 반을 합침.
 *  오른쪽: 강좌 일정 (날짜 · 학급 · 교시 · 강좌명) → 강좌별 일정으로 저장(날짜·반·교시마다 한 줄, 시간표 배정과 같은 방식)
 *        학급·교시는 쉼표로 여러 개: "6반, 7반" / "1교시, 3교시" → 반 × 교시 모든 조합. 똑같은 일정이 이미 있으면 건너뜀.
 *  날짜: "2026년 05월 11일 (월)" (2026-05-11, 2026.5.11, 엑셀 날짜도 읽음)
 */
(function () {
  const ALL_TOKENS = /^(공통|전체|학년|전담)$/;
  const split = (v) => String(v == null ? '' : v).split(/[,，、\/]+/).map((x) => x.trim()).filter(Boolean);
  const last = { gym: '', add: '' };   // 화면을 다시 그려도 마지막 결과가 남도록

  const GYM_COLS = [
    { key: 'date', label: '날짜', alias: ['일자'], req: true, w: 22, ex: '2026년 05월 11일 (월)' },
    { key: 'cls', label: '반', alias: ['학급', '반이름'], req: true, w: 18, ex: '1반, 2반' },
    { key: 'per', label: '교시', alias: ['시간'], req: true, w: 14, ex: '1교시' },
    { key: 'place', label: '공간이름', alias: ['공간', '장소', '체육공간'], req: true, w: 16, ex: '강당' }
  ];
  const ADD_COLS = [
    { key: 'date', label: '날짜', alias: ['일자'], req: true, w: 22, ex: '2026년 05월 11일 (월)' },
    { key: 'cls', label: '학급', alias: ['반'], req: true, w: 24, ex: '6반, 7반, 8반, 9반' },
    { key: 'per', label: '교시', alias: ['시간'], req: true, w: 16, ex: '1교시, 3교시' },
    { key: 'name', label: '강좌명', alias: ['강좌', '일정', '일정명'], req: true, w: 20, ex: '앨범(야외)' }
  ];

  async function context() {
    const GP = window.GP, APP = window.APP;
    const gen = await APP.getGeneral();
    let periods = (await GP.readList('list_time')).map((i) => i.value).filter(Boolean); if (!periods.length) periods = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    const gyms = (await GP.readList('list_gym')).map((i) => i.value).filter(Boolean), rooms = (await GP.readList('list_room')).map((i) => i.value).filter(Boolean);
    const hol = await APP.holidayMap(); const yr = gen.year ? APP.yearRange(Number(gen.year)) : null;
    return { gen, classes: gen.classNames.slice(), periods, gyms, rooms, hol, yr };
  }
  // "1반"/"1" → 학급 이름,  "1교시"/"1" → 교시 이름
  const normCls = (t, classes) => { const s = String(t).replace(/\s+/g, ''); if (classes.indexOf(s) >= 0) return s; const n = /^(\d+)반?$/.exec(s); if (!n) return null; const a = n[1] + '반'; if (classes.indexOf(a) >= 0) return a; const i = +n[1]; return i >= 1 && i <= classes.length ? classes[i - 1] : null; };
  const normPer = (t, periods) => { const s = String(t).replace(/\s+/g, ''); const hit = periods.find((p) => String(p).replace(/\s+/g, '') === s); if (hit) return hit; const n = /^(\d+)(교시)?$/.exec(s); if (!n) return null; return periods.find((p) => String(p).replace(/\s+/g, '') === n[1] + '교시') || null; };
  function readDate(v, ctx) {
    const GP = window.GP; let s = String(v || '').trim(); if (!s) return { err: '날짜가 비었음' };
    if (/^\d{5}(\.\d+)?$/.test(s)) { const d0 = new Date(Math.round((Number(s) - 25569) * 86400000)); s = d0.getUTCFullYear() + '-' + (d0.getUTCMonth() + 1) + '-' + d0.getUTCDate(); }   // 엑셀 날짜 숫자
    if (/^\d{8}$/.test(s)) s = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6);
    const d = GP.toDate(s.replace(/\s*\([^)]*\)\s*$/, '')); if (!d) return { err: '날짜를 읽을 수 없음(' + s + ')' };
    if (ctx.yr && (d < ctx.yr.start || d > ctx.yr.end)) return { err: '지금 학년도(' + ctx.gen.year + ') 기간 밖의 날짜' };
    const h = ctx.hol.get(GP.ymd(d)); if (h) return { err: '휴일(' + (h.name || h) + ')' };
    if (d.getDay() === 0 || d.getDay() === 6) return { err: '주말' };
    return { d };
  }

  // ---------------- 체육 공간 ----------------
  async function uploadGym(toast) {
    const GP = window.GP;
    const recs = await window.BulkUpload.pick({ cols: GYM_COLS }); if (recs === null) return null;
    if (!recs.length) { toast('읽을 수 있는 줄이 없습니다. 양식의 머리글(날짜·반·교시·공간이름)을 확인해 주세요.', true); return null; }
    const ctx = await context(); const skip = []; const slots = new Map();
    recs.forEach((r, i) => {
      const row = r.__row || i + 1, miss = GYM_COLS.filter((c) => !r[c.key]).map((c) => c.label); if (miss.length) return skip.push([row, miss.join('·') + ' 칸이 비었음']);
      const dt = readDate(r.date, ctx); if (dt.err) return skip.push([row, dt.err]);
      const isGym = ctx.gyms.indexOf(r.place.trim()) >= 0, isRoom = !isGym && ctx.rooms.indexOf(r.place.trim()) >= 0;
      if (!isGym && !isRoom) return skip.push([row, '"' + r.place + '"은(는) 공간 개방 설정에 없는 공간']);
      const cl = [], badC = []; split(r.cls).forEach((t) => { const c = t === '불가' ? '불가' : normCls(t, ctx.classes); if (!c) badC.push(t); else if (cl.indexOf(c) < 0) cl.push(c); });
      if (badC.length) return skip.push([row, '없는 반(' + badC.join(', ') + ')']);
      const ps = [], badP = []; split(r.per).forEach((t) => { const p = normPer(t, ctx.periods); if (!p) badP.push(t); else if (ps.indexOf(p) < 0) ps.push(p); });
      if (badP.length) return skip.push([row, '없는 교시(' + badP.join(', ') + ')']);
      ps.forEach((p) => {
        const k = GP.ymd(dt.d) + '|' + p + '|' + r.place.trim();
        const s = slots.get(k) || { d: dt.d, p, place: r.place.trim(), isGym, cls: [] }; cl.forEach((c) => { if (s.cls.indexOf(c) < 0) s.cls.push(c); }); slots.set(k, s);
      });
    });
    if (!slots.size) { last.gym = result('체육 공간', 0, 0, 0, skip); toast('저장할 수 있는 줄이 없습니다.', true); return true; }
    GP.invalidate('data_gym_timetable'); GP.invalidate('data_room_timetable');
    const [gym, room] = await Promise.all([GP.getCol('data_gym_timetable'), GP.getCol('data_room_timetable')]);
    const ops = []; let add = 0, upd = 0, same = 0;
    slots.forEach((s) => {
      const p = s.isGym ? 'gym' : 'room', col = 'data_' + p + '_timetable', list = s.isGym ? gym : room;
      const cls = s.cls.sort((a, b) => (ctx.classes.indexOf(a) + 1 || 999) - (ctx.classes.indexOf(b) + 1 || 999)).join(', ');
      const found = list.filter((r) => { const x = GP.toDate(r[p + '_date']); return x && GP.ymd(x) === GP.ymd(s.d) && String(r[p + '_time'] || '').trim() === s.p && String(r[p + '_place'] || '').trim() === s.place; });
      const data = { [p + '_date']: GP.appDate(s.d), [p + '_class']: cls, [p + '_time']: s.p, [p + '_place']: s.place };
      if (found.length) {
        if (found.length === 1 && String(found[0][p + '_class'] || '').trim() === cls) { same++; return; }
        upd++; ops.push({ type: 'update', col, id: found[0]._id, data }); found.slice(1).forEach((r) => ops.push({ type: 'delete', col, id: r._id }));
      } else { add++; ops.push({ type: 'set', col, id: GP.newId(col), data }); }
    });
    if (!ops.length) { last.gym = result('체육 공간', 0, 0, same, skip); toast('새로 저장할 내용이 없습니다(모두 이미 같은 내용).'); return true; }
    if (!confirm('체육 공간 시간표를 저장합니다.\n\n새로 추가: ' + add + '칸\n내용 바꿈(같은 날짜·교시·공간에 이미 있던 칸): ' + upd + '칸' + (same ? '\n이미 같은 내용: ' + same + '칸' : '') + (skip.length ? '\n건너뛴 줄: ' + skip.length + '줄 (저장 후 아래에 이유 표시)' : '') + '\n\n계속할까요?')) return null;
    await GP.commit(ops); GP.invalidate('data_gym_timetable'); GP.invalidate('data_room_timetable');
    last.gym = result('체육 공간', add, upd, same, skip); toast('체육 공간 시간표 ' + (add + upd) + '칸을 저장했습니다.'); return true;
  }

  // ---------------- 강좌 일정 ----------------
  async function uploadAdd(toast) {
    const GP = window.GP;
    const recs = await window.BulkUpload.pick({ cols: ADD_COLS }); if (recs === null) return null;
    if (!recs.length) { toast('읽을 수 있는 줄이 없습니다. 양식의 머리글(날짜·학급·교시·강좌명)을 확인해 주세요.', true); return null; }
    const ctx = await context(); const skip = []; const tuples = new Map();
    recs.forEach((r, i) => {
      const row = r.__row || i + 1, miss = ADD_COLS.filter((c) => !r[c.key]).map((c) => c.label); if (miss.length) return skip.push([row, miss.join('·') + ' 칸이 비었음']);
      const dt = readDate(r.date, ctx); if (dt.err) return skip.push([row, dt.err]);
      const cl = [], badC = []; split(r.cls).forEach((t) => { const c = ALL_TOKENS.test(t) ? t : normCls(t, ctx.classes); if (!c) badC.push(t); else if (cl.indexOf(c) < 0) cl.push(c); });
      if (badC.length) return skip.push([row, '없는 학급(' + badC.join(', ') + ')']);
      const ps = [], badP = []; split(r.per).forEach((t) => { const p = normPer(t, ctx.periods); if (!p) badP.push(t); else if (ps.indexOf(p) < 0) ps.push(p); });
      if (badP.length) return skip.push([row, '없는 교시(' + badP.join(', ') + ')']);
      const name = r.name.trim();
      cl.forEach((c) => ps.forEach((p) => { const k = [GP.ymd(dt.d), c, p, name].join('|'); if (!tuples.has(k)) tuples.set(k, { d: dt.d, c, p, name }); }));
    });
    GP.invalidate('data_add_timetable');
    const exist = new Set((await GP.getCol('data_add_timetable')).map((r) => { const d = GP.toDate(r.add_date); return d ? [GP.ymd(d), String(r.add_class).trim(), String(r.add_time).trim(), String(r.add_name).trim()].join('|') : ''; }));
    const ops = []; let same = 0; const names = new Set();
    tuples.forEach((t, k) => { if (exist.has(k)) { same++; return; } names.add(t.name); ops.push({ type: 'set', col: 'data_add_timetable', id: GP.newId('data_add_timetable'), data: { add_date: GP.appDate(t.d), add_class: t.c, add_time: t.p, add_name: t.name } }); });
    if (!ops.length) { last.add = result('강좌 일정', 0, 0, same, skip); toast(tuples.size ? '새로 저장할 일정이 없습니다(모두 이미 있음).' : '저장할 수 있는 줄이 없습니다.', !tuples.size); return true; }
    if (!confirm('강좌 일정을 저장합니다.\n\n새로 추가: ' + ops.length + '건 (반 × 교시 한 칸이 1건)\n강좌: ' + [...names].slice(0, 8).join(', ') + (names.size > 8 ? ' 외 ' + (names.size - 8) + '개' : '') + (same ? '\n이미 있는 일정: ' + same + '건 (건너뜀)' : '') + (skip.length ? '\n건너뛴 줄: ' + skip.length + '줄 (저장 후 아래에 이유 표시)' : '') + '\n\n계속할까요?')) return null;
    await GP.commit(ops); GP.invalidate('data_add_timetable');
    last.add = result('강좌 일정', ops.length, 0, same, skip, '건'); toast('강좌 일정 ' + ops.length + '건을 저장했습니다.'); return true;
  }

  const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function result(title, add, upd, same, skip, unit) {
    const u = unit || '칸';
    const head = '<div class="font-semibold text-slate-700">' + escH(title) + ' 업로드 결과</div>' +
      '<div>새로 추가 <b class="text-emerald-700">' + add + u + '</b>' + (upd ? ' · 내용 바꿈 <b class="text-indigo-700">' + upd + u + '</b>' : '') + (same ? ' · 이미 있음 ' + same + u : '') + (skip.length ? ' · 건너뜀 <b class="text-red-600">' + skip.length + '줄</b>' : '') + '</div>';
    const list = skip.length ? '<div class="mt-1 text-red-600">' + skip.slice(0, 30).map(([r, why]) => '· 엑셀 ' + r + '행: ' + escH(why)).join('<br>') + (skip.length > 30 ? '<br>· … 외 ' + (skip.length - 30) + '줄' : '') + '</div>' : '';
    return head + list;
  }

  // 한 칸(체육 공간 또는 강좌 일정)을 el 안에 그림. 관리자 > 시간표 설정 > 시간표 일괄 업로드 에서 씀
  const INFO = {
    gym: { title: '체육 공간 시간표', cols: GYM_COLS, file: '체육공간_시간표_업로드_양식', sheet: '체육 공간 시간표', fn: uploadGym,
      desc: '한 줄에 한 칸: 날짜 · 반 · 교시 · 공간이름. 특별실 시간표의 체육 공간에 들어가고 월간 시간표·반별 일정 조회에도 나옵니다. 같은 날짜·교시·공간에 이미 반이 있으면 새 내용으로 바뀝니다. 반은 "1반, 2반"처럼 여러 개 적을 수 있습니다.' },
    add: { title: '강좌 일정', cols: ADD_COLS, file: '강좌일정_업로드_양식', sheet: '강좌 일정', fn: uploadAdd,
      desc: '한 줄에 강좌 하나: 날짜 · 학급 · 교시 · 강좌명. 학급·교시는 쉼표로 여러 개(예: 6반, 7반 / 1교시, 3교시 → 모든 조합). 강좌별 시간표 조회, 홈·개요의 학년 강사 일정, 월간 시간표, 반별 일정 조회에 나옵니다. 이미 있는 일정과 같으면 건너뜁니다.' }
  };
  function renderBox(el, side, h) {
    const { toast, BTN_G } = h, o = INFO[side];
    el.innerHTML = '<h3 class="font-semibold">' + o.title + '</h3><p class="text-sm text-slate-500">' + o.desc + '</p>' +
      '<p class="text-xs text-slate-400">날짜는 <b>2026년 05월 11일 (월)</b> 형식(2026-05-11도 됨). 휴일·주말·학년도 밖 날짜와 없는 반·교시' + (side === 'gym' ? '·공간' : '') + '이 적힌 줄은 건너뛰고 이유를 알려 줍니다.</p>' +
      '<div class="flex flex-wrap gap-1"><button data-bt="up" type="button" data-gpi="upload" data-tip="데이터 업로드"></button><button data-bt="tpl" type="button" data-gpi="template" data-tip="업로드 양식 다운"></button></div>' +
      '<div data-bt="res" class="text-xs leading-relaxed bg-white border rounded p-2"' + (last[side] ? '' : ' style="display:none"') + '>' + last[side] + '</div>';
    const q = (k) => el.querySelector('[data-bt="' + k + '"]');
    q('tpl').onclick = () => { window.BulkUpload.template({ file: o.file, sheet: o.sheet, cols: o.cols }); toast('양식을 내려받았습니다.'); };
    q('up').onclick = async () => {
      const b = q('up'); b.disabled = true; b.classList.add('gpi-busy');
      try { const ok = await o.fn(toast); if (ok) { const r = q('res'); r.innerHTML = last[side]; r.style.display = ''; } }
      catch (e) { console.warn(e); toast('업로드하지 못했습니다: ' + (e && e.message ? e.message : e), true); }
      finally { b.disabled = false; b.classList.remove('gpi-busy'); }
    };
  }
  window.GPBulkTT = { renderBox };
})();
