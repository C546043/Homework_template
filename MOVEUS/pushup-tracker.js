// MOVE:US STEP 14 — 성공한 KNEE PUSH-UP LAB의 학습 데이터 48개를 기존 게임 벽 부수기에 연결.
// 스쿼트와 같은 카메라 및 BodyPose 인스턴스 사용. 새 카메라/검출기 생성 없음.
// 무릎 대고 팔 펴기(up) -> 팔 굽히기(down) -> 다시 펴기(up) = 벽 1개.
// 10개 × 2세트, 세트 사이 휴식은 60초 자동 타이머. 기존 스페이스바 테스트 유지.

const PUSHUP_FEATURE_VERSION='knee-pushup-8-features-v1-arm';
const PUSHUP_JOINT_CONFIDENCE=0.24;
const PUSHUP_CLASS_CONFIDENCE=0.67;
const PUSHUP_STABLE_CLASSIFICATIONS=3;
const PUSHUP_CLASSIFY_INTERVAL_MS=190;
const PUSHUP_LOST_POSE_RESET_MS=1500;
const PUSHUP_SIDES={
  left:{shoulder:5,elbow:7,wrist:9,hip:11,knee:13},
  right:{shoulder:6,elbow:8,wrist:10,hip:12,knee:14}
};

let pushupNet=null;
let pushupNetTrained=false;
let pushupTrainingPromise=null;
let pushupTrainingError='';
let pushupPending=0;
let pushupRecognized=0;
let pushupPhase='needUp';
let pushupStableLabel=null;
let pushupStableHits=0;
let pushupLastPoseAt=0;
let pushupLastClassifyAt=0;
let pushupClassifyPending=false;
let pushupLabel=null;
let pushupConfidence=0;
let pushupGeneration=0;
let pushupLastPhase='';

function initPushupTracker(){
  // STEP 16: 세트 전환은 60초 카운트다운 후 자동 시작합니다.
}
function pushupReportTrainingError(error){
  pushupTrainingError=String(error?.message||error||'학습 오류');
}

// KNEE PUSH-UP LAB의 makeArmInputs와 8개 값의 산식 및 순서를 동일하게 유지.
function pushupMakeFeatures(pose){
  if(!pose?.keypoints?.length)return null;
  const dim=squatCoordSize(pose); // 원본 640x480 또는 실제 영상 좌표 검사 (LAB의 coordSize와 동일)
  const candidates=[];
  for(const [sideName,side] of Object.entries(PUSHUP_SIDES)){
    const shoulder=squatKeypoint(pose,side.shoulder);
    const elbow=squatKeypoint(pose,side.elbow);
    const wrist=squatKeypoint(pose,side.wrist);
    const required=[shoulder,elbow,wrist];
    if(required.some(p=>!p||squatScore(p)<PUSHUP_JOINT_CONFIDENCE))continue;
    if(required.some(p=>p.x<0||p.x>dim.width||p.y<0||p.y>dim.height))continue;
    const upper=Math.hypot(shoulder.x-elbow.x,shoulder.y-elbow.y);
    const lower=Math.hypot(wrist.x-elbow.x,wrist.y-elbow.y);
    if(upper<10||lower<10)continue;
    const features=[
      squatAngle(shoulder,elbow,wrist)/180,
      shoulder.y/dim.height,
      elbow.y/dim.height,
      wrist.y/dim.height,
      (shoulder.y-wrist.y)/dim.height,
      Math.abs(elbow.y-shoulder.y)/dim.height,
      Math.abs(shoulder.x-wrist.x)/dim.width,
      Math.abs(elbow.x-wrist.x)/dim.width
    ];
    if(!features.every(n=>Number.isFinite(n)&&Math.abs(n)<3))continue;
    candidates.push({inputs:features,quality:required.reduce((s,p)=>s+squatScore(p),0)/3,side:sideName});
  }
  candidates.sort((a,b)=>b.quality-a.quality);
  return candidates[0]||null;
}

