/* Capture to Memo — Acrylic Album Edition / Full Rebuild 2026
   Firebase 경로는 기존 프로젝트와 동일: incoming, saved_memos
   새 UI: 표지 ↔ 인화실 / 아래에서 올라오는 사진 앨범
*/
"use strict";
const $ = (id) => document.getElementById(id);
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
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}
function pad(n) {
  return String(n).padStart(2, "0");
}
function localDay(ms) {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function clockTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function timestamp(value) {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number")
    return Number.isFinite(value) && value > 0
      ? value < 1e12
        ? value * 1000
        : value
      : null;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    const d = Date.parse(value);
    return Number.isFinite(d) ? d : null;
  }
  return null;
}
function memoTime(data) {
  return (
    timestamp(data?.capturedAt) ??
    timestamp(data?.timestamp) ??
    timestamp(data?.createdAt) ??
    Date.now()
  );
}
function relativeDay(day) {
  const today = localDay(Date.now());
  const yesterday = localDay(Date.now() - 86400000);
  return day === today
    ? "오늘"
    : day === yesterday
      ? "어제"
      : day.replaceAll("-", ".");
}
function record(source, key) {
  return (source === "incoming" ? incoming : saved).get(key);
}
function pathFor(source) {
  return source === "incoming" ? "incoming" : "saved_memos";
}
function itemId(source, key) {
  return `${source}:${key}`;
}
function splitId(id) {
  const n = id.indexOf(":");
  return { source: id.slice(0, n), key: id.slice(n + 1) };
}
function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}

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
  const cutoff = Date.now() - 7 * 86400000;
  const rows = [];
  for (const [key, data] of saved) {
    if (!data?.image) continue;
    // Old entries did not store savedAt; timestamp is a fallback, not exact archive date.
    const archivedAt =
      timestamp(data.savedAt) ??
      timestamp(data.archivedAt) ??
      timestamp(data.timestamp) ??
      timestamp(data.createdAt);
    if (archivedAt === null || archivedAt > cutoff) continue;
    rows.push({ source: "locker", key, data, t: memoTime(data) });
  }
  return rows;
}

