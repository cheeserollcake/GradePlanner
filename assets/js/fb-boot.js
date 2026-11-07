/* fb-boot.js : Firebase 도구를 페이지마다 다시 내려받고 다시 연결하지 않도록, 바깥 틀(index.html)이 이미 불러온 것을 그대로 씁니다.
 * (모바일에서 화면을 옮길 때마다 생기던 도구 다운로드·해석·서버 연결 시간을 줄입니다.) 단독으로 열면 예전처럼 직접 불러옵니다. */
(function () {
  var FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
  try {
    var p = window.parent;
    if (p && p !== window && p.firebase && p.firebase.apps && p.firebase.apps.length && p.firebase.firestore) { window.firebase = p.firebase; window.__GP_SHARED_FB = true; return; }
  } catch (e) { /* 다른 출처: 직접 불러옴 */ }
  document.write('<script src="' + FB + 'firebase-app-compat.js"><\/script><script src="' + FB + 'firebase-firestore-compat.js"><\/script>');
})();
