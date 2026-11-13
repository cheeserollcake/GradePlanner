/*
 * gsheet-export.js : XlsxLite 표 설명(sheets)을 내 구글 드라이브의 새 구글 스프레드시트로 만들어 줍니다.
 *   GSheet.create('제목', sheets) -> { url }   (실패하면 읽기 쉬운 한국어 메시지의 Error)
 * 구글 로그인(팝업)은 이 작업에만 쓰고 바로 로그아웃하므로 사이트에는 로그인 상태가 남지 않습니다.
 */
(function (root) {
  'use strict';
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('구글 로그인 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); document.head.appendChild(s); });
  function googleError(e) {
    const code = (e && e.code) || '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '로그인 창이 닫혀서 취소되었습니다.';
    if (code === 'auth/popup-blocked') return '브라우저가 로그인 창을 막았습니다. 팝업을 허용한 뒤 다시 눌러 주세요.';
    if (code === 'auth/unauthorized-domain') return '이 사이트 주소(' + location.hostname + ')가 Firebase 승인된 도메인에 없습니다. Firebase 콘솔 > Authentication > 설정 > 승인된 도메인에 추가해 주세요.';
    if (code === 'auth/operation-not-allowed') return 'Firebase 콘솔 > Authentication > 로그인 방법에서 Google 로그인을 사용 설정해 주세요.';
    if (code === 'auth/configuration-not-found') return 'Firebase Authentication이 아직 시작되지 않았습니다. Firebase 콘솔(gradeplanner-d5499) > 빌드 > Authentication > 시작하기를 누르고, 로그인 방법에서 Google을 사용 설정(프로젝트 지원 이메일 선택 후 저장)해 주세요.';
    return (e && e.message) || String(e);
  }
  async function sheetsError(res) {
    let body = {}; try { body = await res.json(); } catch (e) { /* 본문 없음 */ }
    const msg = (body.error && body.error.message) || ''; const reason = JSON.stringify(body.error || {});
    if (res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(reason)) return 'Google Sheets API가 사용 설정되어 있지 않습니다. Google Cloud 콘솔의 이 프로젝트(gradeplanner-d5499)에서 "Google Sheets API"를 사용 설정해 주세요.';
    if (res.status === 403) return '구글 계정 권한이 부족합니다. 로그인 창에서 "Google 드라이브 파일 만들기" 권한을 허용했는지 확인해 주세요. (' + msg + ')';
    if (res.status === 401) return '구글 로그인이 만료되었습니다. 다시 시도해 주세요.';
    return '스프레드시트를 만들지 못했습니다. (' + res.status + ') ' + msg;
  }
  async function driveError(res) {
    let body = {}; try { body = await res.json(); } catch (e) { /* 본문 없음 */ }
    const msg = (body.error && body.error.message) || ''; const reason = JSON.stringify(body.error || {});
    if (res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(reason)) return 'Google Drive API가 사용 설정되어 있지 않습니다. Google Cloud 콘솔의 이 프로젝트(gradeplanner-d5499)에서 API 및 서비스 > 라이브러리 > "Google Drive API"를 사용 설정한 뒤 1~2분 후 다시 시도해 주세요. (사진이 들어간 내보내기에 필요합니다)';
    if (res.status === 403) return '구글 계정 권한이 부족합니다. 로그인 창에서 "Google 드라이브 파일 만들기" 권한을 허용했는지 확인해 주세요. (' + msg + ')';
    if (res.status === 401) return '구글 로그인이 만료되었습니다. 다시 시도해 주세요.';
    return '스프레드시트를 만들지 못했습니다. (' + res.status + ') ' + msg;
  }
  async function create(title, sheets, onStatus) {
    const say = onStatus || function () {}; let signedIn = false, gsAuth = null;
    try {
      say('구글 로그인 창을 여는 중입니다...');
      if (!firebase.auth) await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
      const provider = new firebase.auth.GoogleAuthProvider(); provider.addScope('https://www.googleapis.com/auth/drive.file'); provider.setCustomParameters({ prompt: 'select_account' });
      // 구글 로그인은 별도 연결(gpgs)에서 해서, 비밀번호 페이지 로그인 상태를 건드리지 않습니다.
      const gsApp = (firebase.apps || []).find((a) => a.name === 'gpgs') || firebase.initializeApp(window.FIREBASE_CONFIG || firebase.app().options, 'gpgs');
      gsAuth = gsApp.auth(); try { await gsAuth.setPersistence(firebase.auth.Auth.Persistence.NONE); } catch (e) { /* 무시 */ }
      const result = await gsAuth.signInWithPopup(provider); signedIn = true;
      const token = result && result.credential && result.credential.accessToken; if (!token) throw new Error('구글 권한(액세스 토큰)을 받지 못했습니다. 다시 시도해 주세요.');
      say('스프레드시트를 만드는 중입니다...');
      if (sheets.some((sp) => sp.rows.some((r) => r.some((c) => c && c.img)))) {
        // 사진이 들어 있는 표: 구글 시트의 IMAGE() 수식은 데이터 주소 이미지를 받지 않으므로, 엑셀 파일(사진 포함)을 드라이브에 올리면서 구글 스프레드시트로 변환합니다.
        const bound = 'gp' + Math.random().toString(36).slice(2);
        const meta = JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.spreadsheet' });
        const body = new Blob(['--' + bound + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + bound + '\r\nContent-Type: ' + XlsxLite.XLSX_MIME + '\r\n\r\n', XlsxLite.toBytes(sheets), '\r\n--' + bound + '--']);
        const dr = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + bound }, body });
        if (!dr.ok) throw new Error(await driveError(dr));
        const dj = await dr.json(); return { url: dj.webViewLink || ('https://docs.google.com/spreadsheets/d/' + dj.id + '/edit') };
      }
      const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(XlsxLite.toSheetsRequest(title, sheets)) });
      if (!res.ok) throw new Error(await sheetsError(res));
      const j = await res.json(); return { url: j.spreadsheetUrl };
    } catch (e) { throw new Error(googleError(e)); }
    finally { if (signedIn && gsAuth) { try { await gsAuth.signOut(); } catch (e) { /* 무시 */ } } }
  }
  root.GSheet = { create, googleError };
})(window);