function pushupLoadAndTrain(){
  if(pushupNetTrained&&pushupNet)return Promise.resolve();
  if(pushupTrainingPromise)return pushupTrainingPromise;
  const job=(async()=>{
    pushupTrainingError='';
    const r=await fetch('./MOVE-US-knee-pushup-training-data.json',{cache:'no-store'});
    if(!r.ok)throw new Error('푸시업 학습 데이터 JSON을 불러오지 못했어요. 파일명과 Live Server 실행을 확인해 주세요.');
    const data=await r.json();
    if(data.featureVersion!==PUSHUP_FEATURE_VERSION)throw new Error('푸시업 학습 데이터의 특징 버전이 다릅니다.');
    for(const name of ['up','down']){
      if(!Array.isArray(data.samples?.[name])||data.samples[name].length<24||
         !data.samples[name].every(row=>Array.isArray(row)&&row.length===8&&row.every(Number.isFinite))){
        throw new Error(`${name} 자세 샘플이 24개 이상이며 8개 숫자여야 합니다.`);
      }
    }
    const net=ml5.neuralNetwork({task:'classification',debug:false});
    for(const row of data.samples.up)net.addData(row,['up']);
    for(const row of data.samples.down)net.addData(row,['down']);
    net.normalizeData();
    await new Promise((resolve,reject)=>{
      try{net.train({epochs:50},resolve);}catch(error){reject(error);}
    });
    pushupNet=net;
    pushupNetTrained=true;
  })();
  pushupTrainingPromise=job;
  return job.finally(()=>{if(pushupTrainingPromise===job)pushupTrainingPromise=null;});
}

function resetPushupSequence(){
  pushupPhase='needUp';
  pushupStableLabel=null;
  pushupStableHits=0;
  pushupLabel=null;
  pushupClassifyPending=false;
  pushupLastPoseAt=Date.now();
  pushupGeneration++;
}
function resetPushupTrackerRound(count=0){
  pushupPending=0;
  pushupRecognized=count;
  resetPushupSequence();
  pushupLastPhase='';
}
function onPushupScreenChange(next){
  if(next!=='game'){
    pushupPending=0;
    resetPushupSequence();
    pushupLastPhase='';
  }
  renderPushupRest();
}
function renderPushupRest(){
  // 이전 버전의 수동 버튼 팝업을 더 이상 표시하지 않습니다.
  const overlay=document.getElementById('pushup-rest');
  if(overlay)overlay.classList.add('hidden');
}
function onPushupSetRest(){
  pushupPending=0;
  resetPushupSequence();
}
function startPushupSecondSet(){
  if(screenMode!=='game'||gamePhase!=='wallRest'||gamePaused||wallCount!==WALL_REPS_PER_SET)return;
  pushupPending=0;
  resetPushupSequence();
  gamePhase='wall';
  clearBanner();
  setBanner('푸시업 2세트 시작! 10개 벽을 더 부숴 보세요.',false,2.3);
  saveProgress();
  renderPushupRest();
  updateMissionHud();
}
function onPushupMissionComplete(){
  pushupPending=0;
  resetPushupSequence();
}

// 성공한 KNEE PUSH-UP LAB의 연속 3회 판정 및 상태 전이를 그대로 적용합니다.
function pushupConfirm(label){
  if(!label){pushupStableLabel=null;pushupStableHits=0;return;}
  if(label===pushupStableLabel)pushupStableHits++;
  else{pushupStableLabel=label;pushupStableHits=1;}
  if(pushupStableHits<PUSHUP_STABLE_CLASSIFICATIONS)return;
  if(pushupPhase==='needUp'&&label==='up'){
    pushupPhase='needDown';
  }else if(pushupPhase==='needDown'&&label==='down'){
    pushupPhase='needReturn';
  }else if(pushupPhase==='needReturn'&&label==='up'){
    pushupPhase='needDown';
    if(screenMode==='game'&&gamePhase==='wall'&&!gamePaused){
      const setCeiling=wallCount<WALL_REPS_PER_SET?WALL_REPS_PER_SET:WALL_TOTAL;
      if(wallCount+pushupPending<setCeiling){
        pushupPending++;
        pushupRecognized++;
        squatBeep();
        squatSetStatus('푸시업 1회!',`무릎 푸시업 ${pushupRecognized}/${WALL_TOTAL}회 인식 · 벽 파괴 대기 ${pushupPending}회`);
      }
    }
  }
}
function pushupClassifyTick(feature){
  if(!feature||!pushupNetTrained||!pushupNet||pushupClassifyPending||
    Date.now()-pushupLastClassifyAt<PUSHUP_CLASSIFY_INTERVAL_MS)return;
  pushupClassifyPending=true;
  pushupLastClassifyAt=Date.now();
  const generation=pushupGeneration;
  try{
    pushupNet.classify([...feature.inputs],(...args)=>{
      pushupClassifyPending=false;
      if(generation!==pushupGeneration||!squatCameraActive||gamePhase!=='wall'||gamePaused)return;
      const results=Array.isArray(args[0])?args[0]:Array.isArray(args[1])?args[1]:null;
      if(!results?.length)return;
      const top=results[0];
      pushupConfidence=Number(top.confidence)||0;
      pushupLabel=pushupConfidence>=PUSHUP_CLASS_CONFIDENCE?top.label:null;
      pushupConfirm(pushupLabel);
    });
  }catch(error){pushupClassifyPending=false;console.warn('푸시업 분류 오류:',error);}
}

