/* Capture to Memo — Album Edition / 2026
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
// 1. 화면 이동 — 가로는 표지/인화실, 세로는 보관함
// -------------------------------------------------------------------
function goRoom(next) {
  if (batchMode || busy) return;
  room = next === "darkroom" ? "darkroom" : "cover";
  document.body.classList.toggle("in-darkroom", room === "darkroom");
}
function setArchive(open) {
  if (batchMode || busy) return;
  archiveOpen = !!open;
  document.body.classList.toggle("archive-open", archiveOpen);
  $("archive-sheet").setAttribute("aria-hidden", String(!archiveOpen));
}
function setupSwipes() {
  let gesture = null;
  const blocked = (t) =>
    t?.closest?.(
      "input,textarea,select,[contenteditable],.dialog,.overlay,.format-tools,#batch-bar,.polaroid,.album-photo,.album-cover,.archive-tools,.archive-close,.cover-controls",
    );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (
        batchMode ||
        busy ||
        blocked(e.target) ||
        document.querySelector(".overlay:not([hidden])")
      )
        return;
      gesture = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        target: e.target,
      };
    },
    true,
  );
  document.addEventListener(
    "pointercancel",
    () => {
      gesture = null;
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      if (!gesture || gesture.id !== e.pointerId) return;
      const g = gesture;
      gesture = null;
      if (batchMode || busy) return;
      const dx = e.clientX - g.x,
        dy = e.clientY - g.y,
        dt = Math.max(1, performance.now() - g.t);
      if (archiveOpen) {
        // 앨범 자체의 가로 스크롤은 기본 스크롤을 그대로 사용
        if (
          g.target.closest("#archive-grip,.archive-header") &&
          dy > 70 &&
          Math.abs(dy) > Math.abs(dx) * 1.2
        )
          setArchive(false);
        return;
      }
      // 화면 하단에서 빠르게 위로 밀면 보관함 열기
      if (
        dy < -65 &&
        Math.abs(dy) > Math.abs(dx) * 1.25 &&
        g.y > innerHeight * 0.62 &&
        dt < 850
      ) {
        setArchive(true);
        return;
      }
      // 표지 / 인화실 가로 이동
      if (
        Math.abs(dx) >= 45 &&
        Math.abs(dx) / dt > 0.36 &&
        Math.abs(dx) > Math.abs(dy) * 1.35
      ) {
        if (dx < 0 && room === "cover") goRoom("darkroom");
        if (dx > 0 && room === "darkroom") goRoom("cover");
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
    refreshBatch();
    drawMemoryPill();
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
// 3. 사진 인화실: 두 줄에 폴라로이드 사진 걸기
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
    openEditor(source, key);
  });
  const check = document.createElement("span");
  check.className = "selection-check";
  check.textContent = "✓";
  check.setAttribute("aria-hidden", "true");
  el.appendChild(check);
}
function drawDarkroom() {
  const all = [...incoming]
    .filter(([, d]) => d?.image)
    .map(([key, data]) => ({ key, data, t: memoTime(data) }))
    .sort((a, b) => b.t - a.t);
  $("incoming-count").textContent = `${pad(all.length)} PHOTOS`;
  $("room-empty").hidden = all.length > 0;
  const lines = [$("line-one"), $("line-two")];
  lines.forEach((l) => l.replaceChildren());
  all.forEach(({ key, data, t }, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "polaroid";
    card.style.setProperty("--tilt", `${((i * 17) % 9) - 4}deg`);
    card.title = "사진 편집 (길게 누르면 여러 장 선택)";
    const img = new Image();
    img.src = data.image;
    img.alt = "아직 보관하지 않은 사진";
    img.draggable = false;
    const label = document.createElement("span");
    label.className = "polaroid-label";
    label.textContent = localDay(t);
    card.append(img, label);
    installPhotoInteraction(card, "incoming", key);
    lines[i % 2].appendChild(card);
  });
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
  const img = new Image();
  img.src = row.data.image;
  img.alt = row.data.labelTxt || "저장된 사진";
  img.loading = "lazy";
  img.draggable = false;
  img.onload = () => {
    const r = img.naturalWidth / img.naturalHeight;
    btn.classList.toggle("landscape", r > 1.3);
    btn.classList.toggle("portrait", r < 0.75);
  };
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
  const keepScroll = rail.scrollLeft;
  rail.replaceChildren();
  const rows = filteredSaved();
  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "archive-empty";
    e.innerHTML =
      "<strong>아직 펼칠 앨범이 없어요.</strong><span>인화실에서 사진과 메모를 저장해 보세요.</span>";
    rail.appendChild(e);
    return;
  }
  const days = new Map();
  rows.forEach((r) => {
    if (!days.has(r.day)) days.set(r.day, []);
    days.get(r.day).push(r);
  });
  const keys = [...days.keys()].sort().reverse();
  for (let i = 0; i < keys.length; i += 2) {
    const dayA = keys[i],
      dayB = keys[i + 1];
    const albumKey = `${dayA}|${dayB || ""}`;
    const card = document.createElement("article");
    card.className = "album-card";
    card.dataset.album = albumKey;
    if (albumClosed.has(albumKey)) card.classList.add("closed");
    const caption = document.createElement("div");
    caption.className = "album-caption";
    caption.innerHTML = `<strong>ALBUM / ${pad(Math.floor(i / 2) + 1)}</strong><span>책을 누르면 열고 닫을 수 있어요</span>`;
    const spread = document.createElement("div");
    spread.className = "album-spread";
    spread.append(
      createPage(dayA, days.get(dayA)),
      createPage(dayB, days.get(dayB) || []),
    );
    const cover = document.createElement("div");
    cover.className = "album-cover";
    const start = dayB || dayA;
    const end = dayA;
    cover.innerHTML = `<div class="micro">PERSONAL MEMORY COLLECTION<br>CAPTURE TO MEMO</div><h3>Days<br>worth<br>keeping.</h3><p>${escapeHTML(start)} — ${escapeHTML(end)}</p>`;
    card.append(caption, spread, cover);
    card.addEventListener("click", (e) => {
      if (batchMode || e.target.closest("button,input")) return;
      if (albumClosed.has(albumKey)) albumClosed.delete(albumKey);
      else albumClosed.add(albumKey);
      card.classList.toggle("closed", albumClosed.has(albumKey));
    });
    rail.append(card);
  }
  rail.scrollLeft = keepScroll;
}
function drawMemoryPill() {
  const today = Date.now() - 5 * 86400000;
  const old = [...saved].filter(([, v]) => v?.image && memoTime(v) <= today);
  $("memory-pill").textContent = old.length
    ? `✦ 오늘의 메모 · 오래된 기록 ${old.length}개`
    : "✦ 오늘의 메모 · 추억을 모아주세요";
}
function openRandomMemory() {
  const old = [...saved].filter(
    ([, v]) => v?.image && memoTime(v) <= Date.now() - 5 * 86400000,
  );
  if (!old.length) {
    toast("5일 이상 지난 메모가 아직 없어요.");
    return;
  }
  const [key] = old[Math.floor(Math.random() * old.length)];
  openEditor("locker", key);
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
  ui.x.onclick = () => {
    ui.layer.remove();
    editorItem = null;
  };
  cancel.onclick = ui.x.onclick;
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
  $("next-room").onclick = () => goRoom("darkroom");
  $("prev-room").onclick = () => goRoom("cover");
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
  $("memory-pill").onclick = openRandomMemory;
  $("viewer-close").onclick = closePhotoViewer;
  $("batch-all").onclick = toggleAll;
  $("batch-cancel").onclick = leaveBatch;
  $("batch-delete").onclick = batchDelete;
  $("batch-date").onclick = batchChangeDate;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("photo-viewer").hidden) closePhotoViewer();
  });
  setupSwipes();
  setupViewportResize();
  subscribe("incoming", incoming);
  subscribe("saved_memos", saved);
  drawDarkroom();
  drawAlbums();
  drawMemoryPill();
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", init, { once: true });
else init();