function dailyShuffle(rows, day) {
  // Deterministic Fisher-Yates: stable during a calendar day and after reload.
  let seed = 2166136261;
  const ordered = [...rows].sort((a, b) => a.key.localeCompare(b.key));
  for (const ch of String(day) + ":" + ordered.map((x) => x.key).join("|")) {
    seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  for (let i = ordered.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
  }
  return ordered;
}

function scheduleDailyCoverRefresh() {
  const n = new Date();
  const midnight = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  setTimeout(
    () => {
      drawCoverPolaroids();
      scheduleDailyCoverRefresh();
    },
    Math.max(1000, midnight.getTime() - Date.now() + 250),
  );
}

function applyCoverPhotoTilt() {
  const host = $("cover-photo-floats");
  if (!host) return;

  // 실제 Three.js 책과 겹치지 않도록 서로 다른 위치 / 방향으로 배치
  const layouts = [
    { left: "51%", top: "23%", rot: 12, rx: 11, ry: -30, scale: 0.7 },
    { left: "89%", top: "41%", rot: -10, rx: -10, ry: 23, scale: 1.02 },
    { left: "82%", top: "79%", rot: 30, rx: 20, ry: -40, scale: 0.82 },
  ];

  const cards = [
    ...host.querySelectorAll(".cover-float-card, .cover-float-shot"),
  ];
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
  const today = localDay(Date.now());
  const chosen = dailyShuffle(coverPhotoPool(), today).slice(0, 3);
  const ids = chosen.map((x) => x.key).join("|") + ":" + today;
  // Firebase updates can trigger frequent repaints; do not restart float animations.
  if (host.dataset.currentPhotos === ids) return;
  host.dataset.currentPhotos = ids;
  host.replaceChildren();
  host.hidden = chosen.length === 0;
  coverFloatingIds = chosen.map((item) => itemId(item.source, item.key));
  chosen.forEach((item, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `cover-float-card pos-${index + 1}`;
    card.title = "사진을 눌러 메모 편집";
    card.draggable = false;
    card.setAttribute(
      "aria-label",
      `${item.data.labelTxt || localDay(item.t)} 메모 편집`,
    );
    const img = new Image();
    img.src = item.data.image;
    img.alt = item.data.labelTxt || "기록된 사진";
    img.draggable = false;
    const label = document.createElement("span");
    label.className = "cover-float-label";
    label.textContent =
      item.data.labelTxt?.trim() || localDay(item.t) || "MEMO";
    card.append(img, label);
    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!busy && !batchMode) openEditor("locker", item.key);
    });
    host.append(card);
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
  const target = next === "darkroom" ? world.clientWidth : 0;
  world.scrollTo({
    left: target,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
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
    const deltaX = world.scrollLeft - lastWireScrollLeft;
    lastWireScrollLeft = world.scrollLeft;
    if (Math.abs(deltaX) > 0.5) nudgeDarkroomPhotos(deltaX);
    const max = Math.max(1, world.scrollWidth - world.clientWidth);
    const progress = THREE_SAFE_CLAMP(
      world.scrollLeft / Math.max(1, world.clientWidth),
    );
    // 화면을 왼쪽으로 1/3 이상 밀었을 때 최초 등장
    if (progress >= 1 / 3) {
      beginDarkroomRevealOnce();
    }

    window.__ctmRoomProgress = progress;
    window.dispatchEvent(
      new CustomEvent("ctm-room-progress", { detail: { progress } }),
    );
    room = progress >= 0.5 ? "darkroom" : "cover";
    document.body.classList.toggle("in-darkroom", room === "darkroom");
  }
  function THREE_SAFE_CLAMP(n) {
    return Math.max(0, Math.min(1, n));
  }
  world.addEventListener(
    "scroll",
    () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        syncScroll();
      });
    },
    { passive: true },
  );

  // PC: 배경을 마우스로 끌면 그만큼 이동, 손을 놓은 위치에 유지
  let mouse = null;
  let suppressClickUntil = 0;
  const blocked = (target) => {
    if (!(target instanceof Element)) return false;
    // 실제 인화실의 사진은 PC에서도 잡아 좌우로 드래그 가능
    if (target.closest("#front-photo-layer .hanging-polaroid")) return true;
    return !!target.closest(
      "button,input,textarea,select,[contenteditable]," +
        ".cover-float-card,.cover-float-shot,.album-photo,.album-cover," +
        ".dialog,.overlay,.archive-tools,.cover-controls",
    );
  };

  world.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      batchMode ||
      busy ||
      archiveOpen ||
      blocked(event.target)
    )
      return;
    mouse = {
      id: event.pointerId,
      x: event.clientX,
      left: world.scrollLeft,
      moved: false,
    };
    // 캡처는 드래그가 감지된 다음에만. 단순 사진 클릭은 유지.
  });

  world.addEventListener("pointermove", (event) => {
    if (!mouse || mouse.id !== event.pointerId) return;
    const dx = event.clientX - mouse.x;
    if (Math.abs(dx) > 7 && !mouse.moved) {
      mouse.moved = true;
      world.setPointerCapture(event.pointerId);
    }
    if (mouse.moved) world.scrollLeft = mouse.left - dx;
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
  world.addEventListener(
    "click",
    (event) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  // 보관함 세로 제스처는 이전 기능대로 유지
  let verticalStart = null;
  document.addEventListener(
    "touchstart",
    (event) => {
      if (
        event.touches.length !== 1 ||
        batchMode ||
        busy ||
        (event.target instanceof Element &&
          !!event.target.closest(
            "#front-photo-layer .hanging-polaroid,.cover-float-card,#memo-drop-zone,#shred-zone",
          )) ||
        darkroomPhysics.photoDrag?.active ||
        document.querySelector(".overlay:not([hidden])")
      ) {
        verticalStart = null;
        return;
      }
      const touch = event.touches[0];

      verticalStart = {
        x: touch.clientX,
        y: touch.clientY,
        target: event.target,
        startedAt: performance.now(),

        // 앨범 페이지를 읽기 위해 스크롤 중인지 기록
        pageScrollTop:
          event.target instanceof Element
            ? event.target.closest(".album-page")?.scrollTop || 0
            : 0,
      };
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "touchend",
    (event) => {
      if (!verticalStart || event.changedTouches.length !== 1) return;
      const start = verticalStart;
      verticalStart = null;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dy) < 65 || Math.abs(dy) < Math.abs(dx) * 1.3) return;

      if (archiveOpen) {
        const elapsed = performance.now() - start.startedAt;

        const startedInArchive =
          start.target instanceof Element &&
          !!start.target.closest("#archive-sheet");

        const onInput =
          start.target instanceof Element &&
          !!start.target.closest("input,textarea,select,[contenteditable]");

        // 보관함에서 아래로 빠르게 스와이프
        if (
          startedInArchive &&
          !onInput &&
          !batchMode &&
          !busy &&
          dy > 105 &&
          elapsed < 550 &&
          dy > Math.abs(dx) * 1.3 &&
          start.pageScrollTop < 3
        ) {
          setArchive(false);
        }
      } else if (dy < 0 && start.y > window.innerHeight * 0.62) {
        setArchive(true);
      }
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "touchcancel",
    () => {
      verticalStart = null;
    },
    { capture: true, passive: true },
  );

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
  rail.addEventListener("pointerdown", (event) => {
    if (
      event.pointerType !== "mouse" ||
      event.button !== 0 ||
      batchMode ||
      busy
    )
      return;
    if (event.target.closest("input,textarea,[contenteditable],.archive-tools"))
      return;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rail.scrollLeft,
      moved: false,
    };
  });
  rail.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 8) {
      drag.moved = true;
      rail.setPointerCapture(event.pointerId);
    }
    if (drag.moved) {
      rail.scrollLeft = drag.left - dx;
      event.preventDefault();
    }
  });
  function end(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved) archiveDragSuppressUntil = performance.now() + 450;
    if (rail.hasPointerCapture(event.pointerId))
      rail.releasePointerCapture(event.pointerId);
    drag = null;
  }
  rail.addEventListener("pointerup", end);
  rail.addEventListener("pointercancel", end);
  // 이미지가 드래그될 때 브라우저 고유 이미지 끌기 동작 방지.
  rail.addEventListener("dragstart", (event) => event.preventDefault());
  rail.addEventListener(
    "click",
    (event) => {
      if (performance.now() < archiveDragSuppressUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
}

// -------------------------------------------------------------------
// 2. Firebase 읽기: 이전 앱 / mobile.html 과 같은 DB 사용
// -------------------------------------------------------------------
function schedulePaint() {
  if (paintScheduled) return;
  paintScheduled = true;
  requestAnimationFrame(() => {
    paintScheduled = false;
    drawDarkroom();
    drawAlbums();
    drawCoverPolaroids();
    refreshBatch();
  });
}
function subscribe(path, map) {
  const ref = db.ref(path);
  ref.on(
    "child_added",
    (s) => {
      if (s.val()?.image) map.set(s.key, s.val());
      schedulePaint();
    },
    (e) => toast("데이터를 읽지 못했어요: " + e.message),
  );
  ref.on("child_changed", (s) => {
    if (s.val()?.image) map.set(s.key, s.val());
    else map.delete(s.key);
    schedulePaint();
  });
  ref.on("child_removed", (s) => {
    map.delete(s.key);
    batchSelected.delete(
      itemId(path === "incoming" ? "incoming" : "locker", s.key),
    );
    schedulePaint();
  });
}

// -------------------------------------------------------------------
// 3. 사진 인화실: 경사진 두 줄 + 물리 기반 폴라로이드
// -------------------------------------------------------------------
function installPhotoInteraction(el, source, key) {
  el.dataset.source = source;
  el.dataset.key = key;
  el.draggable = false;
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  let hold = null,
    origin = null,
    suppress = false;
  el.addEventListener("pointerdown", (e) => {
    if (busy || batchMode || (e.pointerType === "mouse" && e.button !== 0))
      return;
    origin = { x: e.clientX, y: e.clientY, id: e.pointerId };
    suppress = false;
    if (el.classList.contains("hanging-polaroid")) return;
    hold = setTimeout(() => {
      hold = null;
      suppress = true;
      enterBatch(source, key);
    }, 610);
  });
  el.addEventListener("pointermove", (e) => {
    if (
      origin?.id === e.pointerId &&
      Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 11
    ) {
      clearTimeout(hold);
      hold = null;
    }
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((event) =>
    el.addEventListener(event, () => {
      clearTimeout(hold);
      hold = null;
    }),
  );
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (suppress) {
      suppress = false;
      return;
    }
    if (batchMode) {
      toggleBatch(source, key);
      return;
    }
    if (source === "incoming" && el.classList.contains("hanging-polaroid"))
      return;
    openEditor(source, key);
  });
  const check = document.createElement("span");
  check.className = "selection-check";
  check.textContent = "✓";
  check.setAttribute("aria-hidden", "true");
  el.appendChild(check);
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
  width: 0,
  height: 0,
  photoDrag: null,
  revealStarted: false,
  nextSpawnAt: 0,
  spawnGap: 250,
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

// Tracks span the entire 2-page world, visually crossing one another.
// t=0 is at the far left of the cover; t=1 is at the far right of darkroom.
function getDarkroomWirePoint(t, rear = false) {
  const w = darkroomPhysics.width || $("darkroom-scene")?.clientWidth || 900;
  const h = darkroomPhysics.height || $("darkroom-scene")?.clientHeight || 700;
  return {
    x: (2 * t - 1) * w,
    y: (rear ? 0.74 - 0.58 * t : 0.16 + 0.34 * t) * h,
  };
}
function updateDarkroomWires() {
  const scene = $("darkroom-scene");
  const svg = $("world-wire-overlay");
  if (!scene || !svg) return;
  darkroomPhysics.width = Math.max(1, scene.clientWidth);
  darkroomPhysics.height = Math.max(1, scene.clientHeight);
  const track = $("world-track");
  const w = darkroomPhysics.width * 2;
  const h = darkroomPhysics.height;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  const front = $("front-wire"),
    rear = $("rear-wire");
  if (front) {
    front.setAttribute("x1", 0);
    front.setAttribute("y1", h * 0.16);
    front.setAttribute("x2", w);
    front.setAttribute("y2", h * 0.5);
  }
  if (rear) {
    rear.setAttribute("x1", 0);
    rear.setAttribute("y1", h * 0.74);
    rear.setAttribute("x2", w);
    rear.setAttribute("y2", h * 0.16);
  }
  renderRearDarkroomDecor();
  renderDarkroomBendingWire();
}
function renderRearDarkroomDecor() {
  const layer = $("rear-deco-layer");
  if (!layer) return;
  layer.replaceChildren();
  [0.56, 0.72, 0.89].forEach((t, index) => {
    const blank = document.createElement("div");
    blank.className = "rear-empty";
    blank.setAttribute("aria-hidden", "true");
    blank.innerHTML =
      '<span class="wire-clip"></span><span class="rear-empty-photo"></span>';
    const p = getDarkroomWirePoint(t, true);
    blank.style.left = `${p.x}px`;
    blank.style.top = `${p.y}px`;
    blank.style.transform = `translateX(-50%) rotate(${[-13, 9, -6][index]}deg)`;
    layer.append(blank);
  });
}

function makeHangingPhoto(key, data, t) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "polaroid hanging-polaroid";
  card.title = "사진을 눌러 편집 / 길게 눌러 다중 선택";
  card.style.zIndex = "4";
  const clip = document.createElement("span");
  clip.className = "wire-clip";
  clip.setAttribute("aria-hidden", "true");
  const img = new Image();
  img.src = data.image;
  img.alt = "인화실에 걸린 사진";
  img.draggable = false;
  const label = document.createElement("span");
  label.className = "polaroid-label";
  label.textContent = localDay(t);
  card.append(clip, img, label);
  // This is the real existing editor, not an example placeholder.
  installPhotoInteraction(card, "incoming", key);
  return { card, img, label };
}

function createDarkroomHanger(key, data, t) {
  const layer = $("front-photo-layer");
  const { card, img, label } = makeHangingPhoto(key, data, t);
  layer.append(card);
  const height = card.offsetHeight || 203;
  const width = card.offsetWidth || 168;
  const initialT = 0.32; // cover book is in front, polaroid rides behind it.
  const hanger = {
    key,
    data,
    el: card,
    img,
    label,
    cardH: height,
    cardW: width,
    t: initialT,
    targetT: initialT,
    spawnStartT: initialT,
    spawnAt: Infinity,
    landed: false,
    v: 0,
    swing: 0,
    swingV: 0,
    detached: false,
    returning: null,
    freeX: 0,
    freeY: 0,
    deleting: false,
  };
  card.style.visibility = "hidden";
  darkroomPhysics.items.set(key, hanger);
  enableDarkroomPhotoDrag(card, key);
  return hanger;
}

function removeDarkroomHanger(key) {
  const hanger = darkroomPhysics.items.get(key);
  if (!hanger) return;
  if (window.Matter && darkroomPhysics.engine) {
    if (hanger.rope)
      window.Matter.Composite.remove(darkroomPhysics.engine.world, hanger.rope);
    if (hanger.body)
      window.Matter.Composite.remove(darkroomPhysics.engine.world, hanger.body);
  }
  hanger.el.remove();
  darkroomPhysics.items.delete(key);
}

// Incoming key = Firebase push ID (chronological insertion order).
function incomingChronologicalRows() {
  return [...incoming]
    .filter(([, d]) => d?.image)
    .map(([key, data]) => ({ key, data, t: memoTime(data) }))
    .sort((a, b) => {
      const at = timestamp(a.data.timestamp) ?? 0;
      const bt = timestamp(b.data.timestamp) ?? 0;
      return at - bt || String(a.key).localeCompare(String(b.key));
    });
}

function distributeDarkroomHangers(all = incomingChronologicalRows()) {
  const attached = all.filter((row) => {
    const h = darkroomPhysics.items.get(row.key);
    return h && !h.detached && !h.deleting;
  });
  if (!attached.length) return;
  const width = Math.max(
    1,
    darkroomPhysics.width || $("darkroom-scene")?.clientWidth || 900,
  );
  const widest = Math.max(
    110,
    ...attached.map((row) => darkroomPhysics.items.get(row.key).cardW || 168),
  );
  const shredW = $("shred-zone")?.getBoundingClientRect().width || 0;
  const safeGap = widest / 2 + 32;
  const minT = 0.5 + (widest / 2 + 35) / (2 * width);
  const maxT = Math.max(minT, 1 - (shredW + safeGap) / (2 * width));
  const preferredStep = (widest + 25) / (2 * width);
  const step =
    attached.length > 1
      ? Math.min(preferredStep, (maxT - minT) / (attached.length - 1))
      : 0;
  // oldest on right, newest on left. Removed card does not occupy a slot.
  attached.forEach((row, i) => {
    const h = darkroomPhysics.items.get(row.key);
    h.targetT = maxT - i * step;
  });
}

function reflowAttachedDarkroomPhotos() {
  distributeDarkroomHangers(incomingChronologicalRows());
}

function beginDarkroomRevealOnce() {
  if (darkroomPhysics.revealStarted) return;
  const rows = incomingChronologicalRows();
  if (!rows.length) return; // will start after Firebase arrives if already scrolled.
  darkroomPhysics.revealStarted = true;
  const first = performance.now();
  rows.forEach((row, i) => {
    const h = darkroomPhysics.items.get(row.key);
    if (!h) return;
    h.spawnAt = first + i * darkroomPhysics.spawnGap;
    h.spawnStartT = 0.32;
    h.t = h.spawnStartT;
    h.landed = false;
  });
  darkroomPhysics.nextSpawnAt = first + rows.length * darkroomPhysics.spawnGap;
}

function initDarkroomLines() {
  if (darkroomPhysics.started) return;
  darkroomPhysics.started = true;
  updateDarkroomWires();
  const front = $("front-wire");
  if (front && front.tagName.toLowerCase() !== "path") {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.id = "front-wire";
    path.setAttribute("fill", "none");
    front.replaceWith(path);
  }
  darkroomPhysics.lastTime = performance.now();
  requestAnimationFrame(animateDarkroomLines);
  window.addEventListener("resize", () => {
    updateDarkroomWires();
    for (const h of darkroomPhysics.items.values()) {
      h.cardH = h.el.offsetHeight || h.cardH;
      h.cardW = h.el.offsetWidth || h.cardW;
    }
    reflowAttachedDarkroomPhotos();
  });
}

function drawDarkroom() {
  initDarkroomLines();
  const all = incomingChronologicalRows();
  $("incoming-count").textContent = `${pad(all.length)} PHOTOS`;
  $("room-empty").hidden = all.length > 0;
  const activeKeys = new Set(all.map((x) => x.key));
  for (const key of [...darkroomPhysics.items.keys()]) {
    if (!activeKeys.has(key)) removeDarkroomHanger(key);
  }
  for (const { key, data, t } of all) {
    let h = darkroomPhysics.items.get(key);
    if (!h) {
      h = createDarkroomHanger(key, data, t);
      if (darkroomPhysics.revealStarted) {
        const now = performance.now();
        h.spawnAt = Math.max(now, darkroomPhysics.nextSpawnAt);
        darkroomPhysics.nextSpawnAt = h.spawnAt + darkroomPhysics.spawnGap;
      }
    } else if (h.data.image !== data.image) {
      h.img.src = data.image;
    }
    h.data = data;
    h.label.textContent = localDay(t);
  }
  distributeDarkroomHangers(all);
  if ((Number(window.__ctmRoomProgress) || 0) >= 1 / 3)
    beginDarkroomRevealOnce();
}

// Tight, connected wire deformation; ends remain anchored.
function darkroomDragOffset(t) {
  const drag = darkroomPhysics.photoDrag;
  if (!drag || !drag.moved) return { x: 0, y: 0 };
  const pullX = 46 * Math.tanh(drag.dx / 90);
  const pullY = 58 * Math.tanh(drag.dy / 90);
  const distance = (t - drag.t) / 0.16;
  const influence = Math.exp(-0.5 * distance * distance);
  const edge = Math.max(0, Math.min(1, t / 0.07, (1 - t) / 0.07));
  const lock = edge * edge * (3 - 2 * edge);
  return { x: pullX * influence * lock, y: pullY * influence * lock };
}

function tickDarkroomPhotoDrag(dt) {
  const drag = darkroomPhysics.photoDrag;
  if (!drag || drag.active) return;
  const decay = Math.exp(-11 * dt);
  drag.dx *= decay;
  drag.dy *= decay;
  if (Math.hypot(drag.dx, drag.dy) < 0.25) darkroomPhysics.photoDrag = null;
}

function renderDarkroomBendingWire() {
  const path = $("front-wire");
  if (!path || path.tagName.toLowerCase() !== "path") return;
  const width = 2 * (darkroomPhysics.width || 900);
  const height = darkroomPhysics.height || 700;
  const cmds = [];
  for (let i = 0; i <= 128; i++) {
    const t = i / 128,
      o = darkroomDragOffset(t);
    cmds.push(
      `${i ? "L" : "M"}${(width * t + o.x).toFixed(1)},${(height * (0.16 + 0.34 * t) + o.y).toFixed(1)}`,
    );
  }
  path.setAttribute("d", cmds.join(" "));
}

function isInsideMemoTarget(id, x, y) {
  const el = $(id);
  if (!el || archiveOpen) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function playDarkroomDetachEffect(h) {
  const card = h.el;
  if (!card?.isConnected) return;
  const ring = document.createElement("span");
  ring.className = "ctm-detach-ring";
  card.append(ring);
  ring
    .animate(
      [
        { transform: "translate(-50%,-50%) scale(.2)", opacity: 1 },
        { transform: "translate(-50%,-50%) scale(2)", opacity: 0 },
      ],
      { duration: 370, easing: "ease-out" },
    )
    .finished.catch(() => {})
    .finally(() => ring.remove());
  for (let i = 0; i < 5; i++) {
    const spark = document.createElement("span");
    spark.className = "ctm-detach-spark";
    card.append(spark);
    const a = ((-130 + i * 65) * Math.PI) / 180;
    spark
      .animate(
        [
          { transform: "translate(-50%,-50%)", opacity: 1 },
          {
            transform: `translate(calc(-50% + ${Math.cos(a) * 25}px), calc(-50% + ${Math.sin(a) * 25}px)) scale(.1)`,
            opacity: 0,
          },
        ],
        { duration: 380, easing: "ease-out" },
      )
      .finished.catch(() => {})
      .finally(() => spark.remove());
  }
}

function returnDarkroomPhotoToWire(h) {
  if (!h || h.deleting) return;
  h.returning = { fromX: h.freeX, fromY: h.freeY, start: performance.now() };
  h.detached = false;
  h.landed = true;
  h.v = 0;
  h.swing = 0;
  h.swingV = 0;
  h.el.classList.remove("detached");
  reflowAttachedDarkroomPhotos();
}

function playDarkroomShredEffect(clientX, clientY) {
  const duration = 1000;
  for (let i = 0; i < 40; i++) {
    const el = document.createElement("span");
    const size = 18 + Math.random() * 28;
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 150;
    const dx = Math.cos(angle) * distance,
      dy = Math.sin(angle) * distance + 55;
    const rotation = (Math.random() - 0.5) * 720;
    el.style.cssText =
      `position:fixed;left:${clientX}px;top:${clientY}px;width:${size}px;height:${size}px;` +
      `background:#fff;clip-path:polygon(50% 0%,0% 86.6025%,100% 86.6025%);` +
      `opacity:0;pointer-events:none;z-index:9999`;
    document.body.append(el);
    const fade = el.animate(
      [
        { offset: 0, transform: "translate(-50%,-50%) scale(.3)", opacity: 0 },
        {
          offset: 0.1,
          transform: "translate(-50%,-50%) scale(1)",
          opacity: 0.4 + Math.random() * 0.5,
        },
        {
          offset: 1,
          transform: `translate(-50%,-50%) translate(${dx}px,${dy}px) rotate(${rotation}deg) scale(.25)`,
          opacity: 0,
        },
      ],
      { duration, easing: "cubic-bezier(.15,.6,.35,1)" },
    );
    fade.finished.catch(() => {}).finally(() => el.remove());
  }
}

async function shredDarkroomPhoto(h, x, y) {
  if (!h || h.deleting) return;
  h.deleting = true;
  h.el.style.pointerEvents = "none";
  playDarkroomShredEffect(x, y);
  const fade = h.el.animate(
    [
      { opacity: 1, filter: "blur(0px)" },
      { opacity: 0, filter: "blur(5px)" },
    ],
    { duration: 1000, easing: "ease-out", fill: "forwards" },
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    await db.ref("incoming").child(h.key).remove();
  } catch (err) {
    console.error("사진 파기 실패", err);
    fade.cancel();
    h.el.style.pointerEvents = "auto";
    h.deleting = false;
    returnDarkroomPhotoToWire(h);
    toast("삭제 실패: 사진을 다시 줄에 걸었어요.");
  }
}

function enableDarkroomPhotoDrag(card, key) {
  card.style.touchAction = "none";
  card.style.cursor = "grab";
  let session = null,
    suppressClick = false;
  card.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (busy || batchMode || archiveOpen || darkroomPhysics.photoDrag?.active)
      return;
    const h = darkroomPhysics.items.get(key);
    if (!h || !h.landed || h.deleting || h.returning) return;
    session = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  });
  card.addEventListener("pointermove", (event) => {
    if (!session || event.pointerId !== session.id) return;
    const h = darkroomPhysics.items.get(key);
    if (!h || h.deleting) return;
    const dx = event.clientX - session.startX,
      dy = event.clientY - session.startY;
    if (!session.moved && Math.hypot(dx, dy) < 7) return;
    if (!session.moved) {
      session.moved = true;
      suppressClick = true;
      card.classList.add("dragging");
      card.style.cursor = "grabbing";
      try {
        card.setPointerCapture(event.pointerId);
      } catch {}
      if (!h.detached)
        darkroomPhysics.photoDrag = {
          active: true,
          moved: true,
          t: h.t,
          dx: 0,
          dy: 0,
        };
    }
    if (h.detached) {
      h.freeX += event.clientX - session.lastX;
      h.freeY += event.clientY - session.lastY;
    } else {
      const drag = darkroomPhysics.photoDrag;
      if (drag) {
        drag.dx = Math.max(-260, Math.min(260, dx));
        drag.dy = Math.max(-230, Math.min(230, dy));
      }
      if (Math.hypot(dx, dy) >= 130) {
        const p = getDarkroomWirePoint(h.t);
        h.detached = true;
        // Keep the release at the previous elastic position: no sudden jump.
        const o = darkroomDragOffset(h.t);
        h.freeX = p.x + o.x;
        h.freeY = p.y + o.y;
        h.swing = 0;
        h.swingV = 0;
        card.classList.add("detached");
        if (drag) drag.active = false;
        reflowAttachedDarkroomPhotos();
        playDarkroomDetachEffect(h);
      }
    }
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    const detached = !!h.detached;
    $("memo-drop-zone")?.classList.toggle(
      "is-over",
      detached &&
        isInsideMemoTarget("memo-drop-zone", event.clientX, event.clientY),
    );
    $("shred-zone")?.classList.toggle(
      "is-over",
      detached &&
        isInsideMemoTarget("shred-zone", event.clientX, event.clientY),
    );
    event.preventDefault();
  });
  function end(event) {
    if (!session || event.pointerId !== session.id) return;
    const h = darkroomPhysics.items.get(key);
    const moved = session.moved;
    const onBook =
      moved &&
      h?.detached &&
      event.type === "pointerup" &&
      isInsideMemoTarget("memo-drop-zone", event.clientX, event.clientY);
    const onShred =
      moved &&
      h?.detached &&
      event.type === "pointerup" &&
      isInsideMemoTarget("shred-zone", event.clientX, event.clientY);
    if (darkroomPhysics.photoDrag?.active)
      darkroomPhysics.photoDrag.active = false;
    $("memo-drop-zone")?.classList.remove("is-over");
    $("shred-zone")?.classList.remove("is-over");
    card.classList.remove("dragging");
    card.style.cursor = "grab";
    session = null;
    if (card.hasPointerCapture(event.pointerId))
      try {
        card.releasePointerCapture(event.pointerId);
      } catch {}
    if (!h?.detached || !moved) return;
    if (onBook) requestAnimationFrame(() => openEditor("incoming", key));
    else if (onShred) shredDarkroomPhoto(h, event.clientX, event.clientY);
    else returnDarkroomPhotoToWire(h);
  }
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
  card.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}

function nudgeDarkroomPhotos(deltaX) {
  const impulse = Math.max(-30, Math.min(30, deltaX));
  for (const h of darkroomPhysics.items.values()) {
    if (!h.landed || h.detached) continue;
    h.swingV = Math.max(-3.2, Math.min(3.2, h.swingV - impulse * 0.045));
  }
}

function animateDarkroomLines(now) {
  requestAnimationFrame(animateDarkroomLines);
  if (document.hidden) {
    darkroomPhysics.lastTime = now;
    return;
  }
  const dt = Math.max(
    0.001,
    Math.min(0.033, (now - darkroomPhysics.lastTime) / 1000),
  );
  darkroomPhysics.lastTime = now;
  tickDarkroomPhotoDrag(dt);
  const RIDE_DURATION = 2800;
  for (const h of darkroomPhysics.items.values()) {
    if (!darkroomPhysics.revealStarted || now < h.spawnAt) {
      h.el.style.visibility = "hidden";
      continue;
    }
    // 0.32 starts under the 3D cover book; first visible part is after book edge.
    const elapsed = Math.max(0, now - h.spawnAt);
    const u = Math.min(1, elapsed / RIDE_DURATION);
    if (darkroomPhysics.reduced) {
      h.t = h.targetT;
      h.landed = true;
      h.swing = 0;
      h.swingV = 0;
    } else if (!h.landed && !h.detached && !h.returning) {
      const ease = 1 - Math.pow(1 - u, 3);
      h.t = h.spawnStartT + (h.targetT - h.spawnStartT) * ease;
      h.swing = 0;
      h.swingV = 0;
      if (u >= 1) {
        h.t = h.targetT;
        h.landed = true;
        h.swing = 0;
        h.swingV = 0;
      }
    } else if (h.landed && !h.detached && !h.returning) {
      const force = -115 * Math.sin(h.swing) - 8.5 * h.swingV;
      h.swingV += force * dt;
      h.swing += h.swingV * dt;
      h.swing = Math.max(-0.35, Math.min(0.35, h.swing));
      if (Math.abs(h.swing) < 0.001 && Math.abs(h.swingV) < 0.012) {
        h.swing = 0;
        h.swingV = 0;
      }
    }
    if (!h.detached && !h.returning && h.landed && Number.isFinite(h.targetT)) {
      const follow = 1 - Math.exp(-8 * dt);
      h.t += (h.targetT - h.t) * follow;
      if (Math.abs(h.targetT - h.t) < 0.00025) h.t = h.targetT;
    }
    const p = getDarkroomWirePoint(h.t);
    const o = darkroomDragOffset(h.t);
    if (h.returning) {
      const q = Math.min(1, Math.max(0, (now - h.returning.start) / 460));
      const ease = 1 - Math.pow(1 - q, 3);
      h.el.style.left = `${h.returning.fromX + (p.x + o.x - h.returning.fromX) * ease}px`;
      h.el.style.top = `${h.returning.fromY + (p.y + o.y - h.returning.fromY) * ease}px`;
      h.el.style.transform = "translateX(-50%) rotate(0rad)";
      h.el.style.zIndex = "500";
      if (q >= 1) h.returning = null;
    } else if (h.detached) {
      h.el.style.left = `${h.freeX}px`;
      h.el.style.top = `${h.freeY}px`;
      h.el.style.transform = "translateX(-50%) rotate(0rad)";
      h.el.style.zIndex = "500";
    } else {
      h.el.style.left = `${p.x + o.x}px`;
      h.el.style.top = `${p.y + o.y}px`;
      h.el.style.transform = `translateX(-50%) rotate(${h.swing}rad)`;
      h.el.style.zIndex = String(5 + Math.round(h.targetT * 100));
    }
    // Card is behind the cover's 3D book during the initial section.
    // Alpha ramps up as it reaches the far edge of that book, with no teleport.
    const appear = Math.max(0, Math.min(1, (h.t - 0.41) / 0.13));
    h.el.style.opacity =
      h.detached || h.returning || h.landed ? "1" : String(appear);
    h.el.style.visibility = "visible";
    if (
      darkroomPhysics.photoDrag?.active &&
      Math.abs(darkroomPhysics.photoDrag.t - h.t) < 0.001
    )
      h.el.style.zIndex = "500";
  }
  renderDarkroomBendingWire();
}

// Photo movement is implemented in animateDarkroomLines above.

// -------------------------------------------------------------------
// 4. 보관함: 날짜 1개=1페이지, 날짜 2개=1권
// -------------------------------------------------------------------
function filteredSaved() {
  const q = $("archive-search").value.trim().toLowerCase();
  const date = $("archive-date").value;
  return [...saved]
    .filter(([, d]) => d?.image)
    .map(([key, data]) => ({
      key,
      data,
      t: memoTime(data),
      day: localDay(memoTime(data)),
    }))
    .filter(
      (r) =>
        (!q ||
          `${r.data.labelTxt || ""} ${r.data.longMemo || ""}`
            .toLowerCase()
            .includes(q)) &&
        (!date || r.day === date),
    )
    .sort((a, b) => b.t - a.t);
}
function createAlbumPhoto(row) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "album-photo";
  btn.dataset.title = String(row.data.labelTxt || "").trim() || "제목 없음";
  btn.title = row.data.labelTxt || row.day;

  // 사진마다 일정하지만 서로 다른 기울기
  const angles = [-3, 2, -1.8, 3.4, 1.2, -2.5, 2.8, -1];
  const hash = [...String(row.key)].reduce(
    (sum, ch) => sum + ch.charCodeAt(0),
    0,
  );
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

function createPage(pageDays, rows) {
  const page = document.createElement("div");
  page.className = "album-page";

  const dates = Array.isArray(pageDays) ? pageDays : [pageDays].filter(Boolean);

  const heading = document.createElement("p");
  heading.className = "page-date";

  heading.textContent = dates.length
    ? `${dates.map(relativeDay).join(" · ")}  /  ${rows.length} PHOTOS`
    : "BLANK PAGE";

  page.append(heading);

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "page-empty";
    empty.textContent = "다음 기억을 기다리는 페이지";
    page.append(empty);
    return page;
  }

  const grid = document.createElement("div");
  grid.className = "album-grid";

  rows.forEach((row) => {
    grid.appendChild(createAlbumPhoto(row));
  });

  page.appendChild(grid);
  return page;
}

