/* banjung.js — 반배정 (관리자 > 반배정 설정, 반배정하기 페이지가 함께 씀)
 *  설정(공개, 학년도별)   app_config/banjung_<학년도> = { show, names:[임시반], rule:'num'|'name'|'score', starts:{ 기존반번호: { M:{sid,to}, F:{sid,to} } } }
 *  학생별 반배정 정보(보호) data_student 의 bj_sur(성) bj_score bj_sp(특수) bj_slow(학습부진) bj_multi(다문화) bj_move(전출예정) bj_sep[분리 희망 학생 id] bj_contact(연락처·관계)
 *                         bj_memo(반배정 비고 — 명렬표의 비고와는 따로)
 *  배정 결과(보호, 학년도별) gp_private/banjung_res_<학년도> = { a:{학생id: 임시반 번호}, hold:[id], moved:{id:1}, at }
 */
(function () {
  'use strict';
  const GANADA = '가나다라마바사아자차카타파하'.split('');
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  const num = (v) => { const n = Number(str(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; };
  const ko = (a, b) => str(a).localeCompare(str(b), 'ko', { numeric: true });
  const genderOf = (v) => { const t = str(v).trim(); if (/^(남|남자|남성|m|male)$/i.test(t)) return 'M'; if (/^(여|여자|여성|f|female)$/i.test(t)) return 'F'; return 'U'; };
  const G_LABEL = { M: '남', F: '여', U: '?' };
  const RULES = [['num', '번호순'], ['name', '이름순'], ['score', '성적순']];

  // ---------------------------------------------------------------- 설정
  const defaultNames = (n) => Array.from({ length: n }, (_, i) => (GANADA[i] || (i + 1)) + '');
  async function loadCfg() {
    const g = await GP.loadGeneral(); const c = (await GP.getCfg('banjung_' + g.year, null)) || {};
    return { year: g.year, classNames: g.classNames.slice(), show: !!c.show, names: Array.isArray(c.names) && c.names.length ? c.names : defaultNames(g.classCount), rule: c.rule || 'num', starts: c.starts || {} };
  }
  async function saveCfg(c) { await GP.setCfg('banjung_' + c.year, { show: !!c.show, names: c.names, rule: c.rule, starts: c.starts || {} }); }
  const tempName = (cfg, k) => (cfg.names[k] !== undefined ? cfg.names[k] + (/반$/.test(cfg.names[k]) ? '' : '반') : '?');

  // ---------------------------------------------------------------- 학생
  async function loadStudents() {
    const rows = await GP.getCol('data_student');
    return rows.filter((r) => str(r.student_name).trim() && num(r.student_class) > 0).map((r) => {
      const name = str(r.student_name).trim(); const sur = str(r.bj_sur).trim() || name.charAt(0);
      return { id: r._id, cls: num(r.student_class), num: num(r.student_num), name, sur, given: name.indexOf(sur) === 0 ? name.slice(sur.length) : name.slice(1), g: genderOf(r.student_gender),
        score: r.bj_score === undefined || r.bj_score === '' || r.bj_score === null ? null : num(r.bj_score), sp: !!r.bj_sp, slow: !!r.bj_slow, multi: !!r.bj_multi, move: !!r.bj_move,
        sep: Array.isArray(r.bj_sep) ? r.bj_sep.slice() : [], memo: str(r.bj_memo), contact: str(r.bj_contact) };
    });
  }
  const saveStudent = (id, data) => GP.commit([{ type: 'update', col: 'data_student', id, data }]);
  // 학급 안 정렬: 남 → 여(→ 성별 미상), 각 성별 안에서 규칙대로
  function sortInClass(list, rule) {
    const by = rule === 'name' ? (a, b) => ko(a.name, b.name) || a.num - b.num
      : rule === 'score' ? (a, b) => ((b.score === null ? -1e9 : b.score) - (a.score === null ? -1e9 : a.score)) || a.num - b.num
        : (a, b) => a.num - b.num || ko(a.name, b.name);
    const ord = { M: 0, F: 1, U: 2 };
    return list.slice().sort((a, b) => ord[a.g] - ord[b.g] || by(a, b));
  }
  const flagsOf = (s) => [s.sp && '특수', s.slow && '학습부진', s.multi && '다문화', s.move && '전출예정'].filter(Boolean);

  // ---------------------------------------------------------------- 자동 배정
  // 1) 기존반마다 남·여를 규칙 순서로 줄 세우고, 관리자가 정한 시작 학생·시작 반부터 가→나→다… 순서로 돌아가며 배정(마지막 뒤에는 첫 번호로 이어짐)
  // 2) 특수 학생을 반마다 고르게(학급 수 이하이면 한 반에 한 명)  3) 반 인원·성별 인원 맞추기(특수 있는 반은 2명 적게, 모든 반에 특수가 있으면 예외)
  // 4) 같은 성별끼리 맞바꾸며 다듬기: 동명이인·분리 희망(절대) > 성 뺀 이름 같음(강하게) > 학습부진·다문화·전출 고르게, 기존반 고르게, 성적 평균, 처음 배정에서 덜 벗어나게
  function autoAssign(students, cfg) {
    const K = cfg.names.length; const N = students.length; if (!K || !N) return { a: {}, warn: [] };
    const idx = new Map(students.map((s, i) => [s.id, i]));
    const b = new Array(N).fill(0);
    const classes = [...new Set(students.map((s) => s.cls))].sort((x, y) => x - y);
    classes.forEach((c, ci) => {
      const inC = sortInClass(students.filter((s) => s.cls === c), cfg.rule);
      ['M', 'F', 'U'].forEach((G) => {
        const L = inC.filter((s) => s.g === G); if (!L.length) return;
        const st = (cfg.starts[c] && cfg.starts[c][G]) || {};
        let i0 = L.findIndex((s) => s.id === st.sid); if (i0 < 0) i0 = 0;
        let to = st.to !== undefined && st.to !== '' && st.to !== null ? Number(st.to) : (G === 'F' ? ci + 1 : ci); to = ((to % K) + K) % K;
        for (let j = 0; j < L.length; j++) b[idx.get(L[(i0 + j) % L.length].id)] = (to + j) % K;
      });
    });
    const a = b.slice();
    // 짝 목록
    const pairsFull = [], pairsGiven = [], pairsSep = [];
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const x = students[i], y = students[j];
      if (x.name === y.name) pairsFull.push([i, j]); else if (x.given && x.given === y.given) pairsGiven.push([i, j]);
    }
    const sepSet = new Set();
    students.forEach((s, i) => s.sep.forEach((id) => { const j = idx.get(id); if (j === undefined || j === i) return; const k = i < j ? i + '_' + j : j + '_' + i; if (!sepSet.has(k)) { sepSet.add(k); pairsSep.push([Math.min(i, j), Math.max(i, j)]); } }));
    const origList = classes; const oi = new Map(origList.map((c, i) => [c, i]));
    const nOrig = origList.map((c) => students.filter((s) => s.cls === c).length);
    const tot = { sp: 0, slow: 0, multi: 0, move: 0 }; students.forEach((s) => { ['sp', 'slow', 'multi', 'move'].forEach((f) => { if (s[f]) tot[f]++; }); });
    const useScore = cfg.rule === 'score'; const scored = students.filter((s) => s.score !== null); const avgAll = scored.length ? scored.reduce((x, s) => x + s.score, 0) / scored.length : 0;
    let T = new Array(K).fill(N / K);   // 반별 목표 인원(아래에서 정함)
    const C = origList.length; const oIdx = students.map((s) => oi.get(s.cls));
    const qn = new Float64Array(K), qslow = new Float64Array(K), qmulti = new Float64Array(K), qmove = new Float64Array(K), qsp = new Float64Array(K), qsc = new Float64Array(K), qscn = new Float64Array(K), qo = new Float64Array(K * C);
    function cost() {   // 작을수록 좋은 배정(메모리를 새로 잡지 않도록 배열을 다시 씀)
      let c = 0;
      for (const [i, j] of pairsFull) if (a[i] === a[j]) c += 1e7;
      for (const [i, j] of pairsSep) if (a[i] === a[j]) c += 1e7;
      for (const [i, j] of pairsGiven) if (a[i] === a[j]) c += 1e4;
      qn.fill(0); qslow.fill(0); qmulti.fill(0); qmove.fill(0); qsp.fill(0); qsc.fill(0); qscn.fill(0); qo.fill(0);
      let dev = 0;
      for (let i = 0; i < N; i++) { const s = students[i], k = a[i]; qn[k]++; if (s.slow) qslow[k]++; if (s.multi) qmulti[k]++; if (s.move) qmove[k]++; if (s.sp) qsp[k]++; if (s.score !== null) { qsc[k] += s.score; qscn[k]++; } qo[k * C + oIdx[i]]++; if (k !== b[i]) dev++; }
      const ms = tot.slow / K, mm = tot.multi / K, mv = tot.move / K, mp = tot.sp / K;
      for (let k = 0; k < K; k++) {
        c += (qslow[k] - ms) * (qslow[k] - ms) * 300 + (qmulti[k] - mm) * (qmulti[k] - mm) * 120 + (qmove[k] - mv) * (qmove[k] - mv) * 60 + (qsp[k] - mp) * (qsp[k] - mp) * 2000;
        const f = T[k] / N; for (let o = 0; o < C; o++) { const d = qo[k * C + o] - nOrig[o] * f; c += d * d * 25; }
        if (useScore && qscn[k]) { const d = qsc[k] / qscn[k] - avgAll; c += d * d * 3; }
      }
      return c + dev * 1.5;
    }
    const countOf = (k, pred) => { let n = 0; for (let i = 0; i < N; i++) if (a[i] === k && pred(students[i])) n++; return n; };
    // 2) 특수 학생 고르게
    if (tot.sp) {
      const cap = Math.ceil(tot.sp / K);
      for (let guard = 0; guard < 200; guard++) {
        const spc = Array.from({ length: K }, (_, k) => countOf(k, (s) => s.sp));
        const over = spc.findIndex((v) => v > cap); if (over < 0) break;
        let best = null;
        for (let i = 0; i < N; i++) { if (a[i] !== over || !students[i].sp) continue;
          for (let j = 0; j < N; j++) { if (students[j].sp || students[j].g !== students[i].g || spc[a[j]] >= cap || a[j] === over) continue;
            const ai = a[i], aj = a[j]; a[i] = aj; a[j] = ai; const c = cost() + spc[aj] * 1e5; a[i] = ai; a[j] = aj;
            if (!best || c < best.c) best = { c, i, j }; } }
        if (!best) break; const t = a[best.i]; a[best.i] = a[best.j]; a[best.j] = t;
      }
    }
    // 3) 목표 인원: 특수 학생이 있는 반은 2명 적게(모든 반에 특수가 있으면 적용 안 함)
    const spCls = Array.from({ length: K }, (_, k) => countOf(k, (s) => s.sp) > 0);
    const S = spCls.filter(Boolean).length; const reduce = S > 0 && S < K;
    const base = N + (reduce ? 2 * S : 0); const q = Math.floor(base / K); let r = base % K;
    const order = [...Array(K).keys()].sort((x, y) => (spCls[x] - spCls[y]) || x - y);   // 남는 인원은 특수 없는 반부터
    T = new Array(K).fill(0); order.forEach((k) => { T[k] = q + (r > 0 ? 1 : 0) - (reduce && spCls[k] ? 2 : 0); if (r > 0) r--; });
    // 성별 목표: 반 인원에 비례(큰 나머지 방식)
    const GS = ['M', 'F', 'U']; const gTot = {}; GS.forEach((G) => { gTot[G] = students.filter((s) => s.g === G).length; });
    const TG = {}; ['M', 'U'].forEach((G) => {
      const raw = T.map((t) => t * gTot[G] / N); const fl = raw.map(Math.floor); let left = gTot[G] - fl.reduce((x, y) => x + y, 0);
      raw.map((v, k) => [v - fl[k], k]).sort((x, y) => y[0] - x[0]).forEach(([, k]) => { if (left > 0) { fl[k]++; left--; } });
      TG[G] = fl;
    });
    TG.F = T.map((t, k) => t - TG.M[k] - TG.U[k]);   // 여학생 = 반 인원 − 남학생(반 인원이 정확히 맞도록)
    GS.forEach((G) => {
      for (let guard = 0; guard < 500; guard++) {
        const c = Array.from({ length: K }, (_, k) => countOf(k, (s) => s.g === G));
        const from = c.findIndex((v, k) => v > TG[G][k]), to = c.findIndex((v, k) => v < TG[G][k]); if (from < 0 || to < 0) break;
        let best = null;
        for (let i = 0; i < N; i++) { if (a[i] !== from || students[i].g !== G || students[i].sp) continue; const keep = a[i]; a[i] = to; const cc = cost(); a[i] = keep; if (!best || cc < best.c) best = { c: cc, i }; }
        if (!best) break; a[best.i] = to;
      }
    });
    // 4) 맞바꾸며 다듬기(같은 성별, 특수는 특수끼리)
    let cur = cost(); let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const iters = Math.min(60000, 400 * N);
    for (let t = 0; t < iters; t++) {
      const i = Math.floor(rnd() * N), j = Math.floor(rnd() * N);
      if (a[i] === a[j] || students[i].g !== students[j].g || students[i].sp !== students[j].sp) continue;
      const ai = a[i]; a[i] = a[j]; a[j] = ai; const c = cost();
      if (c < cur) cur = c; else { a[j] = a[i]; a[i] = ai; }
    }
    const out = {}; students.forEach((s, i) => { out[s.id] = a[i]; });
    return { a: out, warn: checkRules(students, out, cfg) };
  }

  // 규칙 위반 점검(보드 경고용). hard = 꼭 고쳐야 함, 나머지는 확인 권장
  //  동명이인·분리 희망(절대) / 성 뺀 이름 같음 / 성비(전출예정 제외) / 특수 몰림 / 성적 평균(성적순) / 출신 반 쏠림
  function checkRules(students, a, cfg) {
    const w = []; const byK = {}; const K = cfg.names.length;
    students.forEach((s) => { const k = a[s.id]; if (typeof k !== 'number') return; (byK[k] = byK[k] || []).push(s); });
    const nm = (s) => s.cls + '반 ' + s.name;
    const inAll = students.filter((s) => typeof a[s.id] === 'number');
    const act = inAll.filter((s) => !s.move); const totM = act.filter((s) => s.g === 'M').length, totF = act.filter((s) => s.g === 'F').length;
    const spAll = inAll.filter((s) => s.sp).length, spCap = K ? Math.ceil(spAll / K) : 0;
    const scored = inAll.filter((s) => s.score !== null); const avgAll = scored.length ? scored.reduce((x, s) => x + s.score, 0) / scored.length : 0;
    const origs = [...new Set(inAll.map((s) => s.cls))]; const nOrig = {}; inAll.forEach((s) => { nOrig[s.cls] = (nOrig[s.cls] || 0) + 1; });
    Object.keys(byK).map(Number).sort((x, y) => x - y).forEach((k) => {
      const L = byK[k], tn = tempName(cfg, k);
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const x = L[i], y = L[j];
        if (x.name === y.name) w.push({ hard: true, kind: 'dup', k, t: tn + ': 동명이인 ' + nm(x) + ' · ' + nm(y) });
        else if (x.given && x.given === y.given) w.push({ hard: false, kind: 'given', k, t: tn + ': 이름(성 제외)이 같음 ' + nm(x) + ' · ' + nm(y) });
        if (x.sep.indexOf(y.id) >= 0 || y.sep.indexOf(x.id) >= 0) w.push({ hard: true, kind: 'sep', k, t: tn + ': 분리 희망 학생이 같은 반 ' + nm(x) + ' · ' + nm(y) });
      }
      const la = L.filter((s) => !s.move); const m = la.filter((s) => s.g === 'M').length, f = la.filter((s) => s.g === 'F').length;
      if (totM + totF && la.length) { const expM = la.length * totM / (totM + totF); if (Math.abs(m - expM) > 2) w.push({ hard: false, kind: 'ratio', k, t: tn + ': 성비가 많이 기움 (남 ' + m + ', 여 ' + f + ' · 전출예정 제외)' }); }
      const sp = L.filter((s) => s.sp).length; if (spAll && sp > spCap) w.push({ hard: false, kind: 'sp', k, t: tn + ': 특수 학생이 몰림 (' + sp + '명, 반마다 ' + spCap + '명 이하 권장)' });
      if (cfg.rule === 'score' && scored.length) { const sc = L.filter((s) => s.score !== null); if (sc.length) { const av = sc.reduce((x, s) => x + s.score, 0) / sc.length; if (Math.abs(av - avgAll) > 5) w.push({ hard: false, kind: 'score', k, t: tn + ': 평균 성적 ' + av.toFixed(1) + '점 (전체 평균 ' + avgAll.toFixed(1) + '점과 ' + Math.abs(av - avgAll).toFixed(1) + '점 차이)' }); } }
      origs.forEach((c) => { const cnt = L.filter((s) => s.cls === c).length; const exp = nOrig[c] * L.length / inAll.length; if (Math.abs(cnt - exp) > Math.max(2, exp * 0.5)) w.push({ hard: false, kind: 'orig', k, t: tn + ': ' + (cfg.classNames && cfg.classNames[c - 1] || c + '반') + ' 출신이 ' + (cnt > exp ? '너무 많음' : '너무 적음') + ' (' + cnt + '명, 보통 ' + Math.round(exp) + '명 안팎)' }); });
    });
    return w;
  }
  // 반별 통계
  function stats(students, a, cfg) {
    const K = cfg.names.length; const origs = [...new Set(students.map((s) => s.cls))].sort((x, y) => x - y);
    const st = Array.from({ length: K }, () => ({ n: 0, M: 0, F: 0, U: 0, sc: 0, scn: 0, sp: 0, slow: 0, multi: 0, move: 0, o: {} }));
    students.forEach((s) => { const k = a[s.id]; if (typeof k !== 'number' || !st[k]) return; const q = st[k]; q.n++; q[s.g]++; if (s.score !== null) { q.sc += s.score; q.scn++; } ['sp', 'slow', 'multi', 'move'].forEach((f) => { if (s[f]) q[f]++; }); q.o[s.cls] = (q.o[s.cls] || 0) + 1; });
    return { st, origs };
  }
  // 배정반 안 번호: 남녀 함께 이름순, 전출예정은 맨 뒤
  const exportOrder = (list) => list.slice().sort((x, y) => (x.move - y.move) || ko(x.name, y.name) || x.cls - y.cls);

  // ---------------------------------------------------------------- 결과 저장(보호)
  // orig = 기본 배정하기로 처음 정해진 반(옮겼다가 같은 반으로 돌아오면 '옮김' 표시를 지우는 데 씀)
  async function loadResult(year) { const r = (await GP.privGet('banjung_res_' + year, null)) || {}; return { a: r.a || {}, orig: r.orig || null, hold: Array.isArray(r.hold) ? r.hold : [], moved: r.moved || {}, at: r.at || '' }; }
  async function saveResult(year, r) { await GP.privSet('banjung_res_' + year, { a: r.a, orig: r.orig || null, hold: r.hold, moved: r.moved, at: new Date().toISOString() }); }

  // 초기화: 배정 결과 지우기 + 학생 문서의 반배정 입력값(bj_*) 지우기(명렬표 정보는 그대로)
  const BJ_FIELDS = ['bj_sur', 'bj_score', 'bj_sp', 'bj_slow', 'bj_multi', 'bj_move', 'bj_sep', 'bj_memo', 'bj_contact'];
  async function resetAll(cfg) {
    await saveResult(cfg.year, { a: {}, orig: null, hold: [], moved: {} });
    const rows = await GP.getCol('data_student', true); const ops = [];
    rows.forEach((r) => { const d = {}; BJ_FIELDS.forEach((f) => { if (r[f] !== undefined) d[f] = GP.DELETE; }); if (Object.keys(d).length) ops.push({ type: 'update', col: 'data_student', id: r._id, data: d }); });
    if (ops.length) await GP.commit(ops);
  }
  // ---------------------------------------------------------------- 관리자 > 반배정 탭
  async function renderAdmin(view, h) {
    const { toast, esc, BTN, BTN_P, BTN_G, INP, CARD } = h;
    view.innerHTML = '<p class="text-slate-400">불러오는 중...</p>';
    const cfg = await loadCfg(); let studs = [];
    try { studs = await loadStudents(); } catch (e) { console.warn(e); }
    const save = async (msg) => { try { await saveCfg(cfg); toast(msg || '저장했습니다.'); try { parent.postMessage('gp-meta-changed', '*'); } catch (e) { /* 단독 */ } } catch (e) { toast('저장 실패: ' + e.message, true); } };
    const classes = cfg.classNames.map((nm, i) => ({ n: i + 1, nm }));
    function draw() {
      const K = cfg.names.length;
      const tg = '<label class="bj-tg"><input type="checkbox" id="bjShow" ' + (cfg.show ? 'checked' : '') + '><span></span></label>';
      const names = cfg.names.map((n, i) => '<span class="inline-flex items-center gap-1 border rounded-lg px-2 py-1 bg-white text-sm"><b>' + esc(n) + '</b>' +
        '<button type="button" data-ren="' + i + '" title="이름 바꾸기" class="text-slate-400 hover:text-indigo-600">✏️</button><button type="button" data-del="' + i + '" title="삭제" class="text-slate-400 hover:text-red-600">✕</button></span>').join(' ');
      const rule = RULES.map(([k, l]) => '<label style="display:inline-flex;align-items:center;gap:5px;margin-right:18px;cursor:pointer"><input type="radio" name="bjRule" value="' + k + '" ' + (cfg.rule === k ? 'checked' : '') + '>' + l + '</label>').join('');
      const kOpts = (sel) => cfg.names.map((n, i) => '<option value="' + i + '" ' + (Number(sel) === i ? 'selected' : '') + '>' + esc(tempName(cfg, i)) + '</option>').join('');
      const rows = classes.map((c, ci) => {
        const inC = sortInClass(studs.filter((s) => s.cls === c.n), cfg.rule);
        const cell = (G) => {
          const L = inC.filter((s) => s.g === G); const st = (cfg.starts[c.n] && cfg.starts[c.n][G]) || {};
          const defTo = G === 'F' ? (ci + 1) % K : ci % K; /* 기본: 남 1반 1번→가, 2반→나… / 여 1반 1번→나, 2반→다… */ const to = st.to !== undefined && st.to !== null && st.to !== '' ? Number(st.to) % K : defTo;
          if (!L.length) return '<td class="border px-2 py-1 text-slate-400 text-xs">학생 없음</td>';
          return '<td class="border px-2 py-1"><div class="flex flex-wrap items-center gap-1 text-sm"><select data-st="' + c.n + '|' + G + '|sid" class="' + INP + ' !py-1">' +
            L.map((s, i) => '<option value="' + esc(s.id) + '" ' + (st.sid === s.id || (!st.sid && i === 0) ? 'selected' : '') + '>' + (i + 1) + '. ' + esc(s.name) + '</option>').join('') + '</select>' +
            '<span class="text-slate-400">→</span><select data-st="' + c.n + '|' + G + '|to" class="' + INP + ' !py-1">' + kOpts(to) + '</select></div></td>';
        };
        return '<tr><th class="border bg-slate-50 px-2 py-1 text-sm whitespace-nowrap">' + esc(c.nm) + '</th>' + cell('M') + cell('F') + '</tr>';
      }).join('');
      view.innerHTML = '<style>.bj-tg{position:relative;display:inline-block;width:30px;height:17px;vertical-align:middle}.bj-tg input{opacity:0;width:0;height:0}.bj-tg span{position:absolute;inset:0;background:#cbd5e1;border-radius:999px;transition:.15s;cursor:pointer}.bj-tg span:before{content:"";position:absolute;left:2px;top:2px;width:13px;height:13px;background:#fff;border-radius:50%;transition:.15s}.bj-tg input:checked+span{background:#4f46e5}.bj-tg input:checked+span:before{transform:translateX(13px)}</style>' +
        '<div class="space-y-5">' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">반배정 페이지 보이기</h2><div class="flex items-center gap-2 text-sm">' + tg + '<b id="bjShowLbl" style="color:' + (cfg.show ? '#4f46e5' : '#94a3b8') + '">' + (cfg.show ? 'ON' : 'OFF') + '</b><span class="text-slate-500">켜면 왼쪽 메뉴 › 업무 › 내선번호 아래에 <b>반배정하기</b>가 보입니다. (' + cfg.year + '학년도)</span></div></div>' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">임시반 이름 <span class="text-xs font-normal text-slate-400">배정할 반 ' + K + '개</span></h2><div class="flex flex-wrap gap-2 items-center">' + names +
        '<button type="button" id="bjAdd" class="' + BTN_G + ' !py-1">+ 반 추가</button><button type="button" id="bjReset" class="' + BTN_G + ' !py-1 text-xs">학급 수에 맞게 가나다로 다시</button></div></div>' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">배정 규칙</h2><div class="text-sm">' + rule + '</div><p class="text-xs text-slate-500 mt-1">번호순 = 명렬표의 출석번호 순 · 이름순 = 이름 가나다 순 · 성적순 = 반배정 페이지에서 입력한 성적이 높은 순 (모두 남녀 따로)</p></div>' +
        '<div class="' + CARD + '"><h2 class="font-bold text-lg">학급 내 배정 순서</h2><p class="text-sm text-slate-500">기존반마다 남·여 각각, 고른 학생을 고른 반에 넣고 다음 학생부터 다음 반(가→나→다…)으로 이어서 배정합니다. 마지막 학생 다음은 맨 앞 학생으로 이어집니다.</p>' +
        (studs.length ? '<div class="overflow-x-auto"><table class="w-full border-collapse mt-2"><thead><tr><th class="border bg-slate-100 px-2 py-1 text-sm">기존반</th><th class="border bg-slate-100 px-2 py-1 text-sm">남학생: 시작 학생 → 반</th><th class="border bg-slate-100 px-2 py-1 text-sm">여학생: 시작 학생 → 반</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="text-sm text-amber-700 mt-2">학년 전체 명렬표에 학생이 없습니다. 명렬표를 먼저 입력하세요.</p>') + '</div>' +
        '</div>';
      const $ = (id) => document.getElementById(id);
      $('bjShow').onchange = async () => {
        if ($('bjShow').checked) { cfg.show = true; draw(); save('반배정하기 메뉴를 보입니다.'); return; }
        // 끄기 = 숨기기 + 이 학년도 반배정 자료 모두 초기화(설정·배정 결과·학생별 반배정 입력값)
        if (!confirm('반배정을 끄면 기존에 입력한 값이 모두 초기화됩니다.\n\n· 임시반 이름·배정 규칙·학급 내 배정 순서\n· 반 배정 결과(임시보관함 포함)\n· 학급 기초 설정에 입력한 성·성적·특수·학습부진·다문화·전출예정·분리 희망·비고·연락처\n\n학년 전체 명렬표의 학생 정보는 지우지 않습니다. 끌까요?')) { $('bjShow').checked = true; return; }
        try {
          await resetAll(cfg); Object.assign(cfg, { show: false, names: defaultNames(cfg.classNames.length), rule: 'num', starts: {} });
          await saveCfg(cfg); try { studs = await loadStudents(); } catch (e) { /* 무시 */ }
          draw(); toast('반배정을 끄고 입력한 값을 모두 초기화했습니다.'); try { parent.postMessage('gp-meta-changed', '*'); } catch (e) { /* 단독 */ }
        } catch (e) { console.error(e); $('bjShow').checked = true; toast('초기화 실패: ' + e.message, true); }
      };
      view.querySelectorAll('[data-ren]').forEach((b) => b.onclick = () => { const i = +b.dataset.ren; const v = (prompt('임시반 이름', cfg.names[i]) || '').trim(); if (!v || v === cfg.names[i]) return; if (cfg.names.indexOf(v) >= 0) return toast('이미 있는 이름입니다.', true); cfg.names[i] = v; draw(); save(); });
      view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { const i = +b.dataset.del; if (cfg.names.length <= 1) return toast('반이 하나는 있어야 합니다.', true); if (!confirm('[' + cfg.names[i] + '] 반을 지울까요?')) return; cfg.names.splice(i, 1); draw(); save(); });
      $('bjAdd').onclick = () => { const used = new Set(cfg.names); const nx = GANADA.find((x) => !used.has(x)) || String(cfg.names.length + 1); const v = (prompt('추가할 반 이름', nx) || '').trim(); if (!v) return; if (used.has(v)) return toast('이미 있는 이름입니다.', true); cfg.names.push(v); draw(); save(); };
      $('bjReset').onclick = () => { if (!confirm('임시반을 학급 수(' + cfg.classNames.length + '개)에 맞게 가, 나, 다… 로 다시 만들까요?')) return; cfg.names = defaultNames(cfg.classNames.length); draw(); save(); };
      view.querySelectorAll('[name="bjRule"]').forEach((r) => r.onchange = () => { cfg.rule = r.value; draw(); save(); });
      view.querySelectorAll('[data-st]').forEach((sel) => sel.onchange = () => {
        const [c, G, f] = sel.dataset.st.split('|'); cfg.starts[c] = cfg.starts[c] || {}; cfg.starts[c][G] = cfg.starts[c][G] || {};
        const row = sel.closest('td'); const sid = row.querySelector('[data-st$="|sid"]').value, to = row.querySelector('[data-st$="|to"]').value;
        cfg.starts[c][G] = { sid, to: Number(to) }; save(); void f;
      });
    }
    draw();
  }

  window.BJ = { GANADA, RULES, G_LABEL, genderOf, loadCfg, saveCfg, tempName, loadStudents, saveStudent, sortInClass, flagsOf, autoAssign, checkRules, stats, exportOrder, loadResult, saveResult, resetAll, renderAdmin, defaultNames };
})();
