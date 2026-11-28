/* 관리자 > 비밀번호/데이터 관리 > 웹앱 아이콘
 *  고른 그림으로 아이콘을 크기별로 만들어 gp_global/app_icon(모든 학년 공통)에 저장합니다.
 *  사이트 바깥 틀(index.html)이 열릴 때 이 아이콘으로 탭 아이콘·홈 화면 아이콘·앱 정보(매니페스트)를 바꿔 끼웁니다.
 *  gp_global/icon_meta 에는 바뀐 번호(v)만 두어, 평소에는 작은 문서 1건만 읽습니다.
 *  깃허브 파일을 직접 바꾸고 싶을 때를 위해 같은 이름의 아이콘 파일 묶음(zip)도 내려받을 수 있습니다.
 */
(function () {
  const SIZES = { i32: 32, i180: 180, i192: 192, i512: 512 };
  const S = { img: null, name: '', mode: 'cover', bg: '#ffffff', out: null };

  function draw(size, opt) {   // opt: {mode, bg, fill(배경 칠하기), pad(0~0.5, 가장자리 여백 비율)}
    const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (opt.fill || opt.mode === 'contain') { x.fillStyle = opt.bg; x.fillRect(0, 0, size, size); }
    const pad = Math.round(size * (opt.pad || 0)), box = size - pad * 2, w = S.img.width, h = S.img.height;
    const sc = opt.mode === 'contain' ? Math.min(box / w, box / h) : Math.max(box / w, box / h);
    const dw = w * sc, dh = h * sc;
    x.save(); x.beginPath(); x.rect(pad, pad, box, box); x.clip(); x.drawImage(S.img, pad + (box - dw) / 2, pad + (box - dh) / 2, dw, dh); x.restore();
    return c;
  }
  function build() {
    const o = { mode: S.mode, bg: S.bg };
    const out = {
      i32: draw(32, o).toDataURL('image/png'),
      i180: draw(180, Object.assign({}, o, { fill: true })).toDataURL('image/png'),   // 아이폰은 투명한 부분을 검게 보여 주므로 배경을 칠함
      i192: draw(192, o).toDataURL('image/png'),
      i512: draw(512, o).toDataURL('image/png'),
      m512: draw(512, Object.assign({}, o, { fill: true, pad: 0.1 })).toDataURL('image/png')   // 안드로이드 둥근/원형 아이콘용(가장자리가 잘려도 그림이 남도록 여백)
    };
    const total = Object.values(out).reduce((a, v) => a + v.length, 0);
    if (total > 850000) {   // 사진처럼 무거운 그림: 큰 아이콘 두 개만 JPEG 로 줄여 저장 한도(1MB) 안에 맞춤
      out.i512 = draw(512, Object.assign({}, o, { fill: true })).toDataURL('image/jpeg', 0.88);
      out.m512 = draw(512, Object.assign({}, o, { fill: true, pad: 0.1 })).toDataURL('image/jpeg', 0.88);
    }
    return out;
  }
  const loadImg = (file) => new Promise((res, rej) => { const u = URL.createObjectURL(file), im = new Image(); im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 1000); }; im.onerror = () => rej(new Error('그림 파일을 열 수 없습니다.')); im.src = u; });
  const bytesOf = (dataUrl) => { const b = atob(dataUrl.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  function ico(png) {   // PNG 한 장을 담은 favicon.ico
    const h = new Uint8Array(22), dv = new DataView(h.buffer);
    dv.setUint16(2, 1, true); dv.setUint16(4, 1, true); h[6] = 32; h[7] = 32; dv.setUint16(10, 1, true); dv.setUint16(12, 32, true); dv.setUint32(14, png.length, true); dv.setUint32(18, 22, true);
    const o = new Uint8Array(22 + png.length); o.set(h, 0); o.set(png, 22); return o;
  }
  // 깃허브에 올릴 파일 묶음 (사이트에 있는 파일과 같은 이름·위치)
  async function pngBlobBytes(canvas) { const b = await new Promise((r) => canvas.toBlob(r, 'image/png')); return new Uint8Array(await b.arrayBuffer()); }
  async function downloadZip(out) {
    const o = { mode: S.mode, bg: S.bg };
    const p32 = await pngBlobBytes(draw(32, o)), p180 = await pngBlobBytes(draw(180, Object.assign({}, o, { fill: true })));
    const files = [
      { name: 'favicon.ico', bytes: ico(p32) },
      { name: 'apple-touch-icon.png', bytes: p180 }, { name: 'apple-touch-icon-precomposed.png', bytes: p180 },
      { name: 'assets/icons/favicon-32.png', bytes: p32 }, { name: 'assets/icons/apple-touch-icon.png', bytes: p180 },
      { name: 'assets/icons/icon-192.png', bytes: await pngBlobBytes(draw(192, o)) },
      { name: 'assets/icons/icon-512.png', bytes: await pngBlobBytes(draw(512, o)) },
      { name: 'assets/icons/icon-512-maskable.png', bytes: await pngBlobBytes(draw(512, Object.assign({}, o, { fill: true, pad: 0.1 }))) }
    ];
    const a = document.createElement('a'); a.href = URL.createObjectURL(window.XlsxLite.zipBlob(files)); a.download = '웹앱_아이콘_파일.zip';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  async function render(el, h) {
    const { toast, esc, BTN_P, BTN_G, CARD } = h; const GP = window.GP;
    const col = () => GP.db.collection('gp_global');
    let cur = null; try { const d = await col().doc('app_icon').get(); cur = d.exists ? d.data() : null; } catch (e) { cur = null; }
    const curSrc = cur && cur.i192 ? cur.i192 : '../assets/icons/icon-192.png?v=' + (window.__GP_VER__ || '');
    const prev = (src, r, sz, label) => '<div class="flex flex-col items-center gap-1"><img src="' + src + '" alt="" style="width:' + sz + 'px;height:' + sz + 'px;border-radius:' + r + ';box-shadow:0 1px 4px rgba(0,0,0,.18);background:#fff;object-fit:cover"><span class="text-xs text-slate-400">' + label + '</span></div>';
    el.innerHTML = '<div class="' + CARD + '"><h2 class="font-bold text-lg">웹앱 아이콘 <span class="text-xs font-normal text-slate-400">모든 학년 공통 · 브라우저 탭과 홈 화면에 보이는 그림</span></h2>' +
      '<div class="flex flex-wrap items-start" style="gap:1rem 2rem">' +
      '<div><div class="text-sm font-semibold mb-2">지금 아이콘</div><div class="flex items-end gap-3">' + prev(curSrc, '22%', 64, cur ? '바꾼 아이콘' : '기본 아이콘') + '</div></div>' +
      '<div id="icNew" class="min-w-0"' + (S.out ? '' : ' style="display:none"') + '><div class="text-sm font-semibold mb-2">새 아이콘 미리보기</div><div id="icPrev" class="flex flex-wrap items-end gap-4"></div></div></div>' +
      '<div class="flex flex-wrap items-center text-sm" style="gap:.5rem .75rem">' +
      '<button id="icPick" type="button" class="' + BTN_G + '">그림 고르기</button><span id="icName" class="text-xs text-slate-500">' + esc(S.name || 'PNG·JPG 등, 정사각형에 가까운 그림이 좋습니다') + '</span></div>' +
      '<div id="icOpt" class="flex flex-wrap items-center text-sm" style="gap:.5rem 1.5rem;' + (S.img ? '' : 'display:none') + '"' + '>' +
      '<label class="inline-flex items-center gap-1"><input type="radio" name="icMode" value="cover" style="margin-right:.3rem" ' + (S.mode === 'cover' ? 'checked' : '') + '> 꽉 채우기(가장자리 잘림)</label>' +
      '<label class="inline-flex items-center gap-1"><input type="radio" name="icMode" value="contain" style="margin-right:.3rem" ' + (S.mode === 'contain' ? 'checked' : '') + '> 전체 보이기(여백)</label>' +
      '<label class="inline-flex items-center" style="gap:.4rem">배경색 <input id="icBg" type="color" value="' + esc(S.bg) + '" style="width:2.2rem;height:1.6rem;padding:0;border:1px solid #cbd5e1;border-radius:.3rem"></label></div>' +
      '<div class="flex flex-wrap gap-2"><button id="icSave" type="button" class="' + BTN_P + '"' + (S.out ? '' : ' disabled style="opacity:.45"') + '>이 아이콘으로 바꾸기</button>' +
      '<button id="icZip" type="button" class="' + BTN_G + '"' + (S.out ? '' : ' disabled style="opacity:.45"') + '>깃허브용 아이콘 파일 내려받기</button>' +
      (cur ? '<button id="icReset" type="button" class="' + BTN_G + ' text-red-600">기본 아이콘으로 되돌리기</button>' : '') + '</div>' +
      '<ul class="text-xs text-slate-500 leading-relaxed list-disc pl-5">' +
      '<li>바꾸면 이 사이트를 여는 모든 기기의 탭 아이콘이 바뀌고, 이후 <b>홈 화면에 추가</b>하는 앱 아이콘도 새 그림으로 만들어집니다.</li>' +
      '<li><b>이미 홈 화면에 추가해 둔 아이콘은 바뀌지 않을 수 있습니다.</b> 그럴 때는 홈 화면 아이콘을 지우고 사이트에서 다시 추가하세요.</li>' +
      '<li>브라우저에 따라 홈 화면 아이콘에 새 그림이 적용되지 않을 수도 있습니다. 확실하게 바꾸려면 [깃허브용 아이콘 파일 내려받기]로 받은 파일들을 깃허브 저장소의 같은 위치에 덮어써서 올리세요.</li></ul></div>';
    const $ = (id) => el.querySelector('#' + id);
    const paint = () => {
      if (!S.img) return; S.out = build();
      $('icPrev').innerHTML = prev(S.out.i192, '22%', 64, '둥근 사각형') + prev(S.out.m512, '50%', 64, '원형(안드로이드)') + prev(S.out.i180, '22%', 48, '아이폰') + prev(S.out.i32, '4px', 20, '탭');
      $('icNew').style.display = ''; ['icSave', 'icZip'].forEach((id) => { $(id).disabled = false; $(id).style.opacity = ''; });
    };
    $('icPick').onclick = () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.style.display = 'none';
      inp.onchange = async () => { const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
        try { S.img = await loadImg(f); S.name = f.name; $('icName').textContent = f.name + ' (' + S.img.width + '×' + S.img.height + ')'; $('icOpt').style.display = ''; paint(); }
        catch (e) { toast(e.message, true); } };
      document.body.appendChild(inp); inp.click();
    };
    el.querySelectorAll('input[name=icMode]').forEach((r) => { r.onchange = () => { S.mode = r.value; paint(); }; });
    $('icBg').oninput = () => { S.bg = $('icBg').value; paint(); };
    const notifyTop = () => { try { parent.postMessage('gp-icon-changed', '*'); } catch (e) { /* 단독 실행 */ } };
    const denied = (e) => /permission|권한/i.test(String(e && (e.code || e.message)));
    $('icSave').onclick = async () => {
      if (!S.out) return; const b = $('icSave'); b.disabled = true; const t = b.textContent; b.textContent = '저장하는 중...';
      try {
        const v = String(Date.now());
        await col().doc('app_icon').set(Object.assign({ v, updatedAt: new Date().toISOString() }, S.out));
        await col().doc('icon_meta').set({ v, custom: true });
        notifyTop(); toast('웹앱 아이콘을 바꿨습니다.'); S.img = null; S.out = null; S.name = ''; render(el, h);
      } catch (e) { console.warn(e); toast(denied(e) ? '저장 권한이 없습니다. 관리자 비밀번호로 다시 로그인해 주세요.' : '저장하지 못했습니다: ' + (e.message || e), true); b.disabled = false; b.textContent = t; }
    };
    $('icZip').onclick = async () => { if (!S.img) return; try { await downloadZip(); } catch (e) { toast('파일을 만들지 못했습니다: ' + (e.message || e), true); } };
    const rs = $('icReset'); if (rs) rs.onclick = async () => {
      if (!confirm('기본 아이콘으로 되돌릴까요?')) return;
      try { await col().doc('app_icon').delete(); await col().doc('icon_meta').set({ v: String(Date.now()), custom: false }); notifyTop(); toast('기본 아이콘으로 되돌렸습니다.'); render(el, h); }
      catch (e) { console.warn(e); toast(denied(e) ? '저장 권한이 없습니다. 관리자 비밀번호로 다시 로그인해 주세요.' : '되돌리지 못했습니다: ' + (e.message || e), true); }
    };
    if (S.img) paint();
  }
  window.GPIcon = { render };
})();
