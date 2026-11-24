// ================================================================
// MOVE:US — 독립형 SQUAT LAB (C 방식)
// 원본: 학교에서 만든 HandPose + ml5.neuralNetwork() 제스처 학습 코드
// 응용: BodyPose → 신체 특징 8개 정규화 → 자세 2개 학습 → 순서 판정
// 기존 게임(MOVE:US v11)의 sketch.js와 전혀 연결하지 않습니다.
// 추가: 음성/효과음, 버튼 한 번으로 서기→앉기 2회씩 자동 수집 및 학습
// ================================================================

const VIEW_W = 640;
const VIEW_H = 480;
const JOINT_CONFIDENCE = 0.25;       // 검출 신뢰도가 낮아도 어깨/골반/무릎은 시험 가능
const DRAW_CONFIDENCE = 0.12;        // 디버그용 점 표시는 학습 판정과 별도
const CLASS_CONFIDENCE = 0.68;       // 신경망의 분류 확신도 (초기 실험값)
const SAMPLE_INTERVAL_MS = 160;
const SAMPLES_PER_CAPTURE = 12;      // 클릭 한 번 = 약 2초간 12개 샘플
const MIN_SAMPLES_PER_POSE = 24;     // 최소 2번 수집, 권장 3번 이상
const CLASSIFY_INTERVAL_MS = 180;
const STABLE_CLASSIFICATIONS = 3;    // 같은 자세가 3회 연속 나오면 인정
const LOST_POSE_RESET_MS = 1400;
const FEATURE_VERSION = 'squat-8-features-v2-three-point';

// MoveNet 인덱스. 5/6 어깨, 11/12 골반, 13/14 무릎, 15/16 발목
const JOINTS = {
  left:  { shoulder:5, hip:11, knee:13, ankle:15 },
  right: { shoulder:6, hip:12, knee:14, ankle:16 }
};

let video = null;
let bodyPose = null;
let poses = [];
let connections = [];
let cameraReady = false;
let loadingCamera = false;
let cameraGeneration = 0;
let currentFeatures = null;
let trackingDiagnostic = '카메라 시작 대기';
let trackingQuality = '';
let poseDimensions = {width: VIEW_W, height: VIEW_H};
let poseResultCount = 0;
let lastGoodPoseAt = 0;
let lastCapturedAt = 0;
let lastClassifyAt = 0;
let classifyPending = false;
let latestPoseLabel = null;
let latestConfidence = 0;
let collecting = null;              // {label, collected, nextTime}
let training = false;
let trained = false;
let measuring = false;
let nn = null;
let samples = { standing: [], squatting: [] };
let squatCount = 0;
let stableLabel = null;
let stableHits = 0;
let movementPhase = 'needStanding'; // needStanding → readyForSquat → needReturn
let lastFrameMessageAt = 0;
let activeTrainingGeneration = 0;

// AUTO GUIDE: 두 자세를 번갈아 촬영해 각 24프레임씩 확보합니다.
const GUIDE_STEPS = ['standing', 'squatting', 'standing', 'squatting'];
let guidedMode = false;
let guidedIndex = 0;
let guidedNextAt = 0;
let autoStartAfterTraining = false;
let soundContext = null;
let lastNoPoseSpokenAt = 0;
let lastCountdownSecond = -1;

function elem(id) { return document.getElementById(id); }
function note(message) { elem('log').textContent = message; }
function setStatus(message) { elem('camera-status').textContent = message; }

