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
  const S = window.__asg = window.__asg || { name: '', days: [0, 1, 2, 3, 4], pers: null, hours: '', gym: true, block: false, date: '', grid: {}, notes: {} };

  // 켜기/끄기 스위치 모양 (한 번만 넣음)
  function toggleCss() {
    if (document.getElementById('gp-tg-css')) return; const st = document.createElement('style'); st.id = 'gp-tg-css';
    st.textContent = '.gp-tg{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none}.gp-tg input{position:absolute;opacity:0;width:0;height:0}' +
      '.gp-tg-sw{position:relative;width:30px;height:17px;border-radius:999px;background:#cbd5e1;transition:background .2s;flex-shrink:0}' +
      '.gp-tg-sw::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}' +
      '.gp-tg input:checked+.gp-tg-sw{background:#4f46e5}.gp-tg input:checked+.gp-tg-sw::after{transform:translateX(13px)}.gp-tg input:focus-visible+.gp-tg-sw{outline:2px solid #818cf8;outline-offset:2px}' +
      '.gp-tg-txt{font-size:11px;font-weight:700;color:#94a3b8;min-width:2em}.gp-tg-txt::after{content:"OFF"}.gp-tg input:checked~.gp-tg-txt{color:#4f46e5}.gp-tg input:checked~.gp-tg-txt::after{content:"ON"}' +
      '.asg-cond input[type=checkbox]{width:15px;height:15px;accent-color:#4f46e5;vertical-align:-2px}' +
      '.asg-side{display:none}.asg-top{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0}' +
      '@media (min-width:1024px){.asg-side{display:flex}.asg-top{display:none}}@media (max-width:420px){.asg-top{grid-template-columns:minmax(0,1fr)}}';
    document.head.appendChild(st);
  }
  async function render(view, h) {
    toggleCss();
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
    const hits = (cls, d, p) => (idx.get(key(d, p)) || []).filter((e) => (S.gym || e.src !== 'gym') && e.cls.some((c) => c === cls || ALL_TOKENS.test(c)));
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
      const tog = (name, on, label) => '<label class="gp-tg"><span class="font-semibold">' + esc(label) + '</span><input type="checkbox" data-' + name + '="1" ' + (on ? 'checked' : '') + '><span class="gp-tg-sw" aria-hidden="true"></span><span class="gp-tg-txt"></span></label>';   // 휴대폰 설정 같은 켜기/끄기 스위치
      const chk = (name, val, on, label) => '<label class="inline-flex items-center gap-1 mr-2"><input type="checkbox" data-' + name + '="' + esc(val) + '" ' + (on ? 'checked' : '') + '>' + esc(label) + '</label>';
      const cond = '<div class="' + CARD + '"><h2 class="font-bold text-lg">시간표 배정 <span class="text-xs font-normal text-slate-400">전담·강좌·특별실 일정을 피해 빈 칸에 강좌를 배정합니다. [일정 반영하기]를 눌러야 저장됩니다.</span></h2>' +
        '<div class="grid md:grid-cols-2 gap-3 text-sm">' +
        '<label class="font-semibold">강좌명<input id="aName" class="' + INP + ' w-full mt-1" value="' + esc(S.name) + '" placeholder="예: 심폐소생술"></label>' +
        '<div class="grid grid-cols-2 gap-3"><label class="font-semibold">시수<input id="aHours" type="number" min="0" class="' + INP + ' w-full mt-1 text-right" value="' + esc(S.hours) + '"></label>' +
        '<label class="font-semibold">날짜<input id="aDate" type="date" class="' + INP + ' w-full mt-1" value="' + esc(S.date) + '"></label></div>' +
        '</div>' +
        // 조건: 요일 · 교시 · 체육 고려 · 연차시
        '<div class="asg-cond border rounded-lg bg-slate-50 p-3 space-y-2 text-sm mt-3"><div class="font-bold">조건</div>' +
        '<div class="flex flex-wrap items-center gap-y-1"><span class="font-semibold w-14 shrink-0">요일</span>' + DAYS.map((d, i) => chk('aday', i, S.days.indexOf(i) >= 0, d)).join('') + '</div>' +
        '<div class="flex flex-wrap items-center gap-y-1"><span class="font-semibold w-14 shrink-0">교시</span>' + periods.map((p) => chk('aper', p, S.pers.indexOf(p) >= 0, p)).join('') + '</div>' +
        '<div class="flex flex-wrap items-center gap-x-8 gap-y-2 pt-1">' + tog('agym', S.gym, '체육 고려') + tog('ablock', S.block, '연차시') + '</div></div></div>';
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
      // 버튼: 넓은 화면은 첫 주 옆, 좁은 화면은 [배정할 시간표] 제목 바로 아래 한 줄(더 좁으면 한 줄에 하나)
      const btns = '<button data-act="save" class="' + BTN_P + ' whitespace-nowrap w-full">일정 반영하기</button><button data-act="reset" class="' + BTN_G + ' whitespace-nowrap w-full">배치 초기화</button><button data-act="auto" class="' + BTN + ' bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap w-full">자동 배치</button>';
      const grid = W.map((wk, w) => '<div class="flex flex-col lg:flex-row gap-3 items-stretch"><div class="min-w-0" style="flex:3 1 0"><div class="text-xs font-semibold text-slate-500 mb-1">' + (w + 1) + '주차 · ' + md(wk[0]) + ' ~ ' + md(wk[4]) + '</div>' +
        '<table class="border-collapse text-sm w-full" style="table-layout:fixed"><colgroup><col style="width:64px"></colgroup><thead><tr><th class="border bg-slate-100 text-xs"></th>' +
        wk.map((d, i) => { const hd = hol.get(GP.ymd(d)); return '<th class="border bg-slate-100 text-xs py-1" style="' + (S.days.indexOf(i) < 0 ? 'color:#94a3b8;' : '') + (hd ? 'color:#dc2626;' : '') + '">' + md(d) + '(' + DAYS[i] + ')' + (hd ? '<div class="font-normal" style="font-size:10px">' + esc(hd.name) + '</div>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
        periods.map((p) => '<tr><th class="border bg-slate-50 text-xs" style="' + (S.pers.indexOf(p) < 0 ? 'color:#94a3b8' : '') + '">' + esc(p) + '</th>' + wk.map((d, i) => {
          const k = key(d, p), off = !!hol.get(GP.ymd(d)) || S.days.indexOf(i) < 0 || S.pers.indexOf(p) < 0;
          return '<td class="border p-0" style="' + (off ? 'background:#f1f5f9' : '') + '"><input data-k="' + esc(k) + '" data-w="' + w + '" value="' + esc(S.grid[k] || '') + '" class="w-full text-center bg-transparent outline-none" style="height:28px;font-size:13px" placeholder="' + (off ? '' : '') + '"></td>';
        }).join('') + '</tr>').join('') + '</tbody></table></div>' +
        '<div class="min-w-0 border rounded-lg bg-white p-2 text-xs leading-relaxed overflow-y-auto" style="flex:2 1 0;min-height:5.5rem;max-height:' + (40 + periods.length * 29) + 'px" data-msg="' + w + '"></div>' +
        '<div class="asg-side flex-col gap-2 shrink-0" style="width:9rem">' + (w === 0 ? btns : '') + '</div></div>').join('<div style="height:14px"></div>');
      const help = '<p class="text-xs text-slate-400">칸에 반 번호를 띄어 써서 입력합니다(예: <b>1 2 3</b> → 1반, 2반, 3반). 다른 일정과 겹치면 칸이 분홍색으로 바뀌고 오른쪽 안내 창에 무엇과 겹치는지 나옵니다. 회색 칸은 휴일이거나 조건에서 고르지 않은 요일·교시입니다(입력은 가능, 자동 배치는 건너뜀).</p>';
      view.innerHTML = '<div class="space-y-5">' + cond + month + countBox + '<div class="' + CARD + '"><h3 class="font-bold">배정할 시간표 <span class="text-xs font-normal text-slate-400">5주</span></h3><div class="asg-top">' + btns + '</div>' + help + grid + '</div></div>';
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
      view.querySelectorAll('[data-ablock]').forEach((el) => el.onchange = () => { S.block = el.checked; });
      view.querySelectorAll('input[data-k]').forEach((inp) => {
        inp.oninput = () => { const v = inp.value.replace(/[^\d\s가-힣a-zA-Z,]/g, ''); S.grid[inp.dataset.k] = v; paintWeek(+inp.dataset.w); const c = $('aCount'); if (c) c.innerHTML = countHtml(counts(), parseInt(S.hours, 10) || 0); };
        inp.onchange = () => { const m = $('aMonth'), top = m ? m.scrollTop : 0, focusK = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null; setTimeout(() => { const f = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : focusK; draw(); const m2 = $('aMonth'); if (m2) m2.scrollTop = top; const n = f && view.querySelector('input[data-k="' + f + '"]'); if (n) n.focus(); }, 0); };   // 칸을 벗어나면 월간 일정에도 '배정 중' 표시 (다음 칸 입력은 이어서)   // 칸을 벗어나면 월간 일정에도 '배정 중' 표시
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } };
      });
      const reset = () => { if (!Object.values(S.grid).some((v) => v && v.trim())) return toast('지울 내용이 없습니다.'); if (!confirm('입력 중인 배정을 모두 지울까요? (저장된 일정은 그대로입니다)')) return; S.grid = {}; S.notes = {}; draw(); };
      view.querySelectorAll('[data-act="reset"]').forEach((b) => { b.onclick = reset; });
      view.querySelectorAll('[data-act="auto"]').forEach((b) => { b.onclick = autoFill; });
      view.querySelectorAll('[data-act="save"]').forEach((b) => { b.onclick = save; });
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
      const W5 = weeks(), weekOf = (ymd) => W5.findIndex((wk) => wk.some((d) => GP.ymd(d) === ymd));
      const usedDay = {}, usedWeek = {}; Object.keys(S.grid).forEach((k) => { const day = k.split('|')[0]; parse(S.grid[k]).cls.forEach((c) => { usedDay[c + '|' + day] = true; usedWeek[c + '|' + weekOf(day)] = true; }); });
      // 칸을 비울 수밖에 없는 이유 (그 순간의 남은 시수 기준)
      const selP = periods.filter((p) => S.pers.indexOf(p) >= 0), pairOf = (p) => { if (!S.block) return null; const k = selP.indexOf(p); if (k < 0) return null; const q = k % 2 === 0 ? selP[k + 1] : selP[k - 1]; return q || null; };
      const why = (d, p) => {
        if (S.block && !pairOf(p)) return '연차시 짝이 되는 교시가 없음';
        const min = S.block ? 2 : 1, left = classes.filter((c) => need[c] >= min);
        if (!left.length) return classes.some((c) => need[c] > 0) ? '남은 시수가 1차시뿐이라 연차시(2차시)로 넣을 수 없음' : '모든 반의 시수를 다 배정함';
        const reasons = left.map((c) => {
          const h = hits(c, d, p); if (h.length) return c + ' ' + (h[0].name || '') + '(' + SRC[h[0].src].label + ')';
          if (usedDay[c + '|' + GP.ymd(d)]) return c + ' 오늘 이미 배정';
          const q = pairOf(p); if (q) { if ((S.grid[key(d, q)] || '').trim()) return c + ' 짝 교시(' + q + ')가 이미 찼음'; const h2 = hits(c, d, q); if (h2.length) return c + ' ' + q + '에 ' + (h2[0].name || '') + '(' + SRC[h2[0].src].label + ')'; }
          return '';
        }).filter(Boolean);
        return reasons.length ? '남은 반이 모두 겹치거나 오늘 이미 배정됨 — ' + reasons.slice(0, 4).join(', ') + (reasons.length > 4 ? ' 외 ' + (reasons.length - 4) + '반' : '') : '배정할 수 있는 반이 없음';
      };
      // 지정한 요일·교시를 날짜·교시 순서대로 채움: 겹치지 않고 오늘 아직 안 들어간 반 중에서 고름.
      //  남은 시수가 있는데도 못 채운 칸은 그때의 이유를 기록해 두었다가 그 주 안내 창에 보여 줌.
      let added = 0; const skipWhy = {};
      // 규칙: 같은 반은 하루에 한 번만(연차시는 한 번 = 2차시 연달아). 되도록 같은 반은 한 주에 한 번만 → 이번 주에 아직 안 나온 반 → 남은 시수가 많은 반 순
      const pick = (free, day) => { const w = weekOf(day); return free.slice().sort((x, y) => (usedWeek[x + '|' + w] ? 1 : 0) - (usedWeek[y + '|' + w] ? 1 : 0) || need[y] - need[x] || classes.indexOf(x) - classes.indexOf(y))[0]; };
      const mark = (c, day) => { usedDay[c + '|' + day] = true; usedWeek[c + '|' + weekOf(day)] = true; };
      if (S.block) {   // 연차시: 고른 교시를 앞에서부터 2개씩 짝지어(예: 2·3교시, 4·5교시) 한 반을 연달아 배치
        if (selP.length < 2) return toast('연차시는 교시를 2개 이상 골라야 합니다.', true);
        const pairs = []; for (let i = 0; i + 1 < selP.length; i += 2) pairs.push([selP[i], selP[i + 1]]);
        weeks().forEach((wk) => wk.forEach((d, i) => {
          if (S.days.indexOf(i) < 0 || hol.get(GP.ymd(d))) return; const day = GP.ymd(d);
          pairs.forEach(([pa, pb]) => {
            const ka = key(d, pa), kb = key(d, pb); if ((S.grid[ka] || '').trim() || (S.grid[kb] || '').trim()) return;
            if (!classes.some((c) => need[c] >= 2)) return;
            const free = classes.filter((c) => need[c] >= 2 && !usedDay[c + '|' + day] && !hits(c, d, pa).length && !hits(c, d, pb).length);
            if (!free.length) { skipWhy[ka] = why(d, pa); skipWhy[kb] = why(d, pb); return; }
            const c = pick(free, day), n = String(classes.indexOf(c) + 1); S.grid[ka] = n; S.grid[kb] = n; need[c] -= 2; mark(c, day); added += 2;
          });
        }));
      } else {
        for (const sl of slots) {
          const k = key(sl.d, sl.p); if ((S.grid[k] || '').trim()) continue;
          if (!classes.some((c) => need[c] > 0)) continue;
          const day = GP.ymd(sl.d), free = classes.filter((c) => need[c] > 0 && !usedDay[c + '|' + day] && !hits(c, sl.d, sl.p).length);
          if (!free.length) { skipWhy[k] = why(sl.d, sl.p); continue; }
          const c = pick(free, day); S.grid[k] = String(classes.indexOf(c) + 1); need[c]--; mark(c, day); added++;
        }
      }
      const short = classes.filter((c) => need[c] > 0).map((c) => c + ' ' + need[c] + '차시');
      const odd = S.block && classes.some((c) => need[c] === 1) ? ' (연차시는 2차시씩만 넣으므로 홀수로 남은 1차시는 직접 넣어 주세요)' : '';
      const notes = {};
      weeks().forEach((wk, w) => {
        const lines = [];
        wk.forEach((d, i) => {
          if (S.days.indexOf(i) < 0) return; const day = md(d) + '(' + DAYS[i] + ')';
          const hd = hol.get(GP.ymd(d)); if (hd) { lines.push(day + ': 휴일(' + esc(hd.name) + ')이라 건너뜀'); return; }
          const groups = []; selP.forEach((p) => { if ((S.grid[key(d, p)] || '').trim()) return; const r = skipWhy[key(d, p)] || why(d, p); const g = groups.find((x) => x.r === r); if (g) g.ps.push(p); else groups.push({ r, ps: [p] }); });
          groups.forEach((g) => lines.push(day + ' ' + g.ps.join(', ') + ' 비움: ' + esc(g.r)));
        });
        if (lines.length) notes[w] = lines.slice(0, 12).map((x) => '· ' + x).join('<br>') + (lines.length > 12 ? '<br>· … 외 ' + (lines.length - 12) + '건' : '');
      });
      const head = (added ? '자동 배치로 ' + added + '칸을 채웠습니다.' : '새로 채울 칸이 없습니다.') + (short.length ? ' <b class="text-amber-700">배정하지 못한 시수: ' + short.join(', ') + '</b>' + odd : '');
      notes[0] = head + (notes[0] ? '<br>' + notes[0] : '');
      S.notes = notes;
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
