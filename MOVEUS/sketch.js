// ============================================================
// MOVE:US — STEP 11 / 실제 운동 명칭·주간 경로 3종·불필요한 PREVIEW 표기 삭제
// ① 장애물 10개 (스쿼트)
// ② 균형 잡기 5초 x 단 1회 (플랭크 테스트용)
// ③ 벽 10개 (푸시업): 조각 파티클 확장
// ④ 20회 x 4구간 (스탠딩 힙 어브덕션): 오른쪽20→왼쪽20→45초 휴식→오른쪽20→왼쪽20
// STEP 15: Firebase 로그인 중에는 DAY/진행 중 미션을 계정별로 저장합니다. 오프라인 테스트는 탭 메모리만 사용합니다.
// ============================================================

const GAME_W = 640;
const GAME_H = 360;
const LEVEL_W = 4820;
const JUMP_TOTAL = 10;
const PLANK_SECONDS = 5; // 정식 30초; 이번 키보드 테스트만 5초
const PLANK_SETS = 1;    // 정식 3세트; 이번 테스트만 1회
const WALL_REPS_PER_SET = 10;
const WALL_SETS = 2;
const WALL_TOTAL = WALL_REPS_PER_SET * WALL_SETS;
const LADDER_SECTIONS = 4; // 오른쪽20→왼쪽20→휴식45초→오른쪽20→왼쪽20
const STEPS_PER_LADDER = 20;
const LADDER_STEPS = LADDER_SECTIONS * STEPS_PER_LADDER;
const LADDER_RISE = 285;  // 각 사다리가 화면 높이 가까이 올라가도록 설정
let LADDER_XS = [3200, 3460, 3720, 3980]; // 배치된 직전 미션에 가까이 붙이는 좌표
const BOARD_X = 1580;
let WALL_START = 1920; // 중간 미션 조합에 맞춰 위치 조정
const WALL_SPACING = 101;
const LOWER_GROUND_Y = 281;
const JUMP_OBSTACLES = Array.from({length: JUMP_TOTAL}, (_, i) => 230 + i * 117);
let WALL_OBSTACLES = Array.from({length: WALL_TOTAL}, (_, i) => WALL_START + i * WALL_SPACING);

// 실제 목표 운동량은 변경하지 않습니다. 키보드 프로토타입에서만 횟수를 줄입니다.
const exerciseSettings = {
  squat: { reps: 10, sets: 5 },
  plank: { seconds: 30, sets: 3 },
  kneePushup: { reps: 10, sets: 2 },
  standingHipAbduction: { repsPerSide: 20, sets: 2 },
  wallAngel: { reps: 10, sets: 3 }
};
// 게임 내부 저장소는 그대로 유지하되, 로그인하면 family-cloud.js가 서버에 동기화합니다.
// 오프라인 테스트에서는 새로고침할 때 초기화됩니다.
const sessionStageProgress = new Map();
const DAYS_PER_WEEK = 7;
const PREVIEW_WEEKS_AHEAD = 3; // 현재 주 외에 최대 3주 뒤까지 미리보기
const DAYS_PER_MONTH = 30; // 게임 내 30스테이지를 1개월로 표현 (실제 날짜 제한 없음)
const MONTH_PALETTES = [
  { sky:'#CDE4D8', hills:'#B8D6C1', hills2:'#B1CFBD', water:'#A6CAD3', plant:'#548D70', accent:'#F4BE60' },
  { sky:'#DED8EF', hills:'#C6BCE0', hills2:'#B8AED7', water:'#A4B9DA', plant:'#8175AD', accent:'#F7B86D' },
  { sky:'#F4DCCF', hills:'#EBC3AE', hills2:'#DEAB98', water:'#BED7D7', plant:'#A87A73', accent:'#E8B05E' },
  { sky:'#CFE4E9', hills:'#AFCFD5', hills2:'#9FC2C5', water:'#8EB7D8', plant:'#5A9D95', accent:'#F1C86B' }
];
function monthPalette() { return MONTH_PALETTES[Math.floor(completedThrough / DAYS_PER_MONTH) % MONTH_PALETTES.length]; }
function currentMonthNumber() { return Math.floor(completedThrough / DAYS_PER_MONTH) + 1; }
let completedThrough = 0; // 순서대로 클리어한 최고 스테이지 번호
let mapWeek = 0; // 0: 1~7, 1: 8~14, 2: 15~21 ... 무제한 페이지 생성
// 기존 월드맵의 분위기를 유지하며 길만 3가지 작은 변형으로 순환합니다.
// WEEK 1은 원래 길을 그대로 사용합니다. WEEK 2, 3에서 살짝씩 굴곡이 달라집니다.
// WEEK 4에서 다시 첫 번째 길로 돌아오고, 이후 무제한 반복됩니다.
const WEEKLY_PATH_VARIANTS = [
  [
    {x:78,y:251}, {x:157,y:207}, {x:238,y:232},
    {x:322,y:168}, {x:410,y:210}, {x:487,y:148}, {x:563,y:116}
  ],
  [
    {x:78,y:251}, {x:157,y:224}, {x:238,y:188},
    {x:322,y:209}, {x:410,y:170}, {x:487,y:164}, {x:563,y:125}
  ],
  [
    {x:78,y:246}, {x:157,y:193}, {x:238,y:227},
    {x:322,y:239}, {x:410,y:185}, {x:487,y:136}, {x:563,y:156}
  ]
];
function stagePositionsForWeek(week = mapWeek) {
  return WEEKLY_PATH_VARIANTS[week % WEEKLY_PATH_VARIANTS.length];
}
const COOK_REPS = 10;
const COOK_SETS = 3;

let screenMode = 'title';
let currentStage = 1;
let playerX = 90;
let movementSpeed = 4;
let holdLeft = false;
let holdRight = false;
let spaceHeld = false;
let gamePaused = false;
let sceneScale = 1, sceneLeft = 0, sceneTop = 0;

// 첫 미션 = jump(스쿼트), 중간 = balance/wall/climb 중 중복 없이 2개, 마지막 = cook(월 엔젤).
// 스테이지 하나의 조합은 저장/복원하며, 3 DAY마다 중간 운동 3종이 모두 등장합니다.
let gamePhase = 'jump';
let middleMissions = ['balance','wall'];
let cookSet = 1;
let cookReps = 0;
let cookAction = null;
let cookWalk = null;
let dinnerTimer = 0; // 월 엔젤 3세트 완료 후 식사 등장 → 전달 → 환호까지의 경과 시간
let cookingZoom = 1; // 요리 미션에서는 캐릭터/요리 도구를 1.25배로 보여 줍니다.
let jumpCount = 0;
let jumpAnimation = null;
let balanceSet = 1;
let balanceElapsed = 0;
let boardAngle = 0.1;
const BALANCE_RELEASE_LIMIT = 3; // 손을 뗀 상태로 3초가 지나면 보드에서 내려옵니다.
const BALANCE_EXIT_X = BOARD_X - 108;
let balanceOnBoard = false; // 처음에는 반드시 판 앞에서 대기
let balanceUnstableSeconds = 0;
let balanceMountAnimation = null;
let balanceDismountAnimation = null;
let wallCount = 0;
let wallAnimation = null;
let wallParticles = []; // 벽이 갈라지는 대신 작은 파편들이 흩어집니다.
let ladderCount = 0;     // 총 80회(20 x 4구간)
let climbSection = 0;    // 0: 오른쪽, 1: 왼쪽, 2: 오른쪽, 3: 왼쪽
let ladderStep = 0;      // 현재 사다리에서 0..20
let ladderAnimation = null;
let climbExitX = 0;
let verticalCameraY = 0;
let bannerTimeout = 0;
let bannerSticky = false;
let lastSaveTick = 0;
// 휴식은 음성/버튼 없이 진행. 종료 시각은 Firebase에 저장하여 새로고침 후에도 유지합니다.
const REST_SECONDS = { wallRest:60, climbRest:45, cookRest:60 };
let restUntilMs = 0;
let restPausedAtMs = 0;

// STEP 15-1 — 중간 미션 균형 배정 (기존 Firebase 데이터 구조 변경 없음)
// 매 DAY에는 스쿼트/월 엔젤이 고정이고, 아래 3가지 조합 중 하나가 들어갑니다.
// 3 DAY마다 세 조합을 모두 경험하며 연속된 두 DAY에서는 같은 조합이 나오지 않습니다.
// DAY 번호를 기준으로 결정되므로 새로고침/기기 변경/이어하기에도 안정적입니다.
const MIDDLE_COMBINATIONS = [
  ['balance','wall'],  // 플랭크 + 무릎 푸시업
  ['balance','climb'], // 플랭크 + 스탠딩 힙 어브덕션
  ['wall','climb']     // 무릎 푸시업 + 스탠딩 힙 어브덕션
];
const middleCombinationOrders = [];
function combinationOrderForBlock(block) {
  // 순서표는 DAY 1~3부터 필요할 때만 생성합니다. 3개씩 섞되
  // 이전 묶음 마지막 조합과 다음 묶음 첫 조합이 겹치지 않게 합니다.
  while (middleCombinationOrders.length <= block) {
    const index = middleCombinationOrders.length;
    const order = [0,1,2];
    if (index > 0) {
      // Math.random 대신 DAY 묶음 번호로 시드를 만들어 기기마다 같은 결과를 냅니다.
      let seed = (Math.imul(index, 0x85ebca6b) ^ 0x9e3779b9) >>> 0;
      for (let i = order.length-1; i > 0; i--) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const j = Math.floor(seed / 4294967296 * (i+1));
        [order[i],order[j]]=[order[j],order[i]];
      }
      if (order[0] === middleCombinationOrders[index-1][2]) {
        [order[0],order[1]]=[order[1],order[0]];
      }
    }
    middleCombinationOrders.push(order);
  }
  return middleCombinationOrders[block];
}
function pickMiddleMissions() {
  const day = Math.max(1, Math.floor(Number(currentStage) || 1));
  // 개발용 ?testPushup=1은 DAY 1에서만 적용 (이전엔 모든 DAY의 조합을 고정했음).
  if (day === 1 && typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('testPushup') === '1') {
    return ['wall','climb'];
  }
  const block = Math.floor((day-1)/3);
  const order = combinationOrderForBlock(block);
  // 지형 배치/이동 로직에 맞춰 두 미션의 순서는 기존처럼 유지합니다.
  return [...MIDDLE_COMBINATIONS[order[(day-1)%3]]];
}
function applyMissionLayout() {
  // 기존에는 플랭크 이후에도 고정 좌표(벽 1920 / 사다리 3200)까지
  // 한참 걸어가야 했습니다. 이번에는 실제 선택된 미션의 순서대로 지형을 배치합니다.
  const previousJumpEnd = JUMP_OBSTACLES[JUMP_TOTAL - 1] + 38;
  // 두 운동이 같은 화면에 등장하지 않도록 충분히 떨어트립니다.
  WALL_START = middleMissions.includes('balance') ? BOARD_X + 690 : previousJumpEnd + 690;
  WALL_OBSTACLES = Array.from({length: WALL_TOTAL}, (_, i) => WALL_START + i * WALL_SPACING);
  const previousMissionEnd = middleMissions.includes('wall')
    ? WALL_OBSTACLES[WALL_TOTAL - 1] + 45
    : BOARD_X - 15;
  const ladderStart = previousMissionEnd + 690;
  LADDER_XS = Array.from({length:LADDER_SECTIONS}, (_,i)=>ladderStart + 260*i);
}
function nextMissionAfter(id) {
  const order = ['jump', ...middleMissions, 'cook'];
  return order[order.indexOf(id) + 1] || null;
}
function startNextMission(id) {
  const next = nextMissionAfter(id);
  if (next === 'balance') {
    gamePhase = 'transition';
    setBanner('다음 미션: 중심 잡기 · 플랭크', false, 2.2);
  } else if (next === 'wall') {
    gamePhase = 'wallTransition';
    setBanner('다음 미션: 벽 부수기 · 푸시업', false, 2.2);
  } else if (next === 'climb') {
    gamePhase = 'ladderTransition';
    setBanner('다음 미션: 사다리 오르기 · 다리 들기', false, 2.2);
  } else if (next === 'cook') {
    gamePhase = 'cookTransition';
    cookSet = 1; cookReps = 0; cookAction = null;
    setBanner('마지막 미션! 모닥불 요리 · WALL ANGEL', false, 2.7);
  }
  saveProgress();
}
function levelEndX() { return Math.max(LEVEL_W, cookingBaseX() + 450); }
function cookingBaseX() {
  // 사다리를 선택하지 않았다면 낮은 지형에서, 선택했다면 마지막 고지대에서 요리합니다.
  return middleMissions.includes('climb') ? LADDER_XS[LADDER_SECTIONS-1] + 219 : WALL_OBSTACLES[WALL_TOTAL-1] + 76;
}
function cookingGroundY() {
  return middleMissions.includes('climb') ? levelY(LADDER_SECTIONS) : levelY(0);
}
function cookAvatarX(setNumber) {
  const x = cookingBaseX();
  return x + (setNumber === 1 ? 18 : setNumber === 2 ? 98 : 38); // 불 붙이는 첫 세트에서만 왼쪽으로 20px
}
function cookingActionName() {
  if (cookSet === 1) {
    if (cookReps <= 3) return '장작 놓기';
    if (cookReps <= 4) return '불씨 만들기';
    if (cookReps <= 9) return '불 키우기';
    return '솥 올리기';
  }
  return cookSet === 2 ? '재료 썰기' : '재료 넣고 국 젓기';
}
function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent('game-container');
  pixelDensity(1);
  noSmooth();
  frameRate(30);
  textFont('monospace');
  loadStageCompletion();
  connectButtons();
  ensureRestClock();
  showScreen('title');
  if (typeof initSquatTracker === 'function') initSquatTracker();
  if (typeof initPushupTracker === 'function') initPushupTracker();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  noSmooth();
}

