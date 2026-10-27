Capture to Memo — 보관함 꾹 누르기 / 다중 선택 드래그 삭제

[전체 파일 적용]
1. 현재 작업 폴더를 통째로 백업합니다.
2. 이 폴더의 index.html, sketch.js, style.css, glass3d.js, mobile.html, pen.svg, eraser.svg, archive-soft-decor.svg를 같은 프로젝트 폴더에 넣습니다.
3. VS Code Live Server로 index.html을 열고 Ctrl+Shift+R을 누릅니다.
4. Firebase 사진을 정말 삭제하므로, 테스트용 사진으로 먼저 확인합니다.

[기존 코드에 작은 변경만 적용 — 추천]
1. sketch.js에서 Ctrl+F: function setupArchiveBatchDrag() {
   함수 전체를 01_교체_setupArchiveBatchDrag.txt로 교체.
2. sketch.js에서 Ctrl+F: async function deleteArchiveSelectionAt(
   함수 전체를 02_교체_deleteArchiveSelectionAt.txt로 교체.
3. index.html의 <style> 내부 혹은 별도 style.css 맨 아래에
   03_추가_CSS.txt 내용을 추가합니다.
4. HTML에 id=batch-bar, batch-all, batch-date, batch-cancel,
   archive-trash-zone, archive-trash-count가 존재해야 합니다.
   아래 코드는 이미 이번 통합본에 포함되어 있습니다.
5. init()에서 setupArchiveBatchDrag();가 호출되어야 합니다.

[사용 방법]
- 보관함에서 폴라로이드 0.57초 길게 누르기 → 선택 모드.
- 다른 사진 누르기 → 선택 추가 / 해제.
- 선택한 사진 하나를 잡아 아래로 끌기 → 선택한 전부가 묶음으로 움직임.
- 아래 검은 CUT 영역에 놓기 → 흰 삼각형 1초 이펙트와 함께 실제 데이터 삭제.
- 상단 전체 선택 / 날짜 변경 / 취소.
- 선택 모드에서는 BACK TO MAIN과 검색 필드 숨김.
- 삭제 확인 버튼/팝업 없음. 삭제는 되돌릴 수 없습니다.