function drawAlbums() {
  const rail = $("album-rail");
  if (!rail) return;

  const previousScroll = rail.scrollLeft;
  rail.replaceChildren();

  const rows = filteredSaved();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "archive-empty";
    empty.textContent =
      "아직 펼칠 앨범이 없어요. 인화실에서 사진을 저장해 보세요.";
    rail.append(empty);
    return;
  }

  // 1. 날짜별 사진 분류
  const days = new Map();

  for (const row of rows) {
    if (!days.has(row.day)) {
      days.set(row.day, []);
    }
    days.get(row.day).push(row);
  }

  const dates = [...days.keys()].sort().reverse();

  // 2. 사진 1~2장인 날은 최대 3일 묶기
  const pages = [];
  let group = [];

  const flushGroup = () => {
    if (!group.length) return;

    pages.push({
      dates: [...group],
      photos: group.flatMap((day) => days.get(day)),
    });

    group = [];
  };

  for (const day of dates) {
    if (days.get(day).length >= 3) {
      // 하루 3장 이상이면 독립된 페이지
      flushGroup();

      pages.push({
        dates: [day],
        photos: days.get(day),
      });
    } else {
      // 하루 1~2장이면 함께 묶기
      group.push(day);

      if (group.length === 3) {
        flushGroup();
      }
    }
  }

  flushGroup();

  // 3. 한 권에 두 페이지
  const covers = [
    { color: "#b9ccef", ink: "#20345d", dark: false },
    { color: "#e2c8b0", ink: "#4d392c", dark: false },
    { color: "#27343f", ink: "#f4f5f0", dark: true },
    { color: "#b8cdbf", ink: "#284637", dark: false },
    { color: "#e5b8bf", ink: "#5f3545", dark: false },
    { color: "#c5badc", ink: "#473962", dark: false },
  ];

  const rotations = [-4.2, 3.3, -2.4, 4.5, -3.5, 2.1];

  for (let i = 0; i < pages.length; i += 2) {
    const albumIndex = i / 2;

    const first = pages[i];
    const second = pages[i + 1] || {
      dates: [],
      photos: [],
    };

    const allDates = [...first.dates, ...second.dates];
    const newest = allDates[0];
    const oldest = allDates[allDates.length - 1];

    const style = covers[albumIndex % covers.length];

    const card = document.createElement("article");
    card.className = "album-card";

    card.dataset.album = `${newest}|${oldest}`;
    card.dataset.dark = String(style.dark);

    card.style.setProperty("--album-color", style.color);
    card.style.setProperty("--album-ink", style.ink);

    card.style.setProperty(
      "--album-angle",
      `${rotations[albumIndex % rotations.length]}deg`,
    );

    const spread = document.createElement("div");
    spread.className = "album-spread";

    spread.append(
      createPage(first.dates, first.photos),
      createPage(second.dates, second.photos),
    );

    const caption = document.createElement("div");
    caption.className = "album-caption";

    const info = document.createElement("span");
    info.textContent = `ALBUM ${String(albumIndex + 1).padStart(2, "0")} / ${oldest} — ${newest}`;

    caption.append(info);

    // 책 닫기 이벤트와 닫힌 표지는 만들지 않음
    card.append(spread, caption);
    rail.append(card);
  }

  // 사진 저장 후 다시 그려도 현재 앨범 스크롤 유지
  rail.scrollLeft = previousScroll;
}