function draw() {
  const sceneBg = screenMode === 'map' ? monthPalette().sky :
    screenMode === 'game' ? '#A9D9EF' : '#789FA0';
  background(sceneBg);
  sceneScale = min(width / GAME_W, height / GAME_H);
  sceneLeft = (width - GAME_W * sceneScale) / 2;
  sceneTop = (height - GAME_H * sceneScale) / 2;

  push();
  translate(sceneLeft, sceneTop);
  scale(sceneScale);
  if (screenMode === 'map') drawWorldMap();
  else if (screenMode === 'game') drawStageGame();
  else drawTitleBackground();
  pop();
}

function drawTitleBackground() {
  // 전체 화면 비율에 맞춰 보이는 영역 끝까지 배경을 직접 그립니다.
  // 기존 고정 640x360 지형을 화면 가운데만 그리면 넓은 브라우저에서
  // 좌우 풍경이 잘리거나 비어 보이므로 가시 영역을 계산합니다.
  const left = -sceneLeft / sceneScale;
  const right = (width - sceneLeft) / sceneScale;
  const top = -sceneTop / sceneScale;
  const bottom = (height - sceneTop) / sceneScale;
  const visibleWidth = right - left;
  const middle = (left + right) / 2;
  // 세로로 긴 휴대폰 화면에서는 지면을 아래쪽으로 내립니다.
  const portrait = height > width * 1.3;
  const cloudY = portrait ? top + 62 : 56;
  const groundY = portrait ? bottom - 53 : 307;
  noStroke();

  // 어두운 반투명 오버레이 없이 바로 밝은 하늘색 사용
  fill("#699FA0");
  rect(left, top, visibleWidth, bottom - top);

  // 화면 가장자리에서 잘리지 않도록 화면 폭에 따라 재배치되는 구름과 태양
  fill("#F1C76E");
  rect(right - 146, cloudY, 78, 78);
  fill("#F8F5E6");
  rect(left + 60, cloudY, 114, 22);
  rect(left + 82, cloudY - 20, 72, 23);
  rect(right - 264, cloudY + 55, 78, 17);
  rect(right - 244, cloudY + 38, 40, 20);

  // 먼 언덕을 좌우 화면 끝까지 확장
  fill("#83B7A2");
  rect(left, groundY - 71, visibleWidth, 124);
  fill("#6DA38B");
  rect(left + 18, groundY - 89, visibleWidth * .25, 86);
  rect(middle - 200, groundY - 119, 150, 103);
  rect(middle + 8, groundY - 96, 170, 91);
  rect(right - 150, groundY - 81, 140, 79);

  // 땅과 풀: 캔버스 양쪽 끝까지 이어지도록 그림
  fill("#4C826D");
  rect(left, groundY, visibleWidth, 53);
  fill("#A88057");
  rect(left, groundY + 28, visibleWidth, 25);
  for (let x = left + 12; x < right; x += 42) {
    fill("#71AE89"); rect(x, groundY - 7, 25, 8);
    fill("#94704D"); rect(x + 11, groundY + 39, 20, 5);
  }

  // 두 인물은 유지하되, 중앙 메뉴를 가리지 않도록 양옆에 배치
  drawTree(left + 46, groundY - 63);
  drawTree(right - 85, groundY - 66);
  drawCharacter(middle - min(193, visibleWidth * .32), groundY - 41);
  drawCharacter(middle + min(173, visibleWidth * .31), groundY - 41);
}

// ------------------------------------------------------------
// 월드맵 — 1단계의 지형과 스테이지 선택을 그대로 유지
// ------------------------------------------------------------
function stageNumberOnPage(i) { return mapWeek * DAYS_PER_WEEK + i + 1; }
function maxMapWeek() {
  // 현재 해금된 DAY가 속한 주 + 3주까지 미리 볼 수 있습니다.
  // 아직 DAY 1만 열렸어도 WEEK 1~4를 탐색할 수 있습니다.
  return Math.floor(completedThrough / DAYS_PER_WEEK) + PREVIEW_WEEKS_AHEAD;
}
function setMapWeek(week) {
  mapWeek = Math.max(0, Math.min(maxMapWeek(), week));
  updateMapNavigation();
}
function updateMapNavigation() {
  const first = mapWeek * DAYS_PER_WEEK + 1;
  const last = first + DAYS_PER_WEEK - 1;
  // 앞으로 볼 수 있는 주차도 일반 주차와 동일하게 표시합니다.
  document.getElementById('week-range').textContent =
    `WEEK ${mapWeek+1}  ·  DAY ${first}–${last}`;
  document.getElementById('month-indicator').textContent = `MONTH ${currentMonthNumber()} · ${completedThrough} DAY CLEAR`;
  document.getElementById('prev-week-button').disabled = mapWeek === 0;
  document.getElementById('next-week-button').disabled = mapWeek >= maxMapWeek();
}
function drawWorldMap() {
  const palette = monthPalette();
  background(palette.sky);
  noStroke();
  fill(palette.hills);
  rect(0, 0, 210, 110);
  rect(400, 0, 240, 165);
  rect(0, 310, 250, 50);
  fill(palette.water);
  rect(475, 267, 165, 93);
  rect(505, 250, 135, 17);
  fill(palette.hills2); rect(250, 293, 155, 67);
  drawTree(45, 100);
  drawTree(140, 65);
  drawTree(370, 280);
  drawTree(585, 230);
  drawTree(565, 39);
  const positions = stagePositionsForWeek();
  stroke('#F1E3B7');
  strokeWeight(11); noFill();
  beginShape();
  for (const pos of positions) vertex(pos.x, pos.y);
  endShape(); noStroke();
  for (let i=0; i<DAYS_PER_WEEK; i++) {
    drawStageIcon({number:stageNumberOnPage(i),x:positions[i].x,y:positions[i].y});
  }
  fill('#263E4A'); textAlign(LEFT, TOP); textStyle(BOLD);
  textSize(22); text('WORLD MAP', 20, 17);
  textStyle(NORMAL); textSize(11);
  text('OPEN DAY: PLAY  /  LOCKED DAY: VIEW ONLY', 21, 48);
}

function drawTree(x, y) {
  noStroke();
  fill("#6F8D70");
  rect(x + 10, y + 20, 10, 24);
  fill("#548D70");
  rect(x, y + 10, 30, 20);
  rect(x + 6, y, 18, 15);
}

function drawStageIcon(stage) {
  const size = 43;
  const completed = stage.number <= completedThrough;
  const unlocked = stage.number <= completedThrough + 1;
  const weekly = stage.number % DAYS_PER_WEEK === 0;
  const monthly = stage.number % DAYS_PER_MONTH === 0;
  const accent = monthPalette().accent;
  noStroke();
  if (weekly || monthly) {
    fill(monthly ? '#8E72B0' : '#EFDF9F');
    rect(stage.x-size/2-5,stage.y-size/2-5,size+10,size+10);
  }
  fill('#23424B'); rect(stage.x-size/2+4,stage.y-size/2+4,size,size);
  fill(completed ? '#79B99C' : unlocked ? accent : '#81999D');
  rect(stage.x-size/2,stage.y-size/2,size,size);
  textAlign(CENTER,CENTER); textStyle(BOLD);
  fill(completed || unlocked ? '#263E4A' : '#DCE6E4');
  textSize(weekly || monthly ? 16 : 18);
  text(completed ? '✓' : String(stage.number).padStart(2,'0'),stage.x,stage.y);
  if (completed) {
    fill('#263E4A'); textSize(7); text('DONE',stage.x,stage.y+17);
  } else if (!unlocked) {
    fill('#DCE6E4'); textSize(7); text('LOCK',stage.x,stage.y+17);
  }
  textStyle(NORMAL); textSize(10); fill('#263E4A');
  text(`DAY ${stage.number}`,stage.x,stage.y+35);
  if (weekly || monthly) {
    // 주간·월간 스테이지에는 작은 픽셀 반짝임이 끊임없이 반짝여요.
    const pulse=(Math.sin(frameCount*.13+stage.number)+1)/2;
    fill(monthly ? '#9B6FD0' : '#FFF3B8');
    const points=[[-34,-31],[30,-28],[-31,29],[33,27]];
    points.forEach(([dx,dy],i)=>{
      if((pulse+i*.28)%1<.60) rect(stage.x+dx,stage.y+dy,5,5);
    });
    fill('#263E4A');textSize(8);textAlign(CENTER,CENTER);
    text(monthly?'MONTH':'WEEK',stage.x,stage.y-34);
  }
}

// 캔버스가 화면 전체 크기이므로 클릭한 위치를 맵 좌표로 환산합니다.
function mousePressed(event) {
  if (screenMode !== "map") return;
  if (event && event.target && event.target.tagName !== "CANVAS") return;

  const mapX = (mouseX - sceneLeft) / sceneScale;
  const mapY = (mouseY - sceneTop) / sceneScale;

  const positions = stagePositionsForWeek();
  for (let i=0; i<DAYS_PER_WEEK; i++) {
    const stage=positions[i], number=stageNumberOnPage(i);
    if (abs(mapX-stage.x)<=24 && abs(mapY-stage.y)<=24) {
      if (number <= completedThrough) {
        setMapStatus(`DAY ${number} 완료! 이미 끝낸 DAY는 다시 플레이할 수 없어요.`);
      } else if (number === completedThrough + 1) {
        enterStage(number);
      } else {
        setMapStatus(`DAY ${number}은(는) 아직 잠겨 있어요. 현재 플레이 가능한 DAY는 ${completedThrough+1}이에요.`);
      }
      return false;
    }
  }
}

// ------------------------------------------------------------
// 화면 전환, 저장, 복원
// ------------------------------------------------------------
function showScreen(next) {
  if (screenMode === 'game' && next !== 'game') saveProgress();
  screenMode = next;
  if (typeof onSquatScreenChange === 'function') onSquatScreenChange(next);
  if (typeof onPushupScreenChange === 'function') onPushupScreenChange(next);
  for (const id of ['title', 'map', 'game', 'howto']) {
    document.getElementById(`${id}-screen`).classList.toggle('hidden', id !== next);
  }
  holdLeft = false;
  holdRight = false;
  spaceHeld = false;
  document.getElementById('pause-panel').classList.add('hidden');
  document.getElementById('stage-clear').classList.add('hidden');
  document.getElementById('mission-banner').classList.add('hidden');
  gamePaused = false;
  if(document.getElementById('moveus-rest-clock-overlay'))updateRestClock();
}

function openMap() {
  setMapWeek(Math.floor(completedThrough / DAYS_PER_WEEK));
  setMapStatus(`DAY ${completedThrough+1}이(가) 열렸어요! 원할 때 편하게 플레이하세요.`);
  showScreen('map');
}

