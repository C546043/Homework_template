/* Capture to Memo — Acrylic Album Edition / Full Rebuild 2026
   Firebase 경로는 기존 프로젝트와 동일: incoming, saved_memos
   새 UI: 표지 ↔ 인화실 / 아래에서 올라오는 사진 앨범
*/
"use strict";
const $ = id => document.getElementById(id);
const db = window.db;
const incoming = new Map();
const saved = new Map();
const albumClosed = new Set();
const batchSelected = new Set();
const SKIP_DELETE = "ctm-album-skip-delete-confirm";
let room = "cover";
let archiveOpen = false;
let editorItem = null;
let busy = false;
let batchMode = false;
let lastSelectedRange = null;
let toastTimer = null;
let paintScheduled = false;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}
function pad(n) { return String(n).padStart(2, "0"); }
function localDay(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function clockTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timestamp(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? (value < 1e12 ? value * 1000 : value) : null;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(value);
    return Number.isFinite(d) ? d : null;
  }
  return null;
}
function memoTime(data) {
  return timestamp(data?.capturedAt) ?? timestamp(data?.timestamp) ?? timestamp(data?.createdAt) ?? Date.now();
}
function relativeDay(day) {
  const today = localDay(Date.now());
  const yesterday = localDay(Date.now() - 86400000);
  return day === today ? "오늘" : day === yesterday ? "어제" : day.replaceAll("-", ".");
}
function record(source, key) { return (source === "incoming" ? incoming : saved).get(key); }
function pathFor(source) { return source === "incoming" ? "incoming" : "saved_memos"; }
function itemId(source, key) { return `${source}:${key}`; }
function splitId(id) { const n = id.indexOf(":"); return {source:id.slice(0,n),key:id.slice(n+1)}; }
function escapeHTML(s) { const div=document.createElement("div"); div.textContent=String(s??""); return div.innerHTML; }

// -------------------------------------------------------------------
// 메인 표지: Firebase 사진 중 랜덤 3장 + 3D 기울기 + 편집창 연결
// -------------------------------------------------------------------
let coverFloatingIds = [];

function shuffleCoverPhotos(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function coverPhotoPool() {
  const all = [];
  for (const [key, data] of saved) {
    if (data?.image) all.push({ source: "locker", key, data, t: memoTime(data) });
  }
  for (const [key, data] of incoming) {
    if (data?.image) all.push({ source: "incoming", key, data, t: memoTime(data) });
  }
  return all;
}

function applyCoverPhotoTilt() {
  const host = $("cover-photo-floats");
  if (!host) return;

  // 실제 Three.js 책과 겹치지 않도록 서로 다른 위치 / 방향으로 배치
  const layouts = [
    { left: "51%", top: "23%", rot: 12, rx: 11, ry: -30, scale: 0.7 },
    { left: "89%", top: "41%", rot: -10, rx: -10, ry: 23, scale: 1.02 },
    { left: "82%", top: "79%", rot: 30, rx: 20, ry: -40, scale: 0.82 }
  ];

  const cards = [...host.querySelectorAll(".cover-float-card, .cover-float-shot")];
  cards.slice(0, 3).forEach((card, i) => {
    const p = layouts[i];
    card.style.position = "absolute";
    card.style.left = p.left;
    card.style.top = p.top;
    card.style.right = "auto";
    card.style.bottom = "auto";
    card.style.zIndex = String(8 + i);
    card.style.transformOrigin = "center center";
    card.style.transformStyle = "preserve-3d";
    card.style.willChange = "transform";
    card.style.pointerEvents = "auto";
    card.style.filter = "drop-shadow(0 18px 32px rgba(52,76,173,0.14))";
    card.style.transform = `translate(-50%, -50%) rotate(${p.rot}deg) rotateX(${p.rx}deg) rotateY(${p.ry}deg) scale(${p.scale})`;
  });
}

function drawCoverPolaroids() {
  const host = $("cover-photo-floats");
  if (!host) return;

  const pool = coverPhotoPool();
  const byId = new Map(pool.map(item => [itemId(item.source, item.key), item]));

  // 새 사진이 추가돼도 기존의 무작위 사진을 무조건 다시 바꾸지는 않음
  coverFloatingIds = coverFloatingIds.filter(id => byId.has(id));
  const targetCount = Math.min(3, pool.length);
  if (coverFloatingIds.length < targetCount) {
    const candidates = shuffleCoverPhotos(pool.filter(
      item => !coverFloatingIds.includes(itemId(item.source, item.key))
    ));
    for (const item of candidates.slice(0, targetCount - coverFloatingIds.length)) {
      coverFloatingIds.push(itemId(item.source, item.key));
    }
  }
  coverFloatingIds = coverFloatingIds.slice(0, targetCount);

  host.replaceChildren();
  host.hidden = targetCount === 0;

  coverFloatingIds.forEach((id, index) => {
    const item = byId.get(id);
    if (!item) return;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `cover-float-card pos-${index + 1}`;
    card.setAttribute("aria-label", `${item.data.labelTxt || localDay(item.t) || "사진"} 메모 편집`);
    card.title = "사진을 눌러 메모 편집";
    card.draggable = false;

    const img = new Image();
    img.src = item.data.image;
    img.alt = item.data.labelTxt || "기록된 사진";
    img.draggable = false;
    img.loading = "lazy";

    const label = document.createElement("span");
    label.className = "cover-float-label";
    label.textContent = item.data.labelTxt?.trim() || localDay(item.t) || "MEMO";
    card.append(img, label);

    card.addEventListener("contextmenu", event => event.preventDefault());
    card.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (busy || batchMode) return;
      openEditor(item.source, item.key);
    });

    host.appendChild(card);
  });

  applyCoverPhotoTilt();
}


