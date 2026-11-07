#!/usr/bin/env python3
"""기존 앱스스크립트 화면(index.html)을 Firebase 버전 페이지로 변환합니다."""
import re, pathlib, sys, subprocess

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
# 관리자 버튼용 톱니바퀴(선 아이콘). 예산 페이지의 버튼과 같은 모양.
GEAR_SVG = '<path d="M12.2 2.5h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7v-.2a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" />'

INJECT = lambda key: f"""
  <script>window.__GP_PAGE__ = '{key}';</script>
  <script src="../assets/js/fb-boot.js"></script>
  {'<script src="' + FB + 'firebase-storage-compat.js"></script>' if key == 'p10' else ''}
  <link rel="stylesheet" href="../assets/css/tw-base.css">
  <script src="../assets/js/firebase-config.js"></script>
  <script src="../assets/js/gas-shim.js"></script>
"""

ESBUILD = next((p for p in ["/opt/npm-tools/node_modules/.bin/esbuild", "/home/claude/.npm-global/lib/node_modules/tsx/node_modules/esbuild/bin/esbuild"] if __import__("os").path.exists(p)), "esbuild")
FONT_STACK = "'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR'"

def finalize(html):
    """모바일 속도 개선: 웹폰트 제거, React 화면은 미리 컴파일해서 Babel/React CDN 제거"""
    if "charset" not in html.lower():   # 글자 깨짐 방지
        html = re.sub(r"(<head[^>]*>)", r'\1\n  <meta charset="UTF-8">', html, count=1)
    html = re.sub(r"@import url\('https://cdn\.jsdelivr\.net/gh/orioncactus/pretendard[^']*'\);?", "", html)
    html = html.replace("'Pretendard'", FONT_STACK) if FONT_STACK not in html else html
    def compile_jsx(m):
        out = subprocess.run([ESBUILD, "--loader=jsx", "--minify", "--target=es2018"], input=m.group(1), capture_output=True, text=True)
        if out.returncode != 0: raise SystemExit("JSX 컴파일 실패: " + out.stderr[:500])
        return "<script>" + out.stdout + "</script>"
    if 'type="text/babel"' in html:
        html = re.sub(r'<script type="text/babel">([\s\S]*?)</script>', compile_jsx, html)
        html = re.sub(r'\s*<script src="https://cdnjs\.cloudflare\.com/ajax/libs/react/[^"]*"></script>', '\n  <script src="../assets/js/react.min.js"></script>', html, count=1)
        html = re.sub(r'\s*<script src="https://cdnjs\.cloudflare\.com/ajax/libs/react-dom/[^"]*"></script>', '', html)
        html = re.sub(r'\s*<script src="https://cdnjs\.cloudflare\.com/ajax/libs/babel-standalone/[^"]*"></script>', '', html)
    # 모바일 속도: Tailwind CDN(브라우저에서 CSS 생성) 대신 미리 만든 CSS (scripts/build_css.mjs)
    html = re.sub(r'[ \t]*<script src="https://cdn\.tailwindcss\.com"></script>\n?', '', html)
    if '</head>' in html and 'tw-util.css' not in html:
        html = html.replace('</head>', '  <link rel="stylesheet" href="../assets/css/tw-util.css">\n</head>', 1)
    return html

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
        html, _n = re.subn(r"\{saveStatus === 'saved' && \(\s*<span className=\"status-saved\">[\s\S]*?</span>\s*\)\}", "", html, count=1)   # "모든 내용 저장됨" 문구 삭제
        if not _n: raise SystemExit("p06 저장됨 문구를 찾지 못했습니다")
        html = must_replace(html, "if (targetVal !== currentVal) {", "if (targetVal && targetVal !== currentVal) {", fname)
        html = must_replace(html, "useState('전담(과학1)')", "useState('')", fname)
        html = must_replace(html, "const tabs = ['전담(과학1)', '전담(과학2)', '전담(영어1)', '전담(영어2)', '전담(영어3)'];", "const tabs = Object.keys(cachedData);", fname)
        html = must_replace(html, "setCachedData(processedAll);", "setCachedData(processedAll);\n            setActiveTab(prev => (prev && processedAll[prev]) ? prev : (Object.keys(processedAll)[0] || ''));\n            if (parsed.currentSemester) setSemester(parsed.currentSemester);", fname)
        html = must_replace(html, "if (idx === 9) return 'bg-color-9'; \n          if (idx >= 0 && idx <= 8) return `bg-color-${idx}`;", "if (idx >= 0) return `bg-color-${idx % 10}`;", fname)
        # 글자 색: 시수와 배정이 다른 반만 빨간 볼드, 나머지는 검은 볼드
        html = must_replace(html, "const getTextStyle = (val) => {\n          if (typeof val === 'string' && val.length === 1) return 'text-bold-red';\n          return '';\n        };",
          "let mismatchMap = {};\n        const getTextStyle = (val) => {\n          if (!val) return '';\n          return mismatchMap[val] ? 'text-bold-red' : 'text-bold-black';\n        };", fname)
        html = must_replace(html, "validOptions = options.filter(opt => opt && opt !== '');",
          "validOptions = options.filter(opt => opt && opt !== '');\n          mismatchMap = {};\n          (top[0] || []).slice(1).forEach((o, i) => { const t = parseFloat(top[1][i + 1]) || 0; const c = parseFloat(top[2][i + 1]) || 0; mismatchMap[o] = !!t && t !== c; });", fname)
        html = must_replace(html, ".text-bold-red { font-weight: bold; color: red; }", ".text-bold-red { font-weight: bold; color: red; }\n      .text-bold-black { font-weight: bold; color: #000; }", fname)
        html = re.sub(r"\.cell-fixed \{[^}]*\}", ".cell-fixed {\n        width: 100%;\n        min-width: 0;\n        max-width: none;\n        height: 30px;\n        font-size: 13pt;\n      }", html, count=1)
        html = re.sub(r"\.cell-input \{[^}]*\}", ".cell-input {\n        width: 100%; height: 30px;\n        text-align: center; border: 2px solid #4f46e5; outline: none;\n        font-size: 13pt; font-weight: bold; background: white;\n      }", html, count=1)
        # 상단 표: 첫 열 너비 제한, 나머지 균등 / 하단 표: 주·기간 고정, 나머지 균등(데스크톱에서 가로 스크롤 없음)
        html = must_replace(html, '<table className="table-auto-layout border-collapse">',
          '<table className="border-collapse" style={{ tableLayout: \'fixed\', width: \'100%\', maxWidth: \'1230px\', margin: \'0 auto\' }}>\n                        <colgroup><col style={{ width: \'5rem\' }} />{top[0].slice(1).map((_, i) => <col key={i} />)}</colgroup>', fname)
        html = must_replace(html, "<table className=\"border-collapse\" style={{ tableLayout: 'fixed', minWidth: 'max-content' }}>",
          "<table className=\"border-collapse\" style={{ tableLayout: 'fixed', width: '100%', minWidth: '960px' }}>\n                        <colgroup><col style={{ width: '40px' }} /><col style={{ width: '80px' }} />{Array.from({ length: 30 }, (_, i) => <col key={i} />)}</colgroup>", fname)
        # 제목 옆 연필: 공간 이름(교사명/공간이름)
        html = must_replace(html, '<th colSpan={top[0].length} className="bg-slate-50 p-2 font-bold text-lg border">{title}</th>',
          '<th colSpan={top[0].length} className="bg-slate-50 p-2 font-bold text-lg border">{title}<button className="ml-2 text-base align-middle opacity-60 hover:opacity-100" title="공간 이름" onClick={() => setSpaceEdit({ tab: activeTab, value: currentTabData.space || \'\' })}>✏️</button></th>', fname)
        html = must_replace(html, "const [activeTab, setActiveTab] = useState('');", "const [activeTab, setActiveTab] = useState('');\n        const [spaceEdit, setSpaceEdit] = useState(null);", fname)
        html = must_replace(html, "let mismatchMap = {};", "const saveSpace = () => { const v = spaceEdit; setSpaceEdit(null); google.script.run.withSuccessHandler(() => { fetchAllData(); }).saveSpaceName(v.tab, v.value); };\n        let mismatchMap = {};", fname)
        html = must_replace(html, "            </main>\n          </div>\n        );",
          "            </main>\n            {spaceEdit && (\n              <div className=\"fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4\" onClick={() => setSpaceEdit(null)}>\n                <div className=\"bg-white rounded-xl shadow-xl p-5 w-full max-w-sm space-y-3\" onClick={(e) => e.stopPropagation()}>\n                  <h3 className=\"font-bold\">공간 이름</h3>\n                  <input autoFocus className=\"w-full border rounded-lg px-3 py-2\" placeholder=\"공간이름\" value={spaceEdit.value} onChange={(e) => setSpaceEdit({ ...spaceEdit, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveSpace(); }} />\n                  <div className=\"flex justify-end gap-2\"><button className=\"px-4 py-2 rounded-lg bg-slate-100 text-sm font-semibold\" onClick={() => setSpaceEdit(null)}>취소</button><button className=\"px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold\" onClick={saveSpace}>저장</button></div>\n                </div>\n              </div>\n            )}\n          </div>\n        );", fname)
        html = must_replace(html, '<option value="direct_input" className="text-blue-600 font-bold bg-slate-100">[직접 입력]</option>', "", fname)
        html = must_replace(html, "{!initialLoaded || !currentTabData ? (", "{initialLoaded && tabs.length === 0 ? (\n                <div className=\"flex flex-col items-center justify-center h-64 text-slate-400 space-y-2\"><p>등록된 전담교사가 없습니다.</p><p className=\"text-sm\">학년 관리자 &gt; 학년 기초 설정 &gt; 전담교사에서 과목·담당학급·교사를 등록하세요.</p></div>\n              ) : !initialLoaded || !currentTabData ? (", fname)
    if key == "p04":   # 학급 수·교시 수는 관리자 설정을 따름 / 주간시수배정에서 꺼 둔 칸은 입력 불가 / 빈칸 자동 채우기
        # p12/p13(강조 과목)이 비어 있으면 빈 칸이 강조색으로 칠해져 회색 표시를 덮어쓰므로, 비어 있을 땐 강조하지 않음
        html = html.replace("p12 ? p12.toString() : ''", "p12 ? p12.toString() : null").replace("p13 ? p13.toString() : ''", "p13 ? p13.toString() : null")
        R = lambda a, b: must_replace(html, a, b, fname)
        html = R("const periods = ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'];",
                 "const periods = (timetableData && timetableData.periods) || ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'];\n        const [classCount, setClassCount] = useState(0);\n        const isOff = (c, r) => !!(timetableData && timetableData.off && timetableData.off.indexOf(c + '_' + r) >= 0);\n        const OFF_STYLE = { backgroundColor: '#cbd5e1', backgroundImage: 'repeating-linear-gradient(45deg, rgba(100,116,139,.22) 0 6px, transparent 6px 12px)', color: '#64748b' };")
        html = html.replace("for(let r=1; r<=6; r++) {", "for(let r=1; r<=periods.length; r++) {")
        html = R("setTimetableData(parsed.data);", "setClassCount(parsed.data.classCount || 0);\n                   if (typeof classNum === 'number' && parsed.data.classCount && classNum > parsed.data.classCount) { setActiveTab('all'); } else { setTimetableData(parsed.data); }")
        html = R("Array.from({length:10}, (_, i) => i+1)", "Array.from({length: classCount}, (_, i) => i+1)")
        html = R("const handleDeleteTimetable = (targetClass) => {", """const handleAutoFill = (targetClass) => {
          if (!confirm('빈 공간을 자동으로 채웁니다.')) return;
          setIsRefreshing(true);
          google.script.run
            .withSuccessHandler(res => {
              let p = null; try { p = JSON.parse(res); } catch (e) {}
              if (!p || !p.success) alert('자동 채우기 오류: ' + (p && p.error ? p.error : '알 수 없는 오류'));
              else if (p.short && p.short.length) alert('채울 수 있는 빈칸이 부족해 일부 시수를 배정하지 못했습니다.\\n' + p.short.map(x => x.subject + ' ' + x.count + '시수').join(', '));
              else if (!p.filled) alert('채울 빈칸이 없거나 이미 배정시수에 맞게 채워져 있습니다.');
              loadData(activeTab);
            })
            .withFailureHandler(err => { alert('서버 연결 실패: ' + err); setIsRefreshing(false); })
            .autoFillBasicTimetable({ classNum: targetClass });
        };

        const handleDeleteTimetable = (targetClass) => {""")
        html = R("""                    <button onClick={() => handleDeleteTimetable(activeTab)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                     <Icons.Trash size={24} />
                    </button>""", """                    <div className="flex items-center gap-1">
                      <button onClick={() => handleAutoFill(activeTab)} title="빈 공간 자동 채우기" className="text-slate-400 hover:text-indigo-600 transition-colors p-1">
                       <Icons.Wand size={24} />
                      </button>
                      <button onClick={() => handleDeleteTimetable(activeTab)} title="초기화" className="text-slate-400 hover:text-red-500 transition-colors p-1">
                       <Icons.Trash size={24} />
                      </button>
                    </div>""")
        html = R("        ChevronDown:", """        Wand: (p) => <svg {...p} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg>,
        ChevronDown:""")
        # 단일 학급 보기의 칸: 꺼 둔 칸은 회색, 비어 있으면 입력 불가(값이 이미 있으면 지울 수는 있음)
        html = R("""<td key={cIdx} className={`border p-0 ${cellBg} ${cellBold} h-12 relative`}>""", """<td key={cIdx} className={`border p-0 ${cellBg} ${cellBold} h-12 relative`} style={isOff(cIdx+1, rIdx+1) ? OFF_STYLE : undefined} title={isOff(cIdx+1, rIdx+1) ? '관리자 > 시간표 설정 > 주간시수배정에서 꺼 둔 칸입니다.' : ''}>""")
        html = R("""{subjects.filter(s=>s).map(s => <option key={s} value={s}>{s}</option>)}""", """{(isOff(cIdx+1, rIdx+1) ? (cell ? [cell] : []) : subjects.filter(s=>s)).map(s => <option key={s} value={s}>{s}</option>)}""")
        html = R("""<td key={cIdx} className={`border p-0 ${cellClass} ${cellBold} h-8 relative`}>""", """<td key={cIdx} className={`border p-0 ${cellClass} ${cellBold} h-8 relative`} style={isOff(cIdx+1, rIdx+1) ? OFF_STYLE : undefined}>""")
    if key == "p07":   # 관리자 설정 버튼은 새 관리자 페이지로 이동
        # 상단 아이콘을 한 벌의 선(line) 아이콘으로 통일 (굵기·모서리 동일) — 관리자 버튼(톱니)도 예산 페이지와 같은 모양
        def _ico(name, inner, cls="w-5 h-5"):
            return f'      {name}: () => <svg className="{cls}" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" strokeWidth={{1.8}} strokeLinecap="round" strokeLinejoin="round">{inner}</svg>,\n'
        _ICONS = {
            "Sports": '<circle cx="12" cy="12" r="9.5" /><path d="M12 2.5v19M2.5 12h19" /><path d="M5.3 5.3c3.1 3.2 3.1 10.2 0 13.4M18.7 5.3c-3.1 3.2-3.1 10.2 0 13.4" />',
            "Computer": '<rect x="2.5" y="3.5" width="19" height="13" rx="2.2" /><path d="M8 21h8M12 16.5V21" />',
            "Photo": '<rect x="3.5" y="3.5" width="17" height="17" rx="3" /><circle cx="9" cy="9" r="1.6" /><path d="m20.5 15.5-4.3-4.3a2 2 0 0 0-2.8 0L5.5 20.5" />',
            "Shield": '<path d="M12 3 5 5.8v5.4c0 4.4 2.9 8 7 9.8 4.1-1.8 7-5.4 7-9.8V5.8L12 3Z" /><path d="m9 12 2.2 2.2L15 10.4" />',
            "Key": GEAR_SVG,
            "Gear": GEAR_SVG,
        }
        for _n, _inner in _ICONS.items():
            html, _c = re.subn(r"      " + _n + r": \(\) => <svg.*?</svg>,?\n", lambda m, n=_n, i=_inner: _ico(n, i), html, count=1, flags=re.S)
            if not _c: raise SystemExit("아이콘을 찾지 못했습니다: " + _n)
        html = must_replace(html, "onClick={() => isAdmin ? setView('admin') : setAuthModal('admin')}", "onClick={() => { try { parent.location.hash = '#/admin'; } catch (e) { location.href = 'admin.html'; } }}", fname)
    if key == "p05":   # 학년도 연도는 서버(관리자 설정) 값을 사용
        html = must_replace(html, "const baseYear = 2026;", "const baseYear = dbData.year || 2026;", fname)
    if key in ("p05", "p08", "p09"):   # 2월도 선택 가능
        html = html.replace("[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1]", "[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]")
    if key == "p08":   # 같은 일정으로 묶인 반 함께 수정 / 전담 일정은 전담 시간표에 반영 / 중복이면 저장하지 않음
        R = lambda a, b: must_replace(html, a, b, fname)
        html = R("const classList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];", "let classList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];")
        html = R("let currentClass = 1;", "let currentClass = 1;\n        window.__YEAR__ = parseInt(localStorage.getItem('gp_year'), 10) || 2026;")
        html = R("let year = 2026;\n            if (currentMonth === 1) {\n                year = 2027;\n            }", "let year = window.__YEAR__ || 2026;\n            if (currentMonth <= 2) { year += 1; }")
        a = html.index("function isClassMatch(targetStr, cNum) {"); b = html.index("function isPeriodMatch(")
        html = html[:a] + "function isClassMatch(targetStr, cNum) {\n            if (!targetStr) return false;\n            const s = String(targetStr);\n            if (s.includes('공통') || s.includes('전체') || s.includes('학년') || s.includes('전담')) return true;\n            return s.split(',').map(x => x.trim().replace(/반$/, '')).includes(String(cNum));\n        }\n\n        " + html[b:]
        html = R("const classMenu = document.getElementById('class-menu');", "const classMenu = document.getElementById('class-menu');\n            classMenu.innerHTML = '';")
        html = R("const monthSelect = document.getElementById('month-select');", "const monthSelect = document.getElementById('month-select');\n            monthSelect.innerHTML = '';")
        html = R("const classContainer = document.getElementById('modal-form-classes');", "const classContainer = document.getElementById('modal-form-classes');\n            classContainer.innerHTML = '';\n            document.getElementById('modal-form-periods').innerHTML = '';")
        html = R("globalHolidays = response.holidays;\n                        \n                        // 로컬 스토리지 업데이트", "globalHolidays = response.holidays;\n                        applyServerMeta(response);\n                        \n                        // 로컬 스토리지 업데이트")
        html = R("function refreshData() {", "function applyServerMeta(res) {\n            if (res.year) { window.__YEAR__ = res.year; localStorage.setItem('gp_year', res.year); }\n            if (res.classCount && res.classCount !== classList.length) {\n                classList = Array.from({ length: res.classCount }, (_, i) => i + 1);\n                if (currentClass > classList.length) currentClass = 1;\n                renderUIComponents(); renderModalCheckboxes();\n            }\n        }\n\n        function refreshData() {")
        html = R("const isUnmodifiable = ['강당', '다목', '운동장', '전담', '(휴)'].some(keyword => ev.course.includes(keyword));", "const isUnmodifiable = ev.source === 'gym' || ev.source === 'room' || ev.source === 'sub' || ['강당', '다목', '운동장', '전담', '(휴)'].some(keyword => ev.course.includes(keyword));")
        a = html.index("function executeSave() {"); b = html.index("function showLoading(show)")
        html = html[:a] + r"""function executeSave() {
            const dateVal = document.getElementById('modal-form-date').value;
            const courseVal = document.getElementById('modal-form-course').value.trim();
            const selectedClasses = Array.from(document.querySelectorAll('.modal-class-checkbox:checked')).map(cb => cb.value);
            const selectedPeriods = Array.from(document.querySelectorAll('.modal-period-checkbox:checked')).map(cb => cb.value);

            if(!dateVal) return alert("날짜를 선택해주세요.");
            if(selectedClasses.length === 0) return alert("학급을 하나 이상 선택해주세요.");
            if(selectedPeriods.length === 0) return alert("교시를 하나 이상 선택해주세요.");
            if(!courseVal) return alert("강좌명을 입력해주세요.");

            const newData = { date: dateVal, classes: selectedClasses.join(', '), periods: selectedPeriods.join(', '), course: courseVal, source: currentSelectedOldData ? currentSelectedOldData.source : 'add' };
            if (currentSelectedOldData) callBackendModify('edit', currentSelectedOldData, newData);
            else callBackendModify('add', null, newData);
        }

        function executeDelete(eventObj) {
            if(confirm(`[${eventObj.course}] 일정을 정말 삭제하시겠습니까?`)) callBackendModify('delete', eventObj, null);
        }

        // 서버에서 저장에 성공했을 때만 화면을 바꿉니다. (전담 시간표가 겹치면 오류 안내 후 저장하지 않음)
        function callBackendModify(action, oldData, newData) {
            showLoading(true);
            google.script.run
                .withSuccessHandler(res => {
                    showLoading(false);
                    if (!res || !res.success) { alert((res && res.error) || '저장하지 못했습니다.'); return; }
                    globalRawEvents = res.rawEvents || globalRawEvents;
                    localStorage.setItem('school_schedule_local_cache', JSON.stringify({ rawEvents: globalRawEvents, holidays: globalHolidays }));
                    closeModal();
                    generateAndRenderTable();
                })
                .withFailureHandler(err => { showLoading(false); alert('통신 오류: ' + err); })
                .modifyScheduleData(action, oldData, newData);
        }

        """ + html[b:]
    if key == "p09":   # 강좌 범주(묶음) + 학년도 연도
        R = lambda a, b: must_replace(html, a, b, fname)
        html = R("let year = 2026;\n                if (selectedMonth === 1) year = 2027;", "let year = window.__YEAR__ || 2026;\n                if (selectedMonth <= 2) year += 1;")
        html = R("let globalSpecials = {}; ", "let globalSpecials = {}; \n        let globalGroups = [];\n        let editingGroup = null;")
        html = R("globalSpecials = response.specials || {};", "globalSpecials = response.specials || {};\n                        globalGroups = response.groups || [];\n                        if (response.year) window.__YEAR__ = response.year;")
        a = html.index("function initCourseSelect() {"); b = html.index("function refreshData() {")
        html = html[:a] + r"""function initCourseSelect(keep) {
            const select = document.getElementById('course-select');
            const prev = keep || select.value;
            select.innerHTML = '';
            if (globalDropdowns.length === 0 && globalGroups.length === 0) {
                const option = document.createElement('option');
                option.textContent = "데이터 없음";
                select.appendChild(option);
                return;
            }
            // '전체'는 항상 맨 위(기본값), 그다음 범주(파란 볼드)
            const allOpt = document.createElement('option');
            allOpt.value = '__ALL__'; allOpt.textContent = '전체'; allOpt.style.fontWeight = 'bold';
            select.appendChild(allOpt);
            globalGroups.forEach(gr => {
                const option = document.createElement('option');
                option.value = 'group::' + gr.name;
                option.textContent = gr.name;
                option.style.fontWeight = 'bold';
                option.style.color = '#2563eb';
                select.appendChild(option);
            });
            globalDropdowns.forEach(course => {
                const option = document.createElement('option');
                option.value = course;
                option.textContent = course;
                select.appendChild(option);
            });
            if (prev && Array.from(select.options).some(o => o.value === prev)) select.value = prev; else select.value = '__ALL__';
        }

        // ---- 강좌 범주 관리 (연필 아이콘) ----
        function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
        function openGroupModal() { editingGroup = null; renderGroupModal(); document.getElementById('group-modal').classList.remove('hidden'); }
        function closeGroupModal() { document.getElementById('group-modal').classList.add('hidden'); }
        function newGroup() { editingGroup = { index: -1, name: '', courses: [] }; renderGroupModal(); }
        function editGroup(i) { editingGroup = { index: i, name: globalGroups[i].name, courses: globalGroups[i].courses.slice() }; renderGroupModal(); }
        function cancelGroupEdit() { editingGroup = null; renderGroupModal(); }
        function selectByText() {
            const t = document.getElementById('group-match').value.trim(); if (!t) return;
            document.querySelectorAll('.group-course').forEach(cb => { if (cb.value.includes(t)) cb.checked = true; });
            if (!document.getElementById('group-name').value.trim()) document.getElementById('group-name').value = t;
        }
        function persistGroups(groups, selectName) {
            google.script.run.withSuccessHandler(res => {
                if (!res || !res.success) { alert((res && res.error) || '저장하지 못했습니다.'); return; }
                globalGroups = res.groups; editingGroup = null;
                initCourseSelect(selectName ? 'group::' + selectName : null); renderTable(); renderGroupModal();
            }).saveCourseGroups(groups);
        }
        function saveGroup() {
            const name = document.getElementById('group-name').value.trim();
            const courses = Array.from(document.querySelectorAll('.group-course:checked')).map(cb => cb.value);
            if (!name) return alert('범주 이름을 입력해주세요.');
            if (!courses.length) return alert('포함할 강좌를 하나 이상 선택해주세요.');
            if (globalGroups.some((g, i) => g.name === name && i !== editingGroup.index)) return alert('같은 이름의 범주가 이미 있습니다.');
            const groups = globalGroups.map(g => ({ name: g.name, courses: g.courses.slice() }));
            if (editingGroup.index >= 0) groups[editingGroup.index] = { name, courses }; else groups.push({ name, courses });
            persistGroups(groups, name);
        }
        function deleteGroup(i) {
            if (!confirm('[' + globalGroups[i].name + '] 범주를 삭제할까요? (강좌 자체는 삭제되지 않습니다)')) return;
            const select = document.getElementById('course-select'); const cur = select.value;
            persistGroups(globalGroups.filter((_, k) => k !== i), cur === 'group::' + globalGroups[i].name ? null : cur);
        }
        function renderGroupModal() {
            const box = document.getElementById('group-modal-body');
            if (!editingGroup) {
                const list = globalGroups.map((g, i) => '<div class="flex items-center justify-between border rounded px-3 py-2"><span class="font-bold text-blue-600">' + escHtml(g.name) + ' <span class="text-xs text-gray-400 font-normal">(' + g.courses.length + '개 강좌)</span></span><span class="flex gap-2"><button onclick="editGroup(' + i + ')" class="text-xs px-2 py-1 bg-blue-50 border border-blue-200 text-blue-600 rounded">수정</button><button onclick="deleteGroup(' + i + ')" class="text-xs px-2 py-1 bg-red-50 border border-red-200 text-red-600 rounded">삭제</button></span></div>').join('');
                box.innerHTML = '<p class="text-sm text-gray-500 mb-2">여러 강좌를 하나의 범주로 묶어서 볼 수 있습니다. (예: 우쿨(1~2), 우쿨(3~4) → 우쿨)</p><div class="space-y-2 mb-3">' + (list || '<p class="text-sm text-gray-400 text-center py-3">등록된 범주가 없습니다.</p>') + '</div><button onclick="newGroup()" class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">+ 범주 추가</button>';
                return;
            }
            const eg = editingGroup;
            box.innerHTML = '<input id="group-name" class="w-full border rounded px-2 py-1.5 text-sm mb-2" placeholder="범주 이름 (예: 우쿨)" value="' + escHtml(eg.name) + '">' +
                '<div class="flex gap-1 mb-2"><input id="group-match" class="flex-1 border rounded px-2 py-1 text-sm" placeholder="포함된 글자로 한꺼번에 선택 (예: 우쿨)"><button onclick="selectByText()" class="px-2 py-1 bg-gray-100 border rounded text-sm">선택</button></div>' +
                '<div class="max-h-64 overflow-y-auto border rounded p-2 grid grid-cols-2 gap-1">' + globalDropdowns.map(c => '<label class="text-sm flex items-center gap-1"><input type="checkbox" class="group-course" value="' + escHtml(c) + '" ' + (eg.courses.includes(c) ? 'checked' : '') + '>' + escHtml(c) + '</label>').join('') + '</div>' +
                '<div class="flex justify-between mt-3"><button onclick="cancelGroupEdit()" class="px-3 py-1.5 bg-gray-100 rounded text-sm">취소</button><button onclick="saveGroup()" class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm">저장</button></div>';
        }

        """ + html[b:]
        html = R("const selectedCourse = courseSelect ? courseSelect.value : '';", "const selectedCourse = courseSelect ? courseSelect.value : '';\n                const groupDef = selectedCourse.startsWith('group::') ? globalGroups.find(gr => 'group::' + gr.name === selectedCourse) : null;\n                const groupSet = groupDef ? new Set(groupDef.courses) : null;")
        html = R("if (isAll) return true;", "if (selectedCourse === '__ALL__') return true;\n                                        if (groupSet) return groupSet.has(ev.course);\n                                        if (isAll) return true;")
        # 같은 날짜·교시·일정은 학급을 묶어서 표시 (2반, 3반, 5반 심폐소생)
        html = R("""matchedEvents.sort((a, b) => String(a.classNm).localeCompare(String(b.classNm)));
                                        
                                        const contentHtml = matchedEvents.map(e => {
                                            return `<div class="mb-1"><span class="font-bold text-blue-600">${e.classNm}</span> <span>${e.course}</span></div>`;
                                        }).join('');""", """const clsNo = (x) => { const m = String(x).match(/\\d+/); return m ? parseInt(m[0], 10) : 9999; };
                                        matchedEvents.sort((a, b) => clsNo(a.classNm) - clsNo(b.classNm) || String(a.classNm).localeCompare(String(b.classNm)));
                                        const byCourse = new Map();
                                        matchedEvents.forEach(e => {
                                            if (!byCourse.has(e.course)) byCourse.set(e.course, []);
                                            const arr = byCourse.get(e.course); if (arr.indexOf(e.classNm) < 0) arr.push(e.classNm);
                                        });
                                        const contentHtml = Array.from(byCourse.entries()).map(([course, classes]) => {
                                            return `<div class="mb-1"><span class="font-bold text-blue-600">${classes.join(', ')}</span> <span>${course}</span></div>`;
                                        }).join('');""")
        html = R('<option value="" disabled selected>로딩 중...</option>\n                    </select>', '<option value="" disabled selected>로딩 중...</option>\n                    </select>\n                    <button onclick="openGroupModal()" class="px-2 py-1 bg-white border-2 border-gray-200 rounded-lg hover:bg-blue-50" title="강좌 범주 관리">✏️</button>')
        html = R("</body>", '<div id="group-modal" class="hidden fixed inset-0 bg-black bg-opacity-40 z-50 flex justify-center items-center p-4"><div class="bg-white rounded-xl shadow-xl w-full max-w-md p-4 max-h-[90vh] overflow-y-auto"><div class="flex justify-between items-center mb-3"><h3 class="font-bold">강좌 범주 관리</h3><button onclick="closeGroupModal()" class="text-gray-400 text-lg">✕</button></div><div id="group-modal-body"></div></div></div>\n</body>')
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
          "const headerClass = tableType === 'sports' ? 'sticky-header-sports' : 'sticky-header-com';\n      const colW = 62 + spaces.length * 54;\n      // 열 최소 너비: 머리글(공간 이름)이 잘리지 않는 크기. 모든 열(교시 칸 포함)을 같은 너비로 나눔\n      const _cw = (t) => [...String(t)].reduce((a, ch) => a + (/[ㄱ-힣]/.test(ch) ? 12 : 7), 0);\n      const colMin = Math.max(40, Math.round(Math.max(24, ...spaces.flatMap(sp => String(sp).split(/(?=\\()/)).map(_cw)) + 10));\n      const tdStyle = {};\n      const tblStyle = {};\n      const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(' + (spaces.length + 1) + ', minmax(' + colMin + 'px, 1fr))', width: '100%' };\n      const periodCount = (settings?.times?.length || 6);")
        html = R("<th key={wd} className={`${headerClass} p-3 text-center font-extrabold`}>", "<th key={wd} style={tdStyle} className={`${headerClass} p-3 text-center font-extrabold`}>")
        html = R("<td key={dIdx} className={`border-r bg-slate-50 ${tdWidthClass}`}></td>", "<td key={dIdx} style={tdStyle} className={`border-r bg-slate-50 ${tdWidthClass}`}></td>")
        html = R("<td key={dIdx} className={`border-r p-1 align-top ${tdWidthClass} ${isHoliday ? 'bg-holiday' : ''}`}>", "<td key={dIdx} style={tdStyle} className={`border-r p-1 align-top ${tdWidthClass} ${isHoliday ? 'bg-holiday' : ''}`}>")
        html = R("<div className={`${tableWidthClass} flex flex-col border border-slate-300 rounded overflow-hidden mx-auto`}>", "<div style={tblStyle} className={`${tableWidthClass} flex flex-col border border-slate-300 rounded overflow-hidden mx-auto`}>")
        html = R("<div className={`${gridRowClass} bg-slate-200 text-center text-[10pt] font-bold border-b border-slate-300`}>", "<div style={gridStyle} className={`${gridRowClass} bg-slate-200 text-center text-[10pt] font-bold border-b border-slate-300`}>")
        html = R("{[1,2,3,4,5,6].map(period => (", "{Array.from({ length: periodCount }, (_, i) => i + 1).map(period => (")
        html = R("<div key={period} className={`${gridRowClass} border-b last:border-0 border-slate-200 h-8`}>", "<div key={period} style={gridStyle} className={`${gridRowClass} border-b last:border-0 border-slate-200 h-8`}>")
        html = R("<div key={i} className={`grid-col ${i < spaces.length - 1 ? 'border-r border-slate-300' : ''}`}>{sp}</div>", "<div key={i} style={{ backgroundColor: (settings?.colors || {})[sp], whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'keep-all', lineHeight: 1.15, fontSize: '9pt', padding: '2px 1px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className={`grid-col ${i < spaces.length - 1 ? 'border-r border-slate-300' : ''}`}><span>{String(sp).split(/(?=\\()/).map((t, k) => <React.Fragment key={k}>{k > 0 && <br />}{t}</React.Fragment>)}</span></div>")
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
    if key == "p05":   # 반 수·교시 수를 관리자 설정에 맞춤 (표 폭·줄 수·구분선·색 띠 모두 계산식으로)
        def _all(a, b, n):
            global html
            assert html.count(a) == n, (a, html.count(a))
            html = html.replace(a, b)
        _all("dbData.holidays = dbData.holidays || [];", "window.__P = Math.max(1, (dbData.periods || []).length || 6); window.__C = Math.max(1, dbData.classCount || 10); window.__PN = dbData.periods || []; window.__CN = dbData.classNames || [];\n          dbData.holidays = dbData.holidays || [];", 1)
        _all("new Array(31)", "new Array(1 + 5 * window.__P)", 3)
        _all("const colIdx = 1 + (i * 6);", "const colIdx = 1 + (i * window.__P);", 1)
        _all("numCols: 6 }", "numCols: window.__P }", 1)
        _all("for (let p = 1; p <= 6; p++) { \n                periodRow[1 + (i * 6) + (p - 1)] = p + \"교시\";", "for (let p = 1; p <= window.__P; p++) { \n                periodRow[1 + (i * window.__P) + (p - 1)] = window.__PN[p - 1] || (p + \"교시\");", 1)
        _all("for (let cNum = 1; cNum <= 10; cNum++) {", "for (let cNum = 1; cNum <= window.__C; cNum++) {", 1)
        _all("classRow[0] = `${cNum}반`;", "classRow[0] = window.__CN[cNum - 1] || `${cNum}반`;", 1)
        _all("for (let p = 1; p <= 6; p++) {\n                  const colIdx = 1 + (dIdx * 6) + (p - 1);", "for (let p = 1; p <= window.__P; p++) {\n                  const colIdx = 1 + (dIdx * window.__P) + (p - 1);", 1)
        _all("(r % 12 === 0)", "(r % (window.__C + 2) === 0)", 1)
        _all("(r % 12 === 1)", "(r % (window.__C + 2) === 1)", 1)
        _all("if ([6, 12, 18, 24].includes(c))", "if (c > 0 && c < 5 * window.__P && c % window.__P === 0)", 1)
        _all("if (c === 30)", "if (c === 5 * window.__P)", 1)
        _all("if (r % 12 === 11) {", "if (r % (window.__C + 2) === window.__C + 1) {", 1)
        _all("if (r % 2 === 0) { ", "if ((r % (window.__C + 2)) % 2 === 0) { ", 1)
        import re as _re
        _m = _re.search(r"if \(c >= 1 && c <= 6\) style\.backgroundColor = '#e0f7fa';.*?if \(c >= 25 && c <= 30\) style\.backgroundColor = '#e0f7fa';", html, _re.S)
        assert _m, "p05 색 띠를 찾지 못함"
        html = html[:_m.start()] + "style.backgroundColor = ['#e0f7fa', '#f8f2eb', '#f3eefe', '#fef8e3', '#e0f7fa'][Math.min(4, Math.floor((c - 1) / window.__P))];" + html[_m.end():]
        _all("if (r % 12 === 0 || r % 12 === 1) return '20px';", "if (r % (window.__C + 2) === 0 || r % (window.__C + 2) === 1) return '20px';", 1)
        _all("minWidth: '1500px'", "minWidth: Math.max(900, 40 + 5 * (window.__P || 6) * 48) + 'px'", 1)
        _all("Array.from({ length: 30 })", "Array.from({ length: 5 * (window.__P || 6) })", 1)
        _all("'calc((100% - 40px) / 30)'", "'calc((100% - 40px) / ' + 5 * (window.__P || 6) + ')'", 1)
    if key == "p08":   # 교시 수는 관리자 설정(교시 설정)을 따름
        R = lambda a, b: must_replace(html, a, b, fname)
        html = R("const periodList = [1, 2, 3, 4, 5, 6];", "let periodList = [1, 2, 3, 4, 5, 6]; window.__PN = [];\n        const pName = (p) => (window.__PN && window.__PN[p - 1]) || (p + '교시');")
        html = R("            if (res.classCount && res.classCount !== classList.length) {",
                 "            if (res.periods && res.periods.length && res.periods.join('|') !== (window.__PN || []).join('|')) {\n                window.__PN = res.periods; periodList = res.periods.map((_, i) => i + 1); renderModalCheckboxes();\n            }\n            if (res.classCount && res.classCount !== classList.length) {")
        html = R("for (let p = 1; p <= 6; p++) {", "for (let p = 1; p <= periodList.length; p++) {")
        html = R('${p}교시</th>`;', '${pName(p)}</th>`;')
        html = R('<span class="badge-label">${num}교시</span>', '<span class="badge-label">${pName(num)}</span>')
    if key == "p09":
        R = lambda a, b: must_replace(html, a, b, fname)
        html = R("for (let p = 1; p <= 6; p++) {", "for (let p = 1; p <= Math.max(1, (window.__PN || []).length || 6); p++) {")
        html = R('${p}교시</th>`;', '${(window.__PN && window.__PN[p - 1]) || (p + "교시")}</th>`;')
        html = R("if (response.year) window.__YEAR__ = response.year;", "if (response.year) window.__YEAR__ = response.year;\n                        window.__PN = response.periods || [];")
    if key == "p05":   # 처음 열면 오늘이 속한 달을 보여줌
        html = must_replace(html, "const isMergedCell = (r, c) => {", "useEffect(() => { fetchMonthData(new Date().getMonth() + 1); }, []);\n\n        const isMergedCell = (r, c) => {", fname)
    if key == "p03":   # 관리자 버튼·새로고침·제목줄 삭제 / 반 수는 관리자 설정 / 반별 표 크기 / 엑셀 다운로드·업로드
        R = lambda a, b: must_replace(html, a, b, fname)
        html = re.sub(r'\s*<button class="tab-link admin-btn"[^>]*>관리자</button>', '', html, count=1)
        a = html.index("<!-- (C) 관리자 섹션 -->"); b = html.index("<!-- 4. 스크립트")
        html = html[:a] + html[b:]
        # 새로고침 버튼이 든 윗줄(학년 전체)과 'n반 명렬표' 제목줄(반별) 삭제
        html = re.sub(r'<header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 shadow-sm z-10 sticky top-0 relative overflow-hidden shrink-0">[\s\S]*?</header>', '', html, count=1)
        html = re.sub(r'<header className="bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 shadow-sm z-10 sticky top-0 shrink-0">[\s\S]*?</header>', '', html, count=1)
        html = html.replace('<main className="flex-1 overflow-y-auto p-4 lg:p-8">', '<main className="flex-1 p-4 lg:p-8">')   # 스크롤 때 반 버튼줄이 고정되도록
        html = R('<div className="mb-6 flex flex-nowrap overflow-x-auto gap-2 pb-2 scrollbar-hide">', '<div className="nl-stick mb-6 flex flex-nowrap overflow-x-auto gap-2 pb-2 scrollbar-hide">')
        # 반 수: 관리자 설정(학급 수)을 따름
        html = R("const [classNum, setClassNum] = useState(1);", "const [classNum, setClassNum] = useState(1);\n        const [classCount, setClassCount] = useState(10);")
        html = R("setLocalData(parsed.data);", "setLocalData(parsed.data); if (parsed.classCount) { setClassCount(parsed.classCount); if (classNum > parsed.classCount) setClassNum(1); }")
        html = R("Array.from({length: 10}, (_, i) => i + 1)", "Array.from({length: classCount}, (_, i) => i + 1)")
        html = R("const prevNum = classNum === 1 ? 10 : classNum - 1;", "const prevNum = classNum === 1 ? classCount : classNum - 1;")
        html = R("const nextNum = classNum === 10 ? 1 : classNum + 1;", "const nextNum = classNum >= classCount ? 1 : classNum + 1;")
        html = R("useEffect(() => {\n          fetchData(classNum);\n        }, [classNum]);", "window.__gpReloadClass = () => fetchData(classNum);\n        useEffect(() => {\n          fetchData(classNum);\n        }, [classNum]);")
        html = R("useEffect(() => {\n          google.script.run.withSuccessHandler(res => setData(JSON.parse(res))).getGradeData();\n        }, []);", "window.__gpReloadGrade = fetchData;\n        useEffect(() => {\n          google.script.run.withSuccessHandler(res => setData(JSON.parse(res))).getGradeData();\n        }, []);")
        a = html.index("const getClassBlocks = () => {"); b = html.index("const classBlocks = getClassBlocks();")
        html = html[:a] + """const getClassBlocks = () => {
          const classes = [];
          (data.horizontal.groups || []).forEach((g) => {
            const per = g.rows[0] ? g.rows[0].length / 4 : 0;
            for (let c = 0; c < per; c++) {
              const block = []; let m = 0, f = 0;
              g.rows.forEach((row) => {
                const slice = row.slice(c * 4, c * 4 + 4);
                if (slice[1]) { if (slice[2] === '남성') m++; if (slice[2] === '여성') f++; }
                block.push(slice);
              });
              classes.push({ num: g.start + c, data: block, m, f, t: m + f });
            }
          });
          return classes;
        };
        """ + html[b:]
        html = R("</style>", """.nl-table { table-layout: fixed; width: 100%; margin: 0 auto; box-sizing: border-box; }
      /* 좁은 화면: 열 너비는 내용이 잘리지 않는 크기(번호·성별·생년월일·삭제는 고정 px, 이름·기타는 나머지)이고, 화면보다 표가 넓으면 가로로 스크롤됩니다 */
      .nl-table { min-width: 360px; }
      .nl-table col.c-no { width: 40px; } .nl-table col.c-gd { width: 50px; } .nl-table col.c-nm, .nl-table col.c-nt { width: auto; }
      .nl-table col.c-bd { width: 108px; } .nl-table col.c-dl { width: 36px; }
      .nl-table th { white-space: nowrap; }
      .nl-table input { min-width: 0; font-size: clamp(11px, 3.2vw, 16px); }
      .nl-table th, .nl-table td { overflow: hidden; }
      @media (min-width: 900px) {
        .nl-table { max-width: max(50%, 640px); }
        .nl-table col.c-no, .nl-table col.c-gd { width: 3.4em; } .nl-table col.c-nm, .nl-table col.c-nt { width: auto; }
        .nl-table col.c-bd { width: 17.5em; } .nl-table col.c-dl { width: 2.6em; }
      }
      .nl-stick { position: sticky; top: var(--nav-h, 64px); z-index: 900; background: #f8fafc; padding-top: .5rem; margin-top: -.5rem; }
      #root-class .overflow-x-auto, #root-grade .overflow-x-auto { overflow-x: auto; }
      .xl-bar { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; padding:.75rem 1rem 0; }
      .xl-bar button, .xl-bar select { font-size:.875rem; font-weight:600; padding:.45rem .9rem; border-radius:.5rem; border:1px solid #cbd5e1; background:#fff; color:#334155; }
      .xl-bar button.xl { background:#059669; border-color:#059669; color:#fff; }
      .xl-bar button.xl:hover { background:#047857; }
      .xl-bar button.up { background:#2563eb; border-color:#2563eb; color:#fff; }
      .xl-sec { margin-bottom:.75rem; display:flex; flex-direction:column; gap:.35rem; font-size:.9rem; }
      .xl-t { font-weight:700; color:#475569; font-size:.8rem; }
      .xl-grid { display:flex; flex-wrap:wrap; gap:.5rem 1rem; }
      .xl-step { width:2rem; height:2rem; border:1px solid #cbd5e1; border-radius:.4rem; background:#fff; font-weight:700; }
      .xl-bar button:disabled { opacity:.5; cursor:wait; }
    </style>""")
        html = R("""<table className="w-full text-center border-collapse text-base table-fixed" style={{minWidth: '600px'}}>""", """<table className="nl-table text-center border-collapse text-base table-fixed">""")
        html = R("""                          <col style={{ width: '10%' }} />
                          <col style={{ width: '23%' }} />
                          <col style={{ width: '10%' }} />
                          <col style={{ width: '23%' }} />
                          <col style={{ width: '29%' }} />
                          <col style={{ width: '5%' }} />""", """                          <col className="c-no" />
                          <col className="c-nm" />
                          <col className="c-gd" />
                          <col className="c-nt" />
                          <col className="c-bd" />
                          <col className="c-dl" />""")
        html = R('<div id="root-grade"></div>', """<div class="xl-bar"><button class="xl" id="xl-open">⬇ 내보내기 (엑셀·스프레드시트)</button><button class="up" id="xl-up">⬆ 엑셀 업로드</button><button id="xl-sample">예시 파일 받기</button><input type="file" id="xl-file" accept=".xlsx" style="display:none"><span id="xl-msg" style="font-size:.8rem;color:#64748b"></span></div>
      <div id="xl-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:3000;align-items:center;justify-content:center;padding:1rem">
        <div style="background:#fff;border-radius:1rem;padding:1.25rem;width:100%;max-width:26rem;max-height:92vh;overflow:auto" class="xl-box">
          <h3 style="font-weight:700;font-size:1.1rem;margin-bottom:.75rem">명렬표 내보내기</h3>
          <div class="xl-sec"><div class="xl-t">내려받을 명렬표</div>
            <label><input type="radio" name="xl-scope" value="grade" checked> 학년 전체 명렬표 (한 시트)</label>
            <label><input type="radio" name="xl-scope" value="class"> 반별 명렬표 : <select id="xl-class"></select></label></div>
          <div class="xl-sec"><div class="xl-t">포함할 항목</div>
            <div class="xl-grid"><label><input type="checkbox" class="xl-f" value="no" checked> 번호</label><label><input type="checkbox" class="xl-f" value="name" checked> 이름</label><label><input type="checkbox" class="xl-f" value="gender" checked> 성별</label><label><input type="checkbox" class="xl-f" value="note" checked> 기타</label><label><input type="checkbox" class="xl-f" value="birth"> 생년월일</label></div>
            <div style="display:flex;align-items:center;gap:.5rem;margin-top:.5rem">체크리스트 열
              <button type="button" id="xl-minus" class="xl-step">−</button><input id="xl-checks" type="number" min="0" max="30" value="0" style="width:3.5rem;text-align:center;border:1px solid #cbd5e1;border-radius:.4rem;padding:.25rem"><button type="button" id="xl-plus" class="xl-step">＋</button> 개</div></div>
          <div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.5rem;margin-top:1rem"><button id="xl-cancel" type="button" style="padding:.5rem 1rem;border-radius:.5rem;background:#f1f5f9;font-weight:600">취소</button><button id="xl-gs" type="button" style="padding:.5rem 1rem;border-radius:.5rem;font-weight:600;border:1px solid #cbd5e1;background:#fff">구글 스프레드시트로 만들기</button><button id="xl-go" type="button" class="xl" style="padding:.5rem 1rem;border-radius:.5rem;font-weight:600;color:#fff;background:#059669">엑셀로 내려받기</button></div>
        </div></div>
      <div id="root-grade"></div>""")
        html = R("<!-- 4. 스크립트", open(__import__("os").path.join(__import__("os").path.dirname(__file__), "p03_script.html"), encoding="utf-8").read() + "\n    <!-- 4. 스크립트")
    if key == "p04":   # 학급별 기초시간표: 1열(교시)은 모바일에서도 3글자가 들어가는 너비
        html = must_replace(html, """<th className="border p-1 w-[30px] min-w-[30px] max-w-[30px]" style={{ width: '30px' }}>{activeTab}반</th>""", """<th className="border p-1" style={{ width: '56px', minWidth: '56px' }}>{activeTab}반</th>""", fname)
        html = must_replace(html, """<th className="border p-1 bg-slate-50 font-bold w-[30px] min-w-[30px] max-w-[30px]" style={{ width: '30px', fontSize: '10pt' }}>{period}</th>""", """<th className="border p-1 bg-slate-50 font-bold whitespace-nowrap" style={{ width: '56px', minWidth: '56px', fontSize: '10pt' }}>{period}</th>""", fname)
    if key == "p07":   # 저장 버튼 없이 바로 저장 / 데스크톱에서 가로 스크롤 없는 표 / 이미지 업로드 개선
        R = lambda a, b: must_replace(html, a, b, fname)
        html = R("</style>", ".scroll-container { overflow-x: auto; }\n    .scroll-container > table { display: table !important; width: 100% !important; min-width: 760px; }\n    td.td-sports, td.td-com, th.sticky-header-sports, th.sticky-header-com { width: 20% !important; min-width: 0 !important; max-width: none !important; }\n    .table-fixed-sports, .table-fixed-com { width: 100% !important; min-width: 0 !important; max-width: none !important; }\n    /* 화면이 좁아지면 글자도 줄이되(최소 8pt) 셀 밖으로 삐져나가지 않게, 1열(교시)은 줄바꿈 */\n    .grid-col, .grid-col * { font-size: clamp(10.67px, calc(7.2px + 0.58vw), 14.67px) !important; min-width: 0; }\n    .grid-col { white-space: normal !important; overflow: hidden; text-overflow: clip; word-break: break-all; overflow-wrap: anywhere; line-height: 1.05 !important; text-align: center; }\n    .grid-col > div, .grid-col select, .grid-col input { max-width: 100%; }\n    .grid-col:first-child { word-break: keep-all; }\n  </style>")
        # (1) 체육 공간·컴실 등: 반을 고르면 바로 저장
        html = R("const handleCellChange = (key, val) => {\n        setUnsavedChanges(prev => ({ ...prev, [key]: val }));\n      };",
                 "const handleCellChange = (key, val) => {\n        setUnsavedChanges(prev => ({ ...prev, [key]: val }));\n        onSave({ [key]: val }, () => setUnsavedChanges(prev => { const n = { ...prev }; if (n[key] === val) delete n[key]; return n; }));\n      };")
        html = re.sub(r'<button onClick=\{handleSave\} className="flex items-center gap-1 bg-green-600[\s\S]*?</button>', '', html, count=1)
        a = html.index("onSave={(unsaved, cb) => {"); b = html.index("}} \n              onLoading={setLoading} \n            />}", a) + len("}} \n")
        html = html[:a] + "onSave={(unsaved, cb) => window.__saveSchedule(unsaved, cb, setSchedule)}\n              " + html[b:]
        a = html.index("onSave={(unsaved, cb) => {"); b = html.index("}} \n              onLoading={setLoading} \n            />}", a) + len("}} \n")
        html = html[:a] + "onSave={(unsaved, cb) => window.__saveSchedule(unsaved, cb, setSchedule)}\n              " + html[b:]
        html = R("const App = () => {", """let __saveQ = Promise.resolve();
    window.__saveSchedule = (unsaved, cb, setSchedule) => {   // 한 칸씩 순서대로 저장
      __saveQ = __saveQ.then(() => new Promise((resolve) => {
        const updates = Object.keys(unsaved).map(key => { const parts = key.split('_'); return { date: parts[0], period: parts[1], space: parts[2], className: unsaved[key] }; });
        google.script.run.withSuccessHandler(res => {
          if (res && res.success) setSchedule(p => { const next = { ...p }; Object.keys(unsaved).forEach(k => { if (unsaved[k] === "") delete next[k]; else next[k] = unsaved[k]; }); return next; });
          else alert((res && res.error) || '저장하지 못했습니다.');
          cb(); resolve();
        }).withFailureHandler(err => { alert('저장하지 못했습니다: ' + err); cb(); resolve(); }).saveScheduleData(updates);
      }));
    };

    const App = () => {""")
        # (2) 특별실 비밀번호: 목록에 추가·수정·삭제하면 바로 저장
        html = R("const [form, setForm] = useState({ id: null, name: '', pwd: '', note: '' });", "const [form, setForm] = useState({ id: null, name: '', pwd: '', note: '' });\n      const persist = (list) => onSave(list, () => {});")
        html = R("""        if (form.id) {
          setPwdList(pwdList.map(item => item.id === form.id ? { ...form } : item));
        } else {
          setPwdList([...pwdList, { ...form, id: Date.now() }]);
        }""", """        const next = form.id ? pwdList.map(item => item.id === form.id ? { ...form } : item) : [...pwdList, { ...form, id: Date.now() }];
        setPwdList(next); persist(next);""")
        html = R("          setPwdList(pwdList.filter(item => item.id !== id));", "          const next = pwdList.filter(item => item.id !== id);\n          setPwdList(next); persist(next);")
        html = re.sub(r'<button onClick=\{handleSave\} className="bg-indigo-600[^>]*>저장하기</button>', '', html, count=1)
        html = re.sub(r'<button onClick=\{onExit\} className="bg-slate-200[^>]*>닫기</button>', '', html, count=1)
        html = R('<span className="hidden sm:inline">특별실 시간표</span>', '<span className="hidden sm:inline">시간표 이미지</span>')
        html = R("const [authModal, setAuthModal] = useState(null);", "const [authModal, setAuthModal] = useState(null);\n      useEffect(() => { if (view !== 'password') setIsSpecialAuth(false); }, [view]);   // 다른 곳으로 나가면 비밀번호를 다시 묻습니다")
        html = R("google.script.run.withSuccessHandler(() => { setPasswords(newPwds); alert('특별실 비밀번호가 저장되었습니다.'); cb(); }).saveRoomPasswords(newPwds);",
                 "google.script.run.withSuccessHandler((res) => { if (res && res.success === false) alert('저장하지 못했습니다: ' + res.error); else setPasswords(newPwds); cb(); }).withFailureHandler((e) => { alert('저장하지 못했습니다: ' + e); cb(); }).saveRoomPasswords(newPwds);")
        # (3) 시간표 이미지: 바로 올리고(압축 후 Blob 업로드) 실패하면 이유를 알려 줌
        a = html.index('<input type="file" className="hidden" accept="image/*" onChange={async (e) => {'); b = html.index("}} />", a) + len("}} />")
        html = html[:a] + r"""<input type="file" className="hidden" accept="image/*" onChange={(e) => {
                const file = e.target.files[0]; e.target.value = ''; if (!file) return;
                onLoading(true);
                const done = () => onLoading(false);
                const readFail = () => { alert('이미지를 읽지 못했습니다. 다른 사진으로 시도해 주세요.'); done(); };
                const url = URL.createObjectURL(file); const img = new Image();
                img.onerror = () => { URL.revokeObjectURL(url); readFail(); };
                img.onload = () => {
                  URL.revokeObjectURL(url);
                  // 목표 약 300KB: 크기·품질을 단계적으로 낮추며 가장 큰 사진을 고름
                  const TARGET = 300 * 1024, steps = [[1600, 0.8], [1600, 0.7], [1400, 0.7], [1280, 0.65], [1100, 0.6], [900, 0.55]];
                  let best = null, k = 0;
                  const tryNext = () => {
                    if (k >= steps.length) { if (!best) return readFail(); return onUpload(best, file.name.replace(/\.[^.]+$/, '') + '.jpg', 'image/jpeg', done); }
                    const [MAX, q] = steps[k++]; let width = img.width, height = img.height;
                    if (width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
                    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                    const cx = canvas.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, width, height); cx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob((blob) => { if (!blob) return readFail(); if (!best || blob.size < best.size) best = blob; if (blob.size <= TARGET) { best = blob; k = steps.length; } tryNext(); }, 'image/jpeg', q);
                  };
                  tryNext();
                };
                img.src = url;
              }} />""" + html[b:]
        html = R("onUpload={(base64, name, type, cb) => { google.script.run.withSuccessHandler(()=>{fetchImages(); cb();}).uploadImage(base64, name, type); }}",
                 "onUpload={(data, name, type, cb) => { google.script.run.withSuccessHandler((res)=>{ if (res && res.success === false) alert('업로드하지 못했습니다: ' + res.error); else if (res && res.item) setImages(prev => [...prev, res.item]); else fetchImages(); cb(); }).withFailureHandler((e)=>{ alert('업로드하지 못했습니다: ' + e); cb(); }).uploadImage(data, name, type); }}")
    if key == "p07":   # 공간 수가 바뀌어도(추가/삭제) 표 열 수가 맞도록 격자 열을 공간 개수로 계산
        n0 = html.count("className={`${gridRowClass} ")
        html = html.replace("className={`${gridRowClass} ", "style={{ gridTemplateColumns: 'repeat(' + (spaces.length + 1) + ', minmax(' + colMin + 'px, 1fr))' }} className={`${gridRowClass} ")
        print("  p07 격자 행", n0)
        html = must_replace(html, "<table className=\"border-collapse bg-white shadow-sm rounded-lg mx-auto inline-table text-left\" style={{tableLayout: 'fixed'}}>", "<table className=\"border-collapse bg-white shadow-sm rounded-lg mx-auto inline-table text-left\" style={{tableLayout: 'fixed', minWidth: (5 * ((spaces.length + 1) * colMin + 12)) + 'px'}}>", fname)
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
    html = finalize(html)
    (DST / fname).write_text(html, encoding="utf-8")
    print("변환:", folder.strip(), "->", fname)
