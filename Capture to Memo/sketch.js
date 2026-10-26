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
  const all = [];

  // 최소 일주일(7일) 전 보관한 사진만
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  for (const [key, data] of saved) {
    if (!data?.image) continue;

    // 새 기록은 실제 보관 시각을 사용.
    // 예전 기록은 기존 저장된 시각을 대체 기준으로 사용.
    const archivedAt =
      timestamp(data.savedAt) ??
      timestamp(data.archivedAt) ??
      timestamp(data.timestamp) ??
      timestamp(data.createdAt);

    if (archivedAt === null || archivedAt > cutoff) {
      continue;
    }

    all.push({
      source: "locker",
      key,
      data,
      t: memoTime(data),
    });
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

  // 보관함에서 최소 7일 지난 사진만
  const pool = coverPhotoPool().sort((a, b) =>
    String(a.key).localeCompare(String(b.key)),
  );

  // 사진 목록을 일정한 무작위 순서로 섞기
  // 같은 사진 목록이면 새로고침해도 순서 유지
  let seed = 2166136261;

  for (const item of pool) {
    for (const char of String(item.key)) {
      seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    }
  }

  const shuffled = [...pool];

  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    const j = seed % (i + 1);

    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // 오늘 날짜를 기준으로 하루마다 선택 위치 변경
  const today = new Date();

  const dayNumber = Math.floor(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000,
  );

  const count = Math.min(3, shuffled.length);
  const start = shuffled.length ? dayNumber % shuffled.length : 0;

  const chosen = [];

  for (let i = 0; i < count; i++) {
    chosen.push(shuffled[(start + i) % shuffled.length]);
  }

  coverFloatingIds = chosen.map((item) => itemId(item.source, item.key));

  host.replaceChildren();
  host.hidden = chosen.length === 0;

  // 선정한 사진으로 폴라로이드 만들기
  chosen.forEach((item, index) => {
    const card = document.createElement("button");

    card.type = "button";
    card.className = `cover-float-card pos-${index + 1}`;

    card.draggable = false;
    card.title = "사진을 눌러 메모 편집";

    card.setAttribute(
      "aria-label",
      `${item.data.labelTxt || localDay(item.t)} 메모 편집`,
    );

    const img = new Image();
    img.src = item.data.image;
    img.alt = item.data.labelTxt || "기록된 사진";
    img.draggable = false;
    img.loading = "lazy";

    const label = document.createElement("span");
    label.className = "cover-float-label";

    label.textContent =
      item.data.labelTxt?.trim() || localDay(item.t) || "MEMO";

    card.append(img, label);

    card.addEventListener("contextmenu", (event) => event.preventDefault());

    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (busy || batchMode) return;

      openEditor("locker", item.key);
    });

    host.appendChild(card);
  });

  // 기존에 직접 조절한 사진 위치·회전·크기 유지
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

