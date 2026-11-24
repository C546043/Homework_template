// MOVE:US KNEE PUSH-UP LAB
// 학교 HandPose 학습 방식 + 성공한 MOVE:US SQUAT LAB의 ml5 neuralNetwork 흐름 재사용
// 무릎 대고 푸시업: UP -> DOWN -> UP = 1회, 10회 x 2세트.
// 정식 게임은 건드리지 않습니다. 학습 데이터는 JSON으로만 수동 저장합니다.
const VIEW_W = 640, VIEW_H = 480;
const JOINT_CONFIDENCE = 0.24;
const DRAW_CONFIDENCE = 0.12;
const CLASS_CONFIDENCE = 0.67;
const STABLE_CLASSIFICATIONS = 3;
const CLASSIFY_INTERVAL_MS = 190;
const LOST_POSE_RESET_MS = 1500;
const SAMPLES_PER_CAPTURE = 8;
const SAMPLE_INTERVAL_MS = 145;
const MIN_SAMPLES_PER_POSE = 16;
const TARGET_REPS = 10, TARGET_SETS = 2;
const FEATURE_VERSION = 'knee-pushup-8-features-v1-arm';
const JOINTS = {
  left: {shoulder:5, elbow:7, wrist:9, hip:11, knee:13},
  right:{shoulder:6, elbow:8, wrist:10,hip:12, knee:14}
};
const GUIDE_STEPS=['up','down','up','down','up','down'];

let video=null,bodyPose=null,poses=[],connections=[];
let cameraReady=false,loadingCamera=false,cameraGeneration=0;
let poseResultCount=0, currentFeatures=null, trackingDiagnostic='카메라 대기', trackingQuality='';
let collecting=null,guidedMode=false,guidedIndex=0,guidedNextAt=0,training=false,trained=false,nn=null;
let samples={up:[],down:[]},autoStartAfterTraining=false,trainingGeneration=0;
let measuring=false,classifyPending=false,lastClassifyAt=0,lastGoodPoseAt=0;
let latestPoseLabel=null,latestConfidence=0,stableLabel=null,stableHits=0,phase='needUp';
let currentSet=1,repsInSet=0,totalReps=0,resting=false,finished=false;
let soundContext=null,lastNoPoseSpokenAt=0;

function el(id){return document.getElementById(id);}
function note(message){el('log').textContent=message;}
function status(message){el('camera-status').textContent=message;}
function hint(message){el('guided-hint').textContent=message;el('distance-instruction').textContent=message;}
function soundEnabled(){return el('voice-enabled')?.checked===true;}
function unlockSound(){
  if(!soundEnabled())return;
  try{const C=window.AudioContext||window.webkitAudioContext;
    if(C&&!soundContext)soundContext=new C();
    soundContext?.resume?.();
  }catch(e){console.warn(e);}
}
function chime(kind='ready'){
  if(!soundEnabled()||!soundContext||soundContext.state!=='running')return;
  const freqs=kind==='finish'?[660,880]:kind==='count'?[610]:[470,660];
  freqs.forEach((f,i)=>{
    try{const t=soundContext.currentTime+i*.13;
      const osc=soundContext.createOscillator(),gain=soundContext.createGain();
      osc.type='sine';osc.frequency.value=f;
      gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.052,t+.016);
      gain.gain.exponentialRampToValueAtTime(.0001,t+.15);
      osc.connect(gain);gain.connect(soundContext.destination);osc.start(t);osc.stop(t+.16);
    }catch(e){console.warn(e);}
  });
}
function say(message,kind){
  if(!soundEnabled())return;
  if(kind)chime(kind);
  if(!('speechSynthesis' in window)||!('SpeechSynthesisUtterance' in window))return;
  try{window.speechSynthesis.cancel();const s=new SpeechSynthesisUtterance(message);
    s.lang='ko-KR';s.rate=1.0;s.volume=.92;
    const voice=window.speechSynthesis.getVoices().find(x=>x.lang?.toLowerCase().startsWith('ko'));
    if(voice)s.voice=voice;
    window.speechSynthesis.speak(s);
  }catch(e){console.warn(e);}
}
function poseName(v){return v==='up'?'팔 편 자세':'팔 굽힌 자세';}

