CAPTURE TO MEMO — PHYSICS PRINT ROOM / 2026-10-26

이번 통합본의 실제 파일 목록
- index.html: 메인 화면, 인화실 2개 교차 줄, 보관함, 편집기 HTML/CSS
- sketch.js: Firebase 데이터, 인화실 Matter.js 물리, 랜덤 폴라로이드, 기존 메모 기능
- glass3d.js: 기존 3D 책 (사용자 선택 위치/크기 유지)

설치 (이전 파일 먼저 백업!)
1. 프로젝트 폴더에서 index.html, sketch.js, glass3d.js 세 파일을 통합본으로 교체
2. VS Code의 Live Server에서 index.html 실행
3. 인터넷 연결 필요: Firebase, Matter.js, Three.js, exifr, DOMPurify CDN
4. 브라우저 Ctrl + Shift + R (캐시 무시 새로고침)

변경 사항
- 표지와 인화실이 하나의 긴 가로 공간에서 자유롭게 스크롤됨
- 두 줄은 전체 가로 공간에 걸쳐 교차. 앞줄만 실제 업로드 사진 표시
- 앞줄: 새 사진은 화면 밖에서 경사를 따라 내려와 빈 위치에 자리 잡음
- 사진 집게는 투명 아크릴, 사진은 폴라로이드 비율 + object-fit:cover
- Matter.js가 로드되면 사진 매달림/흔들림은 Matter 물리 엔진 사용
- Matter CDN 로드 실패 시에도 기본 스프링 흔들림 사용
- 뒷줄: 흐린 빈 폴라로이드 장식만 존재
- Firebase incoming 경로의 child_added/changed/removed가 장면을 자동 갱신
- 기존 메모 편집은 openEditor(source,key), 편집창 사진은 contain
- 보관함과 메인 책 구성 유지

다음 수정 요청 때 정확한 Ctrl+F 검색어
index.html: id="darkroom-scene" (실제 인화실 구조)
index.html: THE PRINT ROOM (인화실 CSS)
index.html: id="world-wire-overlay" (교차 줄 SVG)
sketch.js: function drawDarkroom() (사진 배치 / 데이터 반영)
sketch.js: function getDarkroomWirePoint( (줄 경로의 좌표)
sketch.js: function distributeDarkroomHangers( (사진 정지 위치)
sketch.js: function nudgeDarkroomPhotos( (화면 스크롤에 따른 흔들림)
sketch.js: function animateDarkroomLines( (물리 계산 / 이동)
sketch.js: function setupSwipes() (가로 스크롤 연결)
sketch.js: function uploadFiles( (업로드 / Firebase)
sketch.js: function openEditor( (편집기)
glass3d.js: const BOOK_BASE_Y = -0.6; (메인 책 높이)

주의: 실제 Firebase는 테스트용 가상 사진이 아니므로 데이터 구독 및 권한을 기기에서 확인하세요.