function scheduleDailyCoverRefresh() {
  const now = new Date();

  // 다음 날 00:00
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
  );

  const delay = midnight.getTime() - now.getTime() + 500;

  setTimeout(
    () => {
      drawCoverPolaroids();
      scheduleDailyCoverRefresh();
    },
    Math.max(1000, delay),
  );
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
      // 터치를 시작한 곳이 사진인지 확인
      const touchedPhoto =
        event.target instanceof Element &&
        !!event.target.closest(
          "#front-photo-layer .hanging-polaroid, " + ".cover-float-card",
        );

      if (
        event.touches.length !== 1 ||
        batchMode ||
        busy ||
        touchedPhoto ||
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

      // 사진에서 시작한 터치는 절대로
      // 보관함 열기 동작으로 처리하지 않음
      if (
        start.target instanceof Element &&
        start.target.closest(
          "#front-photo-layer .hanging-polaroid, " + ".cover-float-card",
        )
      ) {
        return;
      }

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
  hasRendered: false,
  width: 0,
  height: 0,
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

/* ======================================
   PHOTO DRAG + FLEXIBLE WIRE
   1단계: 줄에 연결된 상태로 잡아당기기
====================================== */

function darkroomDragOffset(t) {
  const drag = darkroomPhysics.photoDrag;

  if (!drag || !drag.moved) {
    return { x: 0, y: 0 };
  }

  // 줄이 얼마나 팽팽한지 결정
  // 작을수록 덜 늘어남
  const MAX_PULL_X = 46;
  const MAX_PULL_Y = 58;

  // 잡아당긴 힘이 강해져도 무한정 늘어나지 않음
  const pullX = MAX_PULL_X * Math.tanh(drag.dx / 90);
  const pullY = MAX_PULL_Y * Math.tanh(drag.dy / 90);

  // 잡은 부분 주변의 줄과 사진만 움직이기
  const distance = (t - drag.t) / 0.16;
  const influence = Math.exp(-0.5 * distance * distance);

  // 줄의 왼쪽 끝과 오른쪽 끝은 고정
  const edgeDistance = Math.max(0, Math.min(1, t / 0.07, (1 - t) / 0.07));

  // 끝부분으로 갈수록 자연스럽게 당김이 줄어듦
  const edgeLock = edgeDistance * edgeDistance * (3 - 2 * edgeDistance);

  const strength = influence * edgeLock;

  return {
    x: pullX * strength,
    y: pullY * strength,
  };
}

/* ========================================
   책 / 가위 구역 판정
======================================== */

function isInsideMemoTarget(id, clientX, clientY) {
  const el = $(id);
  if (!el || archiveOpen) return false;

  const rect = el.getBoundingClientRect();

  return (
    clientX >= rect.left &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );
}

/* ========================================
   다른 곳에 놓으면 원래 줄로 복귀
======================================== */

function returnDarkroomPhotoToWire(hanger) {
  if (!hanger || hanger.deleting) return;

  // 현재 자유롭게 움직인 위치부터 복귀 시작
  hanger.returning = {
    fromX: hanger.freeX,
    fromY: hanger.freeY,
    start: performance.now(),
  };

  hanger.detached = false;
  hanger.landed = true;
  hanger.v = 0;
  hanger.swing = 0;
  hanger.swingV = 0;

  hanger.el.classList.remove("detached");

  // 사진이 다시 줄에 붙으므로 자리 재계산
  reflowAttachedDarkroomPhotos();
}

/* ========================================
   사진 파기: 흰 정삼각형이 퍼지는 효과
======================================== */

function playDarkroomShredEffect(clientX, clientY) {
  const duration = 1000;
  const count = 40;

  for (let i = 0; i < count; i++) {
    const particle = document.createElement("span");

    // 기존보다 훨씬 큰 흰 정삼각형
    const size = 18 + Math.random() * 28;
    const angle = Math.random() * Math.PI * 2;
    const distance = 60 + Math.random() * 150;

    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance + 55;
    const rotation = (Math.random() - 0.5) * 720;
    const alpha = 0.4 + Math.random() * 0.5;

    Object.assign(particle.style, {
      position: "fixed",
      left: `${clientX}px`,
      top: `${clientY}px`,
      width: `${size}px`,
      height: `${size}px`,
      background: "#ffffff",
      clipPath: "polygon(50% 0%, 0% 86.6025%, 100% 86.6025%)",
      pointerEvents: "none",
      zIndex: "9999",
    });

    document.body.appendChild(particle);

    const animation = particle.animate(
      [
        {
          offset: 0,
          transform: "translate(-50%, -50%) scale(0.3)",
          opacity: 0,
        },
        {
          offset: 0.1,
          transform: "translate(-50%, -50%) scale(1)",
          opacity: alpha,
        },
        {
          offset: 1,
          transform: `translate(-50%, -50%)
             translate(${dx}px, ${dy}px)
             rotate(${rotation}deg) scale(0.25)`,
          opacity: 0,
        },
      ],
      {
        duration,
        easing: "cubic-bezier(.15,.6,.35,1)",
        fill: "forwards",
      },
    );

    animation.finished.catch(() => {}).finally(() => particle.remove());
  }
}

/* ========================================
   가위 구역에 놓으면 Firebase에서 삭제
======================================== */

async function shredDarkroomPhoto(hanger, clientX, clientY) {
  if (!hanger || hanger.deleting) return;

  hanger.deleting = true;
  hanger.el.style.pointerEvents = "none";

  // 파기 효과 0.5초
  playDarkroomShredEffect(clientX, clientY);

  const fade = hanger.el.animate(
    [
      { opacity: 1, filter: "blur(0px)" },
      { opacity: 0, filter: "blur(5px)" },
    ],
    {
      duration: 1000,
      easing: "ease-out",
      fill: "forwards",
    },
  );

  // 화면의 파기 효과가 끝난 뒤 실제 삭제
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    await db.ref("incoming").child(hanger.key).remove();

    // 기존 Firebase child_removed 구독에서
    // 화면 제거와 사진 목록 갱신 처리
  } catch (error) {
    console.error("사진 파기 실패:", error);

    fade.cancel();
    hanger.el.style.pointerEvents = "auto";
    hanger.deleting = false;

    returnDarkroomPhotoToWire(hanger);

    toast("삭제에 실패해 사진을 줄에 다시 걸었어요.");
  }
}