function setup(){
  const c=createCanvas(VIEW_W,VIEW_H);c.parent('camera-canvas');
  pixelDensity(1);frameRate(30);bindControls();updateUI();
}
function bindControls(){
  el('start-camera').addEventListener('click',startCamera);
  el('stop-camera').addEventListener('click',stopCamera);
  el('guided-start').addEventListener('click',startGuidedTraining);
  el('guided-cancel').addEventListener('click',()=>cancelGuide(true));
  el('capture-up').addEventListener('click',()=>collectSample('up'));
  el('capture-down').addEventListener('click',()=>collectSample('down'));
  el('train-button').addEventListener('click',()=>trainPostures(false));
  el('measure-button').addEventListener('click',()=>startMeasuring(false));
  el('pause-measure').addEventListener('click',()=>{measuring=false;resetSequence();note('일시정지했어. 세트와 횟수는 그대로 유지돼.');updateUI();});
  el('reset-count').addEventListener('click',()=>{resetReps();note('10회 × 2세트 카운트를 처음부터 초기화했어. 학습 데이터는 유지돼.');updateUI();});
  el('next-set').addEventListener('click',startNextSet);
  el('export-data').addEventListener('click',exportData);
  el('import-data').addEventListener('change',importData);
  el('voice-enabled').addEventListener('change',()=>{if(soundEnabled()){unlockSound();say('음성 안내를 켰습니다.','ready');}else window.speechSynthesis?.cancel();});
}

