# 6학년 통합 관리 시스템 (GitHub Pages + Firebase)

구글 사이트/앱스스크립트/스프레드시트 웹앱을 GitHub Pages + Firebase(Firestore, Storage)로 옮긴 버전입니다.

## 배포
1. 이 폴더 전체를 GitHub 저장소에 올립니다.
2. 저장소 Settings > Pages > Branch `main` / `(root)` 로 설정합니다.
3. Firebase 콘솔에서 Firestore Database / Storage 를 만들고, `firestore.rules`, `storage.rules` 내용을 각각 규칙에 붙여넣어 게시합니다.
4. Authentication > 설정 > 승인된 도메인에 `<아이디>.github.io` 를 추가합니다.

## 구조
- `index.html` : 메뉴 + 페이지 표시(기존 구글 사이트 역할)
- `pages/` : 각 화면. 기존 화면 코드를 그대로 쓰고 데이터만 Firebase로 연결
- `assets/js/gas-shim.js` : `google.script.run` 호출을 Firestore/Storage로 바꿔주는 연결 코드
- `scripts/port_pages.py` : 기존 화면을 변환한 스크립트(참고용)

## Firestore 컬렉션
엑셀 탭과 동일: data_basic, data_task_school, data_task_memo, data_student, data_sub_timetable,
data_add_timetable, data_gym_timetable, data_room_timetable, data_budget, data_supply
새로 쓰는 컬렉션: app_config(설정·비밀번호), data_overview(개요 표 수기 칸), data_basic_timetable,
data_mall(쇼핑몰 ID), data_links(바로가기)