function soundEnabled() { return !!elem('voice-enabled')?.checked; }
// Chrome의 소리 재생 제한을 피하려면 실제 버튼을 누르는 순간 오디오를 활성화합니다.
function unlockSound() {
  if (!soundEnabled()) return;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor && !soundContext) soundContext = new Ctor();
    if (soundContext?.state === 'suspended') soundContext.resume();
  } catch (err) { console.warn('Audio unlock:', err); }
}
function chime(kind='ready') {
  if (!soundEnabled() || !soundContext || soundContext.state!=='running') return;
  const notes = kind==='finish' ? [740,990] : kind==='count' ? [600] : [500,680];
  notes.forEach((hz,idx)=>{
    try {
      const at = soundContext.currentTime + idx*0.15;
      const osc=soundContext.createOscillator(), gain=soundContext.createGain();
      osc.type='sine'; osc.frequency.value=hz;
      gain.gain.setValueAtTime(0.0001,at);
      gain.gain.exponentialRampToValueAtTime(0.07,at+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001,at+0.14);
      osc.connect(gain); gain.connect(soundContext.destination); osc.start(at); osc.stop(at+0.15);
    } catch(err) { console.warn('Chime:',err); }
  });
}
function say(message, beepKind) {
  if (!soundEnabled()) return;
  if (beepKind) chime(beepKind);
  if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(message);
    utter.lang='ko-KR'; utter.rate=1.0; utter.volume=0.9;
    const voices=window.speechSynthesis.getVoices();
    const koVoice=voices.find(v=>v.lang?.toLowerCase().startsWith('ko'));
    if(koVoice) utter.voice=koVoice;
    window.speechSynthesis.speak(utter);
  } catch(err) {console.warn('Voice:',err);}
}
function speakNoPoseIfNeeded(forWrongPosture=false) {
  if (millis()-lastNoPoseSpokenAt > 9000) {
    lastNoPoseSpokenAt=millis();
    say(forWrongPosture?'해당 자세가 아직 확인되지 않았어요. 무리하지 말고 자세를 조금 조정해 주세요.':'관절이 불확실합니다. 어깨, 골반, 무릎이 카메라에 보이도록 조정해 주세요.', 'ready');
  }
}
function poseText(label) {return label==='standing'?'선 자세':'앉은 자세';}
function setGuideHint(text) {
  elem('guided-hint').textContent=text;
  elem('distance-instruction').textContent=text;
}


function setup() {
  const canvas = createCanvas(VIEW_W, VIEW_H);
  canvas.parent('camera-canvas');
  pixelDensity(1);
  frameRate(30);
  bindControls();
  updateUI();
}

function bindControls() {
  elem('start-camera').addEventListener('click', startCamera);
  elem('stop-camera').addEventListener('click', stopCamera);
  elem('voice-enabled').addEventListener('change', () => { if (soundEnabled()) { unlockSound(); say('음성 안내를 켰습니다.', 'ready'); } else window.speechSynthesis?.cancel(); });
  elem('guided-start').addEventListener('click', startGuidedTraining);
  elem('guided-cancel').addEventListener('click', () => cancelGuide(true));
  elem('capture-standing').addEventListener('click', () => collectSample('standing'));
  elem('capture-squatting').addEventListener('click', () => collectSample('squatting'));
  elem('train-button').addEventListener('click', trainPostures);
  elem('measure-button').addEventListener('click', startMeasuring);
  elem('pause-measure').addEventListener('click', () => { measuring = false; resetSequence(false); note('측정을 멈췄어요. 횟수는 그대로 유지돼요.'); updateUI(); });
  elem('reset-count').addEventListener('click', () => { squatCount = 0; resetSequence(false); note('스쿼트 카운터를 0으로 초기화했어요. 학습 데이터는 그대로예요.'); updateUI(); });
  elem('export-data').addEventListener('click', exportJSON);
  elem('import-data').addEventListener('change', importJSON);
}