// -------------------------------------------------------------------
// 1. 화면 이동 — 가로는 표지/인화실, 세로는 보관함
// -------------------------------------------------------------------
function goRoom(next) {
  if (batchMode || busy) return;
  const world = $("world");
  if (!world) return;
  const target = next === "darkroom" ? world.scrollWidth - world.clientWidth : 0;
  world.scrollTo({
    left: target,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
  });
}
function setArchive(open) {
  if (batchMode || busy) return;
  archiveOpen = !!open;
  document.body.classList.toggle("archive-open", archiveOpen);
  $("archive-sheet").setAttribute("aria-hidden", String(!archiveOpen));
}
function setupSwipes() {
  const world = $("world");
  if (!world) return;

  let pending = false;
  let lastWireScrollLeft = world.scrollLeft;
  function syncScroll() {
    const deltaX=world.scrollLeft-lastWireScrollLeft;
    lastWireScrollLeft=world.scrollLeft;
    if(Math.abs(deltaX)>.5)nudgeDarkroomPhotos(deltaX);
    const max = Math.max(1, world.scrollWidth - world.clientWidth);
    const progress = THREE_SAFE_CLAMP(world.scrollLeft / max);
    window.__ctmRoomProgress = progress;
    window.dispatchEvent(new CustomEvent("ctm-room-progress", { detail: { progress } }));
    room = progress >= 0.5 ? "darkroom" : "cover";
    document.body.classList.toggle("in-darkroom", room === "darkroom");
  }
  function THREE_SAFE_CLAMP(n) { return Math.max(0, Math.min(1, n)); }
  world.addEventListener("scroll", () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; syncScroll(); });
  }, { passive: true });

  // PC: 배경을 마우스로 끌면 그만큼 이동, 손을 놓은 위치에 유지
  let mouse = null;
  let suppressClickUntil = 0;
  const blocked = target => {
    if(!(target instanceof Element))return false;
    // 실제 인화실의 사진은 PC에서도 잡아 좌우로 드래그 가능
    if(target.closest("#front-photo-layer .hanging-polaroid"))return false;
    return !!target.closest(
      "button,input,textarea,select,[contenteditable]," +
      ".cover-float-card,.cover-float-shot,.album-photo,.album-cover," +
      ".dialog,.overlay,.archive-tools,.cover-controls"
    );
  };

  world.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0 ||
        batchMode || busy || archiveOpen || blocked(event.target)) return;
    mouse = { id: event.pointerId, x: event.clientX,
              left: world.scrollLeft, moved: false };
    // 캡처는 드래그가 감지된 다음에만. 단순 사진 클릭은 유지.
  });

  world.addEventListener("pointermove", event => {
    if (!mouse || mouse.id !== event.pointerId) return;
    const dx = event.clientX - mouse.x;
    if (Math.abs(dx) > 7 && !mouse.moved) {
      mouse.moved = true;
      world.setPointerCapture(event.pointerId);
    }
    if(mouse.moved)world.scrollLeft = mouse.left - dx;
  });

  function endMouseDrag(event) {
    if (!mouse || mouse.id !== event.pointerId) return;
    const moved = mouse.moved;
    mouse = null;
    if (world.hasPointerCapture(event.pointerId)) {
      world.releasePointerCapture(event.pointerId);
    }
    if (moved) suppressClickUntil = performance.now() + 350;
    syncScroll();
  }
  world.addEventListener("pointerup", endMouseDrag);
  world.addEventListener("pointercancel", endMouseDrag);
  world.addEventListener("click", event => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // 보관함 세로 제스처는 이전 기능대로 유지
  let verticalStart = null;
  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1 || batchMode || busy ||
        document.querySelector(".overlay:not([hidden])")) {
      verticalStart = null;
      return;
    }
    const touch = event.touches[0];
    verticalStart = { x: touch.clientX, y: touch.clientY, target: event.target };
  }, { capture: true, passive: true });

  document.addEventListener("touchend", event => {
    if (!verticalStart || event.changedTouches.length !== 1) return;
    const start = verticalStart;
    verticalStart = null;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dy) < 65 || Math.abs(dy) < Math.abs(dx) * 1.3) return;
    if (archiveOpen) {
      if (dy > 0 && start.target.closest?.("#archive-grip,.archive-header")) {
        setArchive(false);
      }
    } else if (dy < 0 && start.y > window.innerHeight * 0.62) {
      setArchive(true);
    }
  }, { capture: true, passive: true });
  document.addEventListener("touchcancel", () => { verticalStart = null; },
    { capture: true, passive: true });

  window.addEventListener("resize", syncScroll);
  syncScroll();
}

