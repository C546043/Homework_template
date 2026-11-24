// MOVE:US STEP 15 — Firebase 계정 2개 / 실시간 진척도 동기화
// p5.js 본게임과 분리하여 기존 자세 인식/애니메이션을 최대한 보존합니다.
const settings = window.MOVEUS_FIREBASE_SETTINGS ?? {};
const account = document.getElementById('family-account');
const authView = document.getElementById('family-auth');
const loginForm = document.getElementById('family-login-form');
const loginButton = document.getElementById('family-login-button');
const authMessage = document.getElementById('family-auth-message');
const progressPanel = document.getElementById('family-progress');
const statusEl = document.getElementById('family-sync-state');
// 각 계정의 Firestore 실시간 값을 주간 진행 바로 보여줍니다.
const familyLiveProfiles = { ME:null, MOM:null };
const journeyWeek = document.getElementById('family-journey-week');
const journeyDays = Array.from(document.querySelectorAll('.family-journey-days span'));
const journeyMe = document.getElementById('family-marker-me');
const journeyMom = document.getElementById('family-marker-mom');
const journeyMeLabel = document.getElementById('family-marker-me-label');
const journeyMomLabel = document.getElementById('family-marker-mom-label');
const journeyTip = document.getElementById('family-journey-tip');
function familyDay(profile) {
  return Math.max(1,Math.floor(Number(profile?.completedThrough)||0)+1);
}
function renderFamilyJourney() {
  if (!journeyWeek || !journeyMe || !journeyMom) return;
  const meDay=familyDay(familyLiveProfiles.ME);
  const momDay=familyDay(familyLiveProfiles.MOM);
  const latest=Math.max(meDay,momDay);
  const week=Math.floor((latest-1)/7);
  const first=week*7+1;
  journeyWeek.textContent=`WEEK ${week+1} · DAY ${String(first).padStart(2,'0')}–${String(first+6).padStart(2,'0')}`;
  journeyDays.forEach((el,i)=>{el.textContent=String(first+i).padStart(2,'0');});
  const update=(marker,label,role,day)=>{
    const pos=Math.min(6,Math.max(0,day-first));
    marker.style.left=`${((pos+0.5)/7)*100}%`;
    label.textContent=`${role} · DAY ${String(day).padStart(2,'0')}${day<first?' ←':''}`;
    marker.title=`${role}: DAY ${day}${day<first?' (이전 주)':''}`;
  };
  update(journeyMe,journeyMeLabel,'ME',meDay);
  update(journeyMom,journeyMomLabel,'MOM',momDay);
  if (journeyTip) journeyTip.textContent=[
    familyLiveProfiles.ME ? null : 'ME 기록 기다리는 중',
    familyLiveProfiles.MOM ? null : 'MOM 기록 기다리는 중',
    Math.min(meDay,momDay)<first?'← 표시는 이전 주에 있는 사용자':null
  ].filter(Boolean).join(' · ') || '두 사람이 각자 운동한 기록이 여기에 표시돼요.';
}

let auth = null, firestore = null, currentUser = null, profileRef = null;
let unsubscribeMine = null, unsubscribePartner = null;
let writeInFlight = false, writeDirty = false, writeTimer = null, accountReady = false;
let readSession = 0;
let setDocFn = null, serverTimestampFn = null;
let authSignOutFn = null;
let authBusy = false;
let demoMode = false;

const configured = Boolean(
  settings.firebaseConfig?.apiKey &&
  settings.firebaseConfig?.projectId &&
  settings.firebaseConfig?.appId &&
  settings.meUid && settings.momUid &&
  settings.meUid !== settings.momUid &&
  !Object.values(settings.firebaseConfig).some(v => String(v).includes('PASTE_')) &&
  !String(settings.meUid).includes('PASTE_') && !String(settings.momUid).includes('PASTE_')
);

