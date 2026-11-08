/* 마우스·손가락(터치) 모두 되는 끌어서 옮기기 (HTML5 drag 는 모바일에서 동작하지 않아 포인터 이벤트로 직접 구현)
 *   DnD.bind(root, { handle, item, drop, axis, zone, ignore, onDrop(dragEl, targetEl|null, after, zoneEl|null) })
 *   handle: 눌러서 끌기 시작하는 요소 선택자 / item: 실제로 옮겨지는 요소(기본 = handle 이 속한 가장 가까운 item)
 *   drop: 놓을 수 있는 대상 선택자 / zone: 빈 곳에 놓으면 맨 끝에 넣을 영역 선택자(선택)
 *   axis: 'x' | 'y' | (targetEl) => 'x'|'y'  (앞/뒤 판단 방향) */
(function () {
  var css = '.dnd-handle{touch-action:none;cursor:grab;-webkit-user-select:none;user-select:none}' +
    'body.dnd-active,body.dnd-active *{-webkit-user-select:none!important;user-select:none!important;cursor:grabbing!important}' +
    '.dnd-src{opacity:.35}.dnd-ghost{position:fixed;z-index:99999;pointer-events:none;opacity:.9;box-shadow:0 8px 24px rgba(0,0,0,.25);margin:0!important}' +
    '.dnd-before-x{box-shadow:inset 4px 0 0 #4f46e5!important}.dnd-after-x{box-shadow:inset -4px 0 0 #4f46e5!important}' +
    '.dnd-before-y{box-shadow:inset 0 4px 0 #4f46e5!important}.dnd-after-y{box-shadow:inset 0 -4px 0 #4f46e5!important}' +
    '.dnd-zone{outline:2px dashed #4f46e5;outline-offset:2px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var MARKS = ['dnd-before-x', 'dnd-after-x', 'dnd-before-y', 'dnd-after-y', 'dnd-zone'];
  function clearMarks() { MARKS.forEach(function (c) { document.querySelectorAll('.' + c).forEach(function (n) { n.classList.remove(c); }); }); }
  function bind(root, o) {
    var item = o.item || o.handle, ignore = o.ignore === undefined ? 'input,select,textarea,button,a,label' : o.ignore;
    var cur = null;
    root.addEventListener('pointerdown', function (e) {
      if (cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var h = e.target.closest && e.target.closest(o.handle); if (!h || !root.contains(h)) return;
      var ig = ignore && e.target.closest(ignore); if (ig && h.contains(ig) && ig !== h) return;
      var el = h.closest(item) || h; var r = el.getBoundingClientRect();
      cur = { el: el, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, id: e.pointerId, on: false, tgt: null, after: false, zone: null };
      document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    });
    function begin() {
      cur.on = true; var g = cur.el.cloneNode(true); g.classList.add('dnd-ghost'); g.style.width = cur.w + 'px'; g.style.height = cur.h + 'px'; g.removeAttribute('id');
      document.body.appendChild(g); cur.ghost = g; cur.el.classList.add('dnd-src'); document.body.classList.add('dnd-active');
    }
    function move(e) {
      if (!cur || e.pointerId !== cur.id) return;
      if (!cur.on) { if (Math.abs(e.clientX - cur.x) + Math.abs(e.clientY - cur.y) < 6) return; begin(); }
      e.preventDefault();
      cur.ghost.style.left = (e.clientX - cur.dx) + 'px'; cur.ghost.style.top = (e.clientY - cur.dy) + 'px';
      clearMarks(); cur.tgt = null; cur.zone = null;
      var t = document.elementFromPoint(e.clientX, e.clientY); if (!t) return;
      var d = t.closest(o.drop);
      if (d && d !== cur.el && root.contains(d) && (!o.accept || o.accept(cur.el, d))) {
        var ax = typeof o.axis === 'function' ? o.axis(d) : (o.axis || 'x'), r = d.getBoundingClientRect();
        cur.after = ax === 'x' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2; cur.tgt = d;
        d.classList.add('dnd-' + (cur.after ? 'after' : 'before') + '-' + ax);
      } else if (o.zone) { var z = t.closest(o.zone); if (z && root.contains(z)) { cur.zone = z; z.classList.add('dnd-zone'); } }
    }
    function up(e) {
      if (!cur || e.pointerId !== cur.id) return;
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
      var c = cur; cur = null;
      if (!c.on) return;
      if (c.ghost) c.ghost.remove(); c.el.classList.remove('dnd-src'); document.body.classList.remove('dnd-active'); clearMarks();
      var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); }; document.addEventListener('click', swallow, true); setTimeout(function () { document.removeEventListener('click', swallow, true); }, 50);
      if (e.type === 'pointerup' && (c.tgt || c.zone)) o.onDrop(c.el, c.tgt, c.after, c.zone);
    }
  }
  window.DnD = { bind: bind };
})();