// -------------------------------------------------------------------
// 1B. 보관함: 책/사진 위에서도 수평 드래그 가능 (PC & tablet)
// -------------------------------------------------------------------
let archiveDragSuppressUntil = 0;
function setupArchiveRailDrag() {
  const rail = $("album-rail");
  if (!rail) return;
  let drag = null;
  rail.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0 || batchMode || busy) return;
    if (event.target.closest("input,textarea,[contenteditable],.archive-tools")) return;
    drag = {id:event.pointerId, x:event.clientX, y:event.clientY, left:rail.scrollLeft, moved:false};
  });
  rail.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx=event.clientX-drag.x;
    const dy=event.clientY-drag.y;
    if (!drag.moved && Math.hypot(dx,dy)>8) {
      drag.moved=true;
      rail.setPointerCapture(event.pointerId);
    }
    if (drag.moved) {
      rail.scrollLeft=drag.left-dx;
      event.preventDefault();
    }
  });
  function end(event) {
    if (!drag || event.pointerId!==drag.id) return;
    if (drag.moved) archiveDragSuppressUntil=performance.now()+450;
    if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
    drag=null;
  }
  rail.addEventListener("pointerup",end);
  rail.addEventListener("pointercancel",end);
  // 이미지가 드래그될 때 브라우저 고유 이미지 끌기 동작 방지.
  rail.addEventListener("dragstart",event=>event.preventDefault());
  rail.addEventListener("click",event=>{
    if (performance.now()<archiveDragSuppressUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);
}

// -------------------------------------------------------------------
// 2. Firebase 읽기: 이전 앱 / mobile.html 과 같은 DB 사용
// -------------------------------------------------------------------
function schedulePaint() {
  if (paintScheduled) return;
  paintScheduled=true;
  requestAnimationFrame(() => {
    paintScheduled=false;
    drawDarkroom();
    drawAlbums();
    drawCoverPolaroids();
    refreshBatch();
  });
}
function subscribe(path, map) {
  const ref=db.ref(path);
  ref.on("child_added", s => { if(s.val()?.image) map.set(s.key,s.val());schedulePaint(); }, e=>toast("데이터를 읽지 못했어요: "+e.message));
  ref.on("child_changed",s => { if(s.val()?.image) map.set(s.key,s.val()); else map.delete(s.key);schedulePaint(); });
  ref.on("child_removed",s => {map.delete(s.key);batchSelected.delete(itemId(path==="incoming"?"incoming":"locker",s.key));schedulePaint();});
}

// -------------------------------------------------------------------
// 3. 사진 인화실: 경사진 두 줄 + 물리 기반 폴라로이드
// -------------------------------------------------------------------
function installPhotoInteraction(el, source, key) {
  el.dataset.source=source;
  el.dataset.key=key;
  el.draggable=false;
  el.addEventListener("contextmenu", e=>e.preventDefault());
  let hold=null,origin=null,suppress=false;
  el.addEventListener("pointerdown",e=>{
    if (busy || batchMode || (e.pointerType==="mouse"&&e.button!==0)) return;
    origin={x:e.clientX,y:e.clientY,id:e.pointerId}; suppress=false;
    hold=setTimeout(()=>{hold=null;suppress=true;enterBatch(source,key);},610);
  });
  el.addEventListener("pointermove",e=>{
    if(origin?.id===e.pointerId && Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>11){clearTimeout(hold);hold=null;}
  });
  ["pointerup","pointercancel","pointerleave"].forEach(event=>el.addEventListener(event,()=>{clearTimeout(hold);hold=null;}));
  el.addEventListener("click",e=>{
    e.preventDefault();e.stopPropagation();
    if(suppress){suppress=false;return;}
    if(batchMode) {toggleBatch(source,key);return;}
    openEditor(source,key);
  });
  const check=document.createElement("span"); check.className="selection-check";check.textContent="✓";check.setAttribute("aria-hidden","true");el.appendChild(check);
}
/* ============================================================
   DARKROOM WIRE PHYSICS — actual Firebase data and Matter.js
   No artificial incomingPhotos/newItem/openMemoEditor functions.
   New photos automatically arrive via subscribe("incoming") → drawDarkroom().
   ============================================================ */
const darkroomPhysics = {
  items: new Map(),
  engine: null,
  lastTime: 0,
  started: false,
  hasRendered: false,
  width: 0,
  height: 0,
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches
};

// Tracks span the entire 2-page world, visually crossing one another.
// t=0 is at the far left of the cover; t=1 is at the far right of darkroom.
function getDarkroomWirePoint(t, rear=false) {
  const w=darkroomPhysics.width || $("darkroom-scene")?.clientWidth || 900;
  const h=darkroomPhysics.height || $("darkroom-scene")?.clientHeight || 700;
  return {x:(2*t-1)*w, y:(rear ? .74-.58*t : .16+.34*t)*h};
}
function updateDarkroomWires() {
  const scene=$("darkroom-scene");
  const svg=$("world-wire-overlay");
  if(!scene || !svg) return;
  darkroomPhysics.width=Math.max(1,scene.clientWidth);
  darkroomPhysics.height=Math.max(1,scene.clientHeight);
  const track=$("world-track");
  const w=track?.clientWidth || darkroomPhysics.width*2;
  const h=darkroomPhysics.height;
  svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
  const front=$("front-wire"),rear=$("rear-wire");
  if(front) {
    front.setAttribute("x1",0);front.setAttribute("y1",h*.16);
    front.setAttribute("x2",w);front.setAttribute("y2",h*.50);
  }
  if(rear) {
    rear.setAttribute("x1",0);rear.setAttribute("y1",h*.74);
    rear.setAttribute("x2",w);rear.setAttribute("y2",h*.16);
  }
  renderRearDarkroomDecor();
}
function renderRearDarkroomDecor() {
  const layer=$("rear-deco-layer");
  if(!layer)return;
  layer.replaceChildren();
  [0.56,0.72,0.89].forEach((t,index)=>{
    const blank=document.createElement("div");
    blank.className="rear-empty";
    blank.setAttribute("aria-hidden","true");
    blank.innerHTML='<span class="wire-clip"></span><span class="rear-empty-photo"></span>';
    const p=getDarkroomWirePoint(t,true);
    blank.style.left=`${p.x}px`;
    blank.style.top=`${p.y}px`;
    blank.style.transform=`translateX(-50%) rotate(${[-13,9,-6][index]}deg)`;
    layer.append(blank);
  });
}

function makeHangingPhoto(key,data,t) {
  const card=document.createElement("button");
  card.type="button";
  card.className="polaroid hanging-polaroid";
  card.title="사진을 눌러 편집 / 길게 눌러 다중 선택";
  card.style.zIndex="4";
  const clip=document.createElement("span");
  clip.className="wire-clip";
  clip.setAttribute("aria-hidden","true");
  const img=new Image();img.src=data.image;img.alt="인화실에 걸린 사진";img.draggable=false;
  const label=document.createElement("span");
  label.className="polaroid-label";
  label.textContent=localDay(t);
  card.append(clip,img,label);
  // This is the real existing editor, not an example placeholder.
  installPhotoInteraction(card,"incoming",key);
  return {card,img,label};
}

function createDarkroomHanger(key,data,t,newArrival) {
  const layer=$("front-photo-layer");
  const {card,img,label}=makeHangingPhoto(key,data,t);
  layer.append(card);
  const height=card.offsetHeight || 203;
  const width=card.offsetWidth || 168;
  const initialT=newArrival&&!darkroomPhysics.reduced ? .39 : .89;
  const point=getDarkroomWirePoint(initialT);
  const hanger={key,data,el:card,img,label,t:initialT,targetT:initialT,
    v:0,swing:0,swingV:0,phase:Math.random()*6.28,
    body:null,rope:null,cardH:height,cardW:width};
  if(window.Matter && darkroomPhysics.engine) {
    const M=window.Matter;
    // Physical body pivots from an acrylic clip located on the wire.
    const body=M.Bodies.rectangle(point.x,point.y+height/2,width*.76,height*.78,{
      frictionAir:.035, restitution:.05, collisionFilter:{group:-1}
    });
    const rope=M.Constraint.create({pointA:{x:point.x,y:point.y},
      bodyB:body, pointB:{x:0,y:-height/2},length:0,stiffness:.75,damping:.12});
    M.Composite.add(darkroomPhysics.engine.world,[body,rope]);
    hanger.body=body;hanger.rope=rope;
  }
  darkroomPhysics.items.set(key,hanger);
  return hanger;
}

function removeDarkroomHanger(key) {
  const hanger=darkroomPhysics.items.get(key);
  if(!hanger)return;
  if(window.Matter && darkroomPhysics.engine) {
    if(hanger.rope)window.Matter.Composite.remove(darkroomPhysics.engine.world,hanger.rope);
    if(hanger.body)window.Matter.Composite.remove(darkroomPhysics.engine.world,hanger.body);
  }
  hanger.el.remove();
  darkroomPhysics.items.delete(key);
}

// Oldest photos settle closer to the lower right end; new ones arrive from
// beyond the left edge and fill the available hanging positions.
function distributeDarkroomHangers(all) {
  const ordered=[...all].sort((a,b)=>a.t-b.t);
  const count=ordered.length;
  const step=Math.min(.145,.40/Math.max(1,count-1));
  ordered.forEach((item,index)=>{
    const hanger=darkroomPhysics.items.get(item.key);
    if(!hanger)return;
    hanger.targetT=.95-index*step;
    // Avoid needlessly sliding previously saved photographs on initial load.
    if(darkroomPhysics.reduced)hanger.t=hanger.targetT;
  });
}

function initDarkroomLines() {
  if(darkroomPhysics.started)return;
  darkroomPhysics.started=true;
  updateDarkroomWires();
  if(window.Matter) {
    const M=window.Matter;
    darkroomPhysics.engine=M.Engine.create({enableSleeping:false});
    darkroomPhysics.engine.gravity.y=1.0;
    darkroomPhysics.engine.gravity.scale=.001;
  } else {
    console.warn("Matter.js를 불러오지 못해 기본 스프링 흔들림을 사용합니다.");
  }
  darkroomPhysics.lastTime=performance.now();
  requestAnimationFrame(animateDarkroomLines);
  window.addEventListener("resize",()=>{
    updateDarkroomWires();
    for(const hanger of darkroomPhysics.items.values()){
      hanger.cardH=hanger.el.offsetHeight || hanger.cardH;
      hanger.cardW=hanger.el.offsetWidth || hanger.cardW;
    }
  });
}

function drawDarkroom() {
  initDarkroomLines();
  const all=[...incoming].filter(([,d])=>d?.image)
    .map(([key,data])=>({key,data,t:memoTime(data)}))
    .sort((a,b)=>b.t-a.t);
  $("incoming-count").textContent=`${pad(all.length)} PHOTOS`;
  $("room-empty").hidden=all.length>0;
  const ids=new Set(all.map(item=>item.key));
  [...darkroomPhysics.items.keys()].forEach(key=>{if(!ids.has(key))removeDarkroomHanger(key);});
  all.forEach(({key,data,t})=>{
    let hanger=darkroomPhysics.items.get(key);
    if(!hanger){
      hanger=createDarkroomHanger(key,data,t,darkroomPhysics.hasRendered);
    } else if(hanger.data.image!==data.image) {
      hanger.img.src=data.image;
    }
    hanger.data=data;
    hanger.label.textContent=localDay(t);
  });
  distributeDarkroomHangers(all);
  darkroomPhysics.hasRendered=true;
}

// Horizontal swiping creates an impulse on the pendulum bodies. It does NOT
// alter the world scroll position or the book-opening animation.
function nudgeDarkroomPhotos(deltaX) {
  const impulse=Math.max(-45,Math.min(45,deltaX));
  for(const hanger of darkroomPhysics.items.values()) {
    if(hanger.body && window.Matter) {
      const M=window.Matter;
      const current=hanger.body.angularVelocity;
      M.Body.setAngularVelocity(hanger.body,
        Math.max(-.09,Math.min(.09,current-impulse*.0005)));
    } else {
      hanger.swingV=Math.max(-2.2,Math.min(2.2,hanger.swingV-impulse*.027));
    }
  }
}

function animateDarkroomLines(now) {
  requestAnimationFrame(animateDarkroomLines);
  if(document.hidden)return;
  const dt=Math.max(.001,Math.min(.033,(now-darkroomPhysics.lastTime)/1000));
  darkroomPhysics.lastTime=now;
  for(const hanger of darkroomPhysics.items.values()) {
    // Slide along the actual inclined wire under projected gravity and damping.
    if(darkroomPhysics.reduced) {
      hanger.t=hanger.targetT;
    } else {
      const force=(hanger.targetT-hanger.t)*7.2 -hanger.v*2.8 +.22;
      hanger.v+=force*dt;
      hanger.t+=hanger.v*dt;
      if(hanger.t>=hanger.targetT){hanger.t=hanger.targetT;hanger.v=-Math.abs(hanger.v)*.16;}
      if(hanger.t<.35){hanger.t=.35;hanger.v=0;}
    }
    const p=getDarkroomWirePoint(hanger.t);
    if(hanger.rope) {
      hanger.rope.pointA.x=p.x;
      hanger.rope.pointA.y=p.y;
    } else {
      hanger.swingV+=(-hanger.swing*9 -hanger.swingV*4.6)*dt;
      hanger.swing+=hanger.swingV*dt;
    }
  }
  if(window.Matter && darkroomPhysics.engine) {
    window.Matter.Engine.update(darkroomPhysics.engine,Math.max(8,dt*1000));
  }
  for(const hanger of darkroomPhysics.items.values()) {
    const p=getDarkroomWirePoint(hanger.t);
    const angle=hanger.body ? hanger.body.angle : hanger.swing;
    hanger.el.style.left=`${p.x}px`;
    hanger.el.style.top=`${p.y}px`;
    hanger.el.style.transform=`translateX(-50%) rotate(${angle}rad)`;
    hanger.el.style.zIndex=String(5+Math.round(hanger.targetT*100));
  }
}

// -------------------------------------------------------------------
// 4. 보관함: 날짜 1개=1페이지, 날짜 2개=1권
// -------------------------------------------------------------------
function filteredSaved() {
  const q=$("archive-search").value.trim().toLowerCase();
  const date=$("archive-date").value;
  return [...saved].filter(([,d])=>d?.image).map(([key,data])=>({key,data,t:memoTime(data),day:localDay(memoTime(data))}))
    .filter(r=>(!q || `${r.data.labelTxt||""} ${r.data.longMemo||""}`.toLowerCase().includes(q)) && (!date||r.day===date))
    .sort((a,b)=>b.t-a.t);
}
function createAlbumPhoto(row) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "album-photo";
  btn.dataset.date = clockTime(row.t);
  btn.title = row.data.labelTxt || row.day;

  // 사진마다 일정하지만 서로 다른 기울기
  const angles = [-3, 2, -1.8, 3.4, 1.2, -2.5, 2.8, -1];
  const hash = [...String(row.key)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  btn.style.setProperty("--photo-angle", `${angles[hash % angles.length]}deg`);

  const img = new Image();
  img.src = row.data.image;
  img.alt = row.data.labelTxt || "저장된 사진";
  img.loading = "lazy";
  img.draggable = false;

  btn.append(img);
  installPhotoInteraction(btn, "locker", row.key);
  return btn;
}
function createPage(day, rows) {
  const page=document.createElement("div");page.className="album-page";
  const heading=document.createElement("p");heading.className="page-date";heading.textContent=day?`${relativeDay(day)}  ·  ${rows.length} PHOTOS` : "BLANK PAGE";
  page.append(heading);
  if (!rows.length){const empty=document.createElement("p");empty.className="page-empty";empty.textContent="다음 기억을 기다리는 페이지";page.append(empty);return page;}
  const grid=document.createElement("div");grid.className="album-grid";rows.forEach(r=>grid.appendChild(createAlbumPhoto(r)));page.appendChild(grid);return page;
}
function drawAlbums() {
  const rail = $("album-rail");
  const previousScroll = rail.scrollLeft;
  rail.replaceChildren();

  const rows = filteredSaved();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "archive-empty";
    empty.textContent = "아직 펼칠 앨범이 없어요. 인화실에서 사진을 저장해 보세요.";
    rail.append(empty);
    return;
  }

  const days = new Map();
  rows.forEach(row => {
    if (!days.has(row.day)) days.set(row.day, []);
    days.get(row.day).push(row);
  });

  const dates = [...days.keys()].sort().reverse();
  const covers = [
    { color: "#b9ccef", ink: "#20345d", dark: false },
    { color: "#e2c8b0", ink: "#4d392c", dark: false },
    { color: "#27343f", ink: "#f4f5f0", dark: true },
    { color: "#b8cdbf", ink: "#284637", dark: false },
    { color: "#e5b8bf", ink: "#5f3545", dark: false },
    { color: "#c5badc", ink: "#473962", dark: false }
  ];
  const rotations = [-4.2, 3.3, -2.4, 4.5, -3.5, 2.1];

  for (let i = 0; i < dates.length; i += 2) {
    const albumIndex = Math.floor(i / 2);
    const firstDay = dates[i];
    const secondDay = dates[i + 1];
    const albumKey = `${firstDay}|${secondDay || ""}`;
    const style = covers[albumIndex % covers.length];

    const card = document.createElement("article");
    card.className = "album-card";
    card.dataset.album = albumKey;
    card.dataset.dark = String(style.dark);
    card.style.setProperty("--album-color", style.color);
    card.style.setProperty("--album-ink", style.ink);
    card.style.setProperty("--album-angle", `${rotations[albumIndex % rotations.length]}deg`);
    if (albumClosed.has(albumKey)) card.classList.add("closed");

    const spread = document.createElement("div");
    spread.className = "album-spread";
    spread.append(
      createPage(firstDay, days.get(firstDay)),
      createPage(secondDay, secondDay ? days.get(secondDay) : [])
    );

    const cover = document.createElement("div");
    cover.className = "album-cover";
    cover.innerHTML = `
      <span class="album-cover-mini">CAPTURE TO MEMO · VOL.${String(albumIndex+1).padStart(2,"0")}</span>
      <div class="album-cover-name">Our<br>Days.</div>
      <span class="album-cover-period">${escapeHTML(secondDay || firstDay)} — ${escapeHTML(firstDay)}</span>
    `;

    const caption = document.createElement("div");
    caption.className = "album-caption";
    const info = document.createElement("span");
    info.textContent = `ALBUM ${String(albumIndex + 1).padStart(2, "0")}  /  ${secondDay || firstDay} — ${firstDay}`;
    caption.append(info);

    card.append(spread, cover, caption);
    // 한 번 탭하면 책 열기/닫기, 드래그면 가로 스크롤만 수행.
    let press = null;
    let justDragged = false;
    card.addEventListener("pointerdown", event => {
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      justDragged = false;
    });
    card.addEventListener("pointermove", event => {
      if (!press || event.pointerId !== press.id) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 9) {
        justDragged = true;
      }
    });
    card.addEventListener("pointercancel", () => { press = null; });
    card.addEventListener("pointerup", () => { press = null; });
    card.addEventListener("click", event => {
      if (justDragged || performance.now() < archiveDragSuppressUntil) {
        justDragged = false;
        event.preventDefault();
        return;
      }
      if (batchMode || event.target.closest("button,input")) return;
      if (albumClosed.has(albumKey)) albumClosed.delete(albumKey);
      else albumClosed.add(albumKey);
      card.classList.toggle("closed", albumClosed.has(albumKey));
    });
    rail.append(card);
  }

  rail.scrollLeft = previousScroll;
}