const pairs = () => [settings.meUid, settings.momUid];
const isFamily = uid => pairs().includes(uid);
const roleOf = uid => uid === settings.meUid ? 'ME' : uid === settings.momUid ? 'MOM' : 'UNKNOWN';
const shortDate = value => {
  try {
    const d = value?.toDate?.() ?? (value?.seconds ? new Date(value.seconds * 1000) : null);
    return d && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d) : '아직 기록 없음';
  } catch (_) { return '시간 확인 불가'; }
};
const setMessage = message => { authMessage.textContent = message; };
const setStatus = message => {statusEl.textContent = message;};
const errorText = e => {
  const code = String(e?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return '이메일 또는 비밀번호를 확인해 주세요.';
  if (code.includes('too-many-requests')) return '로그인 시도가 많아요. 잠시 후 다시 시도해 주세요.';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return '네트워크 연결을 확인해 주세요.';
  if (code.includes('permission-denied')) return 'Firestore 접근이 차단됐어요. 규칙의 두 UID와 로그인 UID가 일치하는지 확인해 주세요.';
  if (code.includes('unauthorized-domain')) return 'Firebase Authentication의 승인된 도메인에 현재 GitHub Pages 주소를 추가해 주세요.';
  return String(e?.message || e || '알 수 없는 오류');
};

function resetSubscriptions() {
  try {unsubscribeMine?.();} catch (_) {}
  try {unsubscribePartner?.();} catch (_) {}
  unsubscribeMine = unsubscribePartner = null;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  writeDirty = false;
  accountReady = false;
  profileRef = null;
  currentUser = null;
  familyLiveProfiles.ME=null;
  familyLiveProfiles.MOM=null;
  renderFamilyJourney();
  readSession++;
}
function enterDemo() {
  resetSubscriptions();
  demoMode = true;
  authView.classList.add('hidden');
  account.classList.remove('hidden');
  document.getElementById('family-account-name').textContent = 'DEMO';
  setStatus('저장 안 됨');
  progressPanel.classList.add('hidden');
  if (typeof loadStageCompletion === 'function') loadStageCompletion();
  if (typeof showScreen === 'function') showScreen('title');
}

window.moveusCloud = { queueSave() { if (accountReady && !demoMode) queueSave(); } };
document.getElementById('family-demo').addEventListener('click', () => {
  if (authBusy) return;
  if (auth?.currentUser) { setMessage('로그인 상태에서는 로그아웃 후 오프라인 모드를 선택해 주세요.'); return; }
  enterDemo();
});
document.getElementById('family-open-progress').addEventListener('click', () => {
  if (demoMode) {alert('오프라인 테스트에서는 상대방 진행도가 공유되지 않아요.');return;}
  progressPanel.classList.toggle('hidden');
});
document.getElementById('family-close-progress').addEventListener('click', () => progressPanel.classList.add('hidden'));
document.getElementById('family-logout').addEventListener('click', async () => {
  if (demoMode) {demoMode=false; resetSubscriptions(); authView.classList.remove('hidden'); account.classList.add('hidden'); return;}
  if (!auth || !authSignOutFn) return;
  setStatus('로그아웃 중');
  await authSignOutFn(auth);
});

function paintProfile(uid, profile, fromCache=false) {
  const role=roleOf(uid);
  if (role==='UNKNOWN') return;
  familyLiveProfiles[role]=profile || null;
  renderFamilyJourney();
  const prefix = role==='ME' ? 'family-me' : 'family-mom';
  const completed = Math.max(0, Math.floor(Number(profile?.completedThrough)||0));
  document.getElementById(`${prefix}-day`).textContent=`DAY ${String(completed + 1).padStart(2,'0')}`;
  document.getElementById(`${prefix}-detail`).textContent = profile
    ? `${completed} DAY 완료 · ${String(profile.exerciseLabel||'운동 시작 전')} (${String(profile.countLabel||'준비 중')})`
    : '아직 운동 기록이 없어요.';
  document.getElementById(`${prefix}-time`).textContent = profile
    ? `${shortDate(profile.updatedAt)}${fromCache?' · 저장 기록':''}`
    : '—';
}
function queueSave() {
  writeDirty=true;
  if (writeTimer) clearTimeout(writeTimer);
  // 짧은 간격의 동작 저장은 합쳐서 서버 쓰기 수를 줄입니다.
  writeTimer=setTimeout(() => flushSave(), 450);
}
async function flushSave() {
  writeTimer=null;
  if (writeInFlight || !writeDirty || !accountReady || !currentUser || !profileRef) return;
  writeDirty=false;
  const uid=currentUser.uid;
  const session=readSession;
  let data;
  try {
    data = window.moveusCloudSnapshot();
    writeInFlight=true;
    setStatus('저장 중');
    await setDocFn(profileRef, {...data, updatedAt:serverTimestampFn()});
    if (readSession===session && currentUser?.uid===uid) setStatus('동기화됨 ✓');
  } catch (e) {
    console.error('[MOVE:US] 진행도 저장 실패:',e);
    if(readSession===session) {
      setStatus('저장 오류');
      document.getElementById('family-progress-hint').textContent=`저장 오류: ${errorText(e)}`;
    }
    // 서버 연결이 복구되거나 운동 진행이 갱신되면 재시도합니다.
    writeDirty=true;
  } finally {
    writeInFlight=false;
    if(writeDirty && accountReady && currentUser?.uid===uid && !writeTimer) {
      writeTimer=setTimeout(flushSave, 2500);
    }
  }
}

async function startCloud() {
  if (!configured) {
    setMessage('Firebase 설정 전이에요. firebase-config.js에 웹 앱 설정과 두 계정의 UID를 입력해 주세요. 그동안 오프라인 테스트는 가능해요.');
    loginButton.disabled=true;
    return;
  }
  setMessage('Firebase 라이브러리 연결 중...');
  try {
    const version='12.11.0';
    const [appLib,authLib,dbLib] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
    ]);
    const app=appLib.initializeApp(settings.firebaseConfig);
    auth=authLib.getAuth(app);
    auth.languageCode='ko';
    firestore=dbLib.getFirestore(app);
    setDocFn=dbLib.setDoc;
    serverTimestampFn=dbLib.serverTimestamp;
    authSignOutFn=authLib.signOut;
    loginButton.disabled=false;
    setMessage('ME와 MOM 중 자신의 Firebase 이메일 계정으로 로그인해 주세요.');
    loginForm.addEventListener('submit',async event=>{
      event.preventDefault();
      if(authBusy) return;
      authBusy=true;
      loginButton.disabled=true;
      setMessage('로그인 중...');
      try {
        const email=document.getElementById('family-email').value.trim();
        const password=document.getElementById('family-password').value;
        await authLib.signInWithEmailAndPassword(auth,email,password);
        // 로그인 성공 후 onAuthStateChanged에서 Firestore 데이터 복원이 끝나야 화면을 엽니다.
      } catch(e) {
        console.error('[MOVE:US] 로그인 실패:',e);
        setMessage(errorText(e));
      } finally {authBusy=false;loginButton.disabled=false;document.getElementById('family-password').value='';}
    });
    authLib.onAuthStateChanged(auth, async user => {
      // 사용자가 먼저 오프라인 테스트를 택했다면 초기 로그인 상태 콜백으로 덮지 않음.
      if (!user && demoMode) return;
      resetSubscriptions();
      progressPanel.classList.add('hidden');
      if (!user) {
        account.classList.add('hidden');
        authView.classList.remove('hidden');
        demoMode=false;
        if (typeof showScreen==='function') showScreen('title');
        if (typeof loadStageCompletion==='function') loadStageCompletion();
        setMessage('ME와 MOM 중 자신의 이메일 계정으로 로그인해 주세요.');
        return;
      }
      if (!isFamily(user.uid)) {
        setMessage('이 계정은 MOVE:US 두 명의 허용된 계정에 포함되지 않아요. Firebase의 UID 설정을 확인해 주세요.');
        await authLib.signOut(auth);
        return;
      }
      const session=readSession;
      currentUser=user;
      const myRef=dbLib.doc(firestore,'progress',user.uid);
      const partnerUid=user.uid===settings.meUid ? settings.momUid : settings.meUid;
      const partnerRef=dbLib.doc(firestore,'progress',partnerUid);
      profileRef=myRef;
      setMessage('내 DAY 기록을 가져오는 중...');
      try {
        // 내 진행 기록을 먼저 불러온 뒤 화면을 열어 초기화/덮어쓰기를 방지합니다.
        const mySnapshot=await dbLib.getDoc(myRef);
        if(session!==readSession || !auth?.currentUser || auth.currentUser.uid!==user.uid) return;
        if(mySnapshot.exists()) {
          window.moveusCloudRestore(mySnapshot.data());
        } else {
          if (typeof loadStageCompletion==='function') loadStageCompletion();
          await dbLib.setDoc(myRef, {...window.moveusCloudSnapshot(), updatedAt:dbLib.serverTimestamp()});
          if(session!==readSession || auth.currentUser.uid!==user.uid) return;
        }
        accountReady=true;
        demoMode=false;
        document.getElementById('family-account-name').textContent=roleOf(user.uid);
        setStatus('연결됨');
        account.classList.remove('hidden');
        authView.classList.add('hidden');
        // 본인/엄마 문서를 별도로 실시간 구독 (컬렉션 전체 공개 X)
        unsubscribeMine=dbLib.onSnapshot(myRef, snapshot=>{
          if(session!==readSession)return;
          paintProfile(user.uid,snapshot.exists()?snapshot.data():null,snapshot.metadata.fromCache);
        }, e=>{setStatus('읽기 오류');console.error('[MOVE:US] 내 진행도:',e);});
        unsubscribePartner=dbLib.onSnapshot(partnerRef, snapshot=>{
          if(session!==readSession)return;
          paintProfile(partnerUid,snapshot.exists()?snapshot.data():null,snapshot.metadata.fromCache);
        }, e=>{
          document.getElementById('family-progress-hint').textContent=`상대방 기록 읽기 실패: ${errorText(e)}`;
          console.error('[MOVE:US] 상대방 진행도:',e);
        });
      } catch (e) {
        console.error('[MOVE:US] 로그인 후 복원 실패:',e);
        setMessage(`로그인됐지만 기록을 열 수 없어요: ${errorText(e)}`);
        accountReady=false;
        authView.classList.remove('hidden');
      }
    });
  } catch(e) {
    console.error('[MOVE:US] Firebase 초기화 실패:',e);
    setMessage(`Firebase 연결 실패: ${errorText(e)}. 설정이나 인터넷 연결을 확인해 주세요.`);
    loginButton.disabled=true;
  }
}
startCloud();
