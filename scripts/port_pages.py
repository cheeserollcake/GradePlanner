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
INJECT = lambda key: f"""
  <script>window.__GP_PAGE__ = '{key}';</script>
  <script src="{FB}firebase-app-compat.js"></script>
  <script src="{FB}firebase-firestore-compat.js"></script>
  <script src="{FB}firebase-storage-compat.js"></script>
  <script src="../assets/js/firebase-config.js"></script>
  <script src="../assets/js/gas-shim.js"></script>
"""

ESBUILD = "/home/claude/.npm-global/lib/node_modules/tsx/node_modules/esbuild/bin/esbuild"
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
          '<table className="border-collapse" style={{ tableLayout: \'fixed\', width: \'100%\' }}>\n                        <colgroup><col style={{ width: \'5rem\' }} />{top[0].slice(1).map((_, i) => <col key={i} />)}</colgroup>', fname)
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
    if key == "p07":   # 관리자 설정 버튼은 새 관리자 페이지로 이동
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
        html = R("const isUnmodifiable = ['강당', '다목', '운동장', '전담', '(휴)'].some(keyword => ev.course.includes(keyword));", "const isUnmodifiable = ev.source === 'gym' || ['강당', '다목', '운동장', '전담', '(휴)'].some(keyword => ev.course.includes(keyword));")
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
            // 범주는 항상 맨 위에 파란 볼드체로 고정
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
            if (prev && Array.from(select.options).some(o => o.value === prev)) select.value = prev; else select.selectedIndex = 0;
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
        html = R("if (isAll) return true;", "if (groupSet) return groupSet.has(ev.course);\n                                        if (isAll) return true;")
        html = R('<option value="" disabled selected>로딩 중...</option>\n                    </select>', '<option value="" disabled selected>로딩 중...</option>\n                    </select>\n                    <button onclick="openGroupModal()" class="px-2 py-1 bg-white border-2 border-gray-200 rounded-lg hover:bg-blue-50" title="강좌 범주 관리">✏️</button>')
        html = R("</body>", '<div id="group-modal" class="hidden fixed inset-0 bg-black bg-opacity-40 z-50 flex justify-center items-center p-4"><div class="bg-white rounded-xl shadow-xl w-full max-w-md p-4"><div class="flex justify-between items-center mb-3"><h3 class="font-bold">강좌 범주 관리</h3><button onclick="closeGroupModal()" class="text-gray-400 text-lg">✕</button></div><div id="group-modal-body"></div></div></div>\n</body>')
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
    html = finalize(html)
    (DST / fname).write_text(html, encoding="utf-8")
    print("변환:", folder.strip(), "->", fname)