function enableDarkroomPhotoDrag(card, key) {
  card.style.touchAction = "none";
  card.style.cursor = "grab";

  let session = null;
  let suppressClick = false;

  // 사진 잡기
  card.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    if (busy || batchMode || archiveOpen || darkroomPhysics.photoDrag?.active)
      return;

    const hanger = darkroomPhysics.items.get(key);

    if (!hanger || !hanger.landed || hanger.deleting || hanger.returning)
      return;

    session = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
    };
  });

  // 사진 움직이기
  card.addEventListener("pointermove", (event) => {
    if (!session || event.pointerId !== session.id) {
      return;
    }

    const hanger = darkroomPhysics.items.get(key);
    if (!hanger || hanger.deleting) return;

    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;

    if (!session.moved && Math.hypot(dx, dy) < 7) return;

    if (!session.moved) {
      session.moved = true;
      suppressClick = true;

      card.classList.add("dragging");
      card.style.cursor = "grabbing";

      try {
        card.setPointerCapture(event.pointerId);
      } catch {}

      if (!hanger.detached) {
        darkroomPhysics.photoDrag = {
          active: true,
          moved: true,
          t: hanger.t,
          dx: 0,
          dy: 0,
        };
      }
    }

    if (hanger.detached) {
      // 분리된 사진은 자유롭게 이동
      hanger.freeX += event.clientX - session.lastX;

      hanger.freeY += event.clientY - session.lastY;
    } else {
      // 줄에 연결된 사진을 잡아당기기
      const drag = darkroomPhysics.photoDrag;

      if (drag) {
        drag.dx = Math.max(-260, Math.min(260, dx));

        drag.dy = Math.max(-230, Math.min(230, dy));
      }

      // 130px 이상 당기면 똑! 분리
      if (Math.hypot(dx, dy) >= 130) {
        const p = getDarkroomWirePoint(hanger.t);

        hanger.detached = true;
        hanger.freeX = p.x + dx;
        hanger.freeY = p.y + dy;

        hanger.swing = 0;
        hanger.swingV = 0;

        card.classList.add("detached");

        if (drag) drag.active = false;

        reflowAttachedDarkroomPhotos();
        playDarkroomDetachEffect(hanger);
      }
    }

    session.lastX = event.clientX;
    session.lastY = event.clientY;

    if (hanger.detached) {
      card.style.left = `${hanger.freeX}px`;
      card.style.top = `${hanger.freeY}px`;
      card.style.transform = "translateX(-50%) rotate(0rad)";
    }

    // 책에 들어오는 즉시 페이지 반응
    $("memo-drop-zone")?.classList.toggle(
      "is-over",
      hanger.detached &&
        isInsideMemoTarget("memo-drop-zone", event.clientX, event.clientY),
    );

    // 가위 구역 진입 즉시 강조
    $("shred-zone")?.classList.toggle(
      "is-over",
      hanger.detached &&
        isInsideMemoTarget("shred-zone", event.clientX, event.clientY),
    );

    event.preventDefault();
  });

  // 사진 놓기
  function release(event) {
    if (!session || session.id !== event.pointerId) return;

    const hanger = darkroomPhysics.items.get(key);
    const moved = session.moved;

    const onBook =
      moved &&
      hanger?.detached &&
      event.type === "pointerup" &&
      isInsideMemoTarget("memo-drop-zone", event.clientX, event.clientY);

    const onShredder =
      moved &&
      hanger?.detached &&
      event.type === "pointerup" &&
      isInsideMemoTarget("shred-zone", event.clientX, event.clientY);

    if (darkroomPhysics.photoDrag?.active) {
      darkroomPhysics.photoDrag.active = false;
    }

    $("memo-drop-zone")?.classList.remove("is-over");
    $("shred-zone")?.classList.remove("is-over");

    card.classList.remove("dragging");
    card.style.cursor = "grab";

    session = null;

    if (card.hasPointerCapture(event.pointerId)) {
      try {
        card.releasePointerCapture(event.pointerId);
      } catch {}
    }

    if (!hanger?.detached || !moved) return;

    if (onBook) {
      // 책에 놓기 → 기존 편집창
      requestAnimationFrame(() => {
        openEditor("incoming", key);
      });
    } else if (onShredder) {
      // 가위 구역 → 삼각형 효과 + 실제 삭제
      shredDarkroomPhoto(hanger, event.clientX, event.clientY);
    } else {
      // 어느 쪽도 아니라면 원래 줄로 복귀
      returnDarkroomPhotoToWire(hanger);
    }
  }

  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);

  // 드래그 직후 클릭 이벤트로 편집창이
  // 잘못 열리는 것을 방지
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

function tickDarkroomPhotoDrag(dt) {
  const drag = darkroomPhysics.photoDrag;

  if (!drag || drag.active) return;

  // 놓으면 자연스럽게 원래 줄 모양으로 복귀
  const decay = Math.exp(-11 * dt);

  drag.dx *= decay;
  drag.dy *= decay;

  if (Math.hypot(drag.dx, drag.dy) < 0.25) {
    darkroomPhysics.photoDrag = null;
  }
}