function updatePushupTracker(){
  renderPushupRest();
  if(screenMode!=='game')return;
  const inPushup=['wallTransition','wall','wallRest'].includes(gamePhase);
  if(!inPushup){pushupLastPhase=gamePhase;return;}
  const count=squatElement('squat-live-count');
  const state=squatElement('squat-pose-label');
  const title=squatElement('tracking-exercise-title');
  if(title)title.textContent='BODY TRACKING · KNEE PUSH-UP';
  const pendingCount=Math.min(WALL_TOTAL,wallCount+pushupPending);
  const setNumber=gamePhase==='wallRest'?1:pendingCount<WALL_REPS_PER_SET?1:2;
  const setReps=gamePhase==='wallRest'?WALL_REPS_PER_SET:pendingCount%WALL_REPS_PER_SET;
  if(count)count.textContent=`SET ${setNumber}/${WALL_SETS} · ${setReps}/${WALL_REPS_PER_SET}`;
  if(gamePhase!==pushupLastPhase){
    if(gamePhase==='wallTransition') squatSetStatus('푸시업 준비','다음은 무릎 푸시업 · 10회씩 2세트예요.');
    if(gamePhase==='wall' && squatCameraActive && pushupNetTrained) squatSetStatus('푸시업 인식 중','팔 편 자세 → 굽힌 자세 → 편 자세 = 벽 하나');
    if(gamePhase==='wall' && pushupLastPhase==='wallTransition'){
      resetPushupSequence();
    }
    pushupLastPhase=gamePhase;
  }
  if(gamePhase==='wallRest'){
    if(state)state.textContent='1세트 완료 · 60초 휴식 후 자동으로 2세트 시작';
    return;
  }
  if(!squatCameraActive){
    if(state)state.textContent='카메라를 켜면 푸시업을 인식할 수 있어요.';
    return;
  }
  if(!pushupNetTrained){
    if(state)state.textContent=pushupTrainingError?`푸시업 학습 실패: ${pushupTrainingError}`:'푸시업 데이터 학습 중';
    return;
  }
  if(gamePhase==='wallTransition'){
    if(state)state.textContent='푸시업 구간으로 이동 중 · 팔 관절 준비';
    return;
  }
  if(gamePaused){if(state)state.textContent='일시정지 중';return;}
  // 점프와 벽 파괴 애니메이션은 모두 1인식=1액션으로 연결하고 중복 입력을 제한합니다.
  if(pushupPending>0&&!wallAnimation&&!spaceHeld&&wallCount<WALL_TOTAL){
    onActionDown();onActionUp();
    if(wallAnimation)pushupPending--;
  }
  const feature=squatPoses.length?pushupMakeFeatures(squatPoses[0]):null;
  if(feature){
    pushupLastPoseAt=Date.now();
    pushupClassifyTick(feature);
  }else if(Date.now()-pushupLastPoseAt>PUSHUP_LOST_POSE_RESET_MS){
    resetPushupSequence();
  }
  if(state)state.textContent=!squatPoses.length?'사람 인식 대기':!feature?'어깨·팔꿈치·손목 관절 확인 중':
    pushupLabel==='up'?'팔 편 자세 인식 중':pushupLabel==='down'?'팔 굽힌 자세 인식 중':'푸시업 동작을 확인 중';
}