async function waitVideo(capture){
  const v=capture?.elt;
  if(!v)throw new Error('비디오 생성 실패');
  if(v.readyState>=2&&v.videoWidth>0)return;
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{cleanup();reject(new Error('카메라 영상 준비 시간 초과'));},14000);
    const ready=()=>{if(v.readyState>=2&&v.videoWidth>0){cleanup();resolve();}};
    const fail=()=>{cleanup();reject(new Error('카메라 영상 읽기 실패'));};
    const cleanup=()=>{clearTimeout(timeout);v.removeEventListener('loadeddata',ready);v.removeEventListener('error',fail);};
    v.addEventListener('loadeddata',ready);v.addEventListener('error',fail);ready();
  });
}
async function startCamera(){
  unlockSound();
  if(cameraReady||loadingCamera)return;
  if(!navigator.mediaDevices?.getUserMedia){note('Live Server의 http://127.0.0.1 주소에서 열고 카메라 권한을 허용해 줘.');return;}
  if(typeof ml5==='undefined'){note('ml5.js가 로드되지 않았어. 인터넷 연결을 확인해 줘.');return;}
  loadingCamera=true;const generation=++cameraGeneration;
  status('카메라 및 BodyPose 준비 중');note('카메라 사용을 허용해 줘. 모델 다운로드가 끝나면 자동으로 인식을 시작할게.');updateUI();
  try{
    video=createCapture(VIDEO);video.size(VIEW_W,VIEW_H);video.hide();
    await waitVideo(video);
    if(generation!==cameraGeneration)return;
    bodyPose=ml5.bodyPose('MoveNet',{modelType:el('pose-model').value,enableSmoothing:true,minPoseScore:.15});
    if(!bodyPose?.ready)throw new Error('BodyPose.ready를 찾을 수 없어. ml5.js 버전을 확인해 줘.');
    status('BodyPose 모델 로딩 중');
    await bodyPose.ready;
    if(generation!==cameraGeneration)return;
    if(!bodyPose.model||typeof bodyPose.model.estimatePoses!=='function')throw new Error('BodyPose 내부 모델 초기화 실패');
    connections=typeof bodyPose.getConnections==='function'?bodyPose.getConnections():
      (typeof bodyPose.getSkeleton==='function'?bodyPose.getSkeleton():[]);
    bodyPose.detectStart(video,results=>{
      if(generation!==cameraGeneration)return;
      poses=Array.isArray(results)?results:[];
      poseResultCount++;
    });
    cameraReady=true;loadingCamera=false;el('video-placeholder').classList.add('hidden');
    note('카메라 준비 완료. 어깨·팔꿈치·손목이 보이도록 무릎 대고 푸시업 자세를 잡아 줘.');
    say('카메라가 준비됐어요. 자동 학습 시작을 누르고 무릎 대고 푸시업 자세를 잡아 주세요.','ready');
  }catch(e){
    console.error('[MOVE:US PUSH-UP LAB]',e);
    cameraReady=false;loadingCamera=false;stopVideo();
    note('카메라 오류: '+(e?.message||e));status('연결 실패');
  }
  updateUI();
}
function stopVideo(){
  try{if(video?.elt?.srcObject)video.elt.srcObject.getTracks().forEach(t=>t.stop());video?.remove?.();}catch(e){console.warn(e);}
  video=null;
}
function stopCamera(){
  cameraGeneration++;cancelGuide(false);window.speechSynthesis?.cancel();
  try{bodyPose?.detectStop?.();}catch(e){console.warn(e);}
  stopVideo();bodyPose=null;poses=[];cameraReady=false;loadingCamera=false;
  currentFeatures=null;collecting=null;classifyPending=false;measuring=false;
  latestPoseLabel=null;resetSequence();
  el('video-placeholder').classList.remove('hidden');
  status('카메라 꺼짐');note('카메라를 껐어. 학습 데이터와 운동 횟수는 페이지가 열려 있는 동안 유지돼.');updateUI();
}
function kp(pose,index){const v=pose?.keypoints?.[index];return v&&Number.isFinite(v.x)&&Number.isFinite(v.y)?v:null;}
function score(p){return p?(p.confidence??p.score??0):0;}
function angle(a,b,c){
  const ax=a.x-b.x,ay=a.y-b.y,cx=c.x-b.x,cy=c.y-b.y;
  const d=Math.hypot(ax,ay)*Math.hypot(cx,cy);
  if(d<.00001)return 0;
  return Math.acos(Math.max(-1,Math.min(1,(ax*cx+ay*cy)/d)))*180/Math.PI;
}
function coordSize(pose){
  const realW=Number(video?.elt?.videoWidth)||VIEW_W;
  const realH=Number(video?.elt?.videoHeight)||VIEW_H;
  const pts=pose?.keypoints||[];
  const maxX=Math.max(0,...pts.map(p=>Number(p.x)||0));
  const maxY=Math.max(0,...pts.map(p=>Number(p.y)||0));
  return (maxX>VIEW_W+4||maxY>VIEW_H+4)?{w:realW,h:realH}:{w:VIEW_W,h:VIEW_H};
}
function jointText(pose,side){
  return ['shoulder','elbow','wrist','hip','knee'].map(name=>{
    const q=kp(pose,side[name]);
    const names={shoulder:'어깨',elbow:'팔꿈치',wrist:'손목',hip:'골반',knee:'무릎'};
    return names[name]+' '+Math.round(100*score(q))+'%';
  }).join(' · ');
}
function makeArmInputs(pose){
  if(!pose?.keypoints?.length){trackingDiagnostic='포즈 결과 없음';trackingQuality='';return null;}
  const dim=coordSize(pose);const candidates=[];
  for(const [sideName,side] of Object.entries(JOINTS)){
    const shoulder=kp(pose,side.shoulder),elbow=kp(pose,side.elbow),wrist=kp(pose,side.wrist);
    const required=[shoulder,elbow,wrist];
    if(required.some(p=>!p||score(p)<JOINT_CONFIDENCE))continue;
    if(required.some(p=>p.x<0||p.x>dim.w||p.y<0||p.y>dim.h))continue;
    const upper=Math.hypot(shoulder.x-elbow.x,shoulder.y-elbow.y);
    const lower=Math.hypot(wrist.x-elbow.x,wrist.y-elbow.y);
    if(upper<10||lower<10)continue;
    // 학습과 실시간 분류 모두 같은 순서의 8개 신체 특징을 사용합니다.
    const features=[
      angle(shoulder,elbow,wrist)/180, // 핵심: 팔꿈치 각도
      shoulder.y/dim.h,
      elbow.y/dim.h,
      wrist.y/dim.h,
      (shoulder.y-wrist.y)/dim.h,
      Math.abs(elbow.y-shoulder.y)/dim.h,
      Math.abs(shoulder.x-wrist.x)/dim.w,
      Math.abs(elbow.x-wrist.x)/dim.w
    ];
    if(!features.every(n=>Number.isFinite(n)&&Math.abs(n)<3))continue;
    candidates.push({inputs:features,quality:required.reduce((s,p)=>s+score(p),0)/3,side:sideName,elbowAngle:features[0]*180});
  }
  const left=jointText(pose,JOINTS.left),right=jointText(pose,JOINTS.right);
  if(!candidates.length){
    trackingDiagnostic='어깨·팔꿈치·손목 3개가 한쪽 팔에서 충분히 보여야 해요. | 왼쪽 '+left+' | 오른쪽 '+right;
    trackingQuality='팔 관절 확인 필요';return null;
  }
  candidates.sort((a,b)=>b.quality-a.quality);
  const best=candidates[0];trackingQuality=(best.side==='left'?'왼쪽':'오른쪽')+' 팔 사용';
  trackingDiagnostic=`${trackingQuality} · 팔꿈치 ${best.elbowAngle.toFixed(0)}° · `+(best.side==='left'?left:right);
  return best;
}
function draw(){
  background(35,60,68);
  if(cameraReady&&video){
    const vw=Number(video.elt?.videoWidth)||VIEW_W,vh=Number(video.elt?.videoHeight)||VIEW_H;
    const z=Math.min(VIEW_W/vw,VIEW_H/vh);
    const dw=vw*z,dh=vh*z,dx=(VIEW_W-dw)/2,dy=(VIEW_H-dh)/2;
    push();
    if(el('mirror-mode').checked){translate(VIEW_W,0);scale(-1,1);}
    image(video,dx,dy,dw,dh);
    if(el('show-skeleton').checked&&poses.length){
      const size=coordSize(poses[0]);
      push();translate(dx,dy);scale(dw/size.w,dh/size.h);drawSkeleton(poses[0]);pop();
    }
    pop();
    currentFeatures=poses.length?makeArmInputs(poses[0]):null;
    if(!poses.length){trackingQuality='사람 검출 대기';trackingDiagnostic=`분석 결과 ${poseResultCount}회 · 현재 검출 인원 0명`;
    }
    if(currentFeatures)lastGoodPoseAt=millis();
    if(collecting)captureTick();
    if(guidedMode&&!collecting&&!training&&guidedNextAt&&millis()>=guidedNextAt){
      guidedNextAt=0;
      if(guidedIndex<GUIDE_STEPS.length)beginCollection(GUIDE_STEPS[guidedIndex],true);
      else finishGuidedCollection();
    }
    if(measuring&&trained&&!resting&&!finished)classifyTick();
    if(measuring&&millis()-lastGoodPoseAt>LOST_POSE_RESET_MS){resetSequence();latestPoseLabel=null;}
    if(frameCount%8===0)updateUI();
  }else if(frameCount%20===0)updateUI();
}
function drawSkeleton(pose){
  const pts=pose.keypoints||[];
  stroke(250,203,98);strokeWeight(2);
  for(const pair of connections){
    const a=pts[pair[0]],b=pts[pair[1]];
    if(score(a)>DRAW_CONFIDENCE&&score(b)>DRAW_CONFIDENCE)line(a.x,a.y,b.x,b.y);
  }
  noStroke();fill(81,240,166);
  for(const p of pts)if(score(p)>DRAW_CONFIDENCE)circle(p.x,p.y,5);
}