async function startCamera() {
  unlockSound();
  if (cameraReady || loadingCamera) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    note('카메라를 사용할 수 없어요. Live Server의 http://127.0.0.1 주소에서 실행해 주세요.');
    return;
  }
  if (typeof ml5 === 'undefined') {
    note('ml5.js가 로드되지 않았어요. 인터넷 연결을 확인하고 새로고침해 주세요.');
    return;
  }
  loadingCamera = true;
  const generation = ++cameraGeneration;
  setStatus('카메라와 BodyPose 준비 중…');
  note('브라우저에서 카메라 사용을 허용해 주세요. 첫 실행에는 모델 다운로드로 시간이 걸릴 수 있어요.');
  updateUI();
  try {
    // 학교 예제처럼 createCapture(VIDEO)를 사용합니다. 영상과 관절을 같은 640x480 캔버스에 표시합니다.
    video = createCapture(VIDEO);
    video.size(VIEW_W, VIEW_H);
    video.hide();

    const chosen = elem('pose-model').value;
    // 중요: ml5@1의 bodyPose()는 모델 객체를 즉시 반환하지만,
    // 실제 TensorFlow 모델 로딩은 비동기적으로 진행됩니다.
    // `await ml5.bodyPose(...)`만 사용하면 this.model이 null인 상태에서
    // detectStart()가 시작되어 estimatePoses 오류가 발생할 수 있습니다.
    bodyPose = ml5.bodyPose('MoveNet', {
      modelType: chosen,
      enableSmoothing: true,
      minPoseScore: 0.15
    });
    if (!bodyPose || !bodyPose.ready) {
      throw new Error('BodyPose.ready가 없습니다. ml5.js 버전을 확인해 주세요.');
    }
    setStatus('BodyPose 모델 다운로드 및 초기화 중…');
    await bodyPose.ready;
    // 모델 로딩 중 사용자가 카메라를 끈 경우 더 이상 탐지하지 않습니다.
    if (generation !== cameraGeneration) return;
    if (!bodyPose.model || typeof bodyPose.model.estimatePoses !== 'function') {
      throw new Error('BodyPose 내부 검출 모델이 초기화되지 않았습니다.');
    }
    console.info('[MOVE:US] BodyPose 검출 모델 준비 완료:', chosen);
    connections = typeof bodyPose.getConnections === 'function' ? bodyPose.getConnections() :
                  (typeof bodyPose.getSkeleton === 'function' ? bodyPose.getSkeleton() : []);
    bodyPose.detectStart(video, gotPoses);
    trackingDiagnostic = '모델 실행 중 · 신체 관절을 기다려요';
    cameraReady = true;
    loadingCamera = false;
    elem('video-placeholder').classList.add('hidden');
    setStatus('연결됨 · 사람을 찾는 중');
    trackingDiagnostic='BodyPose가 영상을 분석 중이에요.';
    note('카메라 준비 완료! 자동 학습 시작을 누르고 뒤로 이동해 주세요.');
    say('카메라 연결 완료. 자동 학습 시작 버튼을 누른 다음 뒤로 이동해 주세요.', 'ready');
  } catch (err) {
    console.error('BodyPose camera error:',err);
    loadingCamera = false;
    cameraReady = false;
    stopVideoTracks();
    setStatus('카메라 연결 실패');
    note('카메라 연결에 실패했어요: ' + (err?.message || err) + ' · 크롬 주소창 카메라 권한과 인터넷을 확인해 주세요.');
  }
  updateUI();
}

function stopVideoTracks() {
  try {
    if (video?.elt?.srcObject) video.elt.srcObject.getTracks().forEach(track=>track.stop());
    if (video) video.remove();
  } catch (e) { console.warn(e); }
  video = null;
}

function stopCamera() {
  cancelGuide(false);
  window.speechSynthesis?.cancel();
  cameraGeneration++;
  if (bodyPose?.detectStop) {
    try { bodyPose.detectStop(); } catch (err) { console.warn('detectStop:',err); }
  }
  stopVideoTracks();
  bodyPose = null;
  cameraReady = false;
  loadingCamera = false;
  collecting = null;
  measuring = false;
  poses = [];
  currentFeatures = null;
  trackingDiagnostic = '카메라 꺼짐';
  latestPoseLabel = null;
  classifyPending = false;
  resetSequence(false);
  elem('video-placeholder').classList.remove('hidden');
  setStatus('카메라 꺼짐');
  note('카메라를 껐어요. 다시 켜면 학습 데이터는 유지되고, 자세 인식은 다시 시작돼요.');
  updateUI();
}

function gotPoses(results) {
  poses = Array.isArray(results) ? results : [];
  poseResultCount++;
}

