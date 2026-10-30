#!/usr/bin/env python3
"""기존 앱스스크립트 화면(index.html)을 Firebase 버전 페이지로 변환합니다."""
import re, pathlib, sys

SRC = pathlib.Path(sys.argv[1])          # old-main 폴더
DST = pathlib.Path(sys.argv[2])          # pages 폴더
PAGES = {  # 폴더명 -> (새 파일명, 페이지키)
    # Page 01, 02(홈, 6학년 개요)는 새로 작성한 pages/home.html, pages/overview.html 사용
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

    if key == "p06":   # 탭을 관리자 설정(전담교사 매칭)에서 가져옴
        html = must_replace(html, "if (targetVal !== currentVal) {", "if (targetVal && targetVal !== currentVal) {", fname)
        html = must_replace(html, "useState('전담(과학1)')", "useState('')", fname)
        html = must_replace(html, "const tabs = ['전담(과학1)', '전담(과학2)', '전담(영어1)', '전담(영어2)', '전담(영어3)'];", "const tabs = Object.keys(cachedData);", fname)
        html = must_replace(html, "setCachedData(processedAll);", "setCachedData(processedAll);\n            setActiveTab(prev => (prev && processedAll[prev]) ? prev : (Object.keys(processedAll)[0] || ''));\n            if (parsed.currentSemester) setSemester(parsed.currentSemester);", fname)
        html = must_replace(html, "if (idx === 9) return 'bg-color-9'; \n          if (idx >= 0 && idx <= 8) return `bg-color-${idx}`;", "if (idx >= 0) return `bg-color-${idx % 10}`;", fname)
        html = must_replace(html, "val.length === 1", "val.length <= 2", fname)
        html = must_replace(html, '<option value="direct_input" className="text-blue-600 font-bold bg-slate-100">[직접 입력]</option>', "", fname)
        html = must_replace(html, "{!initialLoaded || !currentTabData ? (", "{initialLoaded && tabs.length === 0 ? (\n                <div className=\"flex flex-col items-center justify-center h-64 text-slate-400 space-y-2\"><p>등록된 전담교사가 없습니다.</p><p className=\"text-sm\">학년 관리자 &gt; 학년 기초 설정 &gt; 전담교사에서 과목·담당학급·교사를 등록하세요.</p></div>\n              ) : !initialLoaded || !currentTabData ? (", fname)
    if key == "p07":   # 관리자 설정 버튼은 새 관리자 페이지로 이동
        html = must_replace(html, "onClick={() => isAdmin ? setView('admin') : setAuthModal('admin')}", "onClick={() => { try { parent.location.hash = '#/admin'; } catch (e) { location.href = 'admin.html'; } }}", fname)
    if key == "p07":   # 공간·개방 설정을 관리자 페이지 설정(이름 기준)에서 가져옴
        R = lambda a, b: must_replace(html, a, b, fname)
        html = R('const classOptions = [', 'let classOptions = [')
        html = R("useState(3);", "useState(() => new Date().getMonth() + 1);")
        html = R("const year = (selectedMonth === 1 || selectedMonth === 2) ? 2027 : 2026;", "const year = (selectedMonth <= 2) ? ((settings?.year || 2026) + 1) : (settings?.year || 2026);")
        html = R("[3,4,5,6,7,8,9,10,11,12,1].map(m => (", "[3,4,5,6,7,8,9,10,11,12,1,2].map(m => (")
        html = R("const semester = (selectedMonth >= 3 && selectedMonth <= 7) ? 'sem1' : 'sem2';",
          "const semester = (selectedMonth >= 3 && selectedMonth <= 7) ? 'sem1' : 'sem2';\n      const semKeyOf = (dt) => { const sems = settings?.semesters || []; const iso = getLocalISODate(dt); const s1 = sems.find(x => x.name === '1학기'); const s2 = sems.find(x => x.name === '2학기'); if (s2 && iso >= s2.start && iso <= s2.end) return 'sem2'; if (s1 && iso >= s1.start && iso <= s1.end) return 'sem1'; return semester; };")
        html = R("const isoDate = getLocalISODate(dayObj);", "const isoDate = getLocalISODate(dayObj);\n                      const semester = semKeyOf(dayObj);")
        html = R("const headerClass = tableType === 'sports' ? 'sticky-header-sports' : 'sticky-header-com';",
          "const headerClass = tableType === 'sports' ? 'sticky-header-sports' : 'sticky-header-com';\n      const colW = 62 + spaces.length * 50;\n      const tdStyle = { width: colW + 10, minWidth: colW + 10, maxWidth: colW + 10 };\n      const tblStyle = { width: colW, minWidth: colW, maxWidth: colW };\n      const gridStyle = { display: 'grid', gridTemplateColumns: '1.3fr repeat(' + spaces.length + ', 1fr)', width: '100%' };\n      const periodCount = (settings?.times?.length || 6);")
        html = R("<th key={wd} className={`${headerClass} p-3 text-center font-extrabold`}>", "<th key={wd} style={tdStyle} className={`${headerClass} p-3 text-center font-extrabold`}>")
        html = R("<td key={dIdx} className={`border-r bg-slate-50 ${tdWidthClass}`}></td>", "<td key={dIdx} style={tdStyle} className={`border-r bg-slate-50 ${tdWidthClass}`}></td>")
        html = R("<td key={dIdx} className={`border-r p-1 align-top ${tdWidthClass} ${isHoliday ? 'bg-holiday' : ''}`}>", "<td key={dIdx} style={tdStyle} className={`border-r p-1 align-top ${tdWidthClass} ${isHoliday ? 'bg-holiday' : ''}`}>")
        html = R("<div className={`${tableWidthClass} flex flex-col border border-slate-300 rounded overflow-hidden mx-auto`}>", "<div style={tblStyle} className={`${tableWidthClass} flex flex-col border border-slate-300 rounded overflow-hidden mx-auto`}>")
        html = R("<div className={`${gridRowClass} bg-slate-200 text-center text-[10pt] font-bold border-b border-slate-300`}>", "<div style={gridStyle} className={`${gridRowClass} bg-slate-200 text-center text-[10pt] font-bold border-b border-slate-300`}>")
        html = R("{[1,2,3,4,5,6].map(period => (", "{Array.from({ length: periodCount }, (_, i) => i + 1).map(period => (")
        html = R("<div key={period} className={`${gridRowClass} border-b last:border-0 border-slate-200 h-8`}>", "<div key={period} style={gridStyle} className={`${gridRowClass} border-b last:border-0 border-slate-200 h-8`}>")
        html = R("<div key={i} className={`grid-col ${i < spaces.length - 1 ? 'border-r border-slate-300' : ''}`}>{sp}</div>", "<div key={i} style={{ backgroundColor: (settings?.colors || {})[sp] }} className={`grid-col ${i < spaces.length - 1 ? 'border-r border-slate-300' : ''}`}>{sp}</div>")
        a = html.index("// 다목의 경우 팝업 및 병합 표시 특별 처리"); b = html.index("// 일반 공간 처리")
        html = html[:a] + html[b:]
        html = R("const globalSpaceIdx = spaceIndices[localIdx];", "const globalSpaceIdx = spName;")
        html = html.replace("parseInt(ex.spaceIdx) === globalSpaceIdx", "ex.space === globalSpaceIdx")
        html = R("const spNameMapping = allSpaces[globalSpaceIdx];", "const spNameMapping = spName;")
        html = R("const bgColorClass = spaceBgColors[globalSpaceIdx];", "const bgStyle = { backgroundColor: (settings?.colors || {})[spName] || '#e2e8f0' };")
        html = html.replace("className={`grid-col ${bgColorClass} relative ${borderClass}`}", "style={bgStyle} className={`grid-col relative ${borderClass}`}")
        html = R("spaces={['강당', '다목', '운동장', '나래', 'VR']}", "spaces={settings.gymSpaces || []}")
        html = R("spaceIndices={[0, -1, 2, 3, 4]}", "spaceIndices={[]}")
        html = R("spaces={['컴1', '컴2', '음악']}", "spaces={settings.roomSpaces || []}")
        html = R("spaceIndices={[5, 6, 7]}", "spaceIndices={[]}")
        html = R("setSettings(prev => ({ ...prev, ...(res.settings || {}) }));", "if (res.settings && res.settings.classNames) classOptions = res.settings.classNames.concat(['불가']);\n            setSettings(prev => ({ ...prev, ...(res.settings || {}) }));")
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