// -------------------------------------------------------------------
// 5. 파일 불러오기 + 사진 날짜 파악 + 신규 업로드
// -------------------------------------------------------------------
function parseDateString(s) {
  if (!s) return null;
  if (s instanceof Date) return timestamp(s);
  if (typeof s === "number") return timestamp(s);
  const m = String(s).match(
    /^(\d{4})[-:/](\d{2})[-:/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return null;
  const [y, mo, da, h, mi, sec] = m
    .slice(1)
    .map((n, i) => Number(n ?? (i === 3 ? "12" : "0")));
  const date = new Date(y, mo - 1, da, h, mi, sec);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== da
  )
    return null;
  return date.getTime();
}
function validCapture(t) {
  return (
    Number.isFinite(t) &&
    t >= new Date(1990, 0, 1).getTime() &&
    t <= Date.now() + 86400000
  );
}
async function detectPhotoDate(file) {
  try {
    if (window.exifr) {
      const m = await exifr.parse(file, {
        tiff: true,
        exif: true,
        xmp: true,
        iptc: true,
        mergeOutput: true,
      });
      for (const v of [
        m?.DateTimeOriginal,
        m?.CreateDate,
        m?.DateTimeDigitized,
        m?.DateCreated,
        m?.DateTime,
        m?.ModifyDate,
        m?.["xmp:CreateDate"],
      ]) {
        const t = parseDateString(v);
        if (validCapture(t)) return { date: t, source: "metadata" };
      }
    }
  } catch (err) {
    console.warn("사진 메타데이터 판독:", err);
  }
  const n = file.name.match(
    /(?:^|\D)((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[_-]?(\d{2})[-:.]?(\d{2}))?/,
  );
  if (n) {
    const t = parseDateString(
      `${n[1]}-${n[2]}-${n[3]} ${n[4] || "12"}:${n[5] || "00"}`,
    );
    if (validCapture(t)) return { date: t, source: "filename" };
  }
  return null;
}
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error("이미지를 열 수 없어요."));
    };
    img.src = src;
  });
}
async function compressImage(file) {
  const img = await loadImage(file);
  const scale = Math.min(1, 1000 / img.naturalWidth, 1000 / img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
}
async function uploadFiles(files) {
  if (busy) return;
  busy = true;
  let added = 0;
  try {
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        toast("이미지 파일만 선택할 수 있어요.");
        continue;
      }
      const found = await detectPhotoDate(file);
      let capturedAt = found?.date ?? null,
        dateSource = found?.source ?? "manual";
      if (capturedAt === null) {
        capturedAt = await chooseMissingPhotoDate();
        if (capturedAt === null) continue;
      }
      const image = await compressImage(file);
      await db
        .ref("incoming")
        .push({ image, capturedAt, dateSource, timestamp: Date.now() });
      added++;
    }
    if (added) {
      toast(`${added}장의 사진을 인화실에 걸었어요.`);
      busy = false;
      goRoom("darkroom");
    }
  } catch (e) {
    console.error(e);
    toast("사진 저장 실패: " + e.message);
  } finally {
    busy = false;
  }
}

