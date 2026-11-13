/* fb-boot.js : Firebase 도구를 페이지마다 다시 내려받고 다시 연결하지 않도록, 바깥 틀(index.html)이 이미 불러온 것을 그대로 씁니다.
 * (모바일에서 화면을 옮길 때마다 생기던 도구 다운로드·해석·서버 연결 시간을 줄입니다.) 단독으로 열면 예전처럼 직접 불러옵니다.
 *
 * 주의: 각 화면(iframe)에서 만든 {…} 객체는 바깥 틀의 Firebase 입장에서는 "다른 창에서 만든 객체"라서
 *       저장할 때 "data must be an object, but it was a custom object" 오류가 납니다.
 *       그래서 저장 함수(set/update/add/batch)로 들어가는 값을 바깥 틀의 객체로 바꿔 주는 보정을 한 번만 겁니다. */
(function () {
  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  // 값을 P(바깥 창)의 객체·배열·날짜로 다시 만든다. 참조·Timestamp·FieldValue 같은 Firebase 객체는 그대로 둔다.
  function conv(v, P) {
    if (v === null || typeof v !== 'object') return v;
    var tag = Object.prototype.toString.call(v);
    if (tag === '[object Array]') { var a = new P.Array(v.length); for (var i = 0; i < v.length; i++) a[i] = conv(v[i], P); return a; }
    if (tag === '[object Date]') return v instanceof P.Date ? v : new P.Date(v.getTime());
    if (tag !== '[object Object]') return v;
    var proto = Object.getPrototypeOf(v);
    if (proto !== null && proto.constructor && proto.constructor.name !== 'Object') return v;   // 클래스 객체(참조·FieldValue 등)
    var o = new P.Object(); for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = conv(v[k], P); return o;
  }
  function patch(P) {
    if (P.__gpRealmPatched) return; P.__gpRealmPatched = true;
    var fs = P.firebase.firestore(), wrap = function (proto, name, from) {
      if (!proto || proto === P.Object.prototype || typeof proto[name] !== 'function') return;
      var orig = proto[name];
      proto[name] = function () { var args = Array.prototype.slice.call(arguments); for (var i = from; i < args.length; i++) args[i] = conv(args[i], P); return orig.apply(this, args); };
    };
    var dp = Object.getPrototypeOf(fs.doc('gp_patch/x')), bp = Object.getPrototypeOf(fs.batch()), cp = Object.getPrototypeOf(fs.collection('gp_patch'));
    wrap(dp, 'set', 0); wrap(dp, 'update', 0);      // ref.set(data, opts) / ref.update(data | field, value, …)
    wrap(bp, 'set', 1); wrap(bp, 'update', 1);      // batch.set(ref, data, opts)
    wrap(cp, 'add', 0);                              // collection.add(data)
  }
  window.__gpConvRealm = conv;
  try {
    var p = window.parent;
    if (p && p !== window && p.firebase && p.firebase.apps && p.firebase.apps.length && p.firebase.firestore) {
      patch(p); window.firebase = p.firebase; window.__GP_SHARED_FB = true; return;
    }
  } catch (e) { /* 다른 출처: 직접 불러옴 */ }
  document.write('<script src="' + FB + 'firebase-app-compat.js"><\/script><script src="' + FB + 'firebase-firestore-compat.js"><\/script><script src="' + FB + 'firebase-auth-compat.js"><\/script>');
})();
