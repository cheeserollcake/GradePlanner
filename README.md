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

## 관리자 페이지 (pages/admin.html)
초기 비밀번호는 관리자·페이지 접근 모두 `0000` 입니다. (비밀번호/데이터 관리 메뉴에서 변경)
- 시간표 설정: 과목·시수·전담 체크(`data_basic.list_sub`, `list_sub_hours`, `list_sub_special`), 교시(`list_time`)
- 학년 기초 설정: 학년도, 학기·방학, 기초 일정(CSV 업로드), 학급·담임·전담교사(`app_config/general`, 교사 이름은 `list_t`)
- 공간 개방 설정: 체육 공간(`list_gym`)·특별실(`list_room`), 학기별 개방 시간, 예외(`app_config/space_open`)
- 비밀번호/데이터 관리: 공통 비밀번호(`app_config/passwords`), 학년도별 데이터 삭제

## 참고
- 목록 필드는 순서를 보존하려고 `<필드>_order` 숫자 필드를 함께 저장합니다.
- 날짜는 기존 데이터와 같은 문자열(예: `2026년 10월 20일 (화)`)로 저장합니다.

## 전담 시간표 / 특별실 시간표
- 전담 시간표: 관리자 > 학년 기초 설정 > 전담교사에 등록한 (과목, 교사) 마다 탭이 만들어지고, 표에는 그 교사의 담당학급만 나옵니다.
- 특별실 시간표: 관리자 > 공간 개방 설정의 공간 목록, 학기별 개방 시간, 예외(닫힌 곳 열기/열린 곳 닫기)를 그대로 따릅니다.
- 공휴일은 법령 기준으로 계산합니다(양력 고정일, 음력 명절은 천문 계산, 대체공휴일). 선거일·임시공휴일은 관리자 > 학년 기초 설정 > 기초 일정(휴일 체크, CSV의 '휴일 여부' 열) 또는 개요 화면 연필 아이콘에서 입력하며 `data_basic` 의 `holiday`, `holiday_start_date`, `holiday_end_date` 에 저장됩니다.

## 관리자 페이지 동작
- 관리자 페이지는 들어올 때마다 비밀번호를 묻습니다.
- 시간표 설정, 학급·교사 설정, 학기·방학 날짜, 체육 공간/특별실 목록과 개방 설정은 입력하면 바로 저장됩니다. (저장 버튼 없음)
- 담임교사·전담교사 이름은 `data_basic.list_t` 에 중복 없이 저장되고, 학급/과목/기간과의 매칭은 `app_config/general`(homerooms, specials)에 저장됩니다.
- 과목별 1학기·2학기 총시수는 `data_basic` 의 `list_sub_hours_sem1`, `list_sub_hours_sem2` 에 저장되고, 전담 시간표 상단의 '시수' 줄에 표시됩니다.