// 날짜 입력 — 숫자는 직접 교체, 회색 YYYY-MM-DD 마스크, 우측 네이티브 달력
function dateFromParts(mask, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mask);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  if (
    d.getFullYear() !== +m[1] ||
    d.getMonth() !== +m[2] - 1 ||
    d.getDate() !== +m[3] ||
    d.getHours() !== +t[1] ||
    d.getMinutes() !== +t[2]
  )
    return null;
  return d.getTime();
}
function dialogFrame(title, description = "") {
  const layer = document.createElement("div");
  layer.className = "overlay";
  const box = document.createElement("div");
  box.className = "dialog";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  const top = document.createElement("div");
  top.className = "dialog-head";
  const h = document.createElement("h3");
  h.textContent = title;
  const x = document.createElement("button");
  x.type = "button";
  x.textContent = "✕ 닫기";
  top.append(h, x);
  box.append(top);
  if (description) {
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = description;
    box.append(p);
  }
  layer.append(box);
  $("modal-root").append(layer);
  return { layer, box, x };
}
function chooseMissingPhotoDate() {
  return new Promise((resolve) => {
    const { layer, box, x } = dialogFrame(
      "사진 날짜 지정",
      "언제 생성된 사진인지 확인 할 수 없어요. 저장할 날짜를 입력해주세요!",
    );
    const label = document.createElement("label");
    label.className = "field";
    label.innerHTML = "<span>사진 날짜</span>";
    const combined = document.createElement("div");
    combined.className = "date-combined";
    const display = document.createElement("div");
    display.className = "date-display";
    const input = document.createElement("input");
    input.className = "masked-date";
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "날짜 직접 입력");
    const picker = document.createElement("div");
    picker.className = "picker-wrap";
    picker.textContent = "▦";
    const native = document.createElement("input");
    native.type = "date";
    native.setAttribute("aria-label", "달력 열기");
    picker.append(native);
    combined.append(display, input, picker);
    label.append(combined);
    const tm = document.createElement("label");
    tm.className = "field";
    tm.innerHTML = "<span>시간</span>";
    const time = document.createElement("input");
    time.type = "time";
    time.value = clockTime(Date.now());
    tm.append(time);
    const error = document.createElement("p");
    error.className = "error";
    error.hidden = true;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.textContent = "취소";
    const ok = document.createElement("button");
    ok.className = "solid";
    ok.textContent = "이 날짜로 저장";
    actions.append(cancel, ok);
    box.append(label, tm, error, actions);
    let mask = localDay(Date.now()),
      cursor = 0;
    const base = "YYYY-MM-DD";
    const slots = [0, 1, 2, 3, 5, 6, 8, 9];
    const next = (p) => slots.find((n) => n >= p) ?? 10;
    const prev = (p) => [...slots].reverse().find((n) => n < p) ?? null;
    function render() {
      input.value = mask;
      display.replaceChildren();
      [...mask].forEach((c) => {
        const el = document.createElement("span");
        el.textContent = c;
        if (/[YMD]/.test(c)) el.className = "ghost";
        display.append(el);
      });
      try {
        input.setSelectionRange(cursor, cursor);
      } catch {}
    }
    function insert(text) {
      const chars = [...mask];
      let pos = next(cursor);
      for (const n of String(text).replace(/\D/g, "")) {
        if (pos >= 10) break;
        chars[pos] = n;
        pos = next(pos + 1);
      }
      mask = chars.join("");
      cursor = pos;
      if (dateFromParts(mask, "12:00") !== null) native.value = mask;
      render();
    }
    function erase(backward = true) {
      const pos = backward ? prev(cursor) : next(cursor);
      if (pos === null || pos >= 10) return;
      mask = mask.slice(0, pos) + base[pos] + mask.slice(pos + 1);
      cursor = pos;
      render();
    }
    function onBefore(e) {
      const kind = e.inputType;
      if (
        kind === "insertText" ||
        kind === "insertCompositionText" ||
        kind === "insertReplacementText"
      ) {
        if (e.cancelable) e.preventDefault();
        insert(e.data || "");
      } else if (kind === "deleteContentBackward") {
        if (e.cancelable) e.preventDefault();
        erase(true);
      } else if (kind === "deleteContentForward") {
        if (e.cancelable) e.preventDefault();
        erase(false);
      }
    }
    input.addEventListener("beforeinput", onBefore);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        cursor = prev(cursor) ?? 0;
        render();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        cursor = next(cursor + 1);
        render();
      }
      if (e.key === "Backspace" && !e.defaultPrevented) {
        e.preventDefault();
        erase(true);
      }
      if (/^\d$/.test(e.key) && !e.defaultPrevented) {
        e.preventDefault();
        insert(e.key);
      }
    });
    input.addEventListener("click", () => {
      cursor = next(input.selectionStart ?? 0);
      render();
    });
    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const digits = (e.clipboardData?.getData("text") || "").replace(
        /\D/g,
        "",
      );
      if (digits.length === 8) {
        mask = base;
        cursor = 0;
      }
      insert(digits);
    });
    native.value = mask;
    native.addEventListener("change", () => {
      if (!native.value) return;
      mask = native.value;
      cursor = 0;
      render();
    });
    const close = (v) => {
      layer.remove();
      resolve(v);
    };
    x.onclick = () => close(null);
    cancel.onclick = () => close(null);
    ok.onclick = () => {
      const t = dateFromParts(mask, time.value);
      if (t === null) {
        error.hidden = false;
        error.textContent = "날짜와 시간을 모두 올바르게 입력해 주세요.";
        return;
      }
      close(t);
    };
    render();
  });
}