// -------------------------------------------------------------------
// 5. 파일 불러오기 + 사진 날짜 파악 + 신규 업로드
// -------------------------------------------------------------------
function parseDateString(s){
  if(!s)return null;
  if(s instanceof Date)return timestamp(s);
  if(typeof s==="number")return timestamp(s);
  const m=String(s).match(/^(\d{4})[-:/](\d{2})[-:/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if(!m)return null;
  const [y,mo,da,h,mi,sec]=m.slice(1).map((n,i)=>Number(n??(i===3?"12":"0")));
  const date=new Date(y,mo-1,da,h,mi,sec);
  if(date.getFullYear()!==y||date.getMonth()!==mo-1||date.getDate()!==da)return null;
  return date.getTime();
}
function validCapture(t){return Number.isFinite(t)&&t>=new Date(1990,0,1).getTime()&&t<=Date.now()+86400000;}
async function detectPhotoDate(file){
  try{
    if(window.exifr){
      const m=await exifr.parse(file,{tiff:true,exif:true,xmp:true,iptc:true,mergeOutput:true});
      for(const v of [m?.DateTimeOriginal,m?.CreateDate,m?.DateTimeDigitized,m?.DateCreated,m?.DateTime,m?.ModifyDate,m?.["xmp:CreateDate"]]){
        const t=parseDateString(v);if(validCapture(t))return {date:t,source:"metadata"};
      }
    }
  }catch(err){console.warn("사진 메타데이터 판독:",err);}
  const n=file.name.match(/(?:^|\D)((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[_-]?(\d{2})[-:.]?(\d{2}))?/);
  if(n){const t=parseDateString(`${n[1]}-${n[2]}-${n[3]} ${n[4]||"12"}:${n[5]||"00"}`);if(validCapture(t))return {date:t,source:"filename"};}
  return null;
}
function loadImage(blob){return new Promise((resolve,reject)=>{const src=URL.createObjectURL(blob);const img=new Image();img.onload=()=>{URL.revokeObjectURL(src);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(src);reject(new Error("이미지를 열 수 없어요."));};img.src=src;});}
async function compressImage(file){
  const img=await loadImage(file);
  const scale=Math.min(1,1000/img.naturalWidth,1000/img.naturalHeight);
  const canvas=document.createElement("canvas");canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
  canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",.75);
}
async function uploadFiles(files){
  if(busy)return;
  busy=true;
  let added=0;
  try{
    for(const file of files){
      if(!file.type.startsWith("image/")){toast("이미지 파일만 선택할 수 있어요.");continue;}
      const found=await detectPhotoDate(file);
      let capturedAt=found?.date??null, dateSource=found?.source??"manual";
      if(capturedAt===null){capturedAt=await chooseMissingPhotoDate();if(capturedAt===null)continue;}
      const image=await compressImage(file);
      await db.ref("incoming").push({image,capturedAt,dateSource,timestamp:Date.now()});
      added++;
    }
    if(added){toast(`${added}장의 사진을 인화실에 걸었어요.`);busy=false;goRoom("darkroom");}
  }catch(e){console.error(e);toast("사진 저장 실패: "+e.message);}finally{busy=false;}
}

// 날짜 입력 — 숫자는 직접 교체, 회색 YYYY-MM-DD 마스크, 우측 네이티브 달력
function dateFromParts(mask,time){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(mask);const t=/^(\d{2}):(\d{2})$/.exec(time);
  if(!m||!t)return null;
  const d=new Date(+m[1],+m[2]-1,+m[3],+t[1],+t[2]);
  if(d.getFullYear()!==+m[1]||d.getMonth()!==+m[2]-1||d.getDate()!==+m[3]||d.getHours()!==+t[1]||d.getMinutes()!==+t[2])return null;
  return d.getTime();
}
function dialogFrame(title,description=""){
  const layer=document.createElement("div");layer.className="overlay";
  const box=document.createElement("div");box.className="dialog";box.setAttribute("role","dialog");box.setAttribute("aria-modal","true");
  const top=document.createElement("div");top.className="dialog-head";
  const h=document.createElement("h3");h.textContent=title; const x=document.createElement("button");x.type="button";x.textContent="✕ 닫기";
  top.append(h,x);box.append(top);
  if(description){const p=document.createElement("p");p.className="sub";p.textContent=description;box.append(p);}
  layer.append(box);$("modal-root").append(layer);
  return {layer,box,x};
}
function chooseMissingPhotoDate(){
  return new Promise(resolve=>{
    const {layer,box,x}=dialogFrame("사진 날짜 지정","언제 생성된 사진인지 확인 할 수 없어요. 저장할 날짜를 입력해주세요!");
    const label=document.createElement("label");label.className="field";label.innerHTML="<span>사진 날짜</span>";
    const combined=document.createElement("div");combined.className="date-combined";
    const display=document.createElement("div");display.className="date-display";
    const input=document.createElement("input");input.className="masked-date";input.type="text";input.inputMode="numeric";input.autocomplete="off";input.setAttribute("aria-label","날짜 직접 입력");
    const picker=document.createElement("div");picker.className="picker-wrap";picker.textContent="▦";
    const native=document.createElement("input");native.type="date";native.setAttribute("aria-label","달력 열기");picker.append(native);
    combined.append(display,input,picker);label.append(combined);
    const tm=document.createElement("label");tm.className="field";tm.innerHTML="<span>시간</span>";
    const time=document.createElement("input");time.type="time";time.value=clockTime(Date.now());tm.append(time);
    const error=document.createElement("p");error.className="error";error.hidden=true;
    const actions=document.createElement("div");actions.className="dialog-actions";
    const cancel=document.createElement("button");cancel.textContent="취소";const ok=document.createElement("button");ok.className="solid";ok.textContent="이 날짜로 저장";actions.append(cancel,ok);
    box.append(label,tm,error,actions);
    let mask=localDay(Date.now()),cursor=0;
    const base="YYYY-MM-DD";const slots=[0,1,2,3,5,6,8,9];
    const next=p=>slots.find(n=>n>=p)??10;
    const prev=p=>[...slots].reverse().find(n=>n<p)??null;
    function render(){
      input.value=mask;display.replaceChildren();
      [...mask].forEach(c=>{const el=document.createElement("span");el.textContent=c;if(/[YMD]/.test(c))el.className="ghost";display.append(el);});
      try{input.setSelectionRange(cursor,cursor);}catch{}
    }
    function insert(text){const chars=[...mask];let pos=next(cursor);for(const n of String(text).replace(/\D/g,"")){if(pos>=10)break;chars[pos]=n;pos=next(pos+1);}mask=chars.join("");cursor=pos;if(dateFromParts(mask,"12:00")!==null)native.value=mask;render();}
    function erase(backward=true){const pos=backward?prev(cursor):next(cursor);if(pos===null||pos>=10)return;mask=mask.slice(0,pos)+base[pos]+mask.slice(pos+1);cursor=pos;render();}
    function onBefore(e){
      const kind=e.inputType;
      if(kind==="insertText"||kind==="insertCompositionText"||kind==="insertReplacementText"){if(e.cancelable)e.preventDefault();insert(e.data||"");}
      else if(kind==="deleteContentBackward"){if(e.cancelable)e.preventDefault();erase(true);}
      else if(kind==="deleteContentForward"){if(e.cancelable)e.preventDefault();erase(false);}
    }
    input.addEventListener("beforeinput",onBefore);
    input.addEventListener("keydown",e=>{
      if(e.key==="ArrowLeft"){e.preventDefault();cursor=prev(cursor)??0;render();}
      if(e.key==="ArrowRight"){e.preventDefault();cursor=next(cursor+1);render();}
      if(e.key==="Backspace"&&!e.defaultPrevented){e.preventDefault();erase(true);}
      if(/^\d$/.test(e.key)&&!e.defaultPrevented){e.preventDefault();insert(e.key);}
    });
    input.addEventListener("click",()=>{cursor=next(input.selectionStart??0);render();});
    input.addEventListener("paste",e=>{e.preventDefault();const digits=(e.clipboardData?.getData("text")||"").replace(/\D/g,"");if(digits.length===8){mask=base;cursor=0;}insert(digits);});
    native.value=mask;
    native.addEventListener("change",()=>{if(!native.value)return;mask=native.value;cursor=0;render();});
    const close=v=>{layer.remove();resolve(v);};
    x.onclick=()=>close(null);cancel.onclick=()=>close(null);
    ok.onclick=()=>{const t=dateFromParts(mask,time.value);if(t===null){error.hidden=false;error.textContent="날짜와 시간을 모두 올바르게 입력해 주세요.";return;}close(t);};
    render();
  });
}

// -------------------------------------------------------------------
// 6. 메모 편집기: 사진 위 / 기록 아래, 기존 rich HTML 호환
// -------------------------------------------------------------------
function cleanRich(html){
  if(!window.DOMPurify)return "";
  return DOMPurify.sanitize(html,{
    ALLOWED_TAGS:["div","p","br","span","b","strong","em","i","u","font","ul","ol","li","input"],
    ALLOWED_ATTR:["style","class","type","checked","size","color","contenteditable"]
  });
}
function focusSavedRange(editor){
  const sel=window.getSelection();if(!sel)return;
  if(lastSelectedRange && editor.contains(lastSelectedRange.commonAncestorContainer)){
    try{sel.removeAllRanges();sel.addRange(lastSelectedRange);}catch{}
  }else{editor.focus();}
}
function formatSelection(editor,prop,value){
  const sel=window.getSelection();
  let range=lastSelectedRange?.cloneRange();
  if(sel?.rangeCount){const current=sel.getRangeAt(0);if(editor.contains(current.commonAncestorContainer)&&!current.collapsed)range=current.cloneRange();}
  if(!range||range.collapsed||!editor.contains(range.commonAncestorContainer)){toast("꾸밀 글자를 먼저 선택해 주세요.");return;}
  try{
    const node=document.createElement("span");node.style[prop]=value;node.append(range.extractContents());range.insertNode(node);
    const r=document.createRange();r.selectNodeContents(node);lastSelectedRange=r.cloneRange();
    sel.removeAllRanges();sel.addRange(r);
  }catch(e){console.error(e);toast("선택한 글자를 다시 지정해 주세요.");}
}
function checkboxOnCurrentLine(editor){
  const sel=window.getSelection();let range=lastSelectedRange?.cloneRange();
  if(sel?.rangeCount){const r=sel.getRangeAt(0);if(editor.contains(r.startContainer))range=r.cloneRange();}
  let node=range?.startContainer||editor.lastChild;
  if(node?.nodeType===Node.TEXT_NODE)node=node.parentNode;
  while(node&&node!==editor&&!/^(DIV|P|LI)$/.test(node.nodeName))node=node.parentNode;
  if(!node||node===editor){
    // 직접 입력한 텍스트가 root에 붙어 있는 경우 그 줄 하나만 감싼다.
    const block=document.createElement("div");
    const child=range?.startContainer;
    if(child?.nodeType===Node.TEXT_NODE&&child.parentNode===editor){editor.insertBefore(block,child);block.appendChild(child);}
    else{block.append(document.createElement("br"));editor.append(block);}
    node=block;
  }
  if(node.classList?.contains("memo-task"))return;
  const task=document.createElement("div");task.className="memo-task";task.contentEditable="false";
  const check=document.createElement("input");check.type="checkbox";check.setAttribute("contenteditable","false");
  const span=document.createElement("span");span.contentEditable="true";
  while(node.firstChild)span.append(node.firstChild);
  if(!span.hasChildNodes())span.append(document.createElement("br"));
  task.append(check,span);node.replaceWith(task);
  const r=document.createRange();r.selectNodeContents(span);r.collapse(false);lastSelectedRange=r.cloneRange();
  // 체크박스를 만들 때는 키보드를 강제로 열지 않음.
}
function editToolbar(editor){
  const bar=document.createElement("div");bar.className="format-tools";
  const definitions=[
    ["B","bold"],["매우 크게","32"],["크게","24"],["중간","16"],["작게","12"],
    ["• 목록","ul"],["1. 목록","ol"],["☐ 체크","check"]
  ];
  for(const [label,command] of definitions){const btn=document.createElement("button");btn.type="button";btn.textContent=label;btn.dataset.cmd=command;bar.append(btn);}
  for(const color of ["#e74d4d","#f09537","#368a54","#3977db","#9254ce"]){const btn=document.createElement("button");btn.type="button";btn.dataset.color=color;btn.style.setProperty("--tone",color);btn.title="글씨 색상";btn.setAttribute("aria-label",color);bar.append(btn);}
  bar.addEventListener("pointerdown",()=>{
    const s=window.getSelection();if(s?.rangeCount&&editor.contains(s.getRangeAt(0).commonAncestorContainer))lastSelectedRange=s.getRangeAt(0).cloneRange();
  },true);
  bar.addEventListener("mousedown",e=>{if(e.target.closest("button"))e.preventDefault();});
  bar.addEventListener("click",e=>{
    const btn=e.target.closest("button");if(!btn)return;
    if(btn.dataset.color)formatSelection(editor,"color",btn.dataset.color);
    else if(btn.dataset.cmd==="bold")formatSelection(editor,"fontWeight","bold");
    else if(/^\d+$/.test(btn.dataset.cmd))formatSelection(editor,"fontSize",btn.dataset.cmd+"px");
    else if(btn.dataset.cmd==="check")checkboxOnCurrentLine(editor);
    else{focusSavedRange(editor);document.execCommand(btn.dataset.cmd==="ul"?"insertUnorderedList":"insertOrderedList",false,null);}
  });
  return bar;
}
function makeField(label,initial=""){
  const field=document.createElement("div");field.className="field";
  const lab=document.createElement("label");lab.textContent=label;
  const input=document.createElement("input");input.type="text";input.value=initial;
  field.append(lab,input);return {field,input};
}
function openEditor(source,key){
  if(batchMode||busy)return;
  const data=record(source,key);if(!data)return;
  editorItem={source,key};lastSelectedRange=null;
  const ui=dialogFrame(source==="incoming"?"사진에 기억 남기기":"앨범의 기록 수정하기", "사진을 누르면 크게 볼 수 있어요.");
  const heading=makeField("제목",data.labelTxt||"");heading.input.placeholder="비워두면 사진 날짜가 제목이 돼요";heading.input.maxLength=80;
  const img=new Image();img.src=data.image;img.alt="메모 이미지";img.className="edit-image";img.onclick=()=>openPhotoViewer(data.image);
  const label=document.createElement("div");label.className="field";label.innerHTML="<label>상세 메모</label>";
  const editor=document.createElement("div");editor.className="rich-editor";editor.contentEditable="true";editor.setAttribute("role","textbox");editor.setAttribute("aria-multiline","true");editor.dataset.placeholder="오늘 있었던 일을 자유롭게 기록해 보세요.";
  if(data.longMemoHtml && window.DOMPurify)editor.innerHTML=cleanRich(data.longMemoHtml);
  else {
    // 이전 버전의 일반 텍스트도 줄 단위로 나누어 체크박스가 줄 앞에 붙게 함
    const lines=String(data.longMemo||"").split(/\r?\n/);
    for(const line of lines){const div=document.createElement("div");if(line)div.textContent=line;else div.append(document.createElement("br"));editor.append(div);}
  }
  editor.querySelectorAll(".memo-task span").forEach(s=>s.contentEditable="true");
  editor.querySelectorAll(".memo-task input").forEach(input=>{input.checked=input.hasAttribute("checked");});
  editor.addEventListener("keyup",()=>{const s=window.getSelection();if(s?.rangeCount&&editor.contains(s.getRangeAt(0).commonAncestorContainer))lastSelectedRange=s.getRangeAt(0).cloneRange();});
  editor.addEventListener("touchend",()=>setTimeout(()=>{const s=window.getSelection();if(s?.rangeCount&&editor.contains(s.getRangeAt(0).commonAncestorContainer))lastSelectedRange=s.getRangeAt(0).cloneRange();},20));
  editor.addEventListener("paste",e=>{e.preventDefault();const text=e.clipboardData?.getData("text/plain")||"";document.execCommand("insertText",false,text);});
  const toolbar=editToolbar(editor);const actions=document.createElement("div");actions.className="dialog-actions";
  const dateBtn=document.createElement("button");dateBtn.textContent="날짜 변경";
  const cancel=document.createElement("button");cancel.textContent="취소";
  const save=document.createElement("button");save.className="solid";save.textContent=source==="incoming"?"보관함에 저장":"변경사항 저장";
  actions.append(dateBtn,cancel,save);label.append(toolbar,editor);ui.box.append(heading.field,img,label,actions);
  ui.x.onclick=()=>{ui.layer.remove();editorItem=null;};cancel.onclick=ui.x.onclick;
  dateBtn.onclick=async()=>{
    const picked=await chooseMissingPhotoDate();
    if(picked===null)return;
    try{await db.ref(pathFor(source)).child(key).update({capturedAt:picked,dateSource:"manual"});data.capturedAt=picked;toast("사진 날짜가 변경됐어요.");}
    catch(e){toast("날짜 변경 실패: "+e.message);}
  };
  save.onclick=async()=>{
    if(busy)return;busy=true;save.disabled=true;save.textContent="저장 중...";
    try{
      editor.querySelectorAll('.memo-task input[type="checkbox"]').forEach(c=>c.toggleAttribute("checked",c.checked));
      const content=editor.innerText||"";
      const html=cleanRich(editor.innerHTML);
      const title=heading.input.value.trim()||localDay(memoTime(data));
      const updated={image:data.image,labelTxt:title,longMemo:content,longMemoHtml:html,capturedAt:data.capturedAt??memoTime(data),dateSource:data.dateSource||"manual",timestamp:data.timestamp||Date.now()};
      if(source==="incoming"){
        await db.ref("saved_memos").child(key).set(updated);
        try{await db.ref("incoming").child(key).remove();}catch(e){console.warn("수신함 정리 실패",e);toast("저장은 됐지만 인화실 정리가 필요해요.");}
      }else await db.ref("saved_memos").child(key).update(updated);
      ui.layer.remove();editorItem=null;toast("기록을 저장했어요.");
    }catch(e){console.error(e);toast("저장 실패: "+e.message);}finally{busy=false;save.disabled=false;save.textContent="저장";}
  };
}
function openPhotoViewer(src){$("viewer-image").src=src;$("photo-viewer").hidden=false;}
function closePhotoViewer(){$("photo-viewer").hidden=true;$("viewer-image").src="";}

// -------------------------------------------------------------------
// 7. 길게 누르기 → 다중 선택 → 일괄 날짜 변경 / 삭제
// -------------------------------------------------------------------
function enterBatch(source,key){batchMode=true;batchSelected.add(itemId(source,key));refreshBatch();if(navigator.vibrate)navigator.vibrate(20);}
function toggleBatch(source,key){const id=itemId(source,key);if(batchSelected.has(id))batchSelected.delete(id);else batchSelected.add(id);refreshBatch();}
function leaveBatch(){if(busy)return;batchMode=false;batchSelected.clear();refreshBatch();}
function visibleCards(){return [...document.querySelectorAll(archiveOpen?".album-photo[data-key]":".polaroid[data-key]")];}
function refreshBatch(){
  document.body.classList.toggle("batch-mode",batchMode);$("batch-bar").hidden=!batchMode;
  document.querySelectorAll(".polaroid[data-key],.album-photo[data-key]").forEach(el=>el.classList.toggle("selected",batchSelected.has(itemId(el.dataset.source,el.dataset.key))));
  $("batch-count").textContent=`${batchSelected.size}개 선택됨`;
  $("batch-all").textContent=visibleCards().length&&visibleCards().every(el=>batchSelected.has(itemId(el.dataset.source,el.dataset.key)))?"전체 해제":"전체 선택";
  $("batch-date").disabled=$("batch-delete").disabled=batchSelected.size===0||busy;
}
function toggleAll(){
  const cards=visibleCards();const all=cards.length&&cards.every(el=>batchSelected.has(itemId(el.dataset.source,el.dataset.key)));
  cards.forEach(el=>{const id=itemId(el.dataset.source,el.dataset.key);if(all)batchSelected.delete(id);else batchSelected.add(id);});refreshBatch();
}
function selectedItems(){return [...batchSelected].map(splitId).filter(x=>record(x.source,x.key));}
function askDelete(count){
  return new Promise(resolve=>{
    const ui=dialogFrame("정말로 삭제하시겠습니까?",`선택한 ${count}개의 사진/메모가 삭제돼요. 삭제 후 복구할 수 없어요.`);
    const row=document.createElement("label");row.style.cssText="display:flex;gap:8px;align-items:center;font-size:12px;color:#7a8598;margin-top:20px";
    const check=document.createElement("input");check.type="checkbox";row.append(check,document.createTextNode("다시 보지 않기"));
    const actions=document.createElement("div");actions.className="dialog-actions";
    const cancel=document.createElement("button");cancel.textContent="취소";
    const ok=document.createElement("button");ok.className="danger";ok.textContent="삭제";
    actions.append(cancel,ok);ui.box.append(row,actions);
    const end=value=>{ui.layer.remove();resolve(value);};ui.x.onclick=cancel.onclick=()=>end(false);
    ok.onclick=()=>{if(check.checked){try{localStorage.setItem(SKIP_DELETE,"1");}catch{}}end(true);};
  });
}
async function batchDelete(){
  const items=selectedItems();if(!items.length||busy)return;
  let skip=false;try{skip=localStorage.getItem(SKIP_DELETE)==="1";}catch{}
  if(!skip&&!(await askDelete(items.length)))return;
  busy=true;let success=0;
  try{
    for(const {source,key} of items){try{await db.ref(pathFor(source)).child(key).remove();success++;batchSelected.delete(itemId(source,key));}catch(e){console.error(e);}}
    toast(`${success}개의 기록을 삭제했어요.`);
  }finally{busy=false;if(!batchSelected.size)leaveBatch();else refreshBatch();}
}
async function batchChangeDate(){
  const items=selectedItems();if(!items.length||busy)return;
  const chosen=await chooseMissingPhotoDate();if(chosen===null)return;
  busy=true;let success=0;
  try{
    for(const {source,key} of items){
      const data=record(source,key);if(!data)continue;
      const old=new Date(memoTime(data)),day=new Date(chosen);
      const updated=new Date(day.getFullYear(),day.getMonth(),day.getDate(),old.getHours(),old.getMinutes(),old.getSeconds()).getTime();
      try{await db.ref(pathFor(source)).child(key).update({capturedAt:updated,dateSource:"manual"});success++;batchSelected.delete(itemId(source,key));}catch(e){console.error(e);}
    }
    toast(`${success}개의 날짜를 바꿨어요.`);
  }finally{busy=false;if(!batchSelected.size)leaveBatch();else refreshBatch();}
}

// -------------------------------------------------------------------
// 8. 초기화
// -------------------------------------------------------------------
function setupViewportResize(){
  const apply=()=>document.documentElement.style.setProperty("--visual-height",(window.visualViewport?.height||window.innerHeight)+"px");
  apply();window.visualViewport?.addEventListener("resize",apply);window.addEventListener("resize",apply);
}
function init(){
  // 예전 좌우 이동 버튼을 제거했더라도 오류가 나지 않게 함
  $("archive-tab").onclick=()=>setArchive(true);
  $("archive-close").onclick=()=>setArchive(false);
  $("archive-grip").onclick=()=>setArchive(false);
  $("camera-btn").onclick=()=>$("camera-input").click();
  $("gallery-btn").onclick=()=>$("gallery-input").click();
  for(const id of ["camera-input","gallery-input"]){
    const input=$(id);
    input.onchange=async()=>{const files=[...(input.files||[])];input.value="";await uploadFiles(files);};
  }
  $("archive-search").oninput=drawAlbums;
  $("archive-date").onchange=drawAlbums;
  $("archive-reset").onclick=()=>{$("archive-search").value="";$("archive-date").value="";drawAlbums();};
  $("viewer-close").onclick=closePhotoViewer;
  $("batch-all").onclick=toggleAll;
  $("batch-cancel").onclick=leaveBatch;
  $("batch-delete").onclick=batchDelete;
  $("batch-date").onclick=batchChangeDate;
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("photo-viewer").hidden)closePhotoViewer();});
  setupSwipes();setupArchiveRailDrag();setupViewportResize();
  if (!db || typeof db.ref !== "function") {
    toast("Firebase 연결을 확인해 주세요. 인터넷 또는 Firebase 설정을 확인하세요.");
    console.error("Firebase Realtime Database가 초기화되지 않았습니다.");
  } else {
    subscribe("incoming", incoming);
    subscribe("saved_memos", saved);
  }
  drawDarkroom();drawAlbums();drawCoverPolaroids();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