function setMapStatus(textValue) {
  document.getElementById('map-status').textContent = textValue;
}

function resetStage() {
  jumpCount = 0;
  balanceSet = 1;
  balanceElapsed = 0;
  balanceOnBoard = false;
  balanceUnstableSeconds = 0;
  balanceMountAnimation = null;
  balanceDismountAnimation = null;
  wallCount = 0;
  if (typeof resetPushupTrackerRound === 'function') resetPushupTrackerRound(0);
  ladderCount = 0;
  restUntilMs = 0; restPausedAtMs = 0;
  climbSection = 0;
  ladderStep = 0;
  playerX = 90;
  climbExitX = LADDER_XS[LADDER_SECTIONS-1] - 15;
  verticalCameraY = 0;
  boardAngle = 0.1;
  jumpAnimation = null;
  wallAnimation = null;
  wallParticles = [];
  ladderAnimation = null;
  lastSaveTick = 0;
  gamePhase = 'jump';
  middleMissions = pickMiddleMissions();
  applyMissionLayout();
  cookSet = 1; cookReps = 0; cookAction = null; cookWalk = null; dinnerTimer = 0; cookingZoom = 1;
  spaceHeld = false;
  gamePaused = false;
  clearBanner();
  if (typeof resetSquatTrackerRound === 'function') resetSquatTrackerRound(0);
}

function enterStage(stageNumber) {
  // 완료한 DAY는 어떤 경로에서도 재진입할 수 없습니다.
  if (stageNumber !== completedThrough + 1 || stageNumber < 1) return;
  currentStage = stageNumber;
  resetStage();
  // 중간에 나온 DAY는 동일 탭에서 이어 하고, 완료한 DAY는 진입할 수 없습니다.
  restoreProgress();
  showScreen('game');
  if (gamePhase === 'wallRest' || gamePhase === 'cookRest' || gamePhase === 'climbRest') clearBanner();
  else if (gamePhase === 'wallTransition') setBanner('기존 2개 미션 기록을 이어받았어요! 다음은 벽 부수기.', false, 3.2);
  else if (gamePhase === 'climb') setBanner('오른쪽20 → 왼쪽20 → 45초 휴식 → 오른쪽20 → 왼쪽20', false, 2.8);
  else if (gamePhase.startsWith('cook')) setBanner('마지막 월 엔젤 요리 미션을 이어서 시작합니다!', false, 2.5);
  updateMissionHud();
  if (typeof resetSquatTrackerRound === 'function') resetSquatTrackerRound(jumpCount);
  if (typeof resetPushupTrackerRound === 'function') resetPushupTrackerRound(wallCount);
}

function returnToMap() { openMap(); }

function readSavedProgress(stageNumber = currentStage) {
  const value = sessionStageProgress.get(stageNumber);
  return value ? {value, version:10} : null;
}
function loadStageCompletion() {
  // STEP 10은 개발 시연 버전: 매번 새로 열 때 모든 상태를 초기화합니다.
  // 오래된 STEP 9 localStorage 값도 읽지 않으므로 기존 저장에 영향을 받지 않습니다.
  completedThrough = 0;
  mapWeek = 0;
  sessionStageProgress.clear();
  updateMapNavigation();
}

function restoreProgress() {
  const found = readSavedProgress();
  if (!found) return;
  const saved = found.value;
  // 완료한 DAY의 기록은 불러오지 않습니다.
  if (saved.completed || saved.phase === 'cleared') return;
  if (found.version >= 6 && Array.isArray(saved.middleMissions) &&
      saved.middleMissions.length === 2 &&
      saved.middleMissions.every(m => ['balance','wall','climb'].includes(m))) {
    middleMissions = ['balance','wall','climb'].filter(m => saved.middleMissions.includes(m));
  } else if (found.version < 6) {
    // 이전 버전에서 진행 중이던 미션은 스킵하지 않도록 우선 보존.
    middleMissions = ['balance','wall'];
    if (['ladderTransition','climb','ladderWalk','climbExit'].includes(saved.phase)) middleMissions = ['wall','climb'];
  }
  // 저장된 두 중간 운동이 확정된 후에 지도에서 실제 위치를 계산합니다.
  applyMissionLayout();
  const mapIsLegacy = found.version < 8;
  const oldXToNew = middleMissions.includes('climb')
    ? LADDER_XS[0] - 3200
    : WALL_START - 1920;
  jumpCount = constrain(Number(saved.jumpCount) || 0, 0, JUMP_TOTAL);
  balanceElapsed = constrain(Number(saved.balanceElapsed) || 0, 0, PLANK_SECONDS);
  balanceSet = 1; // 구버전 2~3세트 중이라도 새 테스트는 5초 1회로 환산
  balanceOnBoard = found.version >= 9 ? saved.balanceOnBoard === true : false;
  balanceUnstableSeconds = 0; // 다시 접속했을 때 경고 시간은 새로 시작
  balanceMountAnimation = null;
  balanceDismountAnimation = null;
  wallCount = constrain(Number(saved.wallCount) || 0, 0, WALL_TOTAL);
  restUntilMs = Number.isFinite(Number(saved.restUntilMs)) ? Math.max(0, Number(saved.restUntilMs)) : 0;
  restPausedAtMs = 0;

  const validPhases = ['jump','transition','balance','rest','wallTransition','wall','wallRest',
                       'ladderTransition','climb','climbRest','ladderWalk','climbExit',
                       'cookTransition','cook','cookRest','cookWalk','cookDone'];
  if (!validPhases.includes(saved.phase)) return;
  gamePhase = saved.phase;

  // 저장 순간과 동작 애니메이션 완료 순간이 엇갈려도 다음 미션으로 복구.
  if (gamePhase === 'rest' || (gamePhase === 'balance' && balanceElapsed >= PLANK_SECONDS)) {
    gamePhase = middleMissions.includes('wall') && middleMissions.indexOf('wall') > middleMissions.indexOf('balance') ?
      'wallTransition' : middleMissions.includes('climb') ? 'ladderTransition' : 'cookTransition';
  }
  if (gamePhase === 'jump' && jumpCount >= JUMP_TOTAL) {
    gamePhase = middleMissions[0] === 'balance' ? 'transition' :
                middleMissions[0] === 'wall' ? 'wallTransition' : 'ladderTransition';
  }
  if (gamePhase === 'wall' && wallCount === WALL_REPS_PER_SET) {
    gamePhase = 'wallRest';
  }
  if ((gamePhase === 'wall' || gamePhase === 'wallRest') && wallCount >= WALL_TOTAL) {
    gamePhase = middleMissions.includes('climb') ? 'ladderTransition' : 'cookTransition';
  }

  if (found.version >= 5) {
    // 새 버전 16 이전의 사다리는 10칸x3구간이었습니다. 저장된 총횟수는 유지합니다.
    const oldLadderCount = Math.max(0, Math.floor(Number(saved.ladderCount)||0));
    const oldFormat = Number(saved.ladderExerciseVersion||0) < 2;
    ladderCount = constrain(oldLadderCount, 0, LADDER_STEPS);
    if (oldFormat) {
      // 이전 30회 미션에서 저장된 반복 횟수를 없애거나 갑자기 2배로 부풀리지 않음
      climbSection = Math.min(LADDER_SECTIONS-1, Math.floor(ladderCount / STEPS_PER_LADDER));
      ladderStep = ladderCount - climbSection*STEPS_PER_LADDER;
    } else {
      climbSection = constrain(Number(saved.climbSection) || 0, 0, LADDER_SECTIONS - 1);
      ladderStep = constrain(Number(saved.ladderStep) || 0, 0, STEPS_PER_LADDER);
      ladderCount = climbSection * STEPS_PER_LADDER + ladderStep;
    }
  } else {
    // 이전 step4의 사다리 0~10칸 기록은 첫 번째 구간으로 옮깁니다.
    ladderStep = constrain(Number(saved.ladderCount) || 0, 0, STEPS_PER_LADDER);
    ladderCount = ladderStep;
    climbSection = 0;
    if (gamePhase === 'climbExit') gamePhase = 'ladderWalk';
  }
  if (Number(saved.ladderExerciseVersion||0) < 2 && gamePhase === 'climbExit' && ladderCount < LADDER_STEPS) {
    gamePhase='climb'; // 구버전 30칸 완료를 새 버전 80회 완료로 오인하지 않음
  }
  if (gamePhase === 'climb' && ladderCount === 40 && Number(saved.ladderExerciseVersion||0)>=2) gamePhase='climbRest';
  switch(gamePhase) {
    case 'jump':
      playerX = jumpCount ? JUMP_OBSTACLES[jumpCount - 1] + 38 : 90;
      break;
    case 'transition':
      playerX = JUMP_OBSTACLES[JUMP_TOTAL-1] + 38;
      break;
    case 'balance':
      playerX = balanceOnBoard ? BOARD_X - 15 : BALANCE_EXIT_X;
      break;
    case 'wallTransition':
      playerX = middleMissions.includes('balance') ? BOARD_X - 15 : JUMP_OBSTACLES[9] + 38;
      break;
    case 'wall':
    case 'wallRest':
      playerX = wallCount ? WALL_OBSTACLES[wallCount - 1] + 45 : WALL_OBSTACLES[0] - 47;
      break;
    case 'ladderTransition':
      playerX = middleMissions.includes('wall')
        ? WALL_OBSTACLES[WALL_TOTAL-1] + 45
        : BOARD_X - 15;
      break;
    case 'climbRest':
      playerX = LADDER_XS[1] - 15;
      break;
    case 'climb':
      playerX = LADDER_XS[climbSection] - 15;
      if (ladderStep >= STEPS_PER_LADDER) gamePhase = 'ladderWalk';
      break;
    case 'ladderWalk':
      playerX = Number.isFinite(Number(saved.playerX))
        ? Number(saved.playerX) + (mapIsLegacy ? oldXToNew : 0)
        : LADDER_XS[climbSection] - 15;
      break;
    case 'climbExit':
      playerX = Number.isFinite(Number(saved.playerX))
        ? Number(saved.playerX) + (mapIsLegacy ? oldXToNew : 0)
        : LADDER_XS[LADDER_SECTIONS-1] - 15;
      climbExitX = playerX;
      climbSection = LADDER_SECTIONS-1;
      ladderStep = STEPS_PER_LADDER;
      ladderCount = LADDER_STEPS;
      break;
    case 'cookTransition':
      playerX = Number.isFinite(Number(saved.playerX))
        ? Number(saved.playerX) + (mapIsLegacy ? oldXToNew : 0)
        : cookingBaseX() - 45;
      break;
    case 'cook':
    case 'cookRest':
    case 'cookWalk':
    case 'cookDone':
      cookSet = constrain(Number(saved.cookSet) || 1, 1, COOK_SETS);
      cookReps = constrain(Number(saved.cookReps) || 0, 0, COOK_REPS);
      dinnerTimer = Number(saved.dinnerTimer) || 0;
      playerX = cookAvatarX(cookSet);
      if (gamePhase === 'cookWalk') gamePhase = 'cook';
      if (gamePhase === 'cook' && cookReps >= COOK_REPS) {
        gamePhase = cookSet < COOK_SETS ? 'cookRest' : 'cookDone';
      }
      if (gamePhase === 'cookDone') {
        // 이전 저장본의 남은 카운트다운과 혼동하지 않도록 새 식사 연출 처음부터 재생합니다.
        dinnerTimer = saved.dinnerSequence === 2 ? constrain(Number(saved.dinnerTimer) || 0, 0, 5.6) : 0;
        playerX = cookingBaseX() + (dinnerTimer >= 1.55 ? 38 + Math.min(1, (dinnerTimer-1.55)/1.90)*165 : 38);
      }
      break;
  }
  if (['climb','climbRest','ladderWalk','climbExit','cookTransition','cook','cookRest','cookWalk','cookDone'].includes(gamePhase)) {
    // 이어하기 시 카메라가 첫 프레임에서 아래로 떨어지지 않게 위치 복원
    verticalCameraY = min(0, getCharacterTopY() - 170);
  }
}

