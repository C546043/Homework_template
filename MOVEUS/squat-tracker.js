// MOVE:US v11 integration — 스쿼트만 실제 BodyPose로 조작 (훈련된 데이터 48개).
// 학교 HandPose 예제 및 성공적으로 측정한 MOVE:US SQUAT LAB의 알고리즘 유지.
// 게임의 p5 setup/draw를 새로 선언하지 않고 기존 함수에서 호출합니다.
// 네트워크/브라우저 저장 없음. JSON은 Live Server에서 읽기만 합니다.

const SQUAT_VIEW_W = 640;
const SQUAT_VIEW_H = 480;
const SQUAT_JOINT_CONFIDENCE = 0.25;
const SQUAT_DRAW_CONFIDENCE = 0.12;
const SQUAT_CLASS_CONFIDENCE = 0.68;
const SQUAT_CLASSIFY_INTERVAL = 180;
const SQUAT_STABLE_HITS = 3;
const SQUAT_LOST_RESET_MS = 1400;
const SQUAT_FEATURE_VERSION = 'squat-8-features-v2-three-point';
const SQUAT_JOINTS = {
  left: { shoulder: 5, hip: 11, knee: 13, ankle: 15 },
  right: { shoulder: 6, hip: 12, knee: 14, ankle: 16 }
};
const SQUAT_LINKS = [
  [5,6], [5,7], [7,9], [6,8], [8,10],
  [5,11], [6,12], [11,12], [11,13], [13,15], [12,14], [14,16]
];

let squatVideo = null;
let squatBodyPose = null;
let squatPoses = [];
let squatNet = null;
let squatNetTrained = false;
let squatCameraActive = false;
let squatCameraLoading = false;
let squatPending = 0;
let squatCountRecognized = 0;
let squatPhase = 'needStanding';
let squatStableLabel = null;
let squatStableHits = 0;
let squatLastPoseAt = 0;
let squatLastClassifyAt = 0;
let squatClassifyPending = false;
let squatLabel = null;
let squatConfidence = 0;
let squatFrameResults = 0;
let squatGeneration = 0;
let squatAudioContext = null;
let squatDrag = null;

const squatElement = id => document.getElementById(id);
const squatScore = kp => Number(kp?.confidence ?? kp?.score ?? 0);
const squatClamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function squatSetStatus(state, message) {
  const status = squatElement('squat-signal');
  const note = squatElement('squat-notice');
  if (status) status.textContent = state;
  if (note && message) note.textContent = message;
}

function initSquatTracker() {
  const panel = squatElement('squat-panel');
  if (!panel) return;
  squatElement('squat-start').addEventListener('click', startSquatCamera);
  squatElement('squat-stop').addEventListener('click', () => stopSquatCamera());
  squatElement('squat-size').addEventListener('input', event => {
    const w = Number(event.target.value) || 390;
    panel.style.width = `min(${w}px, calc(100vw - 32px))`;
    keepSquatPanelOnScreen();
  });
  // 카메라 패널은 끌어서 옮길 수 있습니다. 드래그 손잡이는 상단 제목입니다.
  const handle = squatElement('squat-panel-drag');
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const bounds = panel.getBoundingClientRect();
    panel.style.left = `${bounds.left}px`;
    panel.style.top = `${bounds.top}px`;
    panel.style.right = 'auto';
    squatDrag = {x:event.clientX, y:event.clientY, left:bounds.left, top:bounds.top};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!squatDrag) return;
    panel.style.left = `${squatClamp(squatDrag.left+event.clientX-squatDrag.x, 0, Math.max(0,window.innerWidth-panel.offsetWidth))}px`;
    panel.style.top = `${squatClamp(squatDrag.top+event.clientY-squatDrag.y, 0, Math.max(0,window.innerHeight-52))}px`;
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) handle.addEventListener(name, () => {squatDrag=null;});
  window.addEventListener('resize', keepSquatPanelOnScreen);
  const ctx = squatElement('squat-preview')?.getContext('2d');
  if (ctx) {ctx.fillStyle='#213b45';ctx.fillRect(0,0,640,480);ctx.font='17px monospace';ctx.fillStyle='#e5eed7';ctx.textAlign='center';ctx.fillText('CAMERA OFF',320,242);}
}

function keepSquatPanelOnScreen() {
  const p=squatElement('squat-panel');
  if (!p || !p.style.left) return;
  p.style.left=`${squatClamp(parseFloat(p.style.left)||0,0,Math.max(0,innerWidth-p.offsetWidth))}px`;
  p.style.top=`${squatClamp(parseFloat(p.style.top)||0,0,Math.max(0,innerHeight-52))}px`;
}

