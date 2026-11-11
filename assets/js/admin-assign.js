/* 관리자 > 시간표 배정
 *  이미 입력된 전담·강좌·특별실(체육 공간 포함) 일정을 피해서, 빈 칸에 새 강좌를 배정합니다.
 *  - 위: 강좌명 · 조건(요일, 교시, 시수, 체육 고려) · 날짜
 *  - 그 아래: 고른 날짜가 든 주부터 5주의 월간 일정(첫 주가 보이고, 나머지는 스크롤)
 *  - 반별 배정 차시 표 (시수와 같으면 흰 바탕, 부족하면 연노랑, 넘치면 분홍+빨강)
 *  - 5주치 빈 시간표(칸에 반 번호를 띄어 써서 입력, 예: "1 2 3") + 주별 안내 창 + 버튼(첫 줄만)
 *  [일정 반영하기]를 누르기 전에는 아무것도 저장되지 않습니다(강좌별 일정으로 저장 → 반별·강좌별·월간 일정에 표시).
 */
(function () {
  const DAYS = ['월', '화', '수', '목', '금'];
  const SRC = { sub: { label: '전담', bg: '#e0e7ff' }, add: { label: '강좌', bg: '#dcfce7' }, gym: { label: '체육공간', bg: '#fef3c7' }, room: { label: '특별실', bg: '#fce7f3' } };
  const ALL_TOKENS = /공통|전체|학년|전담/;   // 반 대신 이런 말이 적힌 일정은 모든 반에 해당
  const split = (v) => String(v == null ? '' : v).split(/[,，、]+/).map((x) => x.trim()).filter(Boolean);

  // 화면을 다시 그려도 입력하던 내용이 남도록 (페이지를 새로 열면 비워짐)
  const S = window.__asg = window.__asg || { name: '', days: [0, 1, 2, 3, 4], pers: null, hours: '', gym: false, date: '', grid: {}, notes: {} };

  async function render(view, h) {
    const { toast, esc, BTN, BTN_P, BTN_G, INP, CARD } = h;
    const GP = window.GP, APP = window.APP;
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';

    // ---------- 기본 자료 ----------
    let periods = (await GP.readList('list_time')).map((i) => i.value).filter(Boolean); if (!periods.length) periods = [1, 2, 3, 4, 5, 6].map((n) => n + '교시');
    const classes = (await APP.getGeneral()).classNames.slice();
    if (!S.pers) S.pers = periods.filter((p) => !/점심/.test(p));
    S.pers = S.pers.filter((p) => periods.indexOf(p) >= 0);
    if (!S.date) S.date = GP.ymd(new Date());
    let hol = new Map(), idx = new Map();
    async function loadEvents() {
      GP.invalidate('data_sub_timetable'); GP.invalidate('data_add_timetable'); GP.invalidate('data_gym_timetable'); GP.invalidate('data_room_timetable');
      const [sub, add, gym, room, hm] = await Promise.all(['data_sub_timetable', 'data_add_timetable', 'data_gym_timetable', 'data_room_timetable'].map((c) => GP.getCol(c)).concat([APP.holidayMap()]));
      hol = hm; idx = new Map();
      const put = (src, d, cls, time, name) => {
        const dt = GP.toDate(d); if (!dt) return; const day = GP.ymd(dt); const cl = split(cls); if (!cl.length) return;
        split(time).forEach((p) => { const k = day + '|' + p; if (!idx.has(k)) idx.set(k, []); idx.get(k).push({ src, cls: cl, name: String(name || '').trim() }); });
      };
      sub.forEach((r) => put('sub', r.sub_date, r.sub_class, r.sub_time, r.sub_name));
      add.forEach((r) => put('add', r.add_date, r.add_class, r.add_time, r.add_name));
      gym.forEach((r) => put('gym', r.gym_date, r.gym_class, r.gym_time, r.gym_place));
      room.forEach((r) => put('room', r.room_date, r.room_class, r.room_time, r.room_place));
    }
    await loadEvents();

    // ---------- 계산 도우미 ----------
    const weeks = () => { const mon = GP.mondayOf(GP.toDate(S.date) || new Date()); return [0, 1, 2, 3, 4].map((w) => DAYS.map((_, d) => GP.addDays(mon, w * 7 + d))); };
    const md = (d) => (d.getMonth() + 1) + '/' + d.getDate();
    const key = (d, p) => GP.ymd(d) + '|' + p;
    const hits = (cls, d, p) => (idx.get(key(d, p)) || []).filter((e) => (!S.gym || e.src !== 'gym') && e.cls.some((c) => c === cls || ALL_TOKENS.test(c)));
    // 칸 내용 해석: "1 2 3" → ['1반','2반','3반'] (번호는 관리자의 학급 순서 → 학급 이름)
    function parse(text) {
      const out = [], bad = [];
      String(text || '').trim().split(/[\s,，、]+/).filter(Boolean).forEach((t) => {
        const n = parseInt(t, 10); const c = /^\d+$/.test(t) && n >= 1 && n <= classes.length ? classes[n - 1] : (classes.indexOf(t) >= 0 ? t : null);
        if (!c) bad.push(t); else if (out.indexOf(c) < 0) out.push(c);
      });
      return { cls: out, bad };
    }
    // 한 칸의 문제(겹침·휴일·잘못된 반)
    function check(d, p) {
      const v = S.grid[key(d, p)]; if (!v || !v.trim()) return { cls: [], msgs: [], bad: false };
      const r = parse(v), msgs = [], at = md(d) + '(' + DAYS[(d.getDay() + 6) % 7] + ') ' + p + ': ';
      r.bad.forEach((t) => msgs.push(at + '"' + t + '"은(는) 없는 반입니다.'));
      const hd = hol.get(GP.ymd(d)); if (hd) msgs.push(at + '휴일(' + hd.name + ')입니다.');
      r.cls.forEach((c) => hits(c, d, p).forEach((e) => msgs.push(at + c + ' ' + (e.name || '') + '(' + SRC[e.src].label + ') 일정과 겹칩니다.')));
      return { cls: r.cls, msgs, bad: msgs.length > 0 };
    }
    const counts = () => { const m = {}; classes.forEach((c) => { m[c] = 0; }); weeks().forEach((wk) => wk.forEach((d) => periods.forEach((p) => parse(S.grid[key(d, p)]).cls.forEach((c) => { m[c]++; })))); return m; };

    // ---------- 그리기 ----------
    function draw() {
      const W = weeks(), hours = parseInt(S.hours, 10) || 0;
      const chk = (name, val, on, label) => '<label class="inline-flex items-center gap-1 mr-2"><input type="checkbox" data-' + name + '="' + esc(val) + '" ' + (on ? 'checked' : '') + '>' + esc(label) + '</label>';
      const cond = '<div class="' + CARD + '"><h2 class="font-bold text-lg">시간표 배정 <span class="text-xs font-normal text-slate-400">전담·강좌·특별실 일정을 피해 빈 칸에 강좌를 배정합니다. [일정 반영하기]를 눌러야 저장됩니다.</span></h2>' +
        '<div class="grid md:grid-cols-2 gap-3 text-sm">' +
        '<label class="font-semibold">강좌명<input id="aName" class="' + INP + ' w-full mt-1" value="' + esc(S.name) + '" placeholder="예: 심폐소생술"></label>' +
        '<div class="grid grid-cols-2 gap-3"><label class="font-semibold">시수 <span class="font-normal text-slate-400">(반마다)</span><input id="aHours" type="number" min="0" class="' + INP + ' w-full mt-1 text-right" value="' + esc(S.hours) + '"></label>' +
        '<label class="font-semibold">날짜<input id="aDate" type="date" class="' + INP + ' w-full mt-1" value="' + esc(S.date) + '"></label></div>' +
        '<div><div class="font-semibold mb-1">요일</div>' + DAYS.map((d, i) => chk('aday', i, S.days.indexOf(i) >= 0, d)).join('') + '</div>' +
        '<div><div class="font-semibold mb-1">교시</div>' + periods.map((p) => chk('aper', p, S.pers.indexOf(p) >= 0, p)).join('') + '</div>' +
        '<div>' + chk('agym', 1, S.gym, '체육 고려 (체육 공간 일정과 겹쳐도 괜찮음)') + '</div></div></div>';
      // 월간 일정 (5주, 첫 주만 보이고 스크롤)
      const evCell = (cls, d, p) => {
        const list = (idx.get(key(d, p)) || []).filter((e) => e.cls.some((c) => c === cls || ALL_TOKENS.test(c)));
        const mine = parse(S.grid[key(d, p)]).cls.indexOf(cls) >= 0;
        const t = list.map((e) => e.name || SRC[e.src].label).join(', ');
        const bg = list.length ? SRC[list[0].src].bg : '';
        return '<td class="border text-center" title="' + esc(list.map((e) => SRC[e.src].label + ': ' + e.name).join('\n') + (mine ? (list.length ? '\n' : '') + '배정 중: ' + S.name : '')) + '" style="height:22px;padding:0 1px;font-size:10px;line-height:1.1;overflow:hidden;white-space:nowrap;' + (bg ? 'background:' + bg + ';' : '') + (mine ? 'outline:2px solid #6366f1;outline-offset:-2px;' : '') + '">' + esc(t.length > 4 ? t.slice(0, 4) + '…' : t) + '</td>';
      };
      const monthWeek = (wk, w) => '<div class="mw" style="margin-bottom:10px"><div class="text-xs font-semibold text-slate-500 mb-1">' + (w + 1) + '주차 · ' + md(wk[0]) + ' ~ ' + md(wk[4]) + '</div><div class="overflow-x-auto"><table class="border-collapse text-xs" style="table-layout:fixed;width:100%;min-width:' + (60 + 5 * periods.length * 26) + 'px"><colgroup><col style="width:56px"></colgroup>' +
        '<thead><tr><th class="border bg-slate-100"></th>' + wk.map((d, i) => { const hd = hol.get(GP.ymd(d)); return '<th class="border bg-slate-100 font-semibold" colspan="' + periods.length + '" style="' + (hd ? 'color:#dc2626' : '') + '">' + md(d) + '(' + DAYS[i] + ')' + (hd ? ' ' + esc(hd.name) : '') + '</th>'; }).join('') + '</tr>' +
        '<tr><th class="border bg-slate-50"></th>' + wk.map(() => periods.map((p) => '<th class="border bg-slate-50 font-normal" style="font-size:10px;overflow:hidden">' + esc(String(p).replace(/교시$/, '')) + '</th>').join('')).join('') + '</tr></thead><tbody>' +
        classes.map((c) => '<tr><th class="border bg-slate-50 font-semibold" style="font-size:11px">' + esc(c) + '</th>' + wk.map((d) => hol.get(GP.ymd(d)) ? periods.map(() => '<td class="border" style="background:#e5e7eb"></td>').join('') : periods.map((p) => evCell(c, d, p)).join('')).join('') + '</tr>').join('') + '</tbody></table></div></div>';
      const legend = Object.keys(SRC).map((k) => '<span class="inline-flex items-center gap-1 mr-3"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' + SRC[k].bg + '"></span>' + SRC[k].label + '</span>').join('') + '<span class="inline-flex items-center gap-1"><span style="display:inline-block;width:12px;height:12px;border:2px solid #6366f1;border-radius:3px"></span>배정 중</span>';
      const month = '<div class="' + CARD + '"><div class="flex flex-wrap items-center justify-between gap-2"><h3 class="font-bold">월간 일정 <span class="text-xs font-normal text-slate-400">고른 주부터 5주 · 아래로 스크롤하면 다음 주</span></h3><div class="text-xs text-slate-500">' + legend + '</div></div>' +
        '<div id="aMonth" style="overflow-y:auto">' + W.map(monthWeek).join('') + '</div></div>';
      // 반별 배정 차시
      const cnt = counts();
      const countBox = '<div class="' + CARD + '"><h3 class="font-bold">반별 배정 <span class="text-xs font-normal text-slate-400">' + (hours ? '시수 ' + hours + '차시 기준 · 맞음 = 흰색, 부족 = 연노랑, 넘침 = 분홍' : '시수를 넣으면 맞음·부족·넘침을 색으로 보여 줍니다') + '</span></h3>' +
        '<div id="aCount" class="flex flex-wrap gap-2">' + countHtml(cnt, hours) + '</div></div>';
      // 빈 시간표 5주 + 안내 + 버튼(첫 줄만)
      const grid = W.map((wk, w) => '<div class="flex flex-col lg:flex-row gap-3 items-stretch"><div class="min-w-0" style="flex:3 1 0"><div class="text-xs font-semibold text-slate-500 mb-1">' + (w + 1) + '주차 · ' + md(wk[0]) + ' ~ ' + md(wk[4]) + '</div>' +
        '<table class="border-collapse text-sm w-full" style="table-layout:fixed"><colgroup><col style="width:64px"></colgroup><thead><tr><th class="border bg-slate-100 text-xs"></th>' +
        wk.map((d, i) => { const hd = hol.get(GP.ymd(d)); return '<th class="border bg-slate-100 text-xs py-1" style="' + (S.days.indexOf(i) < 0 ? 'color:#94a3b8;' : '') + (hd ? 'color:#dc2626;' : '') + '">' + md(d) + '(' + DAYS[i] + ')' + (hd ? '<div class="font-normal" style="font-size:10px">' + esc(hd.name) + '</div>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        periods.map((p) => '<tr><th class="border bg-slate-50 text-xs" style="' + (S.pers.indexOf(p) < 0 ? 'color:#94a3b8' : '') + '">' + esc(p) + '</th>' + wk.map((d, i) => {
          const k = key(d, p), off = !!hol.get(GP.ymd(d)) || S.days.indexOf(i) < 0 || S.pers.indexOf(p) < 0;
          return '<td class="border p-0" style="' + (off ? 'background:#f1f5f9' : '') + '"><input data-k="' + esc(k) + '" data-w="' + w + '" value="' + esc(S.grid[k] || '') + '" class="w-full text-center bg-transparent outline-none" style="height:28px;font-size:13px" placeholder="' + (off ? '' : '') + '"></td>';
        }).join('') + '</tr>').join('') + '</tbody></table></div>' +
        '<div class="min-w-0 border rounded-lg bg-white p-2 text-xs leading-relaxed overflow-y-auto" style="flex:2 1 0;max-height:' + (40 + periods.length * 29) + 'px" data-msg="' + w + '"></div>' +
        '<div class="flex lg:flex-col gap-2 shrink-0" style="width:120px">' + (w === 0 ? '<button id="aSave" class="' + BTN_P + '">일정 반영하기</button><button id="aReset" class="' + BTN_G + '">배치 초기화</button><button id="aAuto" class="' + BTN + ' bg-emerald-600 text-white hover:bg-emerald-700">자동 배치</button>' : '') + '</div></div>').join('<div style="height:14px"></div>');
      const help = '<p class="text-xs text-slate-400">칸에 반 번호를 띄어 써서 입력합니다(예: <b>1 2 3</b> → 1반, 2반, 3반). 다른 일정과 겹치면 칸이 분홍색으로 바뀌고 오른쪽 안내 창에 무엇과 겹치는지 나옵니다. 회색 칸은 휴일이거나 조건에서 고르지 않은 요일·교시입니다(입력은 가능, 자동 배치는 건너뜀).</p>';
      view.innerHTML = '<div class="space-y-5">' + cond + month + countBox + '<div class="' + CARD + '"><h3 class="font-bold">배정할 시간표 <span class="text-xs font-normal text-slate-400">5주</span></h3>' + help + grid + '</div></div>';
      // 월간 일정: 첫 주 높이만큼만 보이게
      const m = document.getElementById('aMonth'), first = m.querySelector('.mw'); if (first) m.style.maxHeight = (first.offsetHeight + 12) + 'px';
      W.forEach((_, w) => paintWeek(w));
      bind();
    }
    function countHtml(cnt, hours) {
      return classes.map((c) => {
        const n = cnt[c] || 0; let st = 'background:#fff;color:#0f172a'; if (hours) st = n === hours ? 'background:#fff;color:#0f172a' : n < hours ? 'background:#fef9c3;color:#0f172a' : 'background:#fce7f3;color:#dc2626';
        return '<div class="border rounded-lg px-3 py-1.5 text-sm font-bold" style="' + st + '">' + esc(c) + ' ' + n + '차시 배정</div>';
      }).join('');
    }
    // 한 주의 칸 색과 안내 창
    function paintWeek(w) {
      const W = weeks(), wk = W[w], msgs = [];
      wk.forEach((d) => periods.forEach((p) => {
        const inp = view.querySelector('input[data-k="' + key(d, p) + '"]'); if (!inp) return;
        const r = check(d, p); inp.style.background = r.bad ? '#fce7f3' : ''; inp.style.color = r.bad ? '#dc2626' : ''; inp.style.fontWeight = r.bad || (S.grid[key(d, p)] || '').trim() ? '700' : '';
        msgs.push(...r.msgs);
      }));
      const box = view.querySelector('[data-msg="' + w + '"]'); if (!box) return;
      const note = S.notes[w] ? '<div class="text-slate-500 mb-1">' + S.notes[w] + '</div>' : '';
      box.innerHTML = note + (msgs.length ? msgs.map((x) => '<div class="text-red-600 font-semibold">' + esc(x) + '</div>').join('') : (Object.keys(S.grid).some((k) => wk.some((d) => k.indexOf(GP.ymd(d) + '|') === 0) && S.grid[k].trim()) ? '<div class="text-emerald-700">겹치는 일정이 없습니다.</div>' : '<div class="text-slate-400">입력하면 겹치는 일정이 여기에 표시됩니다.</div>'));
    }
    function bind() {
      const $ = (id) => document.getElementById(id);
      $('aName').onchange = () => { S.name = $('aName').value.trim(); setTimeout(draw, 0); };
      $('aHours').onchange = () => { S.hours = $('aHours').value; const c = $('aCount'); if (c) c.innerHTML = countHtml(counts(), parseInt(S.hours, 10) || 0); };
      $('aDate').onchange = () => { if ($('aDate').value) { S.date = $('aDate').value; S.notes = {}; setTimeout(draw, 0); } };
      view.querySelectorAll('[data-aday]').forEach((el) => el.onchange = () => { const i = +el.dataset.aday; S.days = el.checked ? S.days.concat([i]).sort() : S.days.filter((x) => x !== i); draw(); });
      view.querySelectorAll('[data-aper]').forEach((el) => el.onchange = () => { const p = el.dataset.aper; S.pers = periods.filter((x) => (x === p ? el.checked : S.pers.indexOf(x) >= 0)); draw(); });
      view.querySelectorAll('[data-agym]').forEach((el) => el.onchange = () => { S.gym = el.checked; draw(); });
      view.querySelectorAll('input[data-k]').forEach((inp) => {
        inp.oninput = () => { const v = inp.value.replace(/[^\d\s가-힣a-zA-Z,]/g, ''); S.grid[inp.dataset.k] = v; paintWeek(+inp.dataset.w); const c = $('aCount'); if (c) c.innerHTML = countHtml(counts(), parseInt(S.hours, 10) || 0); };
        inp.onchange = () => { const m = $('aMonth'), top = m ? m.scrollTop : 0, focusK = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null; setTimeout(() => { const f = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : focusK; draw(); const m2 = $('aMonth'); if (m2) m2.scrollTop = top; const n = f && view.querySelector('input[data-k="' + f + '"]'); if (n) n.focus(); }, 0); };   // 칸을 벗어나면 월간 일정에도 '배정 중' 표시 (다음 칸 입력은 이어서)   // 칸을 벗어나면 월간 일정에도 '배정 중' 표시
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
      });
      $('aReset').onclick = () => { if (!Object.values(S.grid).some((v) => v && v.trim())) return toast('지울 내용이 없습니다.'); if (!confirm('입력 중인 배정을 모두 지울까요? (저장된 일정은 그대로입니다)')) return; S.grid = {}; S.notes = {}; draw(); };
      $('aAuto').onclick = autoFill;
      $('aSave').onclick = save;
    }

    // ---------- 자동 배치 ----------
    //  조건에서 고른 요일·교시의 빈 칸에, 다른 일정과 겹치지 않는 반을 한 칸에 한 반씩 넣습니다.
    //  남은 시수가 많은 반부터, 같은 날 같은 반은 되도록 한 번만 (부족하면 같은 날에도 넣음). 이미 입력한 칸은 건드리지 않습니다.
    function autoFill() {
      const hours = parseInt(S.hours, 10) || 0;
      if (!S.name) return toast('강좌명을 먼저 입력하세요.', true);
      if (!hours) return toast('시수를 먼저 입력하세요.', true);
      if (!S.days.length || !S.pers.length) return toast('요일과 교시를 하나 이상 고르세요.', true);
      const need = {}; const cnt = counts(); classes.forEach((c) => { need[c] = Math.max(0, hours - (cnt[c] || 0)); });
      const slots = []; weeks().forEach((wk, w) => wk.forEach((d, i) => { if (S.days.indexOf(i) < 0 || hol.get(GP.ymd(d))) return; S.pers.forEach((p) => slots.push({ w, d, p })); }));
      const usedDay = {}; Object.keys(S.grid).forEach((k) => parse(S.grid[k]).cls.forEach((c) => { usedDay[c + '|' + k.split('|')[0]] = true; }));
      let added = 0;
      for (const pass of [1, 2]) {
        for (const s of slots) {
          const k = key(s.d, s.p); if ((S.grid[k] || '').trim()) continue;
          const day = GP.ymd(s.d);
          const cand = classes.filter((c) => need[c] > 0 && !hits(c, s.d, s.p).length && (pass === 2 || !usedDay[c + '|' + day]))
            .sort((a, b) => need[b] - need[a] || classes.indexOf(a) - classes.indexOf(b));
          if (!cand.length) continue;
          const c = cand[0]; S.grid[k] = String(classes.indexOf(c) + 1); need[c]--; usedDay[c + '|' + day] = true; added++;
        }
        if (!classes.some((c) => need[c] > 0)) break;
      }
      const short = classes.filter((c) => need[c] > 0).map((c) => c + ' ' + need[c] + '차시');
      S.notes = { 0: (added ? '자동 배치로 ' + added + '칸을 채웠습니다.' : '새로 채울 칸이 없습니다.') + (short.length ? ' <b class="text-amber-700">배정하지 못한 시수: ' + short.join(', ') + '</b> (요일·교시 조건을 넓히거나 날짜를 바꿔 보세요)' : '') };
      draw(); toast(added ? '자동 배치를 마쳤습니다. 확인한 뒤 [일정 반영하기]를 누르세요.' : '새로 채울 칸이 없습니다.', !added);
    }

    // ---------- 일정 반영하기 ----------
    async function save() {
      if (!S.name) return toast('강좌명을 먼저 입력하세요.', true);
      const W = weeks(), tuples = [], badCells = [];
      W.forEach((wk) => wk.forEach((d) => periods.forEach((p) => { const r = check(d, p); if (r.bad) badCells.push(r.msgs[0]); r.cls.forEach((c) => tuples.push({ d, c, p })); })));
      if (!tuples.length) return toast('배정한 칸이 없습니다.', true);
      if (badCells.length && !confirm('겹치거나 문제가 있는 칸이 ' + badCells.length + '개 있습니다.\n\n' + badCells.slice(0, 8).join('\n') + (badCells.length > 8 ? '\n…' : '') + '\n\n그래도 반영할까요?')) return;
      const exist = new Set((await GP.getCol('data_add_timetable')).map((r) => { const d = GP.toDate(r.add_date); return d ? [GP.ymd(d), String(r.add_class).trim(), String(r.add_time).trim(), String(r.add_name).trim()].join('|') : ''; }));
      const ops = []; let skip = 0;
      tuples.forEach((t) => { const k = [GP.ymd(t.d), t.c, t.p, S.name].join('|'); if (exist.has(k)) { skip++; return; } exist.add(k); ops.push({ type: 'set', col: 'data_add_timetable', id: GP.newId('data_add_timetable'), data: { add_date: GP.appDate(t.d), add_class: t.c, add_time: t.p, add_name: S.name } }); });
      if (!ops.length) return toast('모두 이미 저장된 일정입니다.');
      if (!confirm('[' + S.name + '] 일정 ' + ops.length + '건을 저장합니다.' + (skip ? ' (이미 있는 ' + skip + '건은 건너뜀)' : '') + '\n저장하면 강좌별·반별·월간 일정에 표시됩니다.\n\n계속할까요?')) return;
      await GP.commit(ops); S.grid = {}; S.notes = { 0: '[' + S.name + '] ' + ops.length + '건을 저장했습니다. 저장한 일정은 이제 위 월간 일정에 나옵니다.' };
      await loadEvents(); draw(); toast('[' + S.name + '] 일정 ' + ops.length + '건을 저장했습니다.');
    }

    draw();
  }
  window.GPAssign = { render };
})();
