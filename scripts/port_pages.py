#!/usr/bin/env python3
"""기존 앱스스크립트 화면(index.html)을 Firebase 버전 페이지로 변환합니다."""
import re, pathlib, sys

SRC = pathlib.Path(sys.argv[1])          # old-main 폴더
DST = pathlib.Path(sys.argv[2])          # pages 폴더
PAGES = {  # 폴더명 -> (새 파일명, 페이지키)
    "Page 01 ": ("home.html", "p01"),
    "Page 02":  ("overview.html", "p02"),
    "Page 03":  ("namelist.html", "p03"),
    "Page 04":  ("timetable-basic.html", "p04"),
    "Page 05":  ("timetable-monthly.html", "p05"),
    "Page 06":  ("timetable-special.html", "p06"),
    "Page 07":  ("timetable-room.html", "p07"),
    "Page 08":  ("lookup-class.html", "p08"),
    "Page 09":  ("lookup-course.html", "p09"),
    "Page 10":  ("extension.html", "p10"),
    "Page 11":  ("mall-id.html", "p11"),
}
FB = "https://www.gstatic.com/firebasejs/10.12.2/"
INJECT = lambda key: f"""
  <script>window.__GP_PAGE__ = '{key}';</script>
  <script src="{FB}firebase-app-compat.js"></script>
  <script src="{FB}firebase-firestore-compat.js"></script>
  <script src="{FB}firebase-storage-compat.js"></script>
  <script src="../assets/js/firebase-config.js"></script>
  <script src="../assets/js/gas-shim.js"></script>
"""

def must_replace(txt, old, new, name):
    if old not in txt:
        print(f"  [경고] {name}: 치환 대상을 찾지 못함 -> {old[:50]!r}")
        return txt
    return txt.replace(old, new)

for folder, (fname, key) in PAGES.items():
    html = (SRC / folder / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'<base\s+target="_top"\s*/?>', '', html)
    # 앱스스크립트 템플릿 태그 제거
    html = re.sub(r"<\?!=.*?\?>", "null", html)
    left = re.findall(r"<\?[!=]?[^?]*\?>", html)
    if left: print(f"  [경고] {fname}: 남은 템플릿 태그 {left[:3]}")
    # 공통 연결 코드 주입
    if re.search(r"<head[^>]*>", html):
        html = re.sub(r"(<head[^>]*>)", lambda m: m.group(1) + INJECT(key), html, count=1)
    else:
        html = INJECT(key) + html

    if key == "p06":   # 목표 시수가 비어 있으면 붉은 강조를 하지 않음
        html = must_replace(html, "if (targetVal !== currentVal) {", "if (targetVal && targetVal !== currentVal) {", fname)
    if key == "p07":   # 구글 이미지 크기 접미사 제거
        html = must_replace(html, 'img.url + "=s800"', 'img.url', fname)
    if key == "p10":   # 구글 드라이브 미리보기 -> Firebase Storage 주소
        html = must_replace(html, "'https://drive.google.com/uc?export=view&id=' + id", "id", fname)
        html = html.replace("'https://drive.google.com/file/d/' + id + '/preview'", "docSrc(id, mimeType)")
        html = must_replace(html, "function updateViewerSource(id, mimeType) {",
            "function docSrc(url, mime) {\n      if (mime && mime.indexOf('pdf') !== -1) return url;\n      return 'https://docs.google.com/gview?embedded=1&url=' + encodeURIComponent(url);\n    }\n\n    function updateViewerSource(id, mimeType) {", fname)
        # 기존 코드에 들어 있던 비밀번호 하드코딩 폴백 제거
        html = html.replace("pwd === 'qlcrkdhs01*'", "false")
        html = html.replace("updateViewerSource('1B73wD3pzJYCOxFcsZg-z2GFq0GJT2yF9', 'image/png');", "")
    (DST / fname).write_text(html, encoding="utf-8")
    print("변환:", folder.strip(), "->", fname)