function onSquatScreenChange(next) {
  if (next !== 'game') {
    stopSquatCamera(true);
  }
  // 새 게임에 들어와서도 이미 훈련된 신경망은 페이지 메모리에만 유지됩니다.
}

function resetSquatTrackerRound(count=0) {
  squatPending=0;
  squatCountRecognized=count;
  squatPhase='needStanding';
  squatStableLabel=null;
  squatStableHits=0;
  squatLabel=null;
  squatLastPoseAt=Date.now();
  const countElement=squatElement('squat-live-count');
  if (countElement) countElement.textContent=`${count} / 10`;
}

function unlockSquatAudio() { /* STEP 16: 음성/효과음 모두 사용하지 않음 */ }
function squatBeep() { /* 사운드 없이 시각 효과만 사용 */ }

function squatKeypoint(pose,index) {
  const kp=pose?.keypoints?.[index];
  return kp && Number.isFinite(kp.x)&&Number.isFinite(kp.y) ? kp : null;
}
function squatCoordSize(pose) {
  const rawW = Number(squatVideo?.elt?.videoWidth) || SQUAT_VIEW_W;
  const rawH = Number(squatVideo?.elt?.videoHeight) || SQUAT_VIEW_H;
  const pts = pose?.keypoints || [];
  const maxX = Math.max(0,...pts.map(p=>Number(p.x)||0));
  const maxY = Math.max(0,...pts.map(p=>Number(p.y)||0));
  const originalSpace=(maxX>SQUAT_VIEW_W+4 || maxY>SQUAT_VIEW_H+4) && rawW>0 && rawH>0;
  return originalSpace ? {width:rawW,height:rawH} : {width:SQUAT_VIEW_W,height:SQUAT_VIEW_H};
}
function squatAngle(a,b,c) {
  const ax=a.x-b.x, ay=a.y-b.y, cx=c.x-b.x, cy=c.y-b.y;
  const d=Math.hypot(ax,ay)*Math.hypot(cx,cy);
  if(d<0.0001) return 0;
  return Math.acos(squatClamp((ax*cx+ay*cy)/d,-1,1))*180/Math.PI;
}

// 이 특징 8개는 사용자가 정상적으로 성공한 SQUAT LAB과 동일한 순서/산식입니다.
function squatMakeFeatures(pose) {
  if (!pose?.keypoints?.length) return null;
  const dimensions=squatCoordSize(pose);
  const candidates=[];
  for(const [sideName,side] of Object.entries(SQUAT_JOINTS)) {
    const shoulder=squatKeypoint(pose,side.shoulder);
    const hip=squatKeypoint(pose,side.hip);
    const knee=squatKeypoint(pose,side.knee);
    const required=[shoulder,hip,knee];
    if(required.some(p=>!p || squatScore(p)<SQUAT_JOINT_CONFIDENCE)) continue;
    if(required.some(p=>p.x<0||p.x>dimensions.width||p.y<0||p.y>dimensions.height)) continue;
    const torso=Math.hypot(shoulder.x-hip.x,shoulder.y-hip.y);
    if(torso<12) continue;
    const features=[
      (shoulder.y+hip.y)/(2*dimensions.height),
      shoulder.y/dimensions.height,
      hip.y/dimensions.height,
      knee.y/dimensions.height,
      (knee.y-hip.y)/dimensions.height,
      (hip.y-shoulder.y)/dimensions.height,
      Math.abs(knee.x-hip.x)/dimensions.width,
      squatAngle(shoulder,hip,knee)/180
    ];
    if(features.every(x=>Number.isFinite(x)&&Math.abs(x)<3)) {
      candidates.push({inputs:features,quality:required.reduce((s,p)=>s+squatScore(p),0)/3,side:sideName});
    }
  }
  candidates.sort((a,b)=>b.quality-a.quality);
  return candidates[0]||null;
}