function getKeypoint(pose,index) {
  const kp = pose?.keypoints?.[index];
  return kp && Number.isFinite(kp.x) && Number.isFinite(kp.y) ? kp : null;
}
function score(kp) { return kp ? (kp.confidence ?? kp.score ?? 0) : 0; }
function distance2D(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
function angleDegrees(a,b,c) {
  const ax = a.x-b.x, ay=a.y-b.y, cx=c.x-b.x, cy=c.y-b.y;
  const divisor = Math.hypot(ax,ay)*Math.hypot(cx,cy);
  if (divisor<0.0001) return 0;
  return Math.acos(Math.max(-1,Math.min(1,(ax*cx+ay*cy)/divisor))) * 180 / Math.PI;
}

// 각 관절 신뢰도는 영상에 사람이 보이는 것과 다릅니다. 이전 버전에서는
// 발목 한 개가 0.43보다 낮다는 이유만으로 전체 자세를 버려 실제 학습이 막혔습니다.
// 이 테스트에서는 어깨·골반·무릎의 3점을 바탕으로 스쿼트 상하 움직임을 학습하고
// 발목은 검출 상태를 보여주는 보조 지표로만 활용합니다. 영상은 저장하지 않습니다.
function coordSizeForPose(pose) {
  const rawW = Number(video?.elt?.videoWidth) || VIEW_W;
  const rawH = Number(video?.elt?.videoHeight) || VIEW_H;
  const pts=pose?.keypoints || [];
  const maxX=Math.max(0,...pts.map(p=>Number(p.x)||0));
  const maxY=Math.max(0,...pts.map(p=>Number(p.y)||0));
  // ml5 버전/캡처 장치에 따라 결과가 캔버스 크기 또는 원본 비디오 픽셀 단위일 수 있음.
  const originalSpace = (maxX > VIEW_W+4 || maxY > VIEW_H+4) && rawW>0 && rawH>0;
  return originalSpace ? {width:rawW,height:rawH} : {width:VIEW_W,height:VIEW_H};
}
function jointSummary(pose,side) {
  const names={shoulder:'어깨',hip:'골반',knee:'무릎',ankle:'발목'};
  return Object.entries(side).map(([name,index])=>{
    const kp=getKeypoint(pose,index);
    return `${names[name]} ${kp?Math.round(score(kp)*100):0}%`;
  }).join(' · ');
}
function makeBodyInputs(pose) {
  if (!pose?.keypoints?.length) {
    trackingDiagnostic='포즈 결과가 없어요. 카메라 영상과 조명을 확인해 주세요.';
    trackingQuality='';
    return null;
  }
  const coords=coordSizeForPose(pose);
  poseDimensions=coords;
  const candidates=[];
  for(const [sideName,side] of Object.entries(JOINTS)) {
    const shoulder=getKeypoint(pose,side.shoulder);
    const hip=getKeypoint(pose,side.hip);
    const knee=getKeypoint(pose,side.knee);
    const required=[shoulder,hip,knee];
    if(required.some(p=>!p || score(p)<JOINT_CONFIDENCE)) continue;
    if(required.some(p=>p.x<0||p.x>coords.width||p.y<0||p.y>coords.height)) continue;
    const torso=distance2D(shoulder,hip);
    if(torso<12) continue;
    const normal=[
      (shoulder.y+hip.y)/(2*coords.height), // 0. 윗몸의 평균 높이 (아래로 갈수록 커짐)
      shoulder.y/coords.height,
      hip.y/coords.height,
      knee.y/coords.height,
      (knee.y-hip.y)/coords.height,
      (hip.y-shoulder.y)/coords.height,
      Math.abs(knee.x-hip.x)/coords.width,
      angleDegrees(shoulder,hip,knee)/180
    ];
    if(normal.every(v=>Number.isFinite(v) && Math.abs(v)<3)) {
      const quality=required.reduce((sum,p)=>sum+score(p),0)/3;
      candidates.push({inputs:normal,quality,side:sideName});
    }
  }
  const left=jointSummary(pose,JOINTS.left);
  const right=jointSummary(pose,JOINTS.right);
  if(!candidates.length) {
    trackingDiagnostic=`학습 필수: 어깨·골반·무릎 각 25% 이상 | 왼쪽: ${left} | 오른쪽: ${right}`;
    trackingQuality='필수 3관절 확인 필요';
    return null;
  }
  candidates.sort((a,b)=>b.quality-a.quality);
  const best=candidates[0];
  trackingQuality=best.side==='left'?'왼쪽 신체로 학습 가능':'오른쪽 신체로 학습 가능';
  trackingDiagnostic=`인식됨 (${trackingQuality}) · ${best.side==='left'?left:right}. 발목은 필수가 아니에요.`;
  return best;
}

function draw() {
  background(35,60,68);
  if (cameraReady && video) {
    push();
    // 영상의 원본 비율을 유지하며 전체를 보여 줍니다(잘라내는 cover 방식 아님).
    if (elem('mirror-mode').checked) { translate(VIEW_W,0); scale(-1,1); }
    const iw=Number(video.elt?.videoWidth)||VIEW_W;
    const ih=Number(video.elt?.videoHeight)||VIEW_H;
    const scaleToFit=Math.min(VIEW_W/iw,VIEW_H/ih);
    const dw=iw*scaleToFit, dh=ih*scaleToFit;
    const dx=(VIEW_W-dw)/2, dy=(VIEW_H-dh)/2;
    image(video,dx,dy,dw,dh);
    if(elem('show-skeleton').checked && poses.length) {
      const dims=coordSizeForPose(poses[0]);
      push(); translate(dx,dy); scale(dw/dims.width,dh/dims.height);
      drawPoseOverlay(poses[0]); pop();
    }
    pop();
    currentFeatures = poses.length ? makeBodyInputs(poses[0]) : null;
    if(!poses.length) {
      trackingQuality='관절 검출 대기';
      trackingDiagnostic=`BodyPose 결과 ${poseResultCount}회 수신 · 현재 사람이 검출되지 않음. 밝은 곳에서 전신을 다시 확인해 주세요.`;
    }
    if (currentFeatures) lastGoodPoseAt=millis();
    if (collecting) captureTick();
    if (guidedMode && !collecting && !training && guidedNextAt && millis()>=guidedNextAt) {
      guidedNextAt=0;
      if (guidedIndex < GUIDE_STEPS.length) beginCollection(GUIDE_STEPS[guidedIndex], true);
      else finishGuidedCollection();
    }
    if (measuring && trained) classifyTick();
    if (measuring && millis()-lastGoodPoseAt>LOST_POSE_RESET_MS) {
      resetSequence(false); latestPoseLabel=null;
    }
    if (frameCount%7===0) updateUI();
  } else if (frameCount%20===0) updateUI();
}

function drawPoseOverlay(pose) {
  const pts=pose.keypoints || [];
  stroke(250,203,98); strokeWeight(2);
  for (const pair of connections) {
    const a=pts[pair[0]], b=pts[pair[1]];
    if (score(a)>DRAW_CONFIDENCE&&score(b)>DRAW_CONFIDENCE) line(a.x,a.y,b.x,b.y);
  }
  noStroke(); fill(81,240,166);
  for (const p of pts) if(score(p)>DRAW_CONFIDENCE) circle(p.x,p.y,5);
}

// 단일 버튼으로 전체 학습을 예약: 카메라가 아직 신체를 못 봐도 진행 가능합니다.
function startGuidedTraining() {
  if (!cameraReady || loadingCamera || training) return;
  unlockSound();
  if (measuring) { measuring=false;resetSequence(false); }
  // 기존 학습 데이터는 보존하되, 자동 학습 4블록을 추가한 뒤 새로 훈련합니다.
  guidedMode=true;guidedIndex=0;guidedNextAt=0;
  // 새로운 위치/거리에서 다시 학습할 때 이전 자세 샘플이 섞이지 않도록 초기화.
  samples={standing:[],squatting:[]};squatCount=0;resetSequence(false);
  trained=false;latestPoseLabel=null;
  beginCollection(GUIDE_STEPS[0],true);
}
function cancelGuide(announce) {
  const wasGuided=guidedMode;
  guidedMode=false;guidedIndex=0;guidedNextAt=0;
  if (collecting?.guided) {
    // 취소한 블록의 불완전한 수집은 버립니다.
    samples[collecting.label].length=collecting.startIndex;
    collecting=null;
  }
  if(wasGuided && announce) {note('자동 학습이 취소됐어요. 이미 완료한 블록의 데이터는 남아 있어요.');say('자동 학습을 취소했습니다.');}
  updateUI();
}
function collectSample(label) {
  if (!cameraReady || collecting || training || guidedMode) {
    note('카메라 준비 후 다른 수집 작업이 끝나면 다시 시도해 주세요.'); return;
  }
  unlockSound();
  if (measuring) { measuring=false;resetSequence(false); }
  trained=false;latestPoseLabel=null;
  beginCollection(label,false);
}
function beginCollection(label, guided) {
  collecting = {label,guided,collected:0,startIndex:samples[label].length,
    phase:'waiting',validFrom:0,countdownEnd:0,nextTime:0,
    missingSince:0, lastSecond:-1};
  const msg=`${poseText(label)} 수집 대기. 어깨·골반·무릎이 화면에 보이는 위치로 이동한 뒤 ${label==='standing'?'똑바로 서':'앉은 자세를 취해'} 주세요.`;
  note(msg);setGuideHint(msg);say(msg,'ready');updateUI();
}
function standingReference() {
  const a=samples.standing.map(x=>x[0]).filter(Number.isFinite).sort((x,y)=>x-y);
  if(a.length<6) return null;
  return a[Math.floor(a.length/2)];
}
function isExpectedPosture(label) {
  if(!currentFeatures) return false;
  const ref=standingReference();
  if(ref===null) return true;
  const h=currentFeatures.inputs[0]; // 어깨+골반 평균 y값: 앉을수록 증가
  const tol=0.035; // 캔버스 세로 기준 약 17px 이상 내려가면 앉은 자세 후보
  return label==='squatting' ? h >= ref+tol : h <= ref+tol*0.55;
}
function resetIncompleteBlock(reason) {
  if(!collecting) return;
  const c=collecting;
  samples[c.label].length=c.startIndex;
  c.collected=0;c.phase='waiting';c.validFrom=0;c.countdownEnd=0;
  c.missingSince=0;c.lastSecond=-1;
  note(reason);setGuideHint(reason);
}
function captureTick() {
  if (!collecting) return;
  const c=collecting, now=millis();
  const good=isExpectedPosture(c.label);
  if(!good) {
    if(!c.missingSince) c.missingSince=now;
    if(c.phase==='recording' && now-c.missingSince>1200) {
      resetIncompleteBlock('인식이 끊겨서 현재 12개 블록을 다시 기다리고 있어요. 이전에 완료한 데이터는 그대로예요.');
      speakNoPoseIfNeeded(!!currentFeatures);
    } else if(c.phase==='countdown') {
      c.phase='waiting';c.validFrom=0;c.countdownEnd=0;c.lastSecond=-1;
    } else if(c.phase==='waiting') speakNoPoseIfNeeded(!!currentFeatures);
    return;
  }
  c.missingSince=0;
  if(c.phase==='waiting') {
    if(!c.validFrom) c.validFrom=now;
    if(now-c.validFrom<650) return; // 잠깐 관절이 튄 것은 제외
    c.phase='countdown';c.countdownEnd=now+2500;c.lastSecond=-1;
    const msg=`${poseText(c.label)} 확인. 3초 뒤 자동으로 수집합니다. 자세를 유지해 주세요.`;
    note(msg);setGuideHint(msg);say(msg,'ready');
    return;
  }
  if(c.phase==='countdown') {
    const sec=Math.max(0,Math.ceil((c.countdownEnd-now)/1000));
    if(sec!==c.lastSecond) {
      c.lastSecond=sec;
      setGuideHint(`${poseText(c.label)} 수집까지 ${sec}초. 자세를 유지해 주세요.`);
      if(sec>0) chime('count');
    }
    if(now<c.countdownEnd) return;
    c.phase='recording';c.nextTime=now;
    const msg=`${poseText(c.label)} 수집 시작. 약 2초 동안 그대로 유지해 주세요.`;
    note(msg);setGuideHint(msg);say(msg,'ready');
  }
  if(c.phase!=='recording' || now<c.nextTime) return;
  samples[c.label].push([...currentFeatures.inputs]);
  c.collected++;c.nextTime=now+SAMPLE_INTERVAL_MS;
  setGuideHint(`${poseText(c.label)} ${c.collected} / ${SAMPLES_PER_CAPTURE}개 수집 중`);
  if(c.collected>=SAMPLES_PER_CAPTURE) {
    const guided=c.guided, label=c.label;
    collecting=null;
    chime('finish');
    if(guided) {
      guidedIndex++;
      if(guidedIndex<GUIDE_STEPS.length) {
        const next=GUIDE_STEPS[guidedIndex];
        const msg=`${poseText(label)} 수집 완료. 다음은 ${poseText(next)}입니다.`;
        note(msg);setGuideHint(msg);say(msg,'ready');
        guidedNextAt=now+2500;
      } else {
        const msg='선 자세와 앉은 자세를 모두 수집했습니다. 이제 신경망 학습을 시작합니다.';
        note(msg);setGuideHint(msg);say(msg,'ready');
        guidedNextAt=now+2200;
      }
    } else {
      const msg=`${poseText(label)} 12개 수집 완료! 필요하면 같은 자세를 추가 수집해 주세요.`;
      note(msg);setGuideHint(msg);say(msg,'ready');
    }
  }
  updateUI();
}
function finishGuidedCollection() {
  guidedMode=false;guidedNextAt=0;
  if (samples.standing.length >= MIN_SAMPLES_PER_POSE && samples.squatting.length >= MIN_SAMPLES_PER_POSE) {
    trainPostures(true);
  } else {
    note('수집 개수가 부족해 자동 학습을 멈췄어요. 추가 수집 후 학습해 주세요.');
    say('수집 개수가 부족합니다. 추가 수집이 필요합니다.');
  }
  updateUI();
}

function trainPostures(autoStart=false) {
  if(typeof autoStart !== 'boolean') autoStart=false;
  if (training || collecting || samples.standing.length<MIN_SAMPLES_PER_POSE || samples.squatting.length<MIN_SAMPLES_PER_POSE) {
    note('선 자세와 앉은 자세를 각각 최소 24개 이상 수집해 주세요.'); return;
  }
  autoStartAfterTraining=autoStart;
  measuring=false; training=true; trained=false; classifyPending=false;
  resetSequence(false);
  const generation=++activeTrainingGeneration;
  note('수집한 데이터로 신경망을 학습하는 중이에요. 잠시 기다려 주세요.');
  updateUI();
  try {
    nn=ml5.neuralNetwork({task:'classification',debug:false});
    for(const x of samples.standing) nn.addData(x,['standing']);
    for(const x of samples.squatting) nn.addData(x,['squatting']);
    nn.normalizeData();
    nn.train({epochs:50},()=>{
      if(generation!==activeTrainingGeneration) return;
      training=false;trained=true;latestPoseLabel=null;
      note(autoStartAfterTraining ? '학습 완료! 스쿼트 자동 측정도 시작했어요.' : '학습 완료! ④ 스쿼트 측정 시작 버튼을 눌러 주세요.');
      say(autoStartAfterTraining?'학습 완료. 스쿼트 측정을 시작합니다. 먼저 똑바로 서 주세요.':'학습이 완료되었습니다. 측정 시작 버튼을 눌러 주세요.', 'finish');
      if(autoStartAfterTraining && cameraReady) startMeasuring(true);
      autoStartAfterTraining=false;
      updateUI();
    });
  } catch (error) {
    console.error(error);training=false;
    note('학습 중 오류: '+(error?.message||error));updateUI();
  }
}

function startMeasuring(fromGuide=false) {
  if(typeof fromGuide!=='boolean') fromGuide=false;
  if(!fromGuide) unlockSound();
  if (!trained || !cameraReady || training || collecting) return;
  measuring=true;
  lastClassifyAt=0;latestPoseLabel=null;
  resetSequence(false);
  note('측정 시작! 처음에는 똑바로 서서 선 자세를 인식시킨 뒤 천천히 앉았다 일어나 보세요.');
  if(!fromGuide) say('스쿼트 측정 시작. 먼저 똑바로 서 주세요.', 'ready');
  updateUI();
}

function classifyTick() {
  if(!currentFeatures || classifyPending || millis()-lastClassifyAt<CLASSIFY_INTERVAL_MS) return;
  const input=[...currentFeatures.inputs];
  lastClassifyAt=millis();classifyPending=true;
  try {
    nn.classify(input,(...args)=>{
      classifyPending=false;
      if(!measuring || !trained) return;
      // ml5 v1: callback(results). 일부 실행 환경은 callback(error,results)를 씀.
      const results=Array.isArray(args[0])?args[0]:(Array.isArray(args[1])?args[1]:null);
      if(!results || !results.length) return;
      const top=results[0];
      latestConfidence=Number(top.confidence)||0;
      latestPoseLabel=latestConfidence>=CLASS_CONFIDENCE ? top.label : null;
      updateSequence(latestPoseLabel);
      updateUI();
    });
  } catch(error) {
    classifyPending=false;
    note('자세 분류 오류: '+(error?.message||error));
  }
}

function resetSequence(resetCount=false) {
  movementPhase='needStanding'; stableLabel=null; stableHits=0;
  if (resetCount) squatCount=0;
}

// 사람이 앉아 있는 매 프레임을 횟수로 세지 않도록 3단계 상태 머신 사용.
function updateSequence(label) {
  if (!label) {stableLabel=null;stableHits=0;return;}
  if (label===stableLabel) stableHits++;
  else {stableLabel=label;stableHits=1;}
  if (stableHits < STABLE_CLASSIFICATIONS) return;
  if (movementPhase==='needStanding' && label==='standing') {
    movementPhase='readyForSquat'; note('선 자세 확인! 이제 천천히 앉아 보세요.');say('준비 완료. 앉아 주세요.');
  } else if (movementPhase==='readyForSquat' && label==='squatting') {
    movementPhase='needReturn'; note('앉은 자세 확인! 다시 일어나 주세요.');say('앉은 자세 확인. 다시 일어나 주세요.');
  } else if (movementPhase==='needReturn' && label==='standing') {
    squatCount++;
    movementPhase='readyForSquat';
    note(`스쿼트 ${squatCount}회 성공! 다음 반복을 시작할 수 있어요.`);
    say(`${squatCount}회`,'count');
  }
  // 한 번 처리한 상태를 다른 프레임에서 여러 번 적용하지 않아도 상태 단계가 달라진다.
}

function updateUI() {
  const ready=cameraReady&&!loadingCamera;
  elem('start-camera').disabled=ready||loadingCamera;
  elem('stop-camera').disabled=!ready&&!loadingCamera;
  elem('capture-standing').disabled=!ready||!!collecting||training||guidedMode;
  elem('capture-squatting').disabled=!ready||!!collecting||training||guidedMode;
  elem('guided-start').disabled=!ready||training||guidedMode||!!collecting;
  elem('guided-cancel').disabled=!guidedMode;
  elem('guided-progress').textContent=guidedMode ? `단계 ${Math.min(4,guidedIndex+1)} / 4` : training ? '학습 중' : measuring ? '측정 중' : '시작 대기';
  elem('train-button').disabled=training||guidedMode||!!collecting||samples.standing.length<MIN_SAMPLES_PER_POSE||samples.squatting.length<MIN_SAMPLES_PER_POSE;
  elem('measure-button').disabled=!trained||!ready||training||!!collecting||measuring;
  elem('pause-measure').disabled=!measuring;
  elem('export-data').disabled=!(samples.standing.length||samples.squatting.length);
  elem('standing-count').textContent=samples.standing.length;
  elem('squatting-count').textContent=samples.squatting.length;
  elem('standing-fill').style.width=Math.min(100,samples.standing.length/36*100)+'%';
  elem('squatting-fill').style.width=Math.min(100,samples.squatting.length/36*100)+'%';
  elem('model-status').textContent=training?'신경망 학습 중':trained?'학습 완료':loadingCamera?'BodyPose 로딩 중':ready?'BodyPose 준비됨':'연결 전';
  elem('joints-state').textContent=poses.length?`${poses[0].keypoints?.filter(p=>score(p)>=JOINT_CONFIDENCE).length||0}개 감지`:'사람 찾는 중';
  elem('pose-quality').textContent=currentFeatures?'학습 가능 · 3관절':'관절 확인 필요';
  elem('tracking-detail').textContent=trackingDiagnostic;
  elem('recognized-pose').textContent=!trained?'학습 전':!measuring?'측정 대기':!currentFeatures?'관절 위치 확인':latestPoseLabel==='standing'?'서 있는 자세':latestPoseLabel==='squatting'?'앉은 자세':'자세 확인 중';
  elem('recognition-confidence').textContent=measuring && latestPoseLabel ? Math.round(latestConfidence*100)+'%' : '--';
  elem('squat-count').textContent=squatCount;
  elem('sequence-text').textContent=!measuring?'선 자세 → 앉은 자세 → 선 자세':
    movementPhase==='needStanding'?'① 먼저 서 있는 자세를 보여 주세요':
    movementPhase==='readyForSquat'?'② 준비 완료 — 앉아 주세요':'③ 앉기 확인 — 다시 일어나 주세요';
  if(collecting) setStatus(collecting.phase==='recording'?`수집 중 ${collecting.collected}/${SAMPLES_PER_CAPTURE}`:`${poseText(collecting.label)} 확인 대기`);
  else if(cameraReady) setStatus(currentFeatures?'BodyPose 주요 관절 인식 중':'어깨·골반·무릎 인식 확인 중');
  elem('camera-help').textContent=!ready?'카메라 시작 버튼을 누르고 권한을 허용해 주세요.':
    currentFeatures?'관절이 몸을 제대로 따라오면 선 자세부터 등록해 주세요.':
    '전신이 보이는데 인식이 안 된다면 BODY CHECK의 관절별 수치를 확인해 주세요. 학습은 어깨·골반·무릎으로 진행해요.';
}

function exportJSON() {
  const data={app:'MOVE:US SQUAT LAB',featureVersion:FEATURE_VERSION, samples};
  saveJSON(data,'MOVE-US-squat-training-data.json');
  note('학습 데이터(JSON)를 컴퓨터에 저장했어요. 카메라 영상은 포함되지 않아요.');
}

async function importJSON(event) {
  const file=event.target.files?.[0];
  if(!file) return;
  try {
    const data=JSON.parse(await file.text());
    if(data.featureVersion!==FEATURE_VERSION) throw new Error('특징 버전이 다른 파일이에요.');
    for(const label of ['standing','squatting']) {
      if(!Array.isArray(data.samples?.[label]) ||
         !data.samples[label].every(x=>Array.isArray(x)&&x.length===8&&x.every(Number.isFinite))) {
        throw new Error('학습 데이터 형식이 올바르지 않아요.');
      }
    }
    samples={standing:data.samples.standing.map(x=>[...x]),squatting:data.samples.squatting.map(x=>[...x])};
    trained=false;training=false;measuring=false;nn=null;classifyPending=false;
    resetSequence(false);updateUI();
    note('JSON 불러오기 완료! 카메라를 켠 뒤 ③ 학습 버튼을 눌러 주세요.');
  } catch(error) {note('파일을 불러올 수 없어요: '+(error?.message||error));}
  event.target.value='';
}