function saveProgress() {
  if (screenMode !== 'game') return;
  // 메모리 저장만: 탭을 새로고침하면 Map이 사라져 모든 DAY가 0부터 시작합니다.
  sessionStageProgress.set(currentStage, {
    version:10, stage:currentStage,
    phase:gamePhase, jumpCount,balanceSet,balanceElapsed,balanceOnBoard,wallCount,
    ladderCount,climbSection,ladderStep,ladderExerciseVersion:2,restUntilMs,playerX,middleMissions:[...middleMissions],cookSet,cookReps,
    dinnerTimer,dinnerSequence:2, completed:gamePhase==='cleared'
  });
  // 비동기 동기화: 메모리에 먼저 저장하고, 로그인했을 때만 Firebase에 전송합니다.
  window.moveusCloud?.queueSave?.();
}


// ============================================================
// STEP 15 — Firebase 저장/복원 연결용 순수 함수
// 기존 게임/인식 기능을 변경하지 않으며 유저별 데이터만 읽고 씁니다.
// ============================================================
function moveusCloudRestore(profile) {
  // 플레이 중 계정을 바꾸는 경우에도 이전 플레이 상태를 새 계정에 섞지 않습니다.
  // 화면을 먼저 전환한 뒤 메모리 맵/완료 DAY를 교체해야 합니다.
  if (screenMode === 'game') showScreen('title');
  completedThrough = Math.max(0, Math.min(9999, Math.floor(Number(profile?.completedThrough) || 0)));
  sessionStageProgress.clear();
  currentStage = completedThrough + 1;
  const saved = profile?.stageProgress;
  if (saved && typeof saved === 'object' && !Array.isArray(saved) &&
      Number(saved.stage) === currentStage && saved.phase !== 'cleared' && !saved.completed) {
    sessionStageProgress.set(currentStage, saved);
  }
  mapWeek = Math.floor(completedThrough / DAYS_PER_WEEK);
  updateMapNavigation();
  showScreen('title');
}

function moveusCloudSnapshot() {
  // 전송 항목은 운동 진행에 필요한 숫자/상태뿐이며 카메라 영상은 보내지 않습니다.
  const activeDay = completedThrough + 1;
  const saved = sessionStageProgress.get(activeDay);
  const p = saved && saved.phase !== 'cleared' && !saved.completed ? saved : null;
  const phase = p?.phase || 'notStarted';
  let exerciseLabel = '운동 시작 전';
  let countLabel = '준비 중';
  if (['jump','transition'].includes(phase)) {
    exerciseLabel = '스쿼트 · 장애물 점프';
    countLabel = `${Math.max(0, Number(p.jumpCount)||0)} / ${JUMP_TOTAL}회`;
  } else if (['balance','rest'].includes(phase)) {
    exerciseLabel = '플랭크 · 중심 잡기';
    countLabel = `${(Math.max(0, Number(p.balanceElapsed)||0)).toFixed(1)} / ${PLANK_SECONDS}초`;
  } else if (['wallTransition','wall','wallRest'].includes(phase)) {
    exerciseLabel = '무릎 푸시업 · 벽 부수기';
    countLabel = `${Math.max(0, Number(p.wallCount)||0)} / ${WALL_TOTAL}회`;
  } else if (['ladderTransition','climb','climbRest','ladderWalk','climbExit'].includes(phase)) {
    exerciseLabel = '다리 들기 · 사다리';
    const turns=['오른쪽 1세트','왼쪽 1세트','오른쪽 2세트','왼쪽 2세트'];
    countLabel = `${turns[Math.min(3,Math.floor((Number(p.ladderCount)||0)/STEPS_PER_LADDER))]} · ${(Number(p.ladderCount)||0)%STEPS_PER_LADDER}/${STEPS_PER_LADDER}회`;
  } else if (phase.startsWith('cook')) {
    exerciseLabel = '월 엔젤 · 요리';
    const done = (Math.max(1,Number(p.cookSet)||1)-1)*COOK_REPS + (Number(p.cookReps)||0);
    countLabel = `${Math.max(0,done)} / ${COOK_REPS*COOK_SETS}회`;
  }
  return {
    version: 15,
    completedThrough,
    activeDay,
    exerciseLabel,
    countLabel,
    stageProgress: p ? JSON.parse(JSON.stringify(p)) : null
  };
}