function startGuidedTraining(){
  if(!cameraReady||loadingCamera||training)return;
  unlockSound();measuring=false;resting=false;finished=false;
  guidedMode=true;guidedIndex=0;guidedNextAt=0;samples={up:[],down:[]};
  resetReps();trained=false;latestPoseLabel=null;
  beginCollection(GUIDE_STEPS[0],true);
}
function cancelGuide(announce){
  const was=guidedMode;guidedMode=false;guidedIndex=0;guidedNextAt=0;
  if(collecting?.guided){samples[collecting.label].length=collecting.startIndex;collecting=null;}
  if(was&&announce){note('자동 학습을 취소했어. 완료된 샘플은 남아 있어.');say('자동 학습을 취소했습니다.');}
  updateUI();
}
function collectSample(label){
  if(!cameraReady||training||collecting||guidedMode){note('카메라 준비 후 다시 시도해 줘.');return;}
  unlockSound();measuring=false;trained=false;
  beginCollection(label,false);
}
function beginCollection(label,guided){
  collecting={label,guided,phase:'waiting',validFrom:0,countdownEnd:0,nextTime:0,
    startIndex:samples[label].length,collected:0,missingSince:0,lastSecond:-1};
  const msg=`${poseName(label)} 수집 대기. 무릎을 바닥에 대고 ${label==='up'?'팔을 펴고':'팔을 굽힌'} 자세를 보여 주세요.`;
  note(msg);hint(msg);say(msg,'ready');updateUI();
}
function referenceUpAngle(){
  const arr=samples.up.map(v=>v[0]*180).filter(Number.isFinite).sort((a,b)=>a-b);
  if(arr.length<6)return null;
  return arr[Math.floor(arr.length/2)];
}
function expectedPose(label){
  if(!currentFeatures)return false;
  const angleNow=currentFeatures.elbowAngle,ref=referenceUpAngle();
  if(label==='up')return ref===null?angleNow>=125:angleNow>=Math.max(110,ref-15);
  if(ref===null)return angleNow<=115;
  return angleNow<=Math.min(140,ref-23);
}
function invalidateBlock(message){
  if(!collecting)return;
  const c=collecting;samples[c.label].length=c.startIndex;c.collected=0;
  c.phase='waiting';c.validFrom=0;c.countdownEnd=0;c.missingSince=0;c.lastSecond=-1;
  note(message);hint(message);
}
function captureTick(){
  if(!collecting)return;
  const c=collecting,now=millis(),valid=expectedPose(c.label);
  if(!valid){
    if(!c.missingSince)c.missingSince=now;
    if(c.phase==='recording'&&now-c.missingSince>800){
      invalidateBlock('관절이 보이지 않거나 자세가 바뀌었어. 이번 8개 구간을 다시 기다리고 있어.');
      if(now-lastNoPoseSpokenAt>8500){lastNoPoseSpokenAt=now;say('팔꿈치와 손목이 보이는지 확인해 주세요.','ready');}
    }else if(c.phase==='countdown'){
      c.phase='waiting';c.validFrom=0;c.countdownEnd=0;c.lastSecond=-1;
    }else if(c.phase==='waiting'&&now-lastNoPoseSpokenAt>8500){
      lastNoPoseSpokenAt=now;
      say(currentFeatures?'팔꿈치 각도를 조정해 주세요.':'어깨, 팔꿈치, 손목이 보이도록 카메라 위치를 조정해 주세요.','ready');
    }
    return;
  }
  c.missingSince=0;
  if(c.phase==='waiting'){
    if(!c.validFrom)c.validFrom=now;
    if(now-c.validFrom<550)return;
    c.phase='countdown';c.countdownEnd=now+2300;c.lastSecond=-1;
    const msg=`${poseName(c.label)} 확인. 잠시 후 데이터를 수집할게요. 자세를 유지해 주세요.`;
    note(msg);hint(msg);say(msg,'ready');return;
  }
  if(c.phase==='countdown'){
    const sec=Math.max(0,Math.ceil((c.countdownEnd-now)/1000));
    if(sec!==c.lastSecond){c.lastSecond=sec;hint(`${poseName(c.label)} 수집까지 ${sec}초`);if(sec>0)chime('count');}
    if(now<c.countdownEnd)return;
    c.phase='recording';c.nextTime=now;
    const msg=`${poseName(c.label)} 수집 시작. 약 1초 동안 그대로 유지해 주세요.`;
    note(msg);hint(msg);say(msg,'ready');
  }
  if(c.phase!=='recording'||now<c.nextTime)return;
  samples[c.label].push([...currentFeatures.inputs]);
  c.collected++;c.nextTime=now+SAMPLE_INTERVAL_MS;
  hint(`${poseName(c.label)} ${c.collected}/${SAMPLES_PER_CAPTURE}개 수집 중`);
  if(c.collected>=SAMPLES_PER_CAPTURE){
    const label=c.label,guided=c.guided;collecting=null;chime('finish');
    if(guided){
      guidedIndex++;
      if(guidedIndex<GUIDE_STEPS.length){
        const next=GUIDE_STEPS[guidedIndex];
        const msg=`${poseName(label)} 수집 완료. 다음은 ${poseName(next)}입니다. 천천히 자세를 바꿔 주세요.`;
        note(msg);hint(msg);say(msg,'ready');guidedNextAt=now+2600;
      }else{
        note('자세 수집 완료. 학습을 시작할게요.');hint('데이터 48개 수집 완료. 신경망 학습 중');
        say('자세 수집 완료. 이제 학습합니다.','finish');guidedNextAt=now+2200;
      }
    }else{
      const msg=`${poseName(label)} 8개 수집 완료. 같은 자세를 더 등록할 수 있어.`;
      note(msg);hint(msg);say(msg,'ready');
    }
  }
  updateUI();
}
function finishGuidedCollection(){
  guidedMode=false;guidedNextAt=0;
  if(samples.up.length>=MIN_SAMPLES_PER_POSE&&samples.down.length>=MIN_SAMPLES_PER_POSE)trainPostures(true);
  else{note('데이터 부족. 추가 수집 뒤 학습해 줘.');say('수집된 데이터가 부족합니다.');}
  updateUI();
}
function trainPostures(autoStart=false){
  if(training||collecting||samples.up.length<MIN_SAMPLES_PER_POSE||samples.down.length<MIN_SAMPLES_PER_POSE){
    note(`팔 편 자세와 굽힌 자세를 각각 최소 ${MIN_SAMPLES_PER_POSE}개 수집해 줘.`);return;
  }
  measuring=false;training=true;trained=false;classifyPending=false;
  autoStartAfterTraining=autoStart;resetSequence();
  const gen=++trainingGeneration;
  note('신경망 학습 중. 잠시 기다려 줘.');updateUI();
  try{
    nn=ml5.neuralNetwork({task:'classification',debug:false});
    samples.up.forEach(row=>nn.addData(row,['up']));
    samples.down.forEach(row=>nn.addData(row,['down']));
    nn.normalizeData();
    nn.train({epochs:50},()=>{
      if(gen!==trainingGeneration)return;
      training=false;trained=true;latestPoseLabel=null;
      note('학습 완료! 팔 편 자세 → 굽힌 자세 → 편 자세로 1회를 측정할게.');
      say('푸시업 학습 완료. 측정을 시작합니다. 무릎을 대고 팔을 펴 주세요.','finish');
      if(autoStartAfterTraining&&cameraReady)startMeasuring(true);
      autoStartAfterTraining=false;updateUI();
    });
  }catch(e){console.error(e);training=false;note('학습 오류: '+(e?.message||e));updateUI();}
}
function resetSequence(){phase='needUp';stableLabel=null;stableHits=0;}
function resetReps(){
  currentSet=1;repsInSet=0;totalReps=0;resting=false;finished=false;measuring=false;
  resetSequence();updateUI();
}
function startMeasuring(fromGuide=false){
  if(!fromGuide)unlockSound();
  if(!trained||!cameraReady||training||collecting||finished||resting)return;
  measuring=true;classifyPending=false;lastClassifyAt=0;latestPoseLabel=null;resetSequence();
  note(`측정 시작! ${currentSet}세트: 팔을 편 자세에서 내려갔다 다시 올라와 줘.`);
  if(!fromGuide)say(`${currentSet}세트 측정을 시작합니다. 팔을 편 자세에서 시작해 주세요.`,'ready');
  updateUI();
}
function startNextSet(){
  if(!resting||currentSet>=TARGET_SETS||!cameraReady||!trained)return;
  currentSet++;repsInSet=0;resting=false;
  startMeasuring(false);updateUI();
}
function classifyTick(){
  if(!currentFeatures||classifyPending||millis()-lastClassifyAt<CLASSIFY_INTERVAL_MS)return;
  const data=[...currentFeatures.inputs];lastClassifyAt=millis();classifyPending=true;
  try{nn.classify(data,(...args)=>{
    classifyPending=false;
    if(!measuring||!trained||resting||finished)return;
    const results=Array.isArray(args[0])?args[0]:Array.isArray(args[1])?args[1]:null;
    if(!results?.length)return;
    const top=results[0];latestConfidence=Number(top.confidence)||0;
    latestPoseLabel=latestConfidence>=CLASS_CONFIDENCE?top.label:null;
    updateSequence(latestPoseLabel);updateUI();
  });}catch(e){classifyPending=false;note('분류 오류: '+(e?.message||e));}
}
function updateSequence(label){
  if(!label||resting||finished){stableLabel=null;stableHits=0;return;}
  if(label===stableLabel)stableHits++;else{stableLabel=label;stableHits=1;}
  if(stableHits<STABLE_CLASSIFICATIONS)return;
  if(phase==='needUp'&&label==='up'){
    phase='needDown';note('팔 편 자세 확인! 이제 천천히 내려가 주세요.');
  }else if(phase==='needDown'&&label==='down'){
    phase='needReturn';note('팔 굽힌 자세 확인! 다시 밀어 올려 주세요.');
  }else if(phase==='needReturn'&&label==='up'){
    repsInSet++;totalReps++;phase='needDown';
    note(`푸시업 ${currentSet}세트 ${repsInSet}/${TARGET_REPS}회 · 전체 ${totalReps}/${TARGET_REPS*TARGET_SETS}회`);
    say(`${repsInSet}회`,'count');
    if(repsInSet>=TARGET_REPS){
      measuring=false;
      if(currentSet<TARGET_SETS){
        resting=true;phase='needUp';
        note('1세트 10회 완료! 충분히 쉬고 다음 세트 버튼을 눌러 주세요.');
        say('첫 번째 세트를 완료했습니다. 편하게 쉬고 다음 세트를 시작하세요.','finish');
      }else{
        finished=true;note('두 번째 세트까지 완료! 무릎 대고 푸시업 20회 성공!');
        say('두 세트 모두 완료했습니다. 수고했어요!','finish');
      }
    }
  }
}
function updateUI(){
  const ready=cameraReady&&!loadingCamera;
  el('start-camera').disabled=ready||loadingCamera;
  el('stop-camera').disabled=!ready&&!loadingCamera;
  for(const label of ['up','down']){
    el(`capture-${label}`).disabled=!ready||!!collecting||training||guidedMode;
    el(`${label}-count`).textContent=samples[label].length;
    el(`${label}-fill`).style.width=Math.min(100,samples[label].length/24*100)+'%';
  }
  el('guided-start').disabled=!ready||training||guidedMode||!!collecting;
  el('guided-cancel').disabled=!guidedMode;
  el('guided-progress').textContent=guidedMode?`단계 ${Math.min(6,guidedIndex+1)}/6`:
    training?'학습 중':measuring?'측정 중':resting?'세트 휴식':'대기';
  el('train-button').disabled=training||guidedMode||!!collecting||samples.up.length<MIN_SAMPLES_PER_POSE||samples.down.length<MIN_SAMPLES_PER_POSE;
  el('measure-button').disabled=!trained||!ready||training||!!collecting||measuring||resting||finished;
  el('pause-measure').disabled=!measuring;
  el('export-data').disabled=!(samples.up.length+samples.down.length);
  el('next-set').disabled=!resting||!ready||!trained;
  el('model-status').textContent=training?'신경망 학습 중':trained?'학습 완료':loadingCamera?'BodyPose 로딩 중':ready?'BodyPose 준비됨':'연결 전';
  el('joints-state').textContent=poses.length?`${poses[0].keypoints?.filter(p=>score(p)>=JOINT_CONFIDENCE).length||0}개 감지`:'사람 찾는 중';
  el('pose-quality').textContent=currentFeatures?trackingQuality:'팔 관절 확인 중';
  el('tracking-detail').textContent=trackingDiagnostic;
  el('recognized-pose').textContent=!trained?'학습 전':resting?'세트 사이 휴식':finished?'전체 운동 완료':
    !measuring?'측정 대기':!currentFeatures?'관절 위치 확인':latestPoseLabel==='up'?'팔 편 자세':latestPoseLabel==='down'?'팔 굽힌 자세':'판정 중';
  el('recognition-confidence').textContent=measuring&&latestPoseLabel?Math.round(latestConfidence*100)+'%':'--';
  el('pushup-count').textContent=repsInSet;
  el('count-detail').textContent=`세트 ${currentSet}/${TARGET_SETS} · 전체 ${totalReps}/${TARGET_REPS*TARGET_SETS}회`;
  el('set-1-pill').className='set-pill '+(currentSet>1?'done':'active');
  el('set-2-pill').className='set-pill '+(finished?'done':currentSet===2?'active':'');
  el('set-notice').textContent=finished?'20회 완료! 오늘의 푸시업 미션 성공!':
    resting?'1세트 완료! 원하는 만큼 쉰 뒤 다음 세트를 시작해 주세요.':
    measuring?'동작을 천천히 반복해 주세요. 카메라가 1회마다 알려줘요.':
    trained?'학습 준비 완료. 측정 시작 버튼을 눌러 주세요.':'먼저 자세를 학습해 주세요.';
  el('sequence-text').textContent=!measuring?'팔 편 자세 → 팔 굽힌 자세 → 팔 편 자세':
    phase==='needUp'?'① 먼저 팔 편 자세 보여 주기':phase==='needDown'?'② 팔을 굽히며 내려가기':'③ 팔을 펴면서 다시 올라오기';
  if(collecting)status(collecting.phase==='recording'?`수집 중 ${collecting.collected}/${SAMPLES_PER_CAPTURE}`:`${poseName(collecting.label)} 대기`);
  else if(cameraReady)status(currentFeatures?'팔 관절 추적 중':'어깨·팔꿈치·손목 인식 확인 중');
  el('camera-help').textContent=!ready?'카메라 시작 버튼을 누르고 권한을 허용해 주세요.':
    currentFeatures?'팔이 감지되고 있어요. 무릎을 댄 상태에서 위/아래 자세를 등록해 보세요.':
    '손목·팔꿈치·어깨가 모두 보이는 촬영 각도가 중요해요. 화면 오른쪽 BODY CHECK를 확인해 주세요.';
}
function exportData(){
  const payload={app:'MOVE:US KNEE PUSH-UP LAB',featureVersion:FEATURE_VERSION,samples};
  saveJSON(payload,'MOVE-US-knee-pushup-training-data.json');
  note('학습 특징 데이터 JSON을 저장했어. 영상이나 사진은 포함되지 않아.');
}
async function importData(event){
  const file=event.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.featureVersion!==FEATURE_VERSION)throw new Error('다른 특징 버전의 파일이야.');
    for(const label of ['up','down']){
      if(!Array.isArray(data.samples?.[label])||!data.samples[label].every(row=>Array.isArray(row)&&row.length===8&&row.every(Number.isFinite))){
        throw new Error('JSON의 학습 데이터 형식이 올바르지 않아.');
      }
    }
    samples={up:data.samples.up.map(x=>[...x]),down:data.samples.down.map(x=>[...x])};
    trained=false;training=false;measuring=false;nn=null;classifyPending=false;trainingGeneration++;
    resetReps();note('JSON을 불러왔어. ③ 학습 버튼을 눌러 다시 학습해 줘.');updateUI();
  }catch(e){note('JSON 불러오기 실패: '+(e?.message||e));}
  event.target.value='';
}