// -------------------------------------------------------------------
// 6. 메모 편집기: 사진 위 / 기록 아래, 기존 rich HTML 호환
// -------------------------------------------------------------------
function cleanRich(html) {
  if (!window.DOMPurify) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "div",
      "p",
      "br",
      "span",
      "b",
      "strong",
      "em",
      "i",
      "u",
      "font",
      "ul",
      "ol",
      "li",
      "input",
    ],
    ALLOWED_ATTR: [
      "style",
      "class",
      "type",
      "checked",
      "size",
      "color",
      "contenteditable",
    ],
  });
}
function focusSavedRange(editor) {
  const sel = window.getSelection();
  if (!sel) return;
  if (
    lastSelectedRange &&
    editor.contains(lastSelectedRange.commonAncestorContainer)
  ) {
    try {
      sel.removeAllRanges();
      sel.addRange(lastSelectedRange);
    } catch {}
  } else {
    editor.focus();
  }
}
function formatSelection(editor, prop, value) {
  const sel = window.getSelection();
  let range = lastSelectedRange?.cloneRange();
  if (sel?.rangeCount) {
    const current = sel.getRangeAt(0);
    if (editor.contains(current.commonAncestorContainer) && !current.collapsed)
      range = current.cloneRange();
  }
  if (
    !range ||
    range.collapsed ||
    !editor.contains(range.commonAncestorContainer)
  ) {
    toast("꾸밀 글자를 먼저 선택해 주세요.");
    return;
  }
  try {
    const node = document.createElement("span");
    node.style[prop] = value;
    node.append(range.extractContents());
    range.insertNode(node);
    const r = document.createRange();
    r.selectNodeContents(node);
    lastSelectedRange = r.cloneRange();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (e) {
    console.error(e);
    toast("선택한 글자를 다시 지정해 주세요.");
  }
}
function checkboxOnCurrentLine(editor) {
  const sel = window.getSelection();
  let range = lastSelectedRange?.cloneRange();
  if (sel?.rangeCount) {
    const r = sel.getRangeAt(0);
    if (editor.contains(r.startContainer)) range = r.cloneRange();
  }
  let node = range?.startContainer || editor.lastChild;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
  while (node && node !== editor && !/^(DIV|P|LI)$/.test(node.nodeName))
    node = node.parentNode;
  if (!node || node === editor) {
    // 직접 입력한 텍스트가 root에 붙어 있는 경우 그 줄 하나만 감싼다.
    const block = document.createElement("div");
    const child = range?.startContainer;
    if (child?.nodeType === Node.TEXT_NODE && child.parentNode === editor) {
      editor.insertBefore(block, child);
      block.appendChild(child);
    } else {
      block.append(document.createElement("br"));
      editor.append(block);
    }
    node = block;
  }
  if (node.classList?.contains("memo-task")) return;
  const task = document.createElement("div");
  task.className = "memo-task";
  task.contentEditable = "false";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.setAttribute("contenteditable", "false");
  const span = document.createElement("span");
  span.contentEditable = "true";
  while (node.firstChild) span.append(node.firstChild);
  if (!span.hasChildNodes()) span.append(document.createElement("br"));
  task.append(check, span);
  node.replaceWith(task);
  const r = document.createRange();
  r.selectNodeContents(span);
  r.collapse(false);
  lastSelectedRange = r.cloneRange();
  // 체크박스를 만들 때는 키보드를 강제로 열지 않음.
}
function editToolbar(editor) {
  const bar = document.createElement("div");
  bar.className = "format-tools";
  const definitions = [
    ["B", "bold"],
    ["매우 크게", "32"],
    ["크게", "24"],
    ["중간", "16"],
    ["작게", "12"],
    ["• 목록", "ul"],
    ["1. 목록", "ol"],
    ["☐ 체크", "check"],
  ];
  for (const [label, command] of definitions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.dataset.cmd = command;
    bar.append(btn);
  }
  for (const color of ["#e74d4d", "#f09537", "#368a54", "#3977db", "#9254ce"]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.color = color;
    btn.style.setProperty("--tone", color);
    btn.title = "글씨 색상";
    btn.setAttribute("aria-label", color);
    bar.append(btn);
  }
  bar.addEventListener(
    "pointerdown",
    () => {
      const s = window.getSelection();
      if (
        s?.rangeCount &&
        editor.contains(s.getRangeAt(0).commonAncestorContainer)
      )
        lastSelectedRange = s.getRangeAt(0).cloneRange();
    },
    true,
  );
  bar.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.color) formatSelection(editor, "color", btn.dataset.color);
    else if (btn.dataset.cmd === "bold")
      formatSelection(editor, "fontWeight", "bold");
    else if (/^\d+$/.test(btn.dataset.cmd))
      formatSelection(editor, "fontSize", btn.dataset.cmd + "px");
    else if (btn.dataset.cmd === "check") checkboxOnCurrentLine(editor);
    else {
      focusSavedRange(editor);
      document.execCommand(
        btn.dataset.cmd === "ul" ? "insertUnorderedList" : "insertOrderedList",
        false,
        null,
      );
    }
  });
  return bar;
}
function makeField(label, initial = "") {
  const field = document.createElement("div");
  field.className = "field";
  const lab = document.createElement("label");
  lab.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = initial;
  field.append(lab, input);
  return { field, input };
}
/* =====================================================
   EDITOR INK — 펜 버튼 + 사진/글 위 드로잉 + 저장
   sketch.js에서 function openEditor(...) 바로 위에 붙여넣기
   ===================================================== */

/* ================================================================
   EDITOR INK v3 — memo 글 위에서 선 끊김 방지 / 버튼 클릭 우선
   sketch.js: 기존 setupEditorInk(...) 함수 전체와 교체
   ================================================================ */
/* =====================================================================
   CTM EDITOR INK v5 — 펜 + 획 전체 지우개 / 태블릿 지원
   sketch.js에서 기존 setupEditorInk({ layer, box, polaroid, data }) 함수
   처음부터 끝까지 아래 함수 하나로 교체하세요.
   ===================================================================== */