function prepareDarkroomBendingWire() {
  const old = $("front-wire");

  if (!old || old.tagName.toLowerCase() === "path") return;

  // 기존 직선 SVG를 휘어질 수 있는 Path로 변경
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

  path.id = "front-wire";
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("vector-effect", "non-scaling-stroke");

  old.replaceWith(path);
}

function renderDarkroomBendingWire() {
  const path = $("front-wire");

  if (!path || path.tagName.toLowerCase() !== "path") return;

  const width = darkroomPhysics.width * 2;

  const height = darkroomPhysics.height || 700;
  const points = [];

  for (let i = 0; i <= 128; i++) {
    const t = i / 128;
    const offset = darkroomDragOffset(t);

    const x = width * t + offset.x;
    const y = height * (0.16 + 0.34 * t) + offset.y;

    points.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
  }

  path.setAttribute("d", points.join(" "));
}

function createDarkroomHanger(key, data, t, newArrival) {
  const layer = $("front-photo-layer");
  const { card, img, label } = makeHangingPhoto(key, data, t);
  enableDarkroomPhotoDrag(card, key);
  layer.append(card);

  const height = card.offsetHeight || 203;
  const width = card.offsetWidth || 168;
  // 새 사진은 화면 바깥의 줄 위에서 시작한다.
  const initialT = newArrival && !darkroomPhysics.reduced ? 0.39 : 0.89;
  const point = getDarkroomWirePoint(initialT);
  const hanger = {
    key,
    data,
    el: card,
    img,
    label,
    t: initialT,
    targetT: initialT,
    v: 0,
    swing: 0,
    swingV: 0,
    landed: !newArrival,
    body: null,
    rope: null,
    cardH: height,
    cardW: width,
  };

  if (window.Matter && darkroomPhysics.engine) {
    const M = window.Matter;
    const body = M.Bodies.rectangle(
      point.x,
      point.y + height / 2,
      width * 0.76,
      height * 0.78,
      { frictionAir: 0.14, restitution: 0.01, collisionFilter: { group: -1 } },
    );
    const rope = M.Constraint.create({
      pointA: { x: point.x, y: point.y },
      bodyB: body,
      pointB: { x: 0, y: -height / 2 },
      length: 0,
      stiffness: 0.98,
      damping: 0.38,
    });
    M.Composite.add(darkroomPhysics.engine.world, [body, rope]);
    hanger.body = body;
    hanger.rope = rope;
  }

  darkroomPhysics.items.set(key, hanger);
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

// Oldest photos settle closer to the lower right end; new ones arrive from
// beyond the left edge and fill the available hanging positions.

function distributeDarkroomHangers(all) {
  // 촬영 날짜가 아니라 실제로 들어온 순서를 기준으로 배치
  const arrivalOrder = new Map(
    [...incoming.keys()].map((key, index) => [key, index]),
  );

  // 줄에서 분리된 사진은 자리 계산에서 제외
  const attached = all
    .filter((item) => {
      const hanger = darkroomPhysics.items.get(item.key);
      return hanger && !hanger.detached;
    })
    .sort(
      (a, b) =>
        (arrivalOrder.get(a.key) ?? Infinity) -
        (arrivalOrder.get(b.key) ?? Infinity),
    );

  if (attached.length === 0) return;

  const width = Math.max(1, darkroomPhysics.width || 900);

  const widest = Math.max(
    168,
    ...attached.map((item) => darkroomPhysics.items.get(item.key).cardW || 168),
  );

  const margin = Math.min(width * 0.31, Math.max(22, widest * 0.8));

  const minT = 0.5 + margin / (2 * width);

  const shredZone = $("shred-zone");

  // 가위 구역이 차지하는 실제 너비
  const shredWidth = shredZone ? shredZone.getBoundingClientRect().width : 0;

  // 폴라로이드 절반 너비 + 추가 안전거리 30px
  const safeDistance = widest / 2 + 30;

  // 사진의 오른쪽 끝이 가위 구역에 닿지 않도록 제한
  const maxT = Math.max(minT, 1 - (shredWidth + safeDistance) / (2 * width));

  // 간격을 일정하게 유지해서 빈자리 뒤의 사진만 이동하도록
  const preferredStep = (widest + 78) / (2 * width);

  const step =
    attached.length > 1
      ? Math.min(preferredStep, (maxT - minT) / (attached.length - 1))
      : 0;

  attached.forEach((item, index) => {
    const hanger = darkroomPhysics.items.get(item.key);

    // 오래전에 들어온 사진이 오른쪽
    // 새로 들어온 사진일수록 왼쪽
    hanger.targetT = maxT - index * step;
  });
}

// 사진을 떼어냈을 때 남은 자리들을 다시 계산
function reflowAttachedDarkroomPhotos() {
  const all = [...incoming]
    .filter(([, data]) => data?.image)
    .map(([key, data]) => ({
      key,
      data,
      t: memoTime(data),
    }));

  distributeDarkroomHangers(all);
}

// 분리 순간에 작은 반짝임 효과
function playDarkroomDetachEffect(hanger) {
  const card = hanger.el;
  const pieces = [];

  const ring = document.createElement("span");

  Object.assign(ring.style, {
    position: "absolute",
    left: "50%",
    top: "-10px",
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    border: "2px solid rgba(85,145,245,.88)",
    boxShadow: "0 0 12px rgba(110,180,255,.55)",
    pointerEvents: "none",
    zIndex: "900",
  });

  card.appendChild(ring);
  pieces.push(ring);

  ring.animate(
    [
      {
        transform: "translate(-50%,-50%) scale(.3)",
        opacity: 1,
      },
      {
        transform: "translate(-50%,-50%) scale(1.9)",
        opacity: 0,
      },
    ],
    {
      duration: 380,
      easing: "ease-out",
      fill: "forwards",
    },
  );

  // 집게 주위에 작은 빛 입자 5개
  for (let i = 0; i < 5; i++) {
    const spark = document.createElement("span");

    const angle = ((-135 + i * 68) * Math.PI) / 180;
    const distance = 18 + (i % 2) * 10;

    Object.assign(spark.style, {
      position: "absolute",
      left: "50%",
      top: "-10px",
      width: "5px",
      height: "5px",
      borderRadius: "50%",
      background: i % 2 ? "#b6f1ff" : "#7fa4ff",
      boxShadow: "0 0 6px rgba(130,180,250,.6)",
      pointerEvents: "none",
      zIndex: "901",
    });

    card.appendChild(spark);
    pieces.push(spark);

    spark.animate(
      [
        {
          transform: "translate(-50%,-50%) scale(1)",
          opacity: 1,
        },
        {
          transform: `translate(-50%,-50%) translate(${
            Math.cos(angle) * distance
          }px,${Math.sin(angle) * distance}px) scale(.2)`,
          opacity: 0,
        },
      ],
      {
        duration: 360,
        easing: "ease-out",
        fill: "forwards",
      },
    );
  }

  // 효과가 끝나면 임시 요소 제거
  setTimeout(() => {
    pieces.forEach((piece) => piece.remove());
  }, 450);
}

function initDarkroomLines() {
  if (darkroomPhysics.started) return;
  darkroomPhysics.started = true;
  updateDarkroomWires();
  prepareDarkroomBendingWire();
  renderDarkroomBendingWire();
  if (window.Matter) {
    const M = window.Matter;
    darkroomPhysics.engine = M.Engine.create({ enableSleeping: false });
    darkroomPhysics.engine.gravity.y = 2.15;
    darkroomPhysics.engine.gravity.scale = 0.001;
  } else {
    console.warn("Matter.js를 불러오지 못해 기본 스프링 흔들림을 사용합니다.");
  }
  darkroomPhysics.lastTime = performance.now();
  requestAnimationFrame(animateDarkroomLines);
  window.addEventListener("resize", () => {
    updateDarkroomWires();
    for (const hanger of darkroomPhysics.items.values()) {
      hanger.cardH = hanger.el.offsetHeight || hanger.cardH;
      hanger.cardW = hanger.el.offsetWidth || hanger.cardW;
    }
  });
}

/* =====================================
   인화실 최초 등장: 페이지 로딩당 한 번
===================================== */

function beginDarkroomRevealOnce() {
  // 이미 등장했다면 다시 실행하지 않음
  if (darkroomPhysics.revealStarted) return;

  const hangers = [...darkroomPhysics.items.values()];

  // Firebase 사진을 아직 불러오지 않았다면 대기
  if (!hangers.length) return;

  darkroomPhysics.revealStarted = true;

  const start = performance.now();

  // 오래된 사진부터 순서대로 등장
  hangers.sort((a, b) => memoTime(a.data) - memoTime(b.data));

  hangers.forEach((hanger, i) => {
    // 사진마다 0.6초 간격으로 출발
    hanger.spawnAt = start + i * 250;

    // 책 안쪽에서 출발
    hanger.t = 0.32;
    hanger.v = 0;

    hanger.landed = false;
    hanger.swing = 0;
    hanger.swingV = 0;

    hanger.el.style.visibility = "hidden";
  });
}

/* =====================================
   인화실 사진 그리기
===================================== */

function drawDarkroom() {
  initDarkroomLines();

  const all = [...incoming]
    .filter(([, data]) => data?.image)
    .map(([key, data]) => ({
      key,
      data,
      t: memoTime(data),
    }))
    .sort((a, b) => a.t - b.t);

  $("incoming-count").textContent = `${pad(all.length)} PHOTOS`;

  $("room-empty").hidden = all.length > 0;

  const ids = new Set(all.map((item) => item.key));

  // 삭제된 사진은 화면에서도 제거
  for (const key of [...darkroomPhysics.items.keys()]) {
    if (!ids.has(key)) {
      removeDarkroomHanger(key);
    }
  }

  const addedKeys = [];

  // 기존 사진 유지, 새 사진만 생성
  for (const { key, data, t } of all) {
    let hanger = darkroomPhysics.items.get(key);

    if (!hanger) {
      hanger = createDarkroomHanger(key, data, t, true);

      addedKeys.push(key);
    } else if (hanger.data.image !== data.image) {
      hanger.img.src = data.image;
    }

    hanger.data = data;
    hanger.label.textContent = localDay(t);
  }

  distributeDarkroomHangers(all);

  // 기존 사진의 출발 시간은 변경하지 않음
  let nextSpawn = Math.max(
    performance.now(),
    ...[...darkroomPhysics.items.values()]
      .filter((h) => !addedKeys.includes(h.key) && Number.isFinite(h.spawnAt))
      .map((h) => h.spawnAt + 600),
  );

  for (const key of addedKeys) {
    const hanger = darkroomPhysics.items.get(key);

    hanger.t = 0.39;
    hanger.v = 0;
    hanger.swing = 0;
    hanger.swingV = 0;
    hanger.landed = false;

    hanger.el.style.visibility = "hidden";

    if (darkroomPhysics.revealStarted) {
      // 첫 등장 이후 새로 불러온 사진만
      // 개별적으로 줄을 타고 등장
      hanger.spawnAt = nextSpawn;
      nextSpawn += 600;
    } else {
      // 화면을 1/3 밀기 전까지 대기
      hanger.spawnAt = Infinity;
    }
  }

  darkroomPhysics.hasRendered = true;

  // 사용자가 먼저 스크롤한 뒤 사진이
  // Firebase에서 늦게 로딩돼도 정상 실행
  if ((Number(window.__ctmRoomProgress) || 0) >= 1 / 3) {
    beginDarkroomRevealOnce();
  }
}

// Horizontal swiping creates an impulse on the pendulum bodies. It does NOT
// alter the world scroll position or the book-opening animation.

function nudgeDarkroomPhotos(deltaX) {
  const impulse = Math.max(-30, Math.min(30, deltaX));

  for (const hanger of darkroomPhysics.items.values()) {
    if (!hanger.landed) continue;

    // 스크롤 속도가 빠를수록 큰 충격
    hanger.swingV -= impulse * 0.045;

    // 무한히 커지지 않도록 제한
    hanger.swingV = Math.max(-3.2, Math.min(3.2, hanger.swingV));
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

  // 줄 이동 전체 시간: 2.8초
  const RIDE_DURATION = 2800;
  const START_T = 0.32;

  for (const hanger of darkroomPhysics.items.values()) {
    // 최초 등장 전이거나 출발 순서가 아니면 숨기기
    if (!darkroomPhysics.revealStarted || now < hanger.spawnAt) {
      hanger.el.style.visibility = "hidden";
      continue;
    }

    hanger.el.style.visibility = "visible";

    if (darkroomPhysics.reduced) {
      hanger.t = hanger.targetT;
      hanger.landed = true;
      hanger.swing = 0;
      hanger.swingV = 0;
    } else {
      // =====================================
      // A. 짚라인 이동: Ease Out Cubic
      // =====================================

      if (!hanger.landed) {
        const elapsed = Math.max(0, now - hanger.spawnAt);

        const u = Math.min(1, elapsed / RIDE_DURATION);

        // 처음에는 빠르고 도착할수록 부드럽게 감속
        const easeOut = 1 - Math.pow(1 - u, 3);

        hanger.t = START_T + (hanger.targetT - START_T) * easeOut;

        // 이동하는 동안은 크게 흔들리지 않음
        hanger.swing *= Math.exp(-7 * dt);
        hanger.swingV *= Math.exp(-7 * dt);

        // =====================================
        // B. 도착 후 집게에서 짧게 덜렁임
        // =====================================

        if (u >= 1) {
          hanger.t = hanger.targetT;
          hanger.landed = true;

          // 도착하면 기울어지지 않고 바로 정지
          hanger.swing = 0;
          hanger.swingV = 0;
        }
      }

      // =====================================
      // C. 도착 후 진자 운동
      // =====================================

      const acceleration = -115 * Math.sin(hanger.swing) - 8.5 * hanger.swingV;

      hanger.swingV += acceleration * dt;
      hanger.swing += hanger.swingV * dt;

      hanger.swing = Math.max(-0.35, Math.min(0.35, hanger.swing));

      if (
        hanger.landed &&
        Math.abs(hanger.swing) < 0.001 &&
        Math.abs(hanger.swingV) < 0.012
      ) {
        hanger.swing = 0;
        hanger.swingV = 0;
      }
    }

    // =====================================
    // D. 사진 위치 및 회전 적용
    // =====================================

    // 줄에 붙어 있는 사진만 새 목표 위치로 부드럽게 이동
    if (!hanger.detached && hanger.landed && Number.isFinite(hanger.targetT)) {
      const follow = 1 - Math.exp(-8 * dt);

      hanger.t += (hanger.targetT - hanger.t) * follow;

      if (Math.abs(hanger.targetT - hanger.t) < 0.00025) {
        hanger.t = hanger.targetT;
      }
    }
    const p = getDarkroomWirePoint(hanger.t);
    const offset = darkroomDragOffset(hanger.t);

    if (hanger.returning) {
      // 분리된 사진이 원래 줄로 돌아오는 중
      const duration = 460;

      const u = Math.min(1, (now - hanger.returning.start) / duration);

      const eased = 1 - Math.pow(1 - u, 3);

      const fromX = hanger.returning.fromX;
      const fromY = hanger.returning.fromY;

      const toX = p.x + offset.x;
      const toY = p.y + offset.y;

      const x = fromX + (toX - fromX) * eased;
      const y = fromY + (toY - fromY) * eased;

      hanger.el.style.left = `${x}px`;
      hanger.el.style.top = `${y}px`;
      hanger.el.style.transform = "translateX(-50%) rotate(0rad)";
      hanger.el.style.zIndex = "500";

      if (u >= 1) {
        hanger.returning = null;
      }
    } else if (hanger.detached) {
      // 줄에서 분리되어 드래그 중인 사진
      hanger.el.style.left = `${hanger.freeX}px`;
      hanger.el.style.top = `${hanger.freeY}px`;
      hanger.el.style.transform = "translateX(-50%) rotate(0rad)";
      hanger.el.style.zIndex = "500";
    } else {
      // 줄에 정상적으로 매달린 사진
      hanger.el.style.left = `${p.x + offset.x}px`;

      hanger.el.style.top = `${p.y + offset.y}px`;

      hanger.el.style.transform = `translateX(-50%) rotate(${hanger.swing}rad)`;

      hanger.el.style.zIndex = String(5 + Math.round(hanger.targetT * 100));
    }

    if (
      darkroomPhysics.photoDrag?.active &&
      Math.abs(darkroomPhysics.photoDrag.t - hanger.t) < 0.001
    ) {
      hanger.el.style.zIndex = "500";
    }
  }

  renderDarkroomBendingWire();
}

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
  btn.dataset.date = clockTime(row.t);
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
function createPage(day, rows) {
  const page = document.createElement("div");
  page.className = "album-page";
  const heading = document.createElement("p");
  heading.className = "page-date";
  heading.textContent = day
    ? `${relativeDay(day)}  ·  ${rows.length} PHOTOS`
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
  rows.forEach((r) => grid.appendChild(createAlbumPhoto(r)));
  page.appendChild(grid);
  return page;
}
function drawAlbums() {
  const rail = $("album-rail");
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

  const days = new Map();
  rows.forEach((row) => {
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
    { color: "#c5badc", ink: "#473962", dark: false },
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
    card.style.setProperty(
      "--album-angle",
      `${rotations[albumIndex % rotations.length]}deg`,
    );
    if (albumClosed.has(albumKey)) card.classList.add("closed");

    const spread = document.createElement("div");
    spread.className = "album-spread";
    spread.append(
      createPage(firstDay, days.get(firstDay)),
      createPage(secondDay, secondDay ? days.get(secondDay) : []),
    );

    const cover = document.createElement("div");
    cover.className = "album-cover";
    cover.innerHTML = `
      <span class="album-cover-mini">CAPTURE TO MEMO · VOL.${String(albumIndex + 1).padStart(2, "0")}</span>
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
    card.addEventListener("pointerdown", (event) => {
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      justDragged = false;
    });
    card.addEventListener("pointermove", (event) => {
      if (!press || event.pointerId !== press.id) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 9) {
        justDragged = true;
      }
    });
    card.addEventListener("pointercancel", () => {
      press = null;
    });
    card.addEventListener("pointerup", () => {
      press = null;
    });
    card.addEventListener("click", (event) => {
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
function openEditor(source, key) {
  if (batchMode || busy) return;
  const data = record(source, key);
  if (!data) return;
  editorItem = { source, key };
  lastSelectedRange = null;
  const ui = dialogFrame(
    source === "incoming" ? "사진에 기억 남기기" : "앨범의 기록 수정하기",
    "사진을 누르면 크게 볼 수 있어요.",
  );
  const heading = makeField("제목", data.labelTxt || "");
  heading.input.placeholder = "비워두면 사진 날짜가 제목이 돼요";
  heading.input.maxLength = 80;
  const img = new Image();
  img.src = data.image;
  img.alt = "메모 이미지";
  img.className = "edit-image";
  img.onclick = () => openPhotoViewer(data.image);
  const label = document.createElement("div");
  label.className = "field";
  label.innerHTML = "<label>상세 메모</label>";
  const editor = document.createElement("div");
  editor.className = "rich-editor";
  editor.contentEditable = "true";
  editor.setAttribute("role", "textbox");
  editor.setAttribute("aria-multiline", "true");
  editor.dataset.placeholder = "오늘 있었던 일을 자유롭게 기록해 보세요.";
  if (data.longMemoHtml && window.DOMPurify)
    editor.innerHTML = cleanRich(data.longMemoHtml);
  else {
    // 이전 버전의 일반 텍스트도 줄 단위로 나누어 체크박스가 줄 앞에 붙게 함
    const lines = String(data.longMemo || "").split(/\r?\n/);
    for (const line of lines) {
      const div = document.createElement("div");
      if (line) div.textContent = line;
      else div.append(document.createElement("br"));
      editor.append(div);
    }
  }
  editor
    .querySelectorAll(".memo-task span")
    .forEach((s) => (s.contentEditable = "true"));
  editor.querySelectorAll(".memo-task input").forEach((input) => {
    input.checked = input.hasAttribute("checked");
  });
  editor.addEventListener("keyup", () => {
    const s = window.getSelection();
    if (
      s?.rangeCount &&
      editor.contains(s.getRangeAt(0).commonAncestorContainer)
    )
      lastSelectedRange = s.getRangeAt(0).cloneRange();
  });
  editor.addEventListener("touchend", () =>
    setTimeout(() => {
      const s = window.getSelection();
      if (
        s?.rangeCount &&
        editor.contains(s.getRangeAt(0).commonAncestorContainer)
      )
        lastSelectedRange = s.getRangeAt(0).cloneRange();
    }, 20),
  );
  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  });
  const toolbar = editToolbar(editor);
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const dateBtn = document.createElement("button");
  dateBtn.textContent = "날짜 변경";
  const cancel = document.createElement("button");
  cancel.textContent = "취소";
  const save = document.createElement("button");
  save.className = "solid";
  save.textContent = source === "incoming" ? "보관함에 저장" : "변경사항 저장";
  actions.append(dateBtn, cancel, save);
  label.append(toolbar, editor);
  ui.box.append(heading.field, img, label, actions);

  function closeEditorWithoutSaving() {
    // 저장 중에는 창을 닫지 않음
    if (busy) return;

    ui.layer.remove();
    editorItem = null;

    // 인화실에서 분리한 사진이라면 줄로 복귀
    if (source === "incoming") {
      const hanger = darkroomPhysics.items.get(key);

      if (hanger && hanger.detached && !hanger.deleting) {
        returnDarkroomPhotoToWire(hanger);
      }
    }
  }

  // X 버튼
  ui.x.onclick = closeEditorWithoutSaving;

  // 취소 버튼
  cancel.onclick = closeEditorWithoutSaving;

  // 편집창 바깥의 어두운 배경 클릭
  ui.layer.addEventListener("click", (event) => {
    if (event.target === ui.layer) {
      closeEditorWithoutSaving();
    }
  });
  dateBtn.onclick = async () => {
    const picked = await chooseMissingPhotoDate();
    if (picked === null) return;
    try {
      await db
        .ref(pathFor(source))
        .child(key)
        .update({ capturedAt: picked, dateSource: "manual" });
      data.capturedAt = picked;
      toast("사진 날짜가 변경됐어요.");
    } catch (e) {
      toast("날짜 변경 실패: " + e.message);
    }
  };
  save.onclick = async () => {
    if (busy) return;
    busy = true;
    save.disabled = true;
    save.textContent = "저장 중...";
    try {
      editor
        .querySelectorAll('.memo-task input[type="checkbox"]')
        .forEach((c) => c.toggleAttribute("checked", c.checked));
      const content = editor.innerText || "";
      const html = cleanRich(editor.innerHTML);
      const title = heading.input.value.trim() || localDay(memoTime(data));
      const updated = {
        image: data.image,
        labelTxt: title,
        longMemo: content,
        longMemoHtml: html,
        capturedAt: data.capturedAt ?? memoTime(data),
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
      } else await db.ref("saved_memos").child(key).update(updated);
      ui.layer.remove();
      editorItem = null;
      toast("기록을 저장했어요.");
    } catch (e) {
      console.error(e);
      toast("저장 실패: " + e.message);
    } finally {
      busy = false;
      save.disabled = false;
      save.textContent = "저장";
    }
  };
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

  // 하루에 한 번 메인 사진 변경
  scheduleDailyCoverRefresh();

  // 브라우저를 오래 꺼뒀다가 다시 열어도 날짜 반영
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      drawCoverPolaroids();
    }
  });
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