async function squatLoadAndTrain() {
  if (squatNetTrained && squatNet) return;
  squatSetStatus('학습 준비','저장한 선 자세 24개·앉은 자세 24개를 불러오는 중이에요.');
  const r=await fetch('./MOVE-US-squat-training-data.json',{cache:'no-store'});
  if (!r.ok) throw new Error('학습 데이터 JSON을 읽지 못했습니다. Live Server로 실행하고 JSON 파일이 같은 폴더에 있는지 확인해 주세요.');
  const data=await r.json();
  if (data.featureVersion!==SQUAT_FEATURE_VERSION) throw new Error('학습 데이터 특징 버전이 다릅니다.');
  for(const name of ['standing','squatting']) {
    if (!Array.isArray(data.samples?.[name]) || data.samples[name].length<24 ||
        !data.samples[name].every(x=>Array.isArray(x)&&x.length===8&&x.every(Number.isFinite))) {
      throw new Error(`${name} 학습 데이터 형식이 올바르지 않아요.`);
    }
  }
  squatSetStatus('신경망 학습 중','수집된 48개 샘플로 기존 SQUAT LAB과 같은 분류기를 학습하는 중이에요.');
  const net=ml5.neuralNetwork({task:'classification',debug:false});
  for(const row of data.samples.standing) net.addData(row,['standing']);
  for(const row of data.samples.squatting) net.addData(row,['squatting']);
  net.normalizeData();
  await new Promise((resolve,reject)=>{
    try {net.train({epochs:50},resolve);} catch(e) {reject(e);}
  });
  squatNet=net;
  squatNetTrained=true;
}

async function squatWaitVideoReady(capture) {
  const elt=capture?.elt;
  if (!elt) throw new Error('카메라 영상 객체를 생성하지 못했습니다.');
  if (elt.readyState>=2 && elt.videoWidth>0) return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{cleanup();reject(new Error('카메라 영상 준비 시간이 초과됐습니다. 카메라 권한을 확인해 주세요.'));},12000);
    const check=()=>{if(elt.readyState>=2&&elt.videoWidth>0){cleanup();resolve();}};
    const fail=()=>{cleanup();reject(new Error('웹캠 영상에 접근하지 못했습니다.'));};
    const cleanup=()=>{clearTimeout(timer);elt.removeEventListener('loadeddata',check);elt.removeEventListener('error',fail);};
    elt.addEventListener('loadeddata',check);
    elt.addEventListener('error',fail);
    check();
  });
}

async function startSquatCamera() {
  if (squatCameraLoading || squatCameraActive) return;
  squatCameraLoading=true;
  squatElement('squat-start').disabled=true;
  const generation=++squatGeneration;
  squatSetStatus('준비 중','카메라 권한과 모델 로딩을 확인하는 중입니다. 처음에는 시간이 조금 걸릴 수 있어요.');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라 지원이 없습니다. Live Server(http://127.0.0.1)에서 실행해 주세요.');
    if (typeof ml5==='undefined') throw new Error('ml5.js가 로드되지 않았습니다. 인터넷 연결을 확인해 주세요.');
    // 성공한 SQUAT LAB과 동일: p5 캡처로 640x480을 요청하고 숨겨 둡니다.
    squatVideo=createCapture(VIDEO);
    squatVideo.size(SQUAT_VIEW_W,SQUAT_VIEW_H);
    squatVideo.hide();
    await squatWaitVideoReady(squatVideo);
    if (generation!==squatGeneration) return;

    // 검출기를 사용하기 전에 TensorFlow 모델이 실제로 준비됐는지 기다립니다.
    squatSetStatus('모델 로딩','BodyPose 정확도 우선(Thunder) 모델을 준비하는 중이에요.');
    squatBodyPose=ml5.bodyPose('MoveNet',{
      modelType:'SINGLEPOSE_THUNDER', enableSmoothing:true,minPoseScore:0.15
    });
    if(!squatBodyPose?.ready) throw new Error('BodyPose.ready를 찾을 수 없습니다. ml5.js 버전을 확인해 주세요.');
    await squatBodyPose.ready;
    if(generation!==squatGeneration) return;
    if(!squatBodyPose.model || typeof squatBodyPose.model.estimatePoses!=='function') {
      throw new Error('BodyPose 모델 초기화에 실패했습니다.');
    }

    squatBodyPose.detectStart(squatVideo, results=>{
      if(generation!==squatGeneration) return;
      squatPoses=Array.isArray(results)?results:[];
      squatFrameResults++;
    });
    await squatLoadAndTrain();
    if(generation!==squatGeneration) return;
    // 한 카메라 / BodyPose를 스쿼트와 푸시업이 함께 사용합니다.
    // 푸시업 모델 로딩 오류가 나도 이미 정상 작동하는 스쿼트는 그대로 유지합니다.
    if (typeof pushupLoadAndTrain === 'function') {
      try { await pushupLoadAndTrain(); }
      catch (error) {
        if (typeof pushupReportTrainingError === 'function') pushupReportTrainingError(error);
        console.error('[MOVE:US] 푸시업 데이터 또는 학습 오류:',error);
      }
    }
    if(generation!==squatGeneration) return;
    squatCameraActive=true;
    resetSquatTrackerRound(jumpCount);
    squatElement('squat-stop').disabled=false;
    squatSetStatus('인식 중','학습 완료! 카메라 앞에 전신을 보이고 선 자세 → 앉은 자세 → 선 자세로 운동해 주세요.');
  } catch(e) {
    console.error('[MOVE:US] 스쿼트 카메라 오류:',e);
    squatSetStatus('연결 실패',String(e?.message||e));
    stopSquatCamera(true);
  } finally {
    if(generation===squatGeneration) {
      squatCameraLoading=false;
      squatElement('squat-start').disabled=squatCameraActive;
    }
  }
}