function setupEditorInk({ layer, box, polaroid, data }) {
  const NS = "http://www.w3.org/2000/svg";
  const ink = document.createElementNS(NS, "svg");
  ink.classList.add("editor-ink-art");
  ink.setAttribute("viewBox", "0 0 1000 1000");
  ink.setAttribute("preserveAspectRatio", "none");
  ink.setAttribute("aria-hidden", "true");
  ink.style.touchAction = "none";
  ink.style.pointerEvents = "none";
  box.appendChild(ink);

  // 기존 pen.svg 재사용
  const pen = document.createElement("button");
  pen.type = "button";
  pen.className = "editor-pen-toggle";
  pen.setAttribute("aria-label", "펜 켜기");
  pen.setAttribute("aria-pressed", "false");
  pen.title = "펜 켜기";
  const penImage = new Image();
  penImage.src = "./pen.svg";
  penImage.alt = "";
  penImage.draggable = false;
  pen.append(penImage);
  box.append(pen);

  // 새 eraser.svg (기존 펜과 같은 폴더)
  const eraser = document.createElement("button");
  eraser.type = "button";
  eraser.className = "editor-eraser-toggle";
  eraser.setAttribute("aria-label", "지우개 켜기");
  eraser.setAttribute("aria-pressed", "false");
  eraser.title = "지우개 켜기";
  const eraserImage = new Image();
  eraserImage.src = "./eraser.svg";
  eraserImage.alt = "";
  eraserImage.draggable = false;
  eraser.append(eraserImage);
  box.append(eraser);

  // Firebase memoInk: 기존 선 데이터 형식 [ [ [x,y], ... ], ... ] 유지
  // x,y는 팝업 내부 0~1 상대 좌표이며, 밖으로 나온 사진에서는 범위를 벗어날 수 있음.
  let strokes = Array.isArray(data.memoInk)
    ? data.memoInk
        .slice(0, 900)
        .filter(Array.isArray)
        .map((points) =>
          points
            .slice(0, 1800)
            .filter(
              (p) =>
                Array.isArray(p) &&
                p.length >= 2 &&
                Number.isFinite(Number(p[0])) &&
                Number.isFinite(Number(p[1])),
            )
            .map((p) => [Number(p[0]), Number(p[1])]),
        )
        .filter((points) => points.length > 0)
    : [];

  let mode = "none"; // none / pen / eraser
  let pointerId = null;
  let currentStroke = null;
  let currentPath = null;
  let previousPoint = null;
  let disposed = false;
  const ERASER_RADIUS_PX = 22; // 닿은 획 전체를 삭제하는 지우개 반경

  function rect() {
    return box.getBoundingClientRect();
  }

  function point(clientX, clientY) {
    const r = rect();
    return [
      Math.round(((clientX - r.left) / Math.max(1, r.width)) * 10000) / 10000,
      Math.round(((clientY - r.top) / Math.max(1, r.height)) * 10000) / 10000,
    ];
  }

  function isInside(x, y) {
    return [box, polaroid].some((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }

  function validPosition(e) {
    return (
      Number.isFinite(e.clientX) &&
      Number.isFinite(e.clientY) &&
      !(e.clientX === 0 && e.clientY === 0) &&
      isInside(e.clientX, e.clientY)
    );
  }

  // 모든 중요한 버튼은 펜/지우개보다 우선 처리
  function isControl(target) {
    return (
      target instanceof Element &&
      !!target.closest(
        ".editor-pen-toggle, .editor-eraser-toggle, " +
          ".editor-close, .editor-actions button, .editor-btn",
      )
    );
  }

  function redrawPath(path, points) {
    if (!path || !points.length) return;
    const d = points.map(
      (p, i) =>
        `${i ? "L" : "M"}${(p[0] * 1000).toFixed(2)} ${(p[1] * 1000).toFixed(2)}`,
    );
    if (points.length === 1) d.push("l 0.05 0.05");
    path.setAttribute("d", d.join(" "));
  }

  function createPath(points) {
    const path = document.createElementNS(NS, "path");
    ink.append(path);
    redrawPath(path, points);
    return path;
  }

  function redrawAll() {
    ink.replaceChildren();
    strokes.forEach(createPath);
  }
  redrawAll();

  function endGesture() {
    if (pointerId !== null) {
      try {
        if (ink.hasPointerCapture(pointerId))
          ink.releasePointerCapture(pointerId);
      } catch (_) {
        /* capture가 다른 요소에 걸려있어도 무시 */
      }
    }
    pointerId = null;
    currentStroke = null;
    currentPath = null;
    previousPoint = null;
  }

  function setMode(next) {
    if (disposed) return;
    mode = mode === next ? "none" : next;
    endGesture();
    pen.classList.toggle("is-active", mode === "pen");
    eraser.classList.toggle("is-active", mode === "eraser");
    box.classList.toggle("editor-inking", mode !== "none");
    box.classList.toggle("editor-erasing", mode === "eraser");
    pen.setAttribute("aria-pressed", String(mode === "pen"));
    eraser.setAttribute("aria-pressed", String(mode === "eraser"));
    pen.setAttribute("aria-label", mode === "pen" ? "펜 끄기" : "펜 켜기");
    eraser.setAttribute(
      "aria-label",
      mode === "eraser" ? "지우개 끄기" : "지우개 켜기",
    );
    pen.title = mode === "pen" ? "펜 끄기" : "펜 켜기";
    eraser.title = mode === "eraser" ? "지우개 끄기" : "지우개 켜기";

    // 메모 키보드가 열려 있으면 도구 전환 시 자연스럽게 닫기
    if (mode !== "none" && box.contains(document.activeElement)) {
      document.activeElement.blur?.();
    }
  }
  pen.addEventListener("click", () => setMode("pen"));
  eraser.addEventListener("click", () => setMode("eraser"));

  // 점 P와 선분 AB 사이의 픽셀 거리 제곱
  function distanceSquaredToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax,
      dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 < 0.000001
        ? 0
        : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const x = ax + t * dx - px,
      y = ay + t * dy - py;
    return x * x + y * y;
  }

  // 저사양 지우개: 지우개가 획의 어느 한 부분에 닿으면 획 전체 삭제.
  // 선분 대 선분 충돌만 검사하고, 삭제가 발생할 때만 SVG를 다시 그림.
  function eraseBetween(from, to) {
    const r = rect();
    const w = Math.max(1, r.width),
      h = Math.max(1, r.height);
    const ax = from[0] * w,
      ay = from[1] * h;
    const bx = to[0] * w,
      by = to[1] * h;
    const radius2 = ERASER_RADIUS_PX * ERASER_RADIUS_PX;
    const left = Math.min(ax, bx) - ERASER_RADIUS_PX;
    const right = Math.max(ax, bx) + ERASER_RADIUS_PX;
    const top = Math.min(ay, by) - ERASER_RADIUS_PX;
    const bottom = Math.max(ay, by) + ERASER_RADIUS_PX;

    function intersects(x0, y0, x1, y1) {
      // 지우개 이동 선분과 획 선분이 교차하는 경우
      const cross = (ux, uy, vx, vy) => ux * vy - uy * vx;
      const d1 = cross(bx - ax, by - ay, x0 - ax, y0 - ay);
      const d2 = cross(bx - ax, by - ay, x1 - ax, y1 - ay);
      const d3 = cross(x1 - x0, y1 - y0, ax - x0, ay - y0);
      const d4 = cross(x1 - x0, y1 - y0, bx - x0, by - y0);
      if (
        ((d1 <= 0 && d2 >= 0) || (d1 >= 0 && d2 <= 0)) &&
        ((d3 <= 0 && d4 >= 0) || (d3 >= 0 && d4 <= 0))
      )
        return true;
      // 교차하지 않아도 지우개 반경 이내면 삭제
      return (
        distanceSquaredToSegment(x0, y0, ax, ay, bx, by) <= radius2 ||
        distanceSquaredToSegment(x1, y1, ax, ay, bx, by) <= radius2 ||
        distanceSquaredToSegment(ax, ay, x0, y0, x1, y1) <= radius2 ||
        distanceSquaredToSegment(bx, by, x0, y0, x1, y1) <= radius2
      );
    }

    let changed = false;
    const remaining = [];
    for (const line of strokes) {
      if (!line.length) continue;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of line) {
        const x = p[0] * w,
          y = p[1] * h;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (maxX < left || minX > right || maxY < top || minY > bottom) {
        remaining.push(line);
        continue;
      }
      let hit = false;
      if (line.length === 1) {
        hit =
          distanceSquaredToSegment(
            line[0][0] * w,
            line[0][1] * h,
            ax,
            ay,
            bx,
            by,
          ) <= radius2;
      } else {
        for (let i = 1; i < line.length; i++) {
          if (
            intersects(
              line[i - 1][0] * w,
              line[i - 1][1] * h,
              line[i][0] * w,
              line[i][1] * h,
            )
          ) {
            hit = true;
            break;
          }
        }
      }
      if (hit) changed = true;
      else remaining.push(line);
    }
    if (changed) {
      strokes = remaining;
      redrawAll();
    }
  }

  function down(e) {
    if (mode === "none" || disposed || isControl(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.isPrimary === false || pointerId !== null || !validPosition(e))
      return;

    // 텍스트 선택/글쓰기보다 펜 또는 지우개를 우선
    e.preventDefault();
    e.stopImmediatePropagation();
    pointerId = e.pointerId;
    previousPoint = point(e.clientX, e.clientY);

    if (mode === "pen") {
      currentStroke = [previousPoint];
      strokes.push(currentStroke);
      currentPath = createPath(currentStroke);
    } else {
      eraseBetween(previousPoint, previousPoint);
    }
    // pointer가 글, 사진 위를 지나도 같은 제스처 유지
    try {
      ink.setPointerCapture(pointerId);
    } catch (_) {}
  }

  function move(e) {
    if (
      mode === "none" ||
      disposed ||
      e.pointerId !== pointerId ||
      !previousPoint
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();

    if (!validPosition(e)) {
      endGesture();
      return;
    }
    const next = point(e.clientX, e.clientY);
    const r = rect();
    const dist = Math.hypot(
      (next[0] - previousPoint[0]) * r.width,
      (next[1] - previousPoint[1]) * r.height,
    );
    const maxJump = Math.max(130, Math.min(250, r.width * 0.32));
    // (0,0) 등 튀는 터치 좌표로 긴 선이 생기는 것 방지
    if (dist > maxJump) {
      endGesture();
      return;
    }

    if (mode === "pen") {
      if (dist >= 1.8 && currentStroke && currentStroke.length < 1800) {
        currentStroke.push(next);
        redrawPath(currentPath, currentStroke);
      }
    } else if (mode === "eraser") {
      eraseBetween(previousPoint, next);
    }
    previousPoint = next;
  }

  function up(e) {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (validPosition(e) && previousPoint) {
      const next = point(e.clientX, e.clientY);
      const r = rect();
      const dist = Math.hypot(
        (next[0] - previousPoint[0]) * r.width,
        (next[1] - previousPoint[1]) * r.height,
      );
      if (dist <= Math.max(130, Math.min(250, r.width * 0.32))) {
        if (mode === "eraser") eraseBetween(previousPoint, next);
        else if (
          mode === "pen" &&
          currentStroke &&
          dist >= 1.8 &&
          currentStroke.length < 1800
        ) {
          currentStroke.push(next);
          redrawPath(currentPath, currentStroke);
        }
      }
    }
    endGesture();
  }

  function cancel(e) {
    if (e.pointerId === pointerId) endGesture();
  }

  function interceptClick(e) {
    // 펜/지우개 ON 중에도 저장·취소·X 및 도구 버튼은 클릭 가능
    if (mode === "none" || disposed || isControl(e.target)) return;
    if (validPosition(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("click", interceptClick, true);

  return {
    serialize() {
      return strokes.map((s) => s.map((p) => [...p]));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      endGesture();
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("click", interceptClick, true);
      pen.remove();
      eraser.remove();
      ink.remove();
      box.classList.remove("editor-inking", "editor-erasing");
    },
  };
}

function openEditor(source, key) {
  if (batchMode || busy) return;

  const data = record(source, key);
  if (!data) return;

  editorItem = { source, key };
  lastSelectedRange = null;

  const layer = document.createElement("div");
  layer.className = "overlay editor-overlay";

  const box = document.createElement("section");
  box.className = "dialog editor-modal";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "editor-close";
  closeBtn.setAttribute("aria-label", "닫기");
  closeBtn.textContent = "✕";

  const shell = document.createElement("div");
  shell.className = "editor-shell";

  // -----------------------------
  // LEFT : IMAGE FIRST
  // -----------------------------
  const left = document.createElement("div");
  left.className = "editor-left";

  const stage = document.createElement("div");
  stage.className = "editor-image-stage";

  const polaroid = document.createElement("div");
  polaroid.className = "editor-polaroid";
  polaroid.setAttribute("aria-label", "사진 크게 보기");

  const media = document.createElement("div");
  media.className = "editor-polaroid-media";

  const img = new Image();
  img.src = data.image;
  img.alt = "메모 이미지";
  img.decoding = "async";
  media.append(img);

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "editor-polaroid-date";
  dateInput.value = localDay(data.capturedAt ?? memoTime(data));

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "editor-polaroid-title";
  titleInput.value = data.labelTxt || "";
  titleInput.placeholder = "제목";
  titleInput.maxLength = 80;

  polaroid.append(media, dateInput, titleInput);
  stage.append(polaroid);
  left.append(stage);

  // -----------------------------
  // RIGHT : WRITING
  // -----------------------------
  const right = document.createElement("div");
  right.className = "editor-right";

  const topbar = document.createElement("div");
  topbar.className = "editor-topbar";

  const headingWrap = document.createElement("div");
  headingWrap.className = "editor-heading-wrap";

  const kicker = document.createElement("p");
  kicker.className = "editor-kicker";
  kicker.textContent = "MEMO";

  const heading = document.createElement("h3");
  heading.className = "editor-heading";
  heading.textContent = "이 사진이 소중한 이유";

  headingWrap.append(kicker, heading);

  const actions = document.createElement("div");
  actions.className = "editor-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "editor-btn";
  cancelBtn.textContent = "취소";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "editor-btn primary";
  saveBtn.textContent = "앨범에 보관";

  actions.append(cancelBtn, saveBtn);
  topbar.append(headingWrap, actions);

  const writingPanel = document.createElement("div");
  writingPanel.className = "editor-writing-panel";

  const memoPad = document.createElement("div");
  memoPad.className = "editor-note-surface";
  memoPad.contentEditable = "true";
  memoPad.setAttribute("role", "textbox");
  memoPad.setAttribute("aria-multiline", "true");
  memoPad.spellcheck = true;
  memoPad.dataset.placeholder = "이 날의 기억을 적어보세요.";

  let initialText = "";
  if (String(data.longMemo || "").trim()) {
    initialText = String(data.longMemo);
  } else if (data.longMemoHtml) {
    const temp = document.createElement("div");
    temp.innerHTML = cleanRich(data.longMemoHtml || "");
    initialText = temp.innerText || "";
  }

  if (initialText.trim()) {
    memoPad.textContent = initialText;
  }

  memoPad.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  });

  writingPanel.append(memoPad);
  right.append(topbar, writingPanel);

  shell.append(left, right);
  box.append(closeBtn, shell);
  layer.append(box);
  $("modal-root").append(layer);

  const ink = setupEditorInk({
    layer,
    box,
    polaroid,
    data,
  });

  // -----------------------------
  // tablet / mobile : 뒤 화면 같이 움직이는 거 방지
  // -----------------------------
  const blockBubble = (e) => e.stopPropagation();

  [
    box,
    shell,
    left,
    right,
    stage,
    polaroid,
    dateInput,
    titleInput,
    writingPanel,
    memoPad,
  ].forEach((node) => {
    node.addEventListener("pointerdown", blockBubble);
    node.addEventListener("pointermove", blockBubble);
    node.addEventListener("pointerup", blockBubble);
    node.addEventListener("touchstart", blockBubble, { passive: true });
    node.addEventListener("touchmove", blockBubble, { passive: true });
    node.addEventListener("wheel", blockBubble, { passive: true });
  });

  memoPad.addEventListener("focus", () => {
    box.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  media.addEventListener("click", () => openPhotoViewer(data.image));

  function closeEditorWithoutSaving() {
    if (busy) return;

    ink.dispose();

    layer.remove();
    editorItem = null;

    if (source === "incoming") {
      const hanger = darkroomPhysics.items.get(key);
      if (hanger?.detached && !hanger.deleting) {
        returnDarkroomPhotoToWire(hanger);
      }
    }
  }

  closeBtn.onclick = closeEditorWithoutSaving;
  cancelBtn.onclick = closeEditorWithoutSaving;

  layer.addEventListener("click", (event) => {
    if (event.target === layer) closeEditorWithoutSaving();
  });

  async function saveEditor() {
    if (busy) return;

    busy = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "저장 중...";

    try {
      let capturedAt = data.capturedAt ?? memoTime(data);

      if (dateInput.value) {
        const base = new Date(capturedAt || Date.now());
        const [yy, mm, dd] = dateInput.value.split("-").map(Number);

        if (yy && mm && dd) {
          capturedAt = new Date(
            yy,
            mm - 1,
            dd,
            base.getHours(),
            base.getMinutes(),
            base.getSeconds(),
            0,
          ).getTime();
        }
      }

      const memoText = (memoPad.innerText || "")
        .replace(/\u00A0/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const memoHtml = memoText
        ? memoText
            .split(/\n/)
            .map((line) =>
              line.trim()
                ? `<div>${escapeHTML(line)}</div>`
                : `<div><br></div>`,
            )
            .join("")
        : "";

      const title = titleInput.value.trim() || localDay(capturedAt);

      const updated = {
        image: data.image,
        memoInk: ink.serialize(),
        labelTxt: title,
        longMemo: memoText,
        longMemoHtml: memoHtml,
        capturedAt,
        dateSource: data.dateSource || "manual",
        timestamp: data.timestamp || Date.now(),
      };

      if (source === "incoming") {
        updated.savedAt = Date.now();

        await db.ref("saved_memos").child(key).set(updated);

        try {
          await db.ref("incoming").child(key).remove();
        } catch (e) {
          console.warn("수신함 정리 실패", e);
          toast("저장은 됐지만 인화실 정리가 필요해요.");
        }
      } else {
        await db.ref("saved_memos").child(key).update(updated);
      }

      ink.dispose();
      layer.remove();
      editorItem = null;
      toast("기록을 저장했어요.");
    } catch (e) {
      console.error(e);
      toast("저장 실패: " + e.message);
    } finally {
      busy = false;
      saveBtn.disabled = false;
      saveBtn.textContent = "앨범에 보관";
    }
  }

  saveBtn.onclick = saveEditor;
}
function openPhotoViewer(src) {
  $("viewer-image").src = src;
  $("photo-viewer").hidden = false;
}
function closePhotoViewer() {
  $("photo-viewer").hidden = true;
  $("viewer-image").src = "";
}

// -------------------------------------------------------------------
// 7. 길게 누르기 → 다중 선택 → 일괄 날짜 변경 / 삭제
// -------------------------------------------------------------------
function enterBatch(source, key) {
  batchMode = true;
  batchSelected.add(itemId(source, key));
  refreshBatch();
  if (navigator.vibrate) navigator.vibrate(20);
}
function toggleBatch(source, key) {
  const id = itemId(source, key);
  if (batchSelected.has(id)) batchSelected.delete(id);
  else batchSelected.add(id);
  refreshBatch();
}
function leaveBatch() {
  if (busy) return;
  batchMode = false;
  batchSelected.clear();
  refreshBatch();
}
function visibleCards() {
  return [
    ...document.querySelectorAll(
      archiveOpen ? ".album-photo[data-key]" : ".polaroid[data-key]",
    ),
  ];
}
function refreshBatch() {
  document.body.classList.toggle("batch-mode", batchMode);
  $("batch-bar").hidden = !batchMode;
  document
    .querySelectorAll(".polaroid[data-key],.album-photo[data-key]")
    .forEach((el) =>
      el.classList.toggle(
        "selected",
        batchSelected.has(itemId(el.dataset.source, el.dataset.key)),
      ),
    );
  $("batch-count").textContent = `${batchSelected.size}개 선택됨`;
  $("batch-all").textContent =
    visibleCards().length &&
    visibleCards().every((el) =>
      batchSelected.has(itemId(el.dataset.source, el.dataset.key)),
    )
      ? "전체 해제"
      : "전체 선택";
  $("batch-date").disabled = $("batch-delete").disabled =
    batchSelected.size === 0 || busy;
}
function toggleAll() {
  const cards = visibleCards();
  const all =
    cards.length &&
    cards.every((el) =>
      batchSelected.has(itemId(el.dataset.source, el.dataset.key)),
    );
  cards.forEach((el) => {
    const id = itemId(el.dataset.source, el.dataset.key);
    if (all) batchSelected.delete(id);
    else batchSelected.add(id);
  });
  refreshBatch();
}
function selectedItems() {
  return [...batchSelected].map(splitId).filter((x) => record(x.source, x.key));
}
function askDelete(count) {
  return new Promise((resolve) => {
    const ui = dialogFrame(
      "정말로 삭제하시겠습니까?",
      `선택한 ${count}개의 사진/메모가 삭제돼요. 삭제 후 복구할 수 없어요.`,
    );
    const row = document.createElement("label");
    row.style.cssText =
      "display:flex;gap:8px;align-items:center;font-size:12px;color:#7a8598;margin-top:20px";
    const check = document.createElement("input");
    check.type = "checkbox";
    row.append(check, document.createTextNode("다시 보지 않기"));
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.textContent = "취소";
    const ok = document.createElement("button");
    ok.className = "danger";
    ok.textContent = "삭제";
    actions.append(cancel, ok);
    ui.box.append(row, actions);
    const end = (value) => {
      ui.layer.remove();
      resolve(value);
    };
    ui.x.onclick = cancel.onclick = () => end(false);
    ok.onclick = () => {
      if (check.checked) {
        try {
          localStorage.setItem(SKIP_DELETE, "1");
        } catch {}
      }
      end(true);
    };
  });
}
async function batchDelete() {
  const items = selectedItems();
  if (!items.length || busy) return;
  let skip = false;
  try {
    skip = localStorage.getItem(SKIP_DELETE) === "1";
  } catch {}
  if (!skip && !(await askDelete(items.length))) return;
  busy = true;
  let success = 0;
  try {
    for (const { source, key } of items) {
      try {
        await db.ref(pathFor(source)).child(key).remove();
        success++;
        batchSelected.delete(itemId(source, key));
      } catch (e) {
        console.error(e);
      }
    }
    toast(`${success}개의 기록을 삭제했어요.`);
  } finally {
    busy = false;
    if (!batchSelected.size) leaveBatch();
    else refreshBatch();
  }
}
async function batchChangeDate() {
  const items = selectedItems();
  if (!items.length || busy) return;
  const chosen = await chooseMissingPhotoDate();
  if (chosen === null) return;
  busy = true;
  let success = 0;
  try {
    for (const { source, key } of items) {
      const data = record(source, key);
      if (!data) continue;
      const old = new Date(memoTime(data)),
        day = new Date(chosen);
      const updated = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        old.getHours(),
        old.getMinutes(),
        old.getSeconds(),
      ).getTime();
      try {
        await db
          .ref(pathFor(source))
          .child(key)
          .update({ capturedAt: updated, dateSource: "manual" });
        success++;
        batchSelected.delete(itemId(source, key));
      } catch (e) {
        console.error(e);
      }
    }
    toast(`${success}개의 날짜를 바꿨어요.`);
  } finally {
    busy = false;
    if (!batchSelected.size) leaveBatch();
    else refreshBatch();
  }
}

// -------------------------------------------------------------------
// 8. 초기화
// -------------------------------------------------------------------
function setupViewportResize() {
  const apply = () =>
    document.documentElement.style.setProperty(
      "--visual-height",
      (window.visualViewport?.height || window.innerHeight) + "px",
    );
  apply();
  window.visualViewport?.addEventListener("resize", apply);
  window.addEventListener("resize", apply);
}
function init() {
  // 예전 좌우 이동 버튼을 제거했더라도 오류가 나지 않게 함
  $("archive-tab").onclick = () => setArchive(true);
  $("archive-close").onclick = () => setArchive(false);
  $("archive-grip").onclick = () => setArchive(false);
  $("camera-btn").onclick = () => $("camera-input").click();
  $("gallery-btn").onclick = () => $("gallery-input").click();
  for (const id of ["camera-input", "gallery-input"]) {
    const input = $(id);
    input.onchange = async () => {
      const files = [...(input.files || [])];
      input.value = "";
      await uploadFiles(files);
    };
  }
  $("archive-search").oninput = drawAlbums;
  $("archive-date").onchange = drawAlbums;
  $("archive-reset").onclick = () => {
    $("archive-search").value = "";
    $("archive-date").value = "";
    drawAlbums();
  };
  $("viewer-close").onclick = closePhotoViewer;
  $("batch-all").onclick = toggleAll;
  $("batch-cancel").onclick = leaveBatch;
  $("batch-delete").onclick = batchDelete;
  $("batch-date").onclick = batchChangeDate;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("photo-viewer").hidden) closePhotoViewer();
  });
  setupSwipes();
  setupArchiveRailDrag();
  setupViewportResize();
  if (!db || typeof db.ref !== "function") {
    toast(
      "Firebase 연결을 확인해 주세요. 인터넷 또는 Firebase 설정을 확인하세요.",
    );
    console.error("Firebase Realtime Database가 초기화되지 않았습니다.");
  } else {
    subscribe("incoming", incoming);
    subscribe("saved_memos", saved);
  }
  drawDarkroom();
  drawAlbums();
  drawCoverPolaroids();
  scheduleDailyCoverRefresh();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) drawCoverPolaroids();
  });
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