// ============================================================
// STEP 16 — 소리 없는 공통 휴식 타이머 (60초 / 45초)
// HTML/CSS 파일을 변경하지 않으므로 기존 가족 진행도 바를 그대로 보존할 수 있습니다.
// ============================================================
function ensureRestClock() {
  if (document.getElementById('moveus-rest-clock-overlay')) return;
  const css = document.createElement('style');
  css.id='moveus-rest-clock-style';
  css.textContent = `
    #moveus-rest-clock-overlay {position:absolute;inset:0;z-index:29;display:flex;align-items:center;
      justify-content:center;pointer-events:auto;background:rgba(23,44,58,.66);padding:16px;color:#203744;}
    #moveus-rest-clock-overlay.rest-hidden {display:none!important;}
    .moveus-rest-card {width:min(410px,94vw);max-height:90dvh;overflow:auto;text-align:center;
      padding:clamp(17px,3.5vw,28px);border:4px solid #203744;background:#f8f3df;box-shadow:7px 7px 0 #172c3a;}
    .moveus-rest-eyebrow {font-size:11px;letter-spacing:1.2px;color:#4b8b77;margin:0 0 9px;}
    .moveus-rest-card h2{font-size:clamp(21px,3vw,29px);margin:0 0 9px;}
    .moveus-rest-description{font-size:13px;line-height:1.5;margin:6px 0;}
    .moveus-rest-watch{position:relative;width:clamp(150px,24vh,205px);aspect-ratio:1;margin:13px auto 9px;}
    .moveus-rest-watch svg{display:block;width:100%;height:100%;}
    .moveus-rest-time{font-size:clamp(24px,5vw,36px);font-weight:900;margin:0;color:#203744;font-variant-numeric:tabular-nums;}
    .moveus-rest-skip{display:inline-flex;align-items:center;justify-content:center;min-height:41px;
      margin:11px auto 4px;padding:8px 17px;border:3px solid #203744;border-radius:0;background:#f1c76e;
      box-shadow:4px 4px 0 #203744;color:#203744;font-family:inherit;font-size:13px;font-weight:900;cursor:pointer;touch-action:manipulation;}
    .moveus-rest-skip:hover{background:#ffdda1;}
    .moveus-rest-skip:active{transform:translate(2px,2px);box-shadow:2px 2px 0 #203744;}
    .moveus-rest-skip:focus-visible{outline:3px solid #559ee2;outline-offset:3px;}
    .moveus-rest-foot{font-size:11px;color:#56766f;margin:6px 0 0;line-height:1.5;}
    @media(max-height:550px){.moveus-rest-watch{width:125px}.moveus-rest-card{padding:12px 16px}}
  `;
  document.head.appendChild(css);
  const marks=Array.from({length:12},(_,i)=>{
    const a=(i*30-90)*Math.PI/180;
    return `<line x1="${80+66*Math.cos(a)}" y1="${80+66*Math.sin(a)}" x2="${80+73*Math.cos(a)}" y2="${80+73*Math.sin(a)}" stroke="#42615c" stroke-width="${i%3===0?4:2.4}"/>`;
  }).join('');
  const wrapper=document.createElement('section');
  wrapper.id='moveus-rest-clock-overlay';
  wrapper.className='rest-hidden';
  wrapper.setAttribute('role','status');
  wrapper.setAttribute('aria-label','세트 사이 자동 휴식 타이머');
  wrapper.innerHTML=`<div class="moveus-rest-card">
    <p class="moveus-rest-eyebrow" id="moveus-rest-kicker">SET BREAK</p>
    <h2 id="moveus-rest-title">잠깐 쉬는 시간</h2>
    <p class="moveus-rest-description" id="moveus-rest-description">다음 세트를 준비하세요.</p>
    <div class="moveus-rest-watch"><svg viewBox="0 0 160 160" aria-hidden="true">
      <circle cx="80" cy="80" r="77" fill="#eaf1e8" stroke="#203744" stroke-width="5"/>
      <circle cx="80" cy="80" r="62" fill="#fffdf0" stroke="#a2b7a9" stroke-width="2"/>
      ${marks}
      <line id="moveus-rest-clock-hand" x1="80" y1="90" x2="80" y2="22" stroke="#d27b67" stroke-width="4" stroke-linecap="round"/>
      <circle cx="80" cy="80" r="7" fill="#203744"/>
      </svg></div>
    <p class="moveus-rest-time" id="moveus-rest-time">01:00</p>
    <button id="moveus-rest-skip" class="moveus-rest-skip" type="button" aria-label="현재 휴식을 건너뛰고 다음 세트 시작">▶ 휴식 건너뛰기</button>
    <p class="moveus-rest-foot">시간이 끝나면 자동으로 다음 세트가 시작됩니다 · 소리 없음</p>
  </div>`;
  document.getElementById('game-root').appendChild(wrapper);
  document.getElementById('moveus-rest-skip').addEventListener('click', skipTimedRest);
  // 알림음 켜기 토글을 제거합니다. 게임에서 사용자가 들을 수 있는 음성/효과음은 전부 꺼집니다.
  const toggle=document.getElementById('squat-audio');
  if(toggle){toggle.checked=false;toggle.closest('label')?.remove();}
  // 이전 버전의 푸시업 '2세트 시작' 팝업은 더 이상 사용하지 않습니다.
  document.getElementById('pushup-rest')?.classList.add('hidden');
}
function beginTimedRest(phase) {
  restUntilMs = Date.now()+REST_SECONDS[phase]*1000;
  restPausedAtMs = 0;
  gamePhase=phase;
  clearBanner();
  ensureRestClock();
  updateRestClock();
  saveProgress();
}
function updateRestClock() {
  ensureRestClock();
  const overlay=document.getElementById('moveus-rest-clock-overlay');
  const active=screenMode==='game'&&Object.hasOwn(REST_SECONDS,gamePhase);
  overlay.classList.toggle('rest-hidden',!active);
  if(!active)return;
  const duration=REST_SECONDS[gamePhase];
  if(!restUntilMs) restUntilMs=Date.now()+duration*1000; // 이전 버전 저장본 호환
  const now=gamePaused && restPausedAtMs ? restPausedAtMs : Date.now();
  const remainingMs=Math.max(0,restUntilMs-now);
  const seconds=Math.ceil(remainingMs/1000);
  const spent=Math.min(duration,Math.max(0,(duration*1000-remainingMs)/1000));
  // 남은 휴식 시간 전체에 맞춰 초침이 시계 중심에서 정확히 360도로 회전합니다.
  const progress=duration>0 ? spent/duration : 0;
  const angle=(progress*360-90)*Math.PI/180;
  const handLength=58;
  const tailLength=10;
  const x1=80-tailLength*Math.cos(angle);
  const y1=80-tailLength*Math.sin(angle);
  const x2=80+handLength*Math.cos(angle);
  const y2=80+handLength*Math.sin(angle);
  const hand=document.getElementById('moveus-rest-clock-hand');
  hand.setAttribute('x1',x1.toFixed(2));
  hand.setAttribute('y1',y1.toFixed(2));
  hand.setAttribute('x2',x2.toFixed(2));
  hand.setAttribute('y2',y2.toFixed(2));
  document.getElementById('moveus-rest-time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  const info=gamePhase==='wallRest' ? ['KNEE PUSH-UP · SET 1 / 2','푸시업 1세트 완료','60초 뒤 2세트 10회를 자동으로 시작해요.'] :
      gamePhase==='climbRest' ? ['HIP ABDUCTION · SET 1 / 2','좌우 1세트 완료','45초 뒤 오른쪽 다리 20회부터 2세트를 시작해요.'] :
      [`WALL ANGEL · SET ${cookSet} / ${COOK_SETS}`,`${cookSet}세트 완료`,`60초 뒤 ${cookSet+1}세트를 자동으로 시작해요.`];
  document.getElementById('moveus-rest-kicker').textContent=info[0];
  document.getElementById('moveus-rest-title').textContent=info[1];
  document.getElementById('moveus-rest-description').textContent=info[2];
  if(remainingMs>0||gamePaused)return;
  finishTimedRest();
}
function skipTimedRest() {
  // 운동 횟수/진행도는 건드리지 않고 현재 휴식 구간만 끝냅니다.
  // 타이머가 이미 끝났거나 게임을 중지한 경우 중복 전환하지 않습니다.
  if (screenMode !== 'game' || gamePaused || !Object.hasOwn(REST_SECONDS, gamePhase)) return;
  finishTimedRest();
}
function finishTimedRest() {
  const finished=gamePhase;
  restUntilMs=0;restPausedAtMs=0;
  if(finished==='wallRest'){
    if(typeof startPushupSecondSet==='function')startPushupSecondSet();
    else{gamePhase='wall';saveProgress();}
  } else if(finished==='climbRest'){
    gamePhase='ladderWalk';
    saveProgress();
  } else if(finished==='cookRest'){
    cookSet++;
    cookReps=0;
    cookWalk={startX:playerX,endX:cookAvatarX(cookSet)};
    gamePhase='cookWalk';
    saveProgress();
  }
  clearBanner();
  updateRestClock();
  updateMissionHud();
}

// ------------------------------------------------------------
// 미션 상태 변경: Space(짧게 누름), Space(꾹 누름)
// ------------------------------------------------------------
function onActionDown() {
  if (screenMode !== 'game' || gamePaused || gamePhase === 'cleared') return;
  if (spaceHeld) return; // 키를 꾹 눌러도 벽/점프/사다리는 한 번만 인정
  spaceHeld = true;

  if (gamePhase === 'balance' && !balanceOnBoard && !balanceDismountAnimation && !balanceMountAnimation) {
    // 플랭크를 다시 시작하면 보드 위로 올라갑니다. 이전 유지 시간은 그대로!
    balanceMountAnimation = { elapsed: 0, duration: 0.42, startX: playerX };
    balanceUnstableSeconds = 0;
    clearBanner();
    saveProgress();
  } else if (gamePhase === 'jump' && !jumpAnimation) {
    const obstacleX = JUMP_OBSTACLES[jumpCount];
    if (obstacleX === undefined) return;
    jumpAnimation = { elapsed: 0, duration: 0.64, startX: playerX, finishX: obstacleX + 38 };
    clearBanner();
  } else if (gamePhase === 'rest') {
    balanceSet += 1;
    balanceElapsed = 0;
    gamePhase = 'balance';
    clearBanner();
    saveProgress();
  } else if (gamePhase === 'wall' && !wallAnimation && wallCount < WALL_TOTAL) {
    const wallX = WALL_OBSTACLES[wallCount];
    if (wallX === undefined) return;
    wallAnimation = { elapsed: 0, duration: 0.48, startX: playerX, finishX: wallX + 45, burst: false };
    clearBanner();
  } else if (gamePhase === 'climb' && !ladderAnimation) {
    ladderAnimation = { elapsed: 0, duration: 0.32, from: ladderStep };
    clearBanner();
  } else if (gamePhase === 'cook' && !cookAction && cookReps < COOK_REPS) {
    cookReps++;
    cookAction = { elapsed: 0, duration: .34, kind: cookingActionName() };
    clearBanner();
    saveProgress();
  }
}

function onActionUp() { spaceHeld = false; }

function setBanner(message, sticky = false, seconds = 2.2) {
  const element = document.getElementById('mission-banner');
  element.textContent = message;
  element.classList.remove('hidden');
  bannerTimeout = seconds;
  bannerSticky = sticky;
}
function clearBanner() {
  document.getElementById('mission-banner').classList.add('hidden');
  bannerTimeout = 0;
  bannerSticky = false;
}

function togglePause(forcePause = !gamePaused) {
  if (screenMode !== 'game' || gamePhase === 'cleared') return;
  const now=Date.now();
  if(forcePause && !gamePaused && Object.hasOwn(REST_SECONDS,gamePhase))restPausedAtMs=now;
  if(!forcePause && gamePaused && restPausedAtMs && restUntilMs){restUntilMs+=Math.max(0,now-restPausedAtMs);restPausedAtMs=0;saveProgress();}
  gamePaused = forcePause;
  spaceHeld = false;
  holdLeft = false;
  holdRight = false;
  document.getElementById('pause-panel').classList.toggle('hidden', !gamePaused);
  document.getElementById('pause-button').textContent = gamePaused ? '▶ RESUME' : 'Ⅱ PAUSE';
  if (gamePaused) saveProgress();
}

function clearStage() {
  gamePhase='cleared';
  spaceHeld=false;
  clearBanner();
  if (currentStage === completedThrough+1) {
    completedThrough=currentStage;
    // 완료 기록도 이 페이지를 열어 둔 동안에만 유지됩니다.
  }
  saveProgress();
  const weekMilestone=currentStage % DAYS_PER_WEEK === 0;
  const monthMilestone=currentStage % DAYS_PER_MONTH === 0;
  const card=document.querySelector('#stage-clear .clear-card');
  card.classList.toggle('weekly-clear',weekMilestone && !monthMilestone);
  card.classList.toggle('monthly-clear',monthMilestone);
  document.getElementById('clear-title').textContent=`DAY ${currentStage} CLEAR!`;
  // 실제로 플레이한 중간 운동 2종을 그대로 보여 줍니다.
  // 스테이지가 무작위 조합이어도 운동명은 늘 정확하게 일치합니다.
  const middleExerciseNames = {
    balance: '플랭크',
    wall: '무릎 대고 푸시업',
    climb: '스탠딩 힙 어브덕션'
  };
  const completedExercises = ['스쿼트', ...middleMissions.map(id => middleExerciseNames[id]), '월 엔젤'];
  document.getElementById('clear-summary').textContent = `오늘 완료한 운동: ${completedExercises.join(' · ')}`;
  document.getElementById('clear-milestone').textContent=monthMilestone
    ? `✦ MONTH ${Math.floor(currentStage / DAYS_PER_MONTH)} COMPLETE! 새로운 월드 컬러가 열렸어요! ✦`
    : weekMilestone ? `✦ WEEK ${currentStage / DAYS_PER_WEEK} COMPLETE! 일주일의 움직임을 축하해요! ✦`
    : `다음 DAY ${currentStage+1}이(가) 해금됐어요.`;
  document.getElementById('clear-next-button').textContent=`▶ DAY ${currentStage+1}`;
  document.getElementById('stage-clear').classList.remove('hidden');
}

// 진행 중 DAY에서만 PAUSE → RESTART 사용 가능 (완료 DAY 재시작 불가).
function restartFromBeginning() {
  if (!window.confirm('현재 스테이지를 처음부터 다시 시작할까요?')) return;
  resetStage();
  document.getElementById('pause-panel').classList.add('hidden');
  document.getElementById('pause-button').textContent = 'Ⅱ PAUSE';
  saveProgress(); // 현재 탭의 진행 중 DAY 기록만 갱신
  setBanner('첫 번째 운동부터 다시 시작합니다!', false, 2.1);
  updateMissionHud();
}

// ------------------------------------------------------------
// 게임 루프: 스쿼트 → 중간 두 종(푸시업 10x2 / 다리 들기 20x4 등) → 월 엔젤
// ------------------------------------------------------------
function updateGame() {
  if (typeof updateSquatTracker === 'function') updateSquatTracker();
  if (typeof updatePushupTracker === 'function') updatePushupTracker();
  updateRestClock();
  if (gamePaused || gamePhase === 'cleared' || Object.hasOwn(REST_SECONDS,gamePhase)) return;
  const dt = Math.min(0.06, deltaTime / 1000 || 0);

  if (bannerTimeout > 0 && !bannerSticky) {
    bannerTimeout -= dt;
    if (bannerTimeout <= 0) clearBanner();
  }

  if (gamePhase === 'jump') {
    if (jumpAnimation) {
      jumpAnimation.elapsed += dt;
      const t = constrain(jumpAnimation.elapsed / jumpAnimation.duration, 0, 1);
      playerX = lerp(jumpAnimation.startX, jumpAnimation.finishX, easeInOut(t));
      if (t >= 1) {
        jumpAnimation = null;
        jumpCount++;
        saveProgress();
        if (jumpCount === JUMP_TOTAL) {
          startNextMission('jump');
        }
      }
    } else {
      const dx = getMoveDirection();
      const minX = jumpCount ? JUMP_OBSTACLES[jumpCount - 1] + 38 : 40;
      const maxX = JUMP_OBSTACLES[jumpCount] - 34;
      playerX = constrain(playerX + dx * movementSpeed, minX, maxX);
    }
  } else if (gamePhase === 'transition') {
    playerX = min(BALANCE_EXIT_X, playerX + 780 * dt);
    if (playerX >= BALANCE_EXIT_X) {
      gamePhase = 'balance';
      balanceSet = 1;
      balanceElapsed = 0;
      balanceOnBoard = false; // SPACE 누르기 전까지는 발판 앞에서 기다림
      balanceUnstableSeconds = 0;
      balanceMountAnimation = null;
      balanceDismountAnimation = null;
      setBanner('판 앞에서 대기 중 · 준비되면 올라가세요!', false, 2.4);
      saveProgress();
    }
  } else if (gamePhase === 'balance') {
    if (balanceDismountAnimation) {
      const a = balanceDismountAnimation;
      a.elapsed = min(a.duration, a.elapsed + dt);
      playerX = lerp(a.startX, BALANCE_EXIT_X, easeInOut(a.elapsed / a.duration));
      if (a.elapsed >= a.duration) {
        balanceDismountAnimation = null;
        playerX = BALANCE_EXIT_X;
        saveProgress();
      }
    } else if (balanceMountAnimation) {
      const a = balanceMountAnimation;
      a.elapsed = min(a.duration, a.elapsed + dt);
      playerX = lerp(a.startX, BOARD_X - 15, easeInOut(a.elapsed / a.duration));
      if (a.elapsed >= a.duration) {
        balanceMountAnimation = null;
        balanceOnBoard = true;
        playerX = BOARD_X - 15;
        saveProgress();
      }
    } else if (balanceOnBoard) {
      if (spaceHeld) {
        balanceUnstableSeconds = 0;
        balanceElapsed = min(PLANK_SECONDS, balanceElapsed + dt);
        if (balanceElapsed >= PLANK_SECONDS) {
          // 누적 5초를 채우면 다음 미션으로. 잠깐 놓거나 떨어져도 시간은 초기화되지 않습니다.
          spaceHeld = false;
          balanceUnstableSeconds = 0;
          startNextMission('balance');
        }
      } else {
        balanceUnstableSeconds = min(BALANCE_RELEASE_LIMIT, balanceUnstableSeconds + dt);
        if (balanceUnstableSeconds >= BALANCE_RELEASE_LIMIT) {
          balanceOnBoard = false;
          balanceDismountAnimation = { elapsed: 0, duration: 0.42, startX: playerX };
          setBanner('발판에서 내려왔어요. 준비되면 다시 이어하세요!', false, 3.2);
          saveProgress();
        }
      }
    }
    lastSaveTick += dt;
    if (lastSaveTick >= 1) {
      lastSaveTick = 0;
      saveProgress();
    }
  } else if (gamePhase === 'wallTransition') {
    playerX = min(WALL_OBSTACLES[0] - 47, playerX + 1000 * dt);
    if (playerX >= WALL_OBSTACLES[0] - 47) {
      gamePhase = 'wall';
      setBanner('벽 부수기 미션을 진행하세요!', false, 2.4);
      saveProgress();
    }
  } else if (gamePhase === 'wall') {
    if (wallAnimation) {
      wallAnimation.elapsed += dt;
      const t = constrain(wallAnimation.elapsed / wallAnimation.duration, 0, 1);
      playerX = lerp(wallAnimation.startX, wallAnimation.finishX, easeInOut(t));
      // 벽이 양쪽으로 갈라지지 않고, 부서지는 순간에 작은 조각들로 바뀜
      if (!wallAnimation.burst && t >= 0.18) {
        emitWallBurst(WALL_OBSTACLES[wallCount] + 15, LOWER_GROUND_Y - 33);
        wallAnimation.burst = true;
      }
      if (t >= 1) {
        wallAnimation = null;
        wallCount++;
        saveProgress();
        if (wallCount === WALL_REPS_PER_SET) {
          if (typeof onPushupSetRest === 'function') onPushupSetRest();
          beginTimedRest('wallRest');
        } else if (wallCount === WALL_TOTAL) {
          if (typeof onPushupMissionComplete === 'function') onPushupMissionComplete();
          startNextMission('wall');
        }
      }
    } else {
      const dx = getMoveDirection();
      const minX = wallCount ? WALL_OBSTACLES[wallCount - 1] + 45 : WALL_OBSTACLES[0] - 90;
      const maxX = WALL_OBSTACLES[wallCount] - 37;
      playerX = constrain(playerX + dx * movementSpeed, minX, maxX);
    }
  } else if (gamePhase === 'ladderTransition') {
    playerX = min(LADDER_XS[0] - 15, playerX + 1000 * dt);
    if (playerX >= LADDER_XS[0] - 15) {
      gamePhase = 'climb';
      setBanner('오른쪽 다리 1세트 · 20회 시작!', false, 2.6);
      saveProgress();
    }
  } else if (gamePhase === 'climb') {
    if (ladderAnimation) {
      ladderAnimation.elapsed += dt;
      if (ladderAnimation.elapsed >= ladderAnimation.duration) {
        ladderAnimation = null;
        ladderStep++;
        ladderCount++;
        if (ladderStep === STEPS_PER_LADDER) {
          if (climbSection === LADDER_SECTIONS - 1) {
            gamePhase = 'climbExit';
            climbExitX = playerX;
            setBanner('좌우 두 세트 완료! 다음 미션으로 이동합니다.', false, 2.5);
          } else if(climbSection === 1) {
            // 오른쪽20, 왼쪽20 후에만 45초 휴식
            beginTimedRest('climbRest');
          } else {
            gamePhase = 'ladderWalk';
            const nextSide=climbSection%2===0?'왼쪽':'오른쪽';
            setBanner(`다음은 ${nextSide} 다리 20회 · 자동 이동 중`, false, 2.2);
          }
        }
        saveProgress();
      }
    }
  } else if (gamePhase === 'ladderWalk') {
    // 두 사다리 사이 발판은 자동으로 걸어가게 합니다.
    const nextX = LADDER_XS[climbSection + 1] - 15;
    playerX = min(nextX, playerX + 165 * dt);
    if (playerX >= nextX) {
      climbSection++;
      ladderStep = 0;
      gamePhase = 'climb';
      setBanner(`${climbSection%2===0?'오른쪽':'왼쪽'} 다리 ${climbSection<2?1:2}세트 · 20회`, false, 2.0);
      saveProgress();
    }
  } else if (gamePhase === 'climbExit') {
    climbExitX = min(LADDER_XS[LADDER_SECTIONS-1] + 220, climbExitX + 155 * dt);
    playerX = climbExitX;
    if (climbExitX >= LADDER_XS[LADDER_SECTIONS-1] + 220) startNextMission('climb');
  }

  if (gamePhase === 'cookTransition') {
    const goalX = cookAvatarX(1);
    playerX = min(goalX, playerX + 900 * dt);
    if (playerX >= goalX) {
      gamePhase = 'cook';
      setBanner('WALL ANGEL 1/3 · 10회로 불 피우기!', false, 2.7);
      saveProgress();
    }
  } else if (gamePhase === 'cookWalk') {
    const goalX = cookAvatarX(cookSet);
    playerX = playerX < goalX ? min(goalX, playerX + 95*dt) : max(goalX, playerX - 95*dt);
    if (Math.abs(playerX-goalX) < .1) {
      playerX = goalX;
      gamePhase = 'cook';
      setBanner(cookSet === 2 ? 'WALL ANGEL 2/3 · 재료를 10번 썰어 보세요!' :
                'WALL ANGEL 3/3 · 솥 속 재료를 10번 저어 보세요!', false, 2.7);
      saveProgress();
    }
  } else if (gamePhase === 'cook' && cookAction) {
    cookAction.elapsed += dt;
    if (cookAction.elapsed >= cookAction.duration) {
      cookAction = null;
      if (cookReps >= COOK_REPS) {
        if (cookSet < COOK_SETS) {
          beginTimedRest('cookRest');
        } else {
          gamePhase = 'cookDone';
          dinnerTimer = 0;
          // 기존 가운데 안내가 음식이 솥에서 나오는 연출을 가리지 않도록 제거합니다.
          clearBanner();
        }
        saveProgress();
      }
    }
  } else if (gamePhase === 'cookDone') {
    dinnerTimer += dt;
    // 솥에서 음식 등장(0~0.95s) → 손으로 전달(0.95~1.55s) → 식사 자리로 이동
    // → 음식을 내려놓고 축하(3.45~5.4s). 마지막에만 클리어 화면이 뜹니다.
    const walkT = constrain((dinnerTimer - 1.55) / 1.90, 0, 1);
    playerX = lerp(cookAvatarX(3), cookingBaseX() + 203, easeInOut(walkT));
    if (dinnerTimer >= 5.4) clearStage();
  }

  // 벽 파편을 물리적으로 퍼뜨리는 가벼운 픽셀 애니메이션
  for (const p of wallParticles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 235 * dt; // 간단한 중력
  }
  wallParticles = wallParticles.filter(p => p.life > 0);

  let targetAngle = 0.06;
  if (gamePhase === 'balance' && balanceOnBoard && !balanceMountAnimation) {
    if (spaceHeld) {
      targetAngle = 0; // 플랭크 유지: 중심이 안정됩니다.
    } else {
      // SPACE를 떼면 좌우로 빠르게, 크게 흔들리도록 두 진동을 섞습니다.
      const strength = Math.min(1, balanceUnstableSeconds / 0.40);
      targetAngle = strength * (Math.sin(frameCount * 0.68) * 0.31 + Math.sin(frameCount * 1.23) * 0.12);
    }
  }
  boardAngle = lerp(boardAngle, targetAngle, gamePhase === 'balance' ? 0.38 : 0.15);
  updateMissionHud();
}

function emitWallBurst(x, y) {
  const palette = ['#E9C089','#D8AA72','#A77F5B','#8B664E','#F4D3A2'];
  // 이전 3개 조각에서 약 32개 조각으로 늘림
  for (let i = 0; i < 32; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 38 + Math.random() * 155;
    wallParticles.push({
      x: x + (Math.random() - .5) * 16,
      y: y + (Math.random() - .5) * 34,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      w: 3 + Math.floor(Math.random() * 7),
      h: 3 + Math.floor(Math.random() * 8),
      color: palette[i % palette.length],
      life: .62 + Math.random() * .52
    });
  }
}

function levelY(index) { return LOWER_GROUND_Y - index * LADDER_RISE; }
function getCharacterTopY() {
  if (gamePhase === 'balance') {
    const groundTop = LOWER_GROUND_Y - 44;
    if (balanceDismountAnimation) {
      const a = balanceDismountAnimation;
      return lerp(211, groundTop, easeInOut(a.elapsed / a.duration));
    }
    if (balanceMountAnimation) {
      const a = balanceMountAnimation;
      return lerp(groundTop, 211, easeInOut(a.elapsed / a.duration));
    }
    return balanceOnBoard ? 211 : groundTop;
  }
  if (gamePhase === 'climb') {
    const frac = ladderAnimation ?
      constrain(ladderAnimation.elapsed / ladderAnimation.duration, 0, 1) : 0;
    return levelY(climbSection) - 44 - LADDER_RISE * (ladderStep + frac) / STEPS_PER_LADDER;
  }
  if (gamePhase === 'ladderWalk') return levelY(climbSection + 1) - 44;
  if (gamePhase === 'climbRest') return levelY(2) - 44;
  if (gamePhase === 'climbExit') return levelY(LADDER_SECTIONS) - 44;
  if (['cookTransition','cookWalk','cook','cookRest','cookDone','cleared'].includes(gamePhase)) return cookingGroundY() - 44;
  return LOWER_GROUND_Y - 44;
}

function getMoveDirection() {
  // 직접 캐릭터 이동 기능 없음: 운동 성공 및 구간 전환에 따라 자동 이동.
  return 0;
}

function easeInOut(t) { return t * t * (3 - 2 * t); }

function updateMissionHud() {
  if (screenMode !== 'game') return;
  let title, kicker, count, hint, progress, setLabel, actionLabel;
  const middleIndex = id => middleMissions.indexOf(id) + 2;
  if (gamePhase === 'jump' || gamePhase === 'transition') {
    title = gamePhase === 'jump' ? '장애물 뛰어넘기' : '다음 미션으로 이동!';
    kicker = `DAY ${currentStage} · MISSION 1 / 4`;
    count = `${jumpCount} / ${JUMP_TOTAL}`;
    hint = gamePhase === 'jump' ? '스쿼트 1회 인식 → 장애물 하나 넘기' : '다음 미션으로 이동 중';
    progress = 100 * jumpCount / JUMP_TOTAL;
    setLabel = 'JUMP'; actionLabel = 'JUMP';
  } else if (gamePhase === 'balance') {
    title = '중심 잡기 · 플랭크';
    kicker = `DAY ${currentStage} · MISSION ${middleIndex('balance')} / 4`;
    count = `${balanceElapsed.toFixed(1)} / ${PLANK_SECONDS}초`;
    hint = !balanceOnBoard
      ? (balanceDismountAnimation ? '발판에서 내려오는 중...' : '판 앞에서 대기 · 시작하면 탑승합니다 (기록 유지)')
      : balanceMountAnimation ? '다시 올라가는 중...'
      : !spaceHeld ? `발판이 흔들려요! ${Math.max(0, BALANCE_RELEASE_LIMIT - balanceUnstableSeconds).toFixed(1)}초 후 내려옴`
      : '플랭크 자세 유지 · 누적 5초';
    progress = 100 * balanceElapsed / PLANK_SECONDS;
    setLabel = '1 / 1 SET'; actionLabel = 'HOLD';
  } else if (['wallTransition','wall','wallRest'].includes(gamePhase)) {
    title = gamePhase === 'wall' ? '벽 부수기' : gamePhase === 'wallRest' ? '무릎 푸시업 · 세트 휴식' : '벽 부수기 구간으로 이동!';
    kicker = `DAY ${currentStage} · MISSION ${middleIndex('wall')} / 4`;
    const wallSet = wallCount < WALL_REPS_PER_SET ? 1 : 2;
    const currentReps = wallCount === WALL_REPS_PER_SET && gamePhase === 'wallRest' ? WALL_REPS_PER_SET : wallCount % WALL_REPS_PER_SET;
    count = `${currentReps} / ${WALL_REPS_PER_SET}회 · 전체 ${wallCount} / ${WALL_TOTAL}`;
    hint = gamePhase === 'wallRest' ? '60초 휴식 · 종료되면 2세트 자동 시작' : gamePhase === 'wall' ? '무릎 푸시업 1회 인식 → 벽 하나 부수기' : '푸시업 구간으로 자동 이동 중';
    progress = 100 * wallCount / WALL_TOTAL;
    setLabel = gamePhase === 'wallRest' ? '1 / 2 REST' : `${wallSet} / ${WALL_SETS} SET`; actionLabel = 'BREAK';
  } else if (['ladderTransition','climb','climbRest','ladderWalk','climbExit'].includes(gamePhase)) {
    title = '사다리 오르기 · 스탠딩 힙 어브덕션';
    kicker = `DAY ${currentStage} · MISSION ${middleIndex('climb')} / 4`;
    count = `${Math.min(ladderStep,STEPS_PER_LADDER)} / ${STEPS_PER_LADDER}회 · 전체 ${ladderCount} / ${LADDER_STEPS}`;
    const side=climbSection%2===0 ? '오른쪽':'왼쪽';
    hint = gamePhase === 'climbRest' ? '좌우 1세트 완료 · 45초 휴식 후 오른쪽 2세트 자동 시작' :
      gamePhase === 'climb' ? `${side} 다리 20회 · 한 번에 사다리 한 칸` :
      gamePhase === 'ladderTransition' ? '오른쪽 다리 1세트 구간으로 이동 중' : '다음 다리 구간으로 자동 이동 중';
    progress = 100 * ladderCount / LADDER_STEPS;
    setLabel = `${climbSection<2?1:2} / 2 SET · ${side}`;
    actionLabel = gamePhase === 'climb' ? 'CLIMB' : 'MOVING...';
  } else {
    const cookingNames = ['모닥불 피우기','재료 썰기','솥에 넣고 젓기'];
    title = gamePhase === 'cleared' ? '오늘의 식사 완성!' : cookingNames[cookSet-1];
    kicker = `DAY ${currentStage} · MISSION 4 / 4 · WALL ANGEL`;
    count = `${cookReps} / ${COOK_REPS}회`;
    hint = gamePhase === 'cookTransition' || gamePhase === 'cookWalk' ? '요리 도구 앞으로 이동 중' :
      gamePhase === 'cookRest' ? '60초 휴식 후 다음 세트 자동 시작' :
      gamePhase === 'cookDone' || gamePhase === 'cleared' ? '멋져요! 오늘의 식사가 완성되었어요.' :
      cookSet === 1 ? `1회 = ${cookingActionName()} (1~3 장작 / 4 스파크 / 5~9 불 / 10 솥)` :
      cookSet === 2 ? '1회 = 식재료 한 번 썰기' : '1회 = 국자 한 번 젓기';
    progress = 100 * cookReps / COOK_REPS;
    setLabel = `${cookSet} / 3 SET`;
    actionLabel = gamePhase === 'cookRest' ? 'NEXT' :
      gamePhase === 'cook' ? 'COOK' : 'MOVING...';
  }
  document.getElementById('hud-title').textContent = title;
  document.getElementById('hud-kicker').textContent = kicker;
  document.getElementById('hud-count').textContent = count;
  document.getElementById('hud-hint').textContent = hint;
  document.getElementById('hud-set').textContent = setLabel;
  document.getElementById('progress-fill').style.width = `${progress}%`;
  document.getElementById('progress-track').setAttribute('aria-valuenow', String(Math.round(progress)));
}

// ------------------------------------------------------------
// 기존 배경 + 새로운 장애물과 균형 잡기 장소 그리기
// ------------------------------------------------------------
function drawStageGame() {
  updateGame();
  background('#A9D9EF');
  const cookingView = ['cookTransition','cookWalk','cook','cookRest','cookDone','cleared'].includes(gamePhase);
  // 요리 구간만 부드럽게 확대해 불, 도마, 솥, 캐릭터가 조금 더 크게 보이게 합니다.
  const desiredZoom = cookingView ? 1.25 : 1;
  cookingZoom = lerp(cookingZoom, desiredZoom, 0.12);
  if (abs(cookingZoom - desiredZoom) < .004) cookingZoom = desiredZoom;
  const visibleW = GAME_W / cookingZoom;
  const worldEnd = levelEndX();
  const cameraX = cookingView
    ? constrain(cookingBaseX()+141-visibleW/2,0,worldEnd-visibleW)
    : constrain(playerX-195,0,worldEnd-GAME_W);
  // 사다리의 세로 스크롤은 유지. 요리할 때는 땅이 화면 바깥으로 밀리지 않도록 다시 구성.
  const targetY = cookingView
    ? cookingGroundY() - 290 / cookingZoom
    : min(0, getCharacterTopY() - 170);
  verticalCameraY = lerp(verticalCameraY, targetY, 0.12);
  if (Math.abs(targetY - verticalCameraY) < .05) verticalCameraY = targetY;
  noStroke();
  push();
  scale(cookingZoom);
  translate(-cameraX, -verticalCameraY);

  drawStageSky();

  // 선택되지 않은 중간 운동의 지형은 그리지 않습니다.
  if (middleMissions.includes('climb')) {
    drawGround(0, LADDER_XS[0] - 12, levelY(0));
    for (let i=0;i<LADDER_SECTIONS-1;i++) {
      drawGround(LADDER_XS[i]+29, LADDER_XS[i+1]-12, levelY(i+1));
    }
    drawGround(LADDER_XS[LADDER_SECTIONS-1]+29, worldEnd, levelY(LADDER_SECTIONS));
  } else {
    drawGround(0, worldEnd, levelY(0));
  }

  for (let x=360; x < LADDER_XS[0]-130; x += 340) drawTree(x+95, levelY(0)-45);
  // 각 층의 발판 위에는 작은 나무나 기둥이 하나씩 있습니다.
  for (let i=0;i<LADDER_SECTIONS;i++) {
    const nextX = i === LADDER_SECTIONS-1 ? levelEndX() : LADDER_XS[i+1];
    const x = LADDER_XS[i]+100;
    if (x < nextX-50) drawTree(x, levelY(i+1)-45);
  }

  if (gamePhase === 'jump') for (let i=0;i<JUMP_OBSTACLES.length;i++) {
    const x=JUMP_OBSTACLES[i];
    if (i < jumpCount) {
      fill('#8ABBA0'); rect(x-3, LOWER_GROUND_Y-9, 36, 9);
      continue;
    }
    fill('#C78B56'); rect(x, LOWER_GROUND_Y-32, 32, 32);
    fill('#E9B371'); rect(x, LOWER_GROUND_Y-32, 32, 7);
    fill('#A56F45'); rect(x+5, LOWER_GROUND_Y-21, 8, 7);
    fill('#274553'); textAlign(CENTER, TOP); textSize(11);
    text(`${i+1}`, x+16, LOWER_GROUND_Y-51);
  }
  // 현재 미션과 전환 중인 다음 미션만 보여 줍니다. 한 화면에 두 운동 금지!
  if (['transition','balance'].includes(gamePhase)) drawBalanceStation();
  if (['wallTransition','wall','wallRest'].includes(gamePhase)) drawWallStation();
  if (['ladderTransition','climb','climbRest','ladderWalk','climbExit'].includes(gamePhase)) drawLadderStation();
  drawCookingStation();

  let y = getCharacterTopY();
  if (gamePhase === 'jump' && jumpAnimation) {
    const t = constrain(jumpAnimation.elapsed / jumpAnimation.duration, 0, 1);
    y -= Math.sin(Math.PI * t) * 72;
  }
  if (gamePhase === 'cookDone' || (gamePhase === 'cleared' && cookReps === COOK_REPS)) {
    const celebrating = gamePhase === 'cleared' || dinnerTimer >= 3.45;
    const hop = celebrating ? abs(sin((dinnerTimer - 3.45) * 7)) * 5 : 0;
    drawCharacter(playerX, y - hop, celebrating);
  } else if (['cook','cookRest','cookWalk'].includes(gamePhase) && cookAction) {
    const amount = Math.sin(Math.PI * constrain(cookAction.elapsed / cookAction.duration, 0, 1));
    drawCharacter(playerX + amount*10, y);
  } else drawCharacter(playerX, y);
  pop();
}

function drawStageSky() {
  // 높은 층의 구름도 새로 나타나서 화면이 빈 하늘만 보이지 않게 함
  for (let tier = 0; tier <= LADDER_SECTIONS; tier++) {
    const groundY = levelY(tier);
    for(let x = 95; x < levelEndX(); x += 330) {
      fill('#F6F8EA'); rect(x + tier*25, groundY-224, 85, 23);
      rect(x + tier*25+16, groundY-239, 46, 20);
    }
    fill(tier%2 ? '#96C8B0' : '#83B6A2');
    for(let x=0;x<levelEndX();x+=280) {
      rect(x, groundY-68, 160, 82);
      rect(x+36, groundY-97, 88, 35);
    }
  }
}

function drawGround(xFrom, xTo, topY) {
  const depth = LADDER_RISE + 145;
  noStroke();
  fill('#987451'); rect(xFrom, topY + 12, xTo - xFrom, depth);
  fill('#55A276'); rect(xFrom, topY, xTo - xFrom, 13);
  fill('#B18C62');
  for(let x = xFrom+10;x < xTo-14;x+=38) {
    for(let d=36;d<depth;d+=55) {
      rect(x, topY+d, 18, 7);
      rect(x+15, topY+d+22, 11, 5);
    }
  }
  fill('#785E49'); rect(xTo-7, topY+13, 7, depth);
}

function drawBalanceStation() {
  const x=BOARD_X;
  fill('#253F50'); rect(x-90, 115, 180, 46);
  fill('#F6F3DB'); textAlign(CENTER, CENTER); textStyle(BOLD);
  textSize(14); text('BALANCE', x, 131);
  textSize(10); text('BALANCE', x, 148);
  textStyle(NORMAL);
  fill('#B1B5AA'); rect(x-54, 281, 108, 8);
  fill('#5D9B7F'); ellipse(x, 270, 30, 30);
  push(); translate(x, 255); rotate(boardAngle);
  noStroke(); fill('#294453'); rect(-75, -4, 150, 12);
  fill('#E4BD75'); rect(-75, -7, 150, 9);
  pop();
  if (gamePhase === 'balance' && balanceOnBoard && !spaceHeld && !balanceMountAnimation) {
    fill('#A54F3D'); textAlign(CENTER, CENTER); textStyle(BOLD);
    textSize(11);
    text(`!! WOBBLE ${Math.max(0, BALANCE_RELEASE_LIMIT - balanceUnstableSeconds).toFixed(1)}s !!`, x, 185);
    textStyle(NORMAL);
  }
}

function drawWallStation() {
  fill('#253F50'); rect(WALL_START-68, 119, 148, 38);
  fill('#F6F3DB'); textAlign(CENTER, CENTER); textStyle(BOLD);
  textSize(13); text('BREAK WALLS', WALL_START+6, 135);
  textStyle(NORMAL);

  for(let i=0;i<WALL_OBSTACLES.length;i++) {
    if (i < wallCount) continue;
    const x=WALL_OBSTACLES[i];
    const isBreaking = i === wallCount && wallAnimation;
    const disappeared = isBreaking && wallAnimation.burst;
    // 벽이 두 개로 나뉘어 찢어지는 기존 연출은 삭제
    if (!disappeared) {
      fill('#B3875D'); rect(x, LOWER_GROUND_Y-64, 30, 64);
      fill('#D8AA72'); rect(x, LOWER_GROUND_Y-64, 30, 9);
      fill('#8F674C'); rect(x, LOWER_GROUND_Y-42, 30, 5);
      fill('#F0C38B'); rect(x+8, LOWER_GROUND_Y-59, 6, 13);
      stroke('#89634B'); strokeWeight(2);
      line(x+15, LOWER_GROUND_Y-42, x+15, LOWER_GROUND_Y);
      noStroke();
    }
    fill('#274553'); textAlign(CENTER, TOP); textSize(11);
    text(`${(i % WALL_REPS_PER_SET)+1}`, x+15, LOWER_GROUND_Y-85);
  }
  // 부서진 벽의 자잘한 픽셀 조각이 바깥으로 흩어지고 아래로 떨어짐
  noStroke();
  for(const p of wallParticles) {
    fill(p.color);
    rect(p.x, p.y, p.w, p.h);
  }
}

function drawLadderStation() {
  for(let s=0;s<LADDER_SECTIONS;s++) {
    const x=LADDER_XS[s];
    const top=levelY(s+1);
    const bottom=levelY(s);
    fill('#2D5661');
    rect(x-18, top-8, 8, bottom-top+18);
    rect(x+18, top-8, 8, bottom-top+18);
    for(let i=0;i<STEPS_PER_LADDER;i++) {
      const y=bottom-11-i*(bottom-top)/STEPS_PER_LADDER;
      fill(s<climbSection || s===climbSection && i<ladderStep ? '#F1C76E' : '#DFE8C7');
      rect(x-11, y, 32, 6);
    }
    fill('#253F50'); rect(x-64, bottom-100, 125, 34);
    fill('#F6F3DB'); textAlign(CENTER,CENTER); textStyle(BOLD);
    textSize(10); text(`${s%2===0?'RIGHT':'LEFT'} · SET ${Math.floor(s/2)+1}`, x, bottom-86);
    textSize(9); text('20 REPS',x,bottom-75);
    textStyle(NORMAL);
    // 새로운 발판이 사다리 오른쪽에서만 시작되도록 표식
    fill('#EAC27A'); rect(x+29, top-8, 76, 8);
  }
  fill('#274553'); rect(LADDER_XS[LADDER_SECTIONS-1]+85, levelY(LADDER_SECTIONS)-34, 11, 24);
  fill('#E9B871'); rect(LADDER_XS[LADDER_SECTIONS-1]+82, levelY(LADDER_SECTIONS)-45, 17, 12);
}

// ------------------------------------------------------------
// WALL ANGEL — 3세트 요리 미션: 1. 불 피우기 2. 칼질 3. 국 젓기
// 단순한 픽셀 그래픽만 사용하고 캐릭터 스프라이트는 그대로 유지합니다.
// ------------------------------------------------------------
function drawCookingStation() {
  if (!['cookTransition','cook','cookWalk','cookRest','cookDone','cleared'].includes(gamePhase)) return;
  const x = cookingBaseX();
  const ground = cookingGroundY();
  const fireX = x + 80;
  const boardX = x + 145;
  const potVisible = cookSet > 1 || (cookSet === 1 && cookReps >= 10);
  const logs = cookSet > 1 ? 3 : Math.min(3, cookReps);
  const sparks = cookSet > 1 ? 1 : (cookReps >= 4 ? 1 : 0);
  const flames = cookSet > 1 ? 5 : Math.min(5, Math.max(0, cookReps-4));
  const slices = cookSet > 2 ? 10 : cookSet === 2 ? cookReps : 0;
  const stirring = cookSet === 3;
  const dinnerFinished = gamePhase === 'cookDone' || gamePhase === 'cleared';
  const servedFromPot = gamePhase === 'cleared' || (dinnerFinished && dinnerTimer >= 0.95);
  const animProgress = cookAction ? constrain(cookAction.elapsed / cookAction.duration, 0, 1) : 1;
  noStroke();
  // 가벼운 캠핑 표시판과 작업대. 플레이 중 HUD를 가리지 않도록 지면 근처로 배치
  fill('#294452'); rect(x+45, ground-145, 195, 32);
  fill('#FAF4DD'); textAlign(CENTER, CENTER); textStyle(BOLD);
  textSize(13); text('CAMPFIRE DINNER', x+142, ground-129);
  textStyle(NORMAL);

  // 모닥불 자리 + 장작 세 개 (1~3회)
  fill('#BBA07A'); rect(fireX-35,ground-11,82,8);
  for (let i=0; i<logs; i++) {
    const lx = fireX - 24 + i*15;
    const dropping = cookSet === 1 && cookReps === i+1 && cookAction ? (1-animProgress)*32 : 0;
    fill('#8B6148'); rect(lx, ground-17-dropping, 27, 8);
    fill('#D4A66B'); rect(lx+3, ground-17-dropping, 7, 6);
  }
  // 4회 스파크 1회: 이후 요리 장면이 끝날 때까지 계속 움직입니다.
  if (sparks > 0) {
    for(let i=0;i<sparks*5;i++) {
      const dx = ((i*19)%45)-22, dy = ((i*13)%33);
      const shimmer = Math.sin(frameCount*.35+i*1.7)*6;
      fill(i%2 ? '#FFF2AF' : '#EDB65E');
      rect(fireX + dx, ground-26-dy+shimmer, 4, 4);
    }
  }
  // 5~9회에 불을 다섯 번 키움. 10회에는 솥을 올리고 불 유지.
  if (flames > 0) {
    for(let i=0;i<flames;i++) {
      const flameHeight = 15 + (i+1)*8;
      const flicker = (frameCount+i*7)%16 < 8 ? 2 : 0;
      fill('#E78942'); rect(fireX-20 + i*8, ground-17-flameHeight+flicker, 12, flameHeight);
      fill('#F4C368'); rect(fireX-15 + i*8, ground-17-flameHeight/2+flicker, 6, flameHeight/2);
    }
  }
  // 10회 성공하면 솥이 위에서 떨어져 모닥불 위에 놓임.
  if (potVisible) {
    const drop = cookSet === 1 && cookReps === 10 && cookAction ? (1-animProgress)*66 : 0;
    const potY = ground-54-drop;
    fill('#364D57'); rect(fireX-30, potY, 60, 23);
    fill('#263F49'); rect(fireX-35, potY-6, 70, 9);
    fill('#E6B771'); rect(fireX-23, potY-7, 46, 5);
    fill('#496975'); rect(fireX-36,potY+2,6,9);
    rect(fireX+30,potY+2,6,9);
    if (stirring && !servedFromPot) {
      // 넣었던 채소가 국 속에 보이도록 간단한 픽셀 표현
      for(let i=0;i<6;i++) {
        fill(i%2 ? '#E6A45B' : '#78B477');
        rect(fireX-22+(i*8), potY-7+(i%2)*2, 6, 4);
      }
      // 국자 흔들림과 김. 매번 스페이스를 누를 때 국자가 좌우로 움직임.
      const swing = cookAction ? Math.sin(animProgress*Math.PI*2)*13 : Math.sin(frameCount*.06)*3;
      stroke('#B5936E'); strokeWeight(5);
      line(fireX+4+swing, potY-8, fireX+18-swing*.4, potY-47);
      noStroke(); fill('#FAF5DC');
      rect(fireX-13, potY-49-((frameCount/6)%12), 4, 9);
      rect(fireX+7, potY-62-((frameCount/7)%11), 4, 9);
    }
  }
  // 2세트 재료 손질: 테이블, 도마, 채소, 칼질, 잘린 재료
  if (cookSet >= 2) {
    fill('#986E4D'); rect(boardX-34, ground-40, 75, 11);
    rect(boardX-27,ground-29,7,29); rect(boardX+27,ground-29,7,29);
    fill('#E2C08A'); rect(boardX-25,ground-48,57,8);
    fill('#78A976'); rect(boardX-22,ground-54,17,7);
    fill('#DB9056'); rect(boardX-4,ground-52,19,5);
    for(let i=0;i<slices;i++) {
      fill(i%2 ? '#E3A05E' : '#7CAD6E');
      rect(boardX+7+(i%5)*5,ground-57-Math.floor(i/5)*6,4,6);
    }
    if (cookSet === 2) {
      // 칼은 키를 누를 때 위아래로 움직이고, 자른 재료가 하나씩 쌓임.
      const chopY = cookAction ? Math.sin(animProgress*Math.PI)*13 : 0;
      fill('#485F67'); rect(boardX+8,ground-91+chopY,5,35);
      fill('#E8E7DA'); rect(boardX+3,ground-64+chopY,14,7);
    }
  }
  if (dinnerFinished) {
    // 음식은 항상 솥에서 처음 등장합니다. 먼 곳에 갑자기 생성되거나 공중에 파티클이 날지 않습니다.
    const finalX = x + 243;
    const tableTop = ground - 36;
    noStroke();
    // 원래 음식이 있던 오른쪽 위치에 작고 아늑한 식사 테이블을 배치합니다.
    fill('#A17A53'); rect(finalX-9, tableTop, 69, 8);
    fill('#805E43'); rect(finalX-4, tableTop+8, 7, 29);
    rect(finalX+48, tableTop+8, 7, 29);
    fill('#D7B486'); rect(finalX-9, tableTop-3, 69, 4);

    if (gamePhase === 'cleared' || dinnerTimer >= 3.45) {
      // 직접 가져다 놓은 요리가 식탁 위에 남습니다.
      drawDinnerBowl(finalX+9, tableTop-17);
      fill('#FFF4D1'); textAlign(CENTER, CENTER); textStyle(BOLD);
      textSize(12); text('YUMMY!', finalX+24, ground-97); textStyle(NORMAL);
    } else if (dinnerTimer < 0.95) {
      // 완성된 요리가 솥 안에서 위로 살짝 솟아오릅니다.
      const rise = easeInOut(constrain(dinnerTimer / 0.95, 0, 1));
      drawDinnerBowl(fireX-14, lerp(ground-66, ground-104, rise));
    } else if (dinnerTimer < 1.55) {
      // 솥에서 캐릭터의 손으로 요리를 옮기는 짧은 동작입니다.
      const passT = easeInOut(constrain((dinnerTimer-0.95)/0.60, 0, 1));
      drawDinnerBowl(lerp(fireX-14, cookAvatarX(3)+27, passT),
                     lerp(ground-104, ground-39, passT));
    } else {
      // 캐릭터가 식사를 들고 오른쪽 테이블까지 직접 걸어갑니다.
      drawDinnerBowl(playerX + 27, ground - 39);
    }
  }
}

function drawDinnerBowl(x, y) {
  // 픽셀 2D 음식. 별/벌레처럼 떠다니는 효과 대신 그릇 자체만 보여 줍니다.
  noStroke();
  fill('#FFF2D5'); rect(x+3, y+4, 24, 9);
  fill('#36505B'); rect(x, y+2, 30, 5);
  fill('#E3AA62'); rect(x+4, y, 22, 5);
  fill('#79A977'); rect(x+7, y-3, 6, 5);
  fill('#DA8E55'); rect(x+18, y-4, 6, 6);
  fill('#B9D8C6'); rect(x+9, y+13, 12, 3);
}

function drawCharacter(x, y, celebrating = false) {
  noStroke();
  fill("#233D50");
  rect(x + 2, y + 27, 9, 17);
  rect(x + 19, y + 27, 9, 17);
  fill("#3779A2");
  if (celebrating) {
    // 캐릭터 외형을 바꾸지 않고, 환호하는 짧은 픽셀 팔 동작만 추가합니다.
    rect(x-7, y+1, 6, 18); rect(x+31, y+1, 6, 18);
    fill("#F2BE85"); rect(x-7, y-4, 6, 8); rect(x+31, y-4, 6, 8);
    fill("#3779A2");
  }
  rect(x, y + 13, 30, 21);
  fill("#F2BE85");
  rect(x + 5, y, 21, 16);
  fill("#263E4A");
  rect(x + 4, y - 4, 23, 6);
}

// ------------------------------------------------------------
// 기존 버튼 + 미션 키보드/터치 버튼 연결
// ------------------------------------------------------------
function connectButtons() {
  document.getElementById('play-button').addEventListener('click', openMap);
  document.getElementById('prev-week-button').addEventListener('click', () => setMapWeek(mapWeek-1));
  document.getElementById('next-week-button').addEventListener('click', () => setMapWeek(mapWeek+1));
  document.getElementById('clear-next-button').addEventListener('click', () => enterStage(currentStage+1));
  document.getElementById('map-to-title-button').addEventListener('click', () => showScreen('title'));
  document.getElementById('back-to-map-button').addEventListener('click', returnToMap);
  document.getElementById('howto-button').addEventListener('click', () => showScreen('howto'));
  document.getElementById('howto-back-button').addEventListener('click', () => showScreen('title'));
  document.getElementById('pause-button').addEventListener('click', () => togglePause());
  document.getElementById('resume-button').addEventListener('click', () => togglePause(false));
  document.getElementById('restart-button').addEventListener('click', restartFromBeginning);
  document.getElementById('clear-map-button').addEventListener('click', returnToMap);
  document.getElementById('fullscreen-button').addEventListener('click', toggleFullscreen);

  document.addEventListener('fullscreenchange', () => {
    document.getElementById('fullscreen-button').textContent =
      document.fullscreenElement ? '⛶ WINDOWED' : '⛶ FULLSCREEN';
    setTimeout(() => windowResized(), 60);
  });
  window.addEventListener('keydown', event => {
    if (event.code === 'Space' && screenMode === 'game') {
      event.preventDefault();
      if (!event.repeat) onActionDown();
    }
    if (event.code === 'KeyP' && screenMode === 'game' && !event.repeat) {
      event.preventDefault();
      togglePause();
    }
  });
  window.addEventListener('keyup', event => {
    if (event.code === 'Space') {
      event.preventDefault();
      onActionUp();
    }
  });
  window.addEventListener('blur', () => {
    holdLeft = false; holdRight = false; onActionUp();
    // 카메라 권한 팝업 때문에 창 포커스가 잠시 사라진 경우는 자동 일시정지하지 않습니다.
    if (screenMode === 'game' && !Object.hasOwn(REST_SECONDS,gamePhase) && !(typeof squatCameraLoading !== 'undefined' && squatCameraLoading)) togglePause(true);
  });
  // 개발 테스트 중에는 페이지를 떠날 때도 디스크/서버에 저장하지 않습니다.
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else alert('이 브라우저는 전체 화면을 지원하지 않습니다. PC에서는 F11 키를 사용해 주세요.');
  } catch (_) {
    alert('전체 화면 전환을 사용할 수 없습니다. PC에서는 F11 키를 사용해 주세요.');
  }
}

function keyPressed() {
  if (keyCode === ESCAPE) {
    if (screenMode === 'game') returnToMap();
    else if (screenMode === 'map' || screenMode === 'howto') showScreen('title');
    return false;
  }
}