function stopSquatCamera(silent=false) {
  // 현재 페이지 메모리에 학습된 신경망만 남기고 영상과 모델은 정리합니다.
  squatGeneration++;
  try {squatBodyPose?.detectStop?.();} catch(e) {console.warn('BodyPose stop:',e);}
  if(squatVideo?.elt?.srcObject) {
    try {for(const t of squatVideo.elt.srcObject.getTracks()) t.stop();} catch(e) {console.warn(e);}
  }
  try {squatVideo?.remove?.();} catch(e) {console.warn(e);}
  squatVideo=null;squatBodyPose=null;squatPoses=[];
  squatCameraActive=false;squatCameraLoading=false;
  squatClassifyPending=false;
  squatLabel=null;squatStableLabel=null;squatStableHits=0;
  const start=squatElement('squat-start'), stop=squatElement('squat-stop');
  if (start) start.disabled=false;
  if (stop) stop.disabled=true;
  if(!silent) squatSetStatus('카메라 꺼짐','스쿼트 인식이 멈췄어요. 다시 시작하면 같은 자세 데이터로 측정할 수 있어요.');
}

function squatConfirm(label) {
  if(!label) {squatStableLabel=null;squatStableHits=0;return;}
  if(label===squatStableLabel) squatStableHits++;
  else {squatStableLabel=label;squatStableHits=1;}
  if(squatStableHits<SQUAT_STABLE_HITS) return;
  if(squatPhase==='needStanding' && label==='standing') {
    squatPhase='readyForSquat';
  } else if(squatPhase==='readyForSquat' && label==='squatting') {
    squatPhase='needReturn';
  } else if(squatPhase==='needReturn' && label==='standing') {
    squatPhase='readyForSquat';
    if(screenMode==='game' && gamePhase==='jump' && !gamePaused && jumpCount+squatPending<JUMP_TOTAL) {
      squatPending++;
      squatCountRecognized++;
      squatBeep();
      squatSetStatus('1회 인식!',`스쿼트 ${squatCountRecognized}회 인식 · 점프 대기 ${squatPending}회`);
    }
  }
}

function squatClassifyTick(features) {
  if(!features || !squatNetTrained || !squatNet || squatClassifyPending ||
     Date.now()-squatLastClassifyAt<SQUAT_CLASSIFY_INTERVAL) return;
  squatClassifyPending=true;
  squatLastClassifyAt=Date.now();
  try {
    squatNet.classify([...features.inputs],(...args)=>{
      squatClassifyPending=false;
      if(!squatCameraActive || !squatNetTrained || gamePhase!=='jump') return;
      const results=Array.isArray(args[0])?args[0]:(Array.isArray(args[1])?args[1]:null);
      if(!results?.length) return;
      const top=results[0];
      squatConfidence=Number(top.confidence)||0;
      squatLabel=squatConfidence>=SQUAT_CLASS_CONFIDENCE?top.label:null;
      squatConfirm(squatLabel);
    });
  } catch(e) {squatClassifyPending=false;console.warn('스쿼트 분류 오류:',e);}
}

function squatDrawPreview() {
  const canvas=squatElement('squat-preview');
  const ctx=canvas?.getContext('2d');
  if(!ctx) return;
  ctx.clearRect(0,0,SQUAT_VIEW_W,SQUAT_VIEW_H);
  ctx.fillStyle='#213b45';ctx.fillRect(0,0,SQUAT_VIEW_W,SQUAT_VIEW_H);
  const source=squatVideo?.elt;
  if(!source || source.readyState<2 || !source.videoWidth) {
    ctx.font='17px monospace';ctx.fillStyle='#e5eed7';ctx.textAlign='center';
    ctx.fillText(squatCameraLoading?'CAMERA LOADING...':'CAMERA OFF',320,245);
    return;
  }
  const iw=source.videoWidth, ih=source.videoHeight;
  const ratio=Math.min(SQUAT_VIEW_W/iw,SQUAT_VIEW_H/ih);
  const dw=iw*ratio, dh=ih*ratio;
  const dx=(SQUAT_VIEW_W-dw)/2,dy=(SQUAT_VIEW_H-dh)/2;
  ctx.save();
  if(squatElement('squat-mirror')?.checked) {ctx.translate(SQUAT_VIEW_W,0);ctx.scale(-1,1);}
  // object-fit: contain과 동일한 계산: 모든 영상 프레임이 보이고 잘리는 곳은 없습니다.
  ctx.drawImage(source,dx,dy,dw,dh);
  const pose=squatPoses[0];
  if(pose && squatElement('squat-points')?.checked) {
    const dimensions=squatCoordSize(pose);
    ctx.translate(dx,dy);ctx.scale(dw/dimensions.width,dh/dimensions.height);
    ctx.lineWidth=2;ctx.strokeStyle='#FFD178';ctx.fillStyle='#73F4B0';
    for(const [ia,ib] of SQUAT_LINKS) {
      const a=pose.keypoints?.[ia],b=pose.keypoints?.[ib];
      if(squatScore(a)>SQUAT_DRAW_CONFIDENCE&&squatScore(b)>SQUAT_DRAW_CONFIDENCE) {
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
    }
    for(const kp of pose.keypoints||[]) if(squatScore(kp)>SQUAT_DRAW_CONFIDENCE) {
      ctx.beginPath();ctx.arc(kp.x,kp.y,3,0,Math.PI*2);ctx.fill();
    }
  }
  ctx.restore();
}

function updateSquatTracker() {
  if(screenMode!=='game') return;
  squatDrawPreview();
  const count=squatElement('squat-live-count');
  const forPushup = ['wallTransition','wall','wallRest'].includes(gamePhase);
  const title=squatElement('tracking-exercise-title');
  if(title) title.textContent=forPushup ? 'BODY TRACKING · KNEE PUSH-UP' : gamePhase==='jump' ? 'BODY TRACKING · SQUAT' : 'BODY TRACKING · CAMERA';
  if(count && !forPushup) count.textContent=`${Math.min(10,jumpCount+squatPending)} / 10`;
  const info=squatElement('squat-notice');
  if(info) info.textContent=forPushup
    ? '무릎 대고 푸시업: 팔 편 자세 → 굽힌 자세 → 편 자세 = 벽 1개. 10회 × 2세트. 영상은 저장되지 않습니다.'
    : gamePhase==='jump' ? '직접 학습한 스쿼트 자세 48개로 점프합니다. 영상은 저장되지 않습니다.'
    : '카메라는 계속 켜져 있어도 됩니다. 현재 미션은 개발용 스페이스바 조작을 지원합니다.';
  if(!squatCameraActive) return;
  if(gamePhase==='jump' && !gamePaused) {
    // 점프 애니메이션(0.64초) 중에 다음 스쿼트가 잡혀도 큐에 남겨 둡니다.
    if(squatPending>0 && !jumpAnimation && !spaceHeld && jumpCount<JUMP_TOTAL) {
      onActionDown();
      onActionUp();
      if(jumpAnimation) squatPending--;
    }
    const feature=squatPoses.length?squatMakeFeatures(squatPoses[0]):null;
    if(feature) {
      squatLastPoseAt=Date.now();
      squatClassifyTick(feature);
    } else if(Date.now()-squatLastPoseAt>SQUAT_LOST_RESET_MS) {
      squatStableLabel=null;squatStableHits=0;squatPhase='needStanding';squatLabel=null;
    }
    const status=squatElement('squat-pose-label');
    if(status) status.textContent = !squatPoses.length?'사람 인식 대기':!feature?'주요 관절 확인 중':
      squatLabel==='standing'?'선 자세 인식 중':squatLabel==='squatting'?'앉은 자세 인식 중':'동작을 확인하고 있어요';
  } else {
    const status=squatElement('squat-pose-label');
    if(status) status.textContent='스쿼트 구간 완료 · 다음 운동 진행 중';
  }
}
