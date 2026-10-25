/* Capture to Memo!
   시간별 수신함 + 자동 보관 + 물리 보관함
*/

const db = window.db;

let lockerDOM;

let currentTarget = null;
let editingSource = null;
let currentScreen = "work";
let saving = false;
let toastTimer;

const incomingCache = new Map();
const savedCache = new Map();

const TAG_RATIO = 780 / 240;

// -------------------------
// 기본 UI
// -------------------------

function $(id) {
  return document.getElementById(id);
}

function notify(message) {
  const toast = $("status-toast");
  toast.textContent = message;
  toast.style.display = "block";

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 2600);
}

function showScreen(screen) {
  if (batchMode && currentScreen !== screen) {
    exitBatchMode();
  }

  currentScreen = screen;
  // 이 아래에 있는 기존 화면 전환 코드는 그대로 유지

  $("screen-track").classList.toggle("show-locker", screen === "locker");
}

// -------------------------
// 초기화
// -------------------------

function initializeApp() {
  lockerDOM = $("locker");
  initializePhotoInputs();

  $("open-locker-btn").onclick = () => showScreen("locker");
  $("back-btn").onclick = () => showScreen("work");

  $("close-modal").onclick = closeDecoModal;

  // 사진 수신
  const incomingRef = db.ref("incoming");

  incomingRef.on("child_added", (snap) => {
    if (snap.val()?.image) {
      incomingCache.set(snap.key, snap.val());
      renderIncoming();
    }
  });

  incomingRef.on("child_changed", (snap) => {
    if (snap.val()?.image) {
      incomingCache.set(snap.key, snap.val());
    } else {
      incomingCache.delete(snap.key);
    }
    renderIncoming();
  });

  incomingRef.on("child_removed", (snap) => {
    incomingCache.delete(snap.key);
    renderIncoming();
  });

  // 저장된 메모
  const savedRef = db.ref("saved_memos");

  savedRef.on("child_added", upsertMemo);
  savedRef.on("child_changed", upsertMemo);

  savedRef.on("child_removed", (snap) => {
    savedCache.delete(snap.key);

    // 기존 날짜별 보관함 갱신
    removeMemoFromLocker(snap.key);

    // 오늘의 메모 갱신
    scheduleDailyMemoryRefresh();
  });

  initializeLockerFilters();
  initializeMemoToolbar();
  initializePhotoViewer();
  initializeMemoViewport();
  initializeBatchSelection();
}

document.addEventListener("DOMContentLoaded", initializeApp);

// ------------------------------------------------
// 태블릿 한 번 터치로 메모 열기 (PC 더블클릭 유지)
// ------------------------------------------------

function enableTouchOpen(element, getMemo) {
  let touchStart = null;

  element.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;

    touchStart = {
      x: e.clientX,
      y: e.clientY,
      id: e.pointerId,
      moved: false,
    };
  });

  element.addEventListener("pointermove", (e) => {
    if (!touchStart) return;
    if (touchStart.id !== e.pointerId) return;

    const distance = Math.hypot(
      e.clientX - touchStart.x,
      e.clientY - touchStart.y,
    );

    if (distance > 12) {
      touchStart.moved = true;
    }
  });

  element.addEventListener("pointercancel", () => {
    touchStart = null;
  });

  element.addEventListener("pointerup", (e) => {
    if (!touchStart) return;
    if (touchStart.id !== e.pointerId) return;

    // 여기서는 편집창을 열지 않고 터치 상태만 유지
  });

  // pointerup 이후 발생하는 click에서 편집창 열기
  element.addEventListener("click", (e) => {
    if (!touchStart) return;

    const validTouch = !touchStart.moved;
    touchStart = null;

    if (!validTouch || saving) return;

    e.preventDefault();
    e.stopPropagation();

    // 중복으로 편집창 열기 방지
    if ($("deco-modal").classList.contains("open")) {
      return;
    }

    openDecoModal(getMemo());
  });
}

// ------------------------------------------------
// 메인 화면: 카메라/사진첩 → Firebase incoming
// ------------------------------------------------
// 원본 파일에서 EXIF 촬영일을 먼저 읽습니다.
// 캔버스로 변환한 이미지에는 원래 EXIF가 사라질 수 있습니다.

/* =====================================
   사진 원본 날짜 자동 인식 강화
===================================== */

// EXIF 날짜 문자열을 JavaScript 날짜로 변환
function parsePhotoDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === "number") {
    const time = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value !== "string") return null;

  // EXIF: 2026:10:20 14:30:00
  // ISO:  2026-10-20T14:30:00
  const match = value.match(
    /^(\d{4})[:/-](\d{2})[:/-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 12);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);

  const date = new Date(year, month - 1, day, hour, minute, second);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date.getTime();
}

// 사진 파일명에 날짜가 있다면 추출
function readDateFromFilename(filename) {
  const name = filename.replace(/\.[^.]+$/, "");

  // 예:
  // IMG_20261020_143000
  // PXL_20261020_143000
  // 2026-10-20_14-30-00
  const match = name.match(
    /(?:^|[^\d])((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[_\s-]?(\d{2})[-:.]?(\d{2})(?:[-:.]?(\d{2}))?)?(?=$|[^\d])/,
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 12);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);

  const date = new Date(year, month - 1, day, hour, minute, second);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date.getTime();
}

// 날짜가 지나치게 오래되었거나 미래면 제외
function isValidPhotoDate(timestamp) {
  if (!Number.isFinite(timestamp)) return false;

  const minimum = new Date(1990, 0, 1).getTime();
  const maximum = Date.now() + 86400000;

  return timestamp >= minimum && timestamp <= maximum;
}

// 최종 날짜 인식
async function readOriginalPhotoDate(file) {
  // 가장 먼저 EXIF / XMP 확인
  if (window.exifr) {
    try {
      const metadata = await window.exifr.parse(file, {
        tiff: true,
        exif: true,
        xmp: true,
        iptc: true,
        mergeOutput: true,
      });

      console.log("사진 메타데이터:", metadata);

      const possibleDates = [
        metadata?.DateTimeOriginal,
        metadata?.CreateDate,
        metadata?.DateTimeDigitized,
        metadata?.DateTime,
        metadata?.DateCreated,
        metadata?.ModifyDate,
        metadata?.["photoshop:DateCreated"],
        metadata?.["xmp:CreateDate"],
        metadata?.["exif:DateTimeOriginal"],
        metadata?.["tiff:DateTime"],
      ];

      for (const value of possibleDates) {
        const timestamp = parsePhotoDate(value);

        if (isValidPhotoDate(timestamp)) {
          console.log("촬영 날짜 인식 성공:", new Date(timestamp));

          return timestamp;
        }
      }
    } catch (error) {
      console.warn("메타데이터 날짜 분석 실패:", error);
    }
  } else {
    console.warn("EXIF 라이브러리가 로드되지 않았습니다.");
  }

  // 두 번째: 파일명에서 날짜 검색
  const filenameDate = readDateFromFilename(file.name);

  if (isValidPhotoDate(filenameDate)) {
    console.log("파일명에서 날짜 발견:", new Date(filenameDate));

    return filenameDate;
  }

  // 세 번째: 자동 인식 실패
  console.log("촬영 날짜 자동 인식 불가:", {
    name: file.name,
    type: file.type,
    lastModified: file.lastModified,
  });

  return null;
}

async function processSelectedPhoto(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    notify("이미지 파일을 선택해 주세요.");
    return;
  }

  const source = URL.createObjectURL(file);
  try {
    // 선택 직후 원본 파일에서 날짜를 먼저 읽기
    let capturedAt = await readOriginalPhotoDate(file);

    // 날짜 자동 인식에 실패했다면 선택창 표시
    let dateSource = "metadata";

    if (capturedAt === null) {
      capturedAt = await chooseOriginalPhotoDate();

      // 취소했다면 사진을 업로드하지 않음
      if (capturedAt === null) {
        notify("사진 불러오기를 취소했어요.");
        return;
      }

      dateSource = "manual";
    }

    const image = await loadBrowserImage(source);
    const maxWidth = 900;
    const maxHeight = 900;
    const factor = Math.min(
      1,
      maxWidth / image.naturalWidth,
      maxHeight / image.naturalHeight,
    );

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL("image/jpeg", 0.76);

    await db.ref("incoming").push({
      image: imageData,
      timestamp: Date.now(),
      capturedAt: capturedAt,
      dateSource: dateSource,
    });

    notify("사진이 수신함에 추가되었어요.");
  } catch (error) {
    console.error("사진 추가 오류:", error);
    notify("사진 추가 실패: " + error.message);
  } finally {
    URL.revokeObjectURL(source);
  }
}

function initializePhotoInputs() {
  ["main-camera-input", "main-gallery-input"].forEach((id) => {
    const input = $(id);
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.disabled = true;
      try {
        window.__uploadIsGallery = id === "main-gallery-input";
        await processSelectedPhoto(file);
      } finally {
        input.value = "";
        input.disabled = false;
      }
    });
  });
}

// -------------------------
// 시간별 사진 정리
// -------------------------

function getTimestamp(data) {
  const value = data.timestamp ?? data.createdAt ?? data.time;

  if (typeof value === "number") {
    return value < 1e12 ? value * 1000 : value;
  }

  if (typeof value === "string") {
    const numeric = Number(value);

    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 1e12 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  // 이전 버전에서 촬영 시각이 기록되지 않은 경우
  return null;
}

function hourGroupKey(timestamp) {
  if (timestamp === null) return "unknown";

  const date = new Date(timestamp);
  date.setMinutes(0, 0, 0);

  return String(date.getTime());
}

function formatHour(timestamp) {
  if (timestamp === null) {
    return "촬영 시각 미기록";
  }

  const date = new Date(timestamp);

  const day = date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const hour = String(date.getHours()).padStart(2, "0");

  return `${day} · ${hour}:00 ~ ${hour}:59`;
}

function formatTime(timestamp) {
  if (timestamp === null) return "시간 정보 없음";

  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderIncoming() {
  const container = $("incoming-list");
  container.replaceChildren();

  // 사진의 실제 촬영일을 우선 사용
  // 촬영일이 없으면 불러온 날짜 사용
  const entries = [...incomingCache.entries()]
    .map(([key, data]) => ({
      key,
      data,
      importedAt: getTimestamp(data),
      timestamp:
        getTimestamp({ timestamp: data.capturedAt }) ?? getTimestamp(data),
    }))
    .sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity));

  $("empty-message").style.display = entries.length ? "none" : "block";

  // 날짜별 그룹 생성
  const groups = new Map();

  entries.forEach((entry) => {
    const dayKey =
      entry.timestamp === null
        ? "unknown"
        : String(startOfDay(entry.timestamp));

    if (!groups.has(dayKey)) {
      groups.set(dayKey, {
        timestamp: entry.timestamp,
        photos: [],
      });
    }

    groups.get(dayKey).photos.push(entry);
  });

  // 최신 날짜 순서로 정렬
  const orderedGroups = [...groups.values()].sort(
    (a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity),
  );

  orderedGroups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "incoming-day-group";

    // 보관함과 같은 날짜 헤더
    const title = document.createElement("div");
    title.className = "incoming-day-title";

    const titleText = document.createElement("span");
    titleText.textContent = formatLockerDayLabel(group.timestamp);

    const count = document.createElement("span");
    count.className = "incoming-day-count";
    count.textContent = `${group.photos.length}장`;

    title.append(titleText, count);

    // 기존 메인 화면의 사진 그리드 유지
    const grid = document.createElement("div");
    grid.className = "photo-grid";

    group.photos.forEach(({ key, data, timestamp, importedAt }) => {
      const card = document.createElement("div");
      card.className = "incoming-photo";
      installBatchSelection(card, "incoming", key);
      card.title = "사진을 눌러 메모 작성";

      const image = document.createElement("img");
      image.src = data.image;
      image.alt = "전송한 사진";
      image.loading = "lazy";

      // 원본 사진의 시간 표시
      const time = document.createElement("time");
      time.textContent = formatTime(timestamp);

      card.append(image, time);

      // 불러온 날짜가 다르다면 작은 안내문 표시
      if (
        importedAt !== null &&
        timestamp !== null &&
        !isSameDay(importedAt, timestamp)
      ) {
        const original = document.createElement("div");
        original.className = "incoming-original-date";
        original.textContent =
          "불러온 날짜: " + new Date(importedAt).toLocaleDateString("ko-KR");

        card.appendChild(original);
      }

      // 기존 사진 편집 기능 유지
      const incomingMemo = () => ({
        source: "incoming",
        key,
        image: data.image,
        labelTxt: data.labelTxt || "",
        longMemo: data.longMemo || "",
        longMemoHtml: data.longMemoHtml || "",
      });

      // PC 더블클릭
      card.addEventListener("dblclick", () => {
        openDecoModal(incomingMemo());
      });

      // 모바일 터치
      enableTouchOpen(card, incomingMemo);

      grid.appendChild(card);
    });

    section.append(title, grid);
    container.appendChild(section);
  });
}

// -------------------------
// 이미지 편집창
// -------------------------

function openDecoModal(item) {
  currentTarget = { ...item };
  editingSource = item.source;
  $("memo-input").value = item.labelTxt || "";
  $("popup-preview-img").src = item.image;
  loadRichMemo(item);
  $("deco-modal").classList.add("open");
  $("long-memo-input").blur();
  $("deco-modal").querySelector(".modal-content").scrollTop = 0;
  updateMemoViewport();
}

function closeDecoModal() {
  if (saving) return;
  currentTarget = null;
  editingSource = null;
  $("deco-modal").classList.remove("open");
  $("long-memo-input").blur();
}

function loadBrowserImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러올 수 없습니다."));
    image.src = src;
  });
}

// -------------------------
// 꾸미기 완료 = 자동 보관
// -------------------------

async function fixAndMerge() {
  if (!currentTarget || saving) return;
  const target = { ...currentTarget };
  saving = true;
  $("fix-btn").disabled = true;
  $("fix-btn").textContent = "저장 중...";
  try {
    const old =
      target.source === "locker" ? savedCache.get(target.key) || {} : {};
    const incoming = incomingCache.get(target.key) || {};
    const capturedAt =
      target.source === "incoming"
        ? (getTimestamp({ timestamp: incoming.capturedAt }) ??
          getTimestamp(incoming) ??
          Date.now())
        : (getTimestamp({ timestamp: old.capturedAt }) ??
          getTimestamp(old) ??
          Date.now());
    const title = $("memo-input").value.trim() || getLocalDateKey(capturedAt);
    const rich = collectRichMemo();
    const data = {
      image: target.image,
      labelTxt: title,
      longMemo: rich.longMemo,
      longMemoHtml: rich.longMemoHtml,
      timestamp:
        target.source === "locker"
          ? (getTimestamp(old) ?? Date.now())
          : Date.now(),
      capturedAt,
    };
    if (target.source === "locker") {
      await db.ref("saved_memos").child(target.key).update(data);
      notify("메모가 수정되었어요.");
    } else {
      await db.ref("saved_memos").child(target.key).set(data);
      try {
        await db.ref("incoming").child(target.key).remove();
      } catch (err) {
        console.error("수신함 정리 실패", err);
        notify("저장됐지만 수신함 정리는 실패했어요.");
      }
      notify("보관함에 저장했어요!");
    }
    currentTarget = null;
    editingSource = null;
    $("deco-modal").classList.remove("open");
  } catch (error) {
    console.error("메모 저장 오류", error);
    notify("저장 실패: " + error.message);
  } finally {
    saving = false;
    $("fix-btn").disabled = false;
    $("fix-btn").textContent = "보관함에 저장";
  }
}

// -------------------------
// 보관함(일별 아카이브형)
// -------------------------

function getMemoTime(memo) {
  return getTimestamp({ timestamp: memo.capturedAt }) ?? getTimestamp(memo);
}

function startOfDay(timestamp) {
  if (timestamp === null) return null;

  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getLockerDayKey(memo) {
  const time = getMemoTime(memo);
  if (time === null) return "unknown";
  return String(startOfDay(time));
}

function isSameDay(a, b) {
  if (!(a instanceof Date)) a = new Date(a);
  if (!(b instanceof Date)) b = new Date(b);

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatLockerDayLabel(timestamp) {
  if (timestamp === null) return "날짜 미기록";

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) return "오늘";
  if (isSameDay(date, yesterday)) return "어제";

  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatLockerCardTime(timestamp) {
  if (timestamp === null) return "시간 정보 없음";

  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderLocker() {
  const locker = $("locker");
  locker.replaceChildren();

  const entries = [...savedCache.entries()]
    .map(([key, memo]) => ({
      key,
      memo,
      time: getMemoTime(memo),
      dayKey: getLockerDayKey(memo),
    }))
    .filter(({ memo, time }) => {
      const term = ($("locker-search")?.value || "").trim().toLocaleLowerCase();
      const day = $("locker-date")?.value || "";
      return (
        (!term ||
          `${memo.labelTxt || ""} ${memo.longMemo || ""}`
            .toLocaleLowerCase()
            .includes(term)) &&
        (!day || getLocalDateKey(time) === day)
      );
    })
    .sort((a, b) => {
      const at = a.time ?? -Infinity;
      const bt = b.time ?? -Infinity;
      return bt - at;
    });

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.id = "locker-empty-message";
    empty.textContent =
      $("locker-search")?.value || $("locker-date")?.value
        ? "검색 결과가 없어요."
        : "아직 보관된 메모가 없어요.";
    locker.appendChild(empty);
    return;
  }

  const groups = new Map();

  entries.forEach((entry) => {
    if (!groups.has(entry.dayKey)) {
      groups.set(entry.dayKey, {
        key: entry.dayKey,
        label: formatLockerDayLabel(entry.time),
        sortValue: entry.time === null ? -Infinity : startOfDay(entry.time),
        items: [],
      });
    }

    groups.get(entry.dayKey).items.push(entry);
  });

  const orderedGroups = [...groups.values()].sort((a, b) => {
    return (b.sortValue ?? -Infinity) - (a.sortValue ?? -Infinity);
  });

  orderedGroups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "locker-day-group";

    const titleRow = document.createElement("div");
    titleRow.className = "locker-day-title";

    const title = document.createElement("span");
    title.textContent = group.label;

    const count = document.createElement("span");
    count.className = "locker-day-count";
    count.textContent = `${group.items.length}개`;

    titleRow.append(title, count);

    const grid = document.createElement("div");
    grid.className = "locker-grid";

    group.items.forEach((entry) => {
      grid.appendChild(createLockerCard(entry));
    });

    section.append(titleRow, grid);
    locker.appendChild(section);
  });
}

function createLockerCard(entry) {
  const { key, memo, time } = entry;

  const card = document.createElement("article");
  card.className = "locker-card";
  installBatchSelection(card, "locker", key);
  card.draggable = false;
  card.title = "두 번 클릭해서 수정하기";

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "locker-card-thumb-wrap";

  const image = document.createElement("img");
  image.src = memo.image;
  image.alt = memo.labelTxt || "저장된 사진";
  image.draggable = false;

  thumbWrap.appendChild(image);

  const meta = document.createElement("div");
  meta.className = "locker-card-meta";

  const title = document.createElement("div");
  title.className = "locker-card-title";
  title.textContent =
    (memo.labelTxt || "").trim() || getLocalDateKey(time) || "날짜 미기록";

  const sub = document.createElement("div");
  sub.className = "locker-card-time";
  sub.textContent = formatLockerCardTime(time);

  meta.append(title, sub);
  card.append(thumbWrap, meta);

  const lockerMemo = () => ({
    source: "locker",
    key,
    image: memo.image,
    labelTxt: memo.labelTxt || "",
    longMemo: memo.longMemo || "",
    longMemoHtml: memo.longMemoHtml || "",
  });
  card.addEventListener("dblclick", () => openDecoModal(lockerMemo()));
  enableTouchOpen(card, lockerMemo);

  card.addEventListener("dragstart", (e) => {
    card.classList.add("dragging");
    e.dataTransfer.setData("source", "locker");
    e.dataTransfer.setData("memoKey", key);
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
  });

  return card;
}

function upsertMemo(snapshot) {
  const memo = snapshot.val();

  if (!memo || !memo.image) return;

  savedCache.set(snapshot.key, memo);

  // 날짜별 보관함 갱신
  renderLocker();

  // 오늘의 메모도 갱신
  scheduleDailyMemoryRefresh();
}

function removeMemoFromLocker() {
  renderLocker();
}

/* =========================================
   오늘의 메모: 5일 이상 지난 추억
========================================= */

const MEMORY_MIN_AGE = 5 * 24 * 60 * 60 * 1000;

// 현재 화면에 선택된 메모
let selectedDailyMemoryKey = null;

// Firebase 초기 데이터가 여러 번 들어올 때
// 화면이 반복해서 갱신되지 않게 처리
let dailyMemoryRefreshTimer = null;

// 마지막으로 메모를 선정한 날짜
let dailyMemorySelectedDate = null;

// 오늘 날짜를 문자열로 변환
function dailyMemoryTodayKey() {
  const now = new Date();

  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].join("-");
}

// 5일 이상 지난 메모만 추출
function getOldMemories() {
  const now = Date.now();

  return [...savedCache.entries()]
    .filter(([key, memo]) => {
      if (!memo || !memo.image) return false;

      // 촬영 시각 우선, 없으면 저장 시각 사용
      const timestamp = getMemoTime(memo);

      if (timestamp === null) return false;

      return now - timestamp >= MEMORY_MIN_AGE;
    })
    .map(([key, memo]) => ({
      key,
      memo,
      timestamp: getMemoTime(memo),
    }));
}

// Firebase 데이터가 갱신되었을 때 호출
function scheduleDailyMemoryRefresh() {
  clearTimeout(dailyMemoryRefreshTimer);

  dailyMemoryRefreshTimer = setTimeout(() => {
    showRandomMemory(false);
  }, 150);
}

// 메모 랜덤 선정 및 화면 갱신
function showRandomMemory(forceNew = false) {
  const container = document.getElementById("daily-memory-content");

  const shuffleButton = document.getElementById("daily-memory-shuffle");

  if (!container || !shuffleButton) return;

  const candidates = getOldMemories();

  // 5일 지난 메모가 없는 경우
  if (candidates.length === 0) {
    selectedDailyMemoryKey = null;

    container.replaceChildren();

    const empty = document.createElement("p");
    empty.className = "daily-memory-empty";
    empty.textContent =
      "아직 5일 이상 지난 메모가 없어요.\n" +
      "조금 더 시간이 지나면 추억을 보여줄게요.";

    container.appendChild(empty);

    shuffleButton.disabled = true;
    return;
  }

  shuffleButton.disabled = candidates.length < 2;

  const todayKey = dailyMemoryTodayKey();

  // 날짜가 바뀌면 새로운 메모를 선정
  if (dailyMemorySelectedDate !== todayKey) {
    selectedDailyMemoryKey = null;
    dailyMemorySelectedDate = todayKey;
  }

  // 기존 선택이 아직 유효한지 확인
  const current = candidates.find(
    (item) => item.key === selectedDailyMemoryKey,
  );

  let selected = current;

  // 버튼을 누르거나 기존 선택이 없는 경우
  if (forceNew || !selected) {
    let pool = candidates;

    // 메모가 2개 이상이면 같은 메모 연속 선택 방지
    if (forceNew && candidates.length > 1) {
      pool = candidates.filter((item) => item.key !== selectedDailyMemoryKey);
    }

    selected = pool[Math.floor(Math.random() * pool.length)];

    selectedDailyMemoryKey = selected.key;
  }

  renderDailyMemory(selected);
}

// 오늘의 메모 실제 화면 생성
function renderDailyMemory(entry) {
  const container = document.getElementById("daily-memory-content");

  if (!container || !entry) return;

  const { key, memo, timestamp } = entry;

  container.replaceChildren();

  // 사진
  const image = document.createElement("img");
  image.className = "daily-memory-photo";
  image.src = memo.image;
  image.alt = memo.labelTxt || "추억 사진";
  image.title = "두 번 클릭하면 수정할 수 있어요.";

  const dailyMemo = () => ({
    source: "locker",
    key,
    image: memo.image,
    labelTxt: memo.labelTxt || "",
    longMemo: memo.longMemo || "",
    longMemoHtml: memo.longMemoHtml || "",
  });
  image.addEventListener("dblclick", () => openDecoModal(dailyMemo()));
  enableTouchOpen(image, dailyMemo);

  // 라벨 이름
  const title = document.createElement("h4");
  title.className = "daily-memory-title";
  title.textContent =
    memo.labelTxt || getLocalDateKey(timestamp) || "날짜 미기록";

  // 촬영 날짜
  const date = document.createElement("div");
  date.className = "daily-memory-date";

  date.textContent =
    timestamp === null
      ? "날짜 미기록"
      : new Date(timestamp).toLocaleDateString("ko-KR", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

  // 상세 메모
  const body = document.createElement("div");
  body.className = "daily-memory-body";

  if (memo.longMemoHtml && window.DOMPurify) {
    body.innerHTML = sanitizeMemoHtml(memo.longMemoHtml);
    body.querySelectorAll('input[type="checkbox"]').forEach((box) => {
      box.disabled = true;
    });
  } else {
    body.textContent =
      memo.longMemo?.trim() || "이 사진에는 아직 작성된 메모가 없어요.";
  }

  container.append(image, title, date, body);
}

/* =========================================
   보관함 검색 · 날짜
========================================= */
function getLocalDateKey(timestamp) {
  if (timestamp == null || !Number.isFinite(timestamp)) return "";
  const d = new Date(timestamp);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
function initializeLockerFilters() {
  $("locker-search")?.addEventListener("input", renderLocker);
  $("locker-date")?.addEventListener("change", renderLocker);
  $("locker-filter-reset")?.addEventListener("click", () => {
    $("locker-search").value = "";
    $("locker-date").value = "";
    renderLocker();
  });
}

/* =========================================
   메모 HTML 서식 편집 (기존 일반 텍스트와 호환)
========================================= */
let savedMemoSelection = null;
function rememberMemoSelection() {
  const editor = $("long-memo-input");
  const sel = window.getSelection();
  if (!sel?.rangeCount || !editor) return;
  const range = sel.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer))
    savedMemoSelection = range.cloneRange();
}
function getEditorRange() {
  const editor = $("long-memo-input"),
    selection = window.getSelection();
  if (selection?.rangeCount) {
    const r = selection.getRangeAt(0);
    if (editor.contains(r.commonAncestorContainer)) return r.cloneRange();
  }
  if (
    savedMemoSelection &&
    editor.contains(savedMemoSelection.commonAncestorContainer)
  )
    return savedMemoSelection.cloneRange();
  const r = document.createRange();
  r.selectNodeContents(editor);
  r.collapse(false);
  return r;
}
function restoreMemoSelection() {
  const range = getEditorRange(),
    sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}
function applySelectedMemoStyle(prop, value) {
  const editor = $("long-memo-input"),
    range = getEditorRange();
  if (range.collapsed) {
    notify("꾸밀 글자를 먼저 선택해 주세요.");
    return;
  }
  try {
    const el = document.createElement("span");
    el.style[prop] = value;
    el.appendChild(range.extractContents());
    range.insertNode(el);
    const newRange = document.createRange();
    newRange.selectNodeContents(el);
    savedMemoSelection = newRange.cloneRange();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(newRange);
  } catch (err) {
    console.error(err);
    notify("글자를 다시 선택해 주세요.");
  }
}
function applyMemoFontSize(value) {
  const n = Number(value);
  if ([12, 16, 24, 32].includes(n))
    applySelectedMemoStyle("fontSize", n + "px");
}
function insertMemoCheckbox() {
  const editor = $("long-memo-input"),
    range = getEditorRange();
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const parentLine = node?.closest?.(".memo-task,div,p,li");
  if (parentLine?.classList?.contains("memo-task")) return;
  let line = parentLine && editor.contains(parentLine) ? parentLine : null;
  if (!line || line === editor) {
    // 빈 메모 또는 루트 텍스트: 해당 줄을 하나의 DIV로 만들기
    const holder = document.createElement("div");
    if (
      range.startContainer.nodeType === Node.TEXT_NODE &&
      range.startContainer.parentNode === editor
    ) {
      const textNode = range.startContainer;
      editor.insertBefore(holder, textNode);
      holder.appendChild(textNode);
    } else {
      const frag = range.cloneRange();
      frag.selectNodeContents(editor);
      if (!editor.querySelector("div,p,ul,ol,.memo-task")) {
        while (editor.firstChild) holder.appendChild(editor.firstChild);
        editor.appendChild(holder);
      } else {
        // 기존의 여러 줄은 건드리지 않고 선택 위치에만 체크줄을 추가
        range.insertNode(holder);
      }
    }
    line = holder;
  }
  const task = document.createElement("div");
  task.className = "memo-task";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.contentEditable = "false";
  const text = document.createElement("span");
  text.contentEditable = "true";
  while (line.firstChild) text.appendChild(line.firstChild);
  if (!text.hasChildNodes()) text.appendChild(document.createElement("br"));
  task.append(input, text);
  line.replaceWith(task);
  const r = document.createRange();
  r.selectNodeContents(text);
  r.collapse(false);
  savedMemoSelection = r.cloneRange();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
function syncMemoCheckboxes() {
  $("long-memo-input")
    .querySelectorAll('.memo-task input[type="checkbox"]')
    .forEach((c) => {
      if (c.checked) c.setAttribute("checked", "");
      else c.removeAttribute("checked");
    });
}
function sanitizeMemoHtml(html) {
  if (!window.DOMPurify) throw new Error("메모 보안 라이브러리 로딩 실패");
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "div",
      "p",
      "br",
      "span",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "font",
      "ul",
      "ol",
      "li",
      "input",
    ],
    ALLOWED_ATTR: ["class", "style", "color", "size", "type", "checked"],
    ALLOW_DATA_ATTR: false,
  });
  const box = document.createElement("div");
  box.innerHTML = clean;
  box.querySelectorAll("*").forEach((el) => {
    const color = el.style.color,
      size = el.style.fontSize,
      weight = el.style.fontWeight;
    el.removeAttribute("style");
    if (/^(#[0-9a-f]{3,8}|rgb\([\d,\s]+\))$/i.test(color))
      el.style.color = color;
    if (/^(12|16|24|32)px$/.test(size)) el.style.fontSize = size;
    if (weight === "bold" || weight === "700") el.style.fontWeight = "bold";
    if (!el.classList.contains("memo-task")) el.removeAttribute("class");
    if (el.tagName === "INPUT") {
      if (
        el.type !== "checkbox" ||
        !el.parentElement?.classList.contains("memo-task")
      )
        el.remove();
      else {
        el.type = "checkbox";
        el.contentEditable = "false";
      }
    }
  });
  box
    .querySelectorAll(".memo-task > span")
    .forEach((el) => (el.contentEditable = "true"));
  return box.innerHTML;
}
function loadRichMemo(item) {
  const editor = $("long-memo-input");
  savedMemoSelection = null;
  editor.replaceChildren();
  if (item.longMemoHtml && window.DOMPurify) {
    try {
      editor.innerHTML = sanitizeMemoHtml(item.longMemoHtml);
      editor.querySelectorAll(".memo-task input").forEach((i) => {
        i.checked = i.hasAttribute("checked");
      });
      return;
    } catch (err) {
      console.warn(err);
    }
  }
  editor.textContent = item.longMemo || "";
}
function collectRichMemo() {
  const editor = $("long-memo-input");
  syncMemoCheckboxes();
  const text = editor.innerText;
  return { longMemo: text, longMemoHtml: sanitizeMemoHtml(editor.innerHTML) };
}
function initializeMemoToolbar() {
  const toolbar = $("memo-toolbar"),
    editor = $("long-memo-input");
  if (!toolbar || toolbar.dataset.ready) return;
  toolbar.dataset.ready = "1";
  document.addEventListener("selectionchange", rememberMemoSelection);
  toolbar.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("pointerdown", rememberMemoSelection);
    btn.addEventListener("mousedown", (e) => e.preventDefault());
  });
  toolbar.querySelectorAll(".format-btn[data-command]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.command === "bold")
        applySelectedMemoStyle("fontWeight", "bold");
      else {
        restoreMemoSelection();
        document.execCommand(btn.dataset.command, false, null);
        rememberMemoSelection();
      }
    }),
  );
  toolbar
    .querySelectorAll(".memo-color")
    .forEach((btn) =>
      btn.addEventListener("click", () =>
        applySelectedMemoStyle("color", btn.dataset.color),
      ),
    );
  toolbar
    .querySelectorAll(".memo-size-btn")
    .forEach((btn) =>
      btn.addEventListener("click", () => applyMemoFontSize(btn.dataset.size)),
    );
  $("memo-add-checkbox").addEventListener("click", insertMemoCheckbox);
  editor.addEventListener("change", (e) => {
    if (e.target.matches('input[type="checkbox"]')) syncMemoCheckboxes();
  });
  editor.addEventListener("paste", (e) => {
    e.preventDefault();
    document.execCommand(
      "insertText",
      false,
      e.clipboardData.getData("text/plain"),
    );
  });
}

/* =========================================
   사진 전체화면 확대 (버튼 없이 핀치/휠)
========================================= */
let viewerScale = 1,
  viewerX = 0,
  viewerY = 0;
const viewerPointers = new Map();
let viewerPinchDistance = 0,
  viewerPinchScale = 1,
  viewerLastX = 0,
  viewerLastY = 0;
function applyPhotoZoom() {
  $("photo-viewer-image").style.transform =
    `translate(${viewerX}px, ${viewerY}px) scale(${viewerScale})`;
}
function resetPhotoZoom() {
  viewerScale = 1;
  viewerX = 0;
  viewerY = 0;
  applyPhotoZoom();
}
function changePhotoZoom(delta) {
  viewerScale = Math.max(1, Math.min(5, viewerScale + delta));
  if (viewerScale === 1) {
    viewerX = 0;
    viewerY = 0;
  }
  applyPhotoZoom();
}
function openPhotoViewer(source) {
  if (!source) return;
  $("photo-viewer-image").src = source;
  $("photo-viewer").classList.add("open");
  $("photo-viewer").setAttribute("aria-hidden", "false");
  viewerPointers.clear();
  resetPhotoZoom();
}
function closePhotoViewer() {
  $("photo-viewer").classList.remove("open");
  $("photo-viewer").setAttribute("aria-hidden", "true");
  $("photo-viewer-image").src = "";
  viewerPointers.clear();
}
function initializePhotoViewer() {
  $("popup-workspace").addEventListener("click", (e) => {
    if (currentTarget && !saving) openPhotoViewer(currentTarget.image);
  });
  const stage = $("photo-viewer-stage");
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      changePhotoZoom(e.deltaY < 0 ? 0.2 : -0.2);
    },
    { passive: false },
  );
  stage.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    viewerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    if (viewerPointers.size === 1) {
      viewerLastX = e.clientX;
      viewerLastY = e.clientY;
    }
    if (viewerPointers.size === 2) {
      const [a, b] = [...viewerPointers.values()];
      viewerPinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      viewerPinchScale = viewerScale;
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!viewerPointers.has(e.pointerId)) return;
    viewerPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (viewerPointers.size === 2) {
      const [a, b] = [...viewerPointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (viewerPinchDistance > 0) {
        viewerScale = Math.max(
          1,
          Math.min(5, (viewerPinchScale * d) / viewerPinchDistance),
        );
        applyPhotoZoom();
      }
    } else if (viewerScale > 1) {
      viewerX += e.clientX - viewerLastX;
      viewerY += e.clientY - viewerLastY;
      applyPhotoZoom();
    }
    viewerLastX = e.clientX;
    viewerLastY = e.clientY;
  });
  function end(e) {
    viewerPointers.delete(e.pointerId);
    if (viewerPointers.size === 1) {
      const p = [...viewerPointers.values()][0];
      viewerLastX = p.x;
      viewerLastY = p.y;
    }
  }
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("photo-viewer").classList.contains("open"))
      closePhotoViewer();
  });
}

/* =========================================
   가상 키보드 표시 영역 대응
========================================= */
function updateMemoViewport() {
  const v = window.visualViewport;
  const height = v ? v.height : window.innerHeight;
  const top = v ? v.offsetTop : 0;
  document.documentElement.style.setProperty("--visible-height", height + "px");
  document.documentElement.style.setProperty("--visible-top", top + "px");
  document.body.classList.toggle(
    "memo-keyboard-open",
    window.innerHeight - height > 140,
  );
}
function initializeMemoViewport() {
  updateMemoViewport();
  window.visualViewport?.addEventListener("resize", updateMemoViewport);
  window.visualViewport?.addEventListener("scroll", updateMemoViewport);
  window.addEventListener("resize", updateMemoViewport);
}

/* =====================================
   사진 날짜 선택: 달력 / 직접 입력
===================================== */

// 현재 날짜와 시각을 로컬 형식으로 반환
function getCurrentPhotoDateValues() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return {
    date: [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join(
      "-",
    ),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

// 잘못된 날짜(예: 2026-02-30)도 검사
function parseSelectedPhotoDate(value) {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);

  if (year < 1900 || year > 2100 || hour > 23 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    return null;

  return date.getTime();
}

// 날짜 선택창 열기

function chooseOriginalPhotoDate() {
  return new Promise((resolve) => {
    const modal = document.getElementById("photo-date-modal");
    const input = document.getElementById("photo-date-text");
    const display = document.getElementById("photo-date-display");
    const calendar = document.getElementById("photo-date-calendar");
    const time = document.getElementById("photo-date-time");
    const confirm = document.getElementById("photo-date-confirm");
    const cancel = document.getElementById("photo-date-cancel");
    const error = document.getElementById("photo-date-error");

    const positions = [0, 1, 2, 3, 5, 6, 8, 9];
    const emptyMask = "YYYY-MM-DD";

    const now = getCurrentPhotoDateValues();

    let mask = now.date;
    let caret = 0;

    time.value = now.time;
    calendar.value = now.date;
    modal.hidden = false;
    error.hidden = true;

    // 하이픈을 건너뛰고 다음 숫자 위치 찾기
    function nextPosition(pos) {
      return positions.find((p) => p >= pos) ?? 10;
    }

    // 이전 숫자 위치 찾기
    function previousPosition(pos) {
      return [...positions].reverse().find((p) => p < pos) ?? null;
    }

    // 색상이 다른 날짜 글자 표시
    function renderDate() {
      input.value = mask;
      display.replaceChildren();

      for (let i = 0; i < mask.length; i++) {
        const span = document.createElement("span");
        const char = mask[i];

        span.textContent = char;

        if (/[YMD]/.test(char)) {
          span.classList.add("empty");
        }

        if (document.activeElement === input && i === caret) {
          span.classList.add("active");
        }

        display.appendChild(span);
      }

      try {
        input.setSelectionRange(caret, caret);
      } catch (e) {}
    }

    // 달력 날짜 동기화
    function syncCalendar() {
      if (/[YMD]/.test(mask)) return;

      const timestamp = parseSelectedPhotoDate(mask + " 12:00");

      if (timestamp !== null) {
        calendar.value = mask;
      }
    }

    // 현재 위치부터 숫자 채우기
    function insertDigits(text) {
      const digits = String(text).replace(/\D/g, "");

      if (!digits) return;

      let chars = mask.split("");
      let pos = nextPosition(caret);

      for (const digit of digits) {
        if (pos >= 10) break;

        chars[pos] = digit;
        pos = nextPosition(pos + 1);
      }

      mask = chars.join("");
      caret = pos;

      syncCalendar();
      renderDate();
    }

    // 이전 숫자 한 칸만 삭제
    function deletePreviousDigit() {
      const position = previousPosition(caret);

      if (position === null) return;

      const chars = mask.split("");
      chars[position] = emptyMask[position];

      mask = chars.join("");
      caret = position;

      renderDate();
    }

    // 현재 숫자 한 칸 삭제
    function deleteCurrentDigit() {
      const position = nextPosition(caret);

      if (position >= 10) return;

      const chars = mask.split("");
      chars[position] = emptyMask[position];

      mask = chars.join("");
      caret = position;

      renderDate();
    }

    // 모바일 키보드 입력 처리
    function onBeforeInput(e) {
      const type = e.inputType || "";

      if (type === "insertText" || type === "insertReplacementText") {
        if (!e.cancelable) return;

        e.preventDefault();
        insertDigits(e.data || "");
      } else if (type === "deleteContentBackward") {
        if (!e.cancelable) return;

        e.preventDefault();
        deletePreviousDigit();
      } else if (type === "deleteContentForward") {
        if (!e.cancelable) return;

        e.preventDefault();
        deleteCurrentDigit();
      } else if (type === "insertFromPaste") {
        if (e.cancelable) e.preventDefault();
      }
    }

    // 숫자가 아닌 문자·방향키 처리
    function onKeyDown(e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        caret = previousPosition(caret) ?? 0;
        renderDate();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        caret = nextPosition(caret + 1);
        renderDate();
      } else if (e.key === "Home") {
        e.preventDefault();
        caret = 0;
        renderDate();
      } else if (e.key === "End") {
        e.preventDefault();
        caret = 10;
        renderDate();
      }
    }

    // 모바일 일부 키보드의 비표준 입력 대응
    function onInput() {
      if (input.value !== mask) {
        const raw = input.value;
        const digits = raw.replace(/\D/g, "");

        // 숫자만 직접 입력한 경우
        if (digits.length > 0 && raw.length < 10) {
          mask = emptyMask;
          caret = 0;
          insertDigits(digits);
        } else {
          renderDate();
        }
      }
    }

    // 커서를 터치한 자리와 일치시킴
    function onCursorChange() {
      const selection = input.selectionStart;

      if (selection !== null) {
        caret = nextPosition(selection);
        renderDate();
      }
    }

    function onFocus() {
      renderDate();
    }

    function onBlur() {
      display
        .querySelectorAll(".active")
        .forEach((el) => el.classList.remove("active"));
    }

    // 복사한 날짜 숫자 붙여넣기
    function onPaste(e) {
      e.preventDefault();

      const text = e.clipboardData?.getData("text/plain") || "";

      const digits = text.replace(/\D/g, "");

      if (digits.length === 8) {
        mask = emptyMask;
        caret = 0;
      }

      insertDigits(digits);
    }

    // 달력에서 날짜를 선택했을 때
    function onCalendarChange() {
      if (!calendar.value) return;

      mask = calendar.value;
      caret = 0;

      error.hidden = true;
      renderDate();
    }

    // 저장
    function onConfirm() {
      if (/[YMD]/.test(mask)) {
        error.textContent = "연도, 월, 일을 모두 입력해주세요.";
        error.hidden = false;
        return;
      }

      const timestamp = parseSelectedPhotoDate(`${mask} ${time.value}`);

      if (timestamp === null) {
        error.textContent = "올바른 날짜와 시간을 입력해주세요.";
        error.hidden = false;
        return;
      }

      cleanup();
      resolve(timestamp);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function cleanup() {
      input.removeEventListener("beforeinput", onBeforeInput);
      input.removeEventListener("keydown", onKeyDown);
      input.removeEventListener("input", onInput);
      input.removeEventListener("click", onCursorChange);
      input.removeEventListener("keyup", onCursorChange);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("paste", onPaste);

      calendar.removeEventListener("change", onCalendarChange);
      confirm.removeEventListener("click", onConfirm);
      cancel.removeEventListener("click", onCancel);

      modal.hidden = true;
    }

    input.addEventListener("beforeinput", onBeforeInput);
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("input", onInput);
    input.addEventListener("click", onCursorChange);
    input.addEventListener("keyup", onCursorChange);
    input.addEventListener("focus", onFocus);
    input.addEventListener("blur", onBlur);
    input.addEventListener("paste", onPaste);

    calendar.addEventListener("change", onCalendarChange);
    confirm.addEventListener("click", onConfirm);
    cancel.addEventListener("click", onCancel);

    renderDate();
  });
}

/* ==============================================
   메인 화면 + 보관함 공통 다중 선택 편집 모드
============================================== */

let batchMode = false;
let batchBusy = false;
const batchSelected = new Set();

// 카드 식별자: 메인과 보관함의 같은 key 충돌 방지
function batchId(source, key) {
  return `${source}:${key}`;
}

// 현재 화면에서 보이는 선택 가능 카드
function getVisibleBatchCards() {
  const container =
    currentScreen === "locker" ? $("locker") : $("incoming-list");

  return container ? [...container.querySelectorAll("[data-batch-key]")] : [];
}

// 현재 보이는 카드의 선택 상태 표시
function refreshBatchSelection() {
  document.body.classList.toggle("batch-select-mode", batchMode);

  document.querySelectorAll("[data-batch-key]").forEach((card) => {
    const id = batchId(card.dataset.batchSource, card.dataset.batchKey);

    const selected = batchSelected.has(id);

    card.classList.toggle("batch-selected", selected);
    card.setAttribute("aria-selected", batchMode ? String(selected) : "false");
  });

  const count = $("batch-selected-count");
  if (count) {
    count.textContent = `${batchSelected.size}개 선택됨`;
  }

  const total = getVisibleBatchCards().length;
  const allButton = $("batch-select-all-btn");

  if (allButton) {
    const allSelected =
      total > 0 &&
      getVisibleBatchCards().every((card) =>
        batchSelected.has(
          batchId(card.dataset.batchSource, card.dataset.batchKey),
        ),
      );

    allButton.textContent = allSelected ? "전체 해제" : "전체 선택";
  }

  ["batch-date-btn", "batch-delete-btn"].forEach((id) => {
    const button = $(id);
    if (button) {
      button.disabled = !batchSelected.size || batchBusy;
    }
  });
}

// 편집 모드 시작
function enterBatchMode(source, key) {
  if (batchBusy) return;

  batchMode = true;
  batchSelected.add(batchId(source, key));
  refreshBatchSelection();

  // 가능할 때 가벼운 터치 피드백
  if (navigator.vibrate) navigator.vibrate(25);
}

// 편집 모드 종료
function exitBatchMode() {
  if (batchBusy) return;

  batchMode = false;
  batchSelected.clear();
  refreshBatchSelection();
}

// 카드 하나의 선택 / 해제
function toggleBatchCard(source, key) {
  if (!batchMode || batchBusy) return;

  const id = batchId(source, key);

  if (batchSelected.has(id)) {
    batchSelected.delete(id);
  } else {
    batchSelected.add(id);
  }

  refreshBatchSelection();
}

// 모든 카드 또는 보이는 카드 선택 해제
function toggleBatchSelectAll() {
  const cards = getVisibleBatchCards();

  const allSelected =
    cards.length > 0 &&
    cards.every((card) =>
      batchSelected.has(
        batchId(card.dataset.batchSource, card.dataset.batchKey),
      ),
    );

  cards.forEach((card) => {
    const id = batchId(card.dataset.batchSource, card.dataset.batchKey);

    if (allSelected) {
      batchSelected.delete(id);
    } else {
      batchSelected.add(id);
    }
  });

  refreshBatchSelection();
}

// 카드에 길게 누르기 기능 설치

function installBatchSelection(card, source, key) {
  // 모바일 길게 누르기 시 크롬 기본 메뉴 차단
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  // 이미지 드래그 및 기본 선택 동작 방지
  card.setAttribute("draggable", "false");

  card.querySelectorAll("img").forEach((img) => {
    img.draggable = false;
  });

  // 기존 코드부터 그대로 유지
  card.dataset.batchSource = source;
  card.dataset.batchKey = key;

  const check = document.createElement("span");
  check.className = "batch-check-mark";
  check.textContent = "✓";
  check.setAttribute("aria-hidden", "true");
  card.appendChild(check);

  let timer = null;
  let startX = 0;
  let startY = 0;
  let pointerId = null;

  // 길게 눌러 선택한 직후 click으로 다시 해제되는 것 방지
  let ignoreClickUntil = 0;

  function clearHold() {
    clearTimeout(timer);
    timer = null;
  }

  card.addEventListener("pointerdown", (e) => {
    if (batchBusy) return;

    // PC: 왼쪽 마우스 버튼만
    if (e.pointerType === "mouse" && e.button !== 0) {
      return;
    }

    if (batchMode) return;

    startX = e.clientX;
    startY = e.clientY;
    pointerId = e.pointerId;

    clearHold();

    timer = setTimeout(() => {
      timer = null;

      ignoreClickUntil = Date.now() + 900;
      enterBatchMode(source, key);
    }, 600);
  });

  card.addEventListener("pointermove", (e) => {
    if (pointerId !== e.pointerId) return;

    // 스크롤은 길게 누르기로 인식하지 않음
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 12) {
      clearHold();
    }
  });

  // capture 단계에서 기존 터치 편집 이벤트와 충돌 방지
  card.addEventListener(
    "pointerup",
    (e) => {
      clearHold();

      if (batchMode) {
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  card.addEventListener("pointercancel", clearHold);
  card.addEventListener("pointerleave", clearHold);

  // 편집 모드에서는 터치/클릭 = 선택 전환
  card.addEventListener(
    "click",
    (e) => {
      if (!batchMode) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      if (Date.now() < ignoreClickUntil) return;

      toggleBatchCard(source, key);
    },
    true,
  );

  // 더블클릭도 편집창으로 넘어가지 않게
  card.addEventListener(
    "dblclick",
    (e) => {
      if (!batchMode) return;

      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );

  // 재렌더링된 카드도 기존 선택 상태 복원
  if (batchMode) {
    card.classList.toggle(
      "batch-selected",
      batchSelected.has(batchId(source, key)),
    );
  }
}

// 삭제 및 날짜 변경 다이얼로그 생성
function createBatchDialog(title, message) {
  const backdrop = document.createElement("div");
  backdrop.className = "batch-dialog-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "batch-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const heading = document.createElement("h3");
  heading.textContent = title;

  const description = document.createElement("p");
  description.textContent = message;

  const content = document.createElement("div");

  const actions = document.createElement("div");
  actions.className = "batch-dialog-buttons";

  dialog.append(heading, description, content, actions);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  return { backdrop, dialog, content, actions };
}

// 선택된 메모 정보 수집
function getBatchItems() {
  return [...batchSelected]
    .map((id) => {
      const divider = id.indexOf(":");
      const source = id.slice(0, divider);
      const key = id.slice(divider + 1);

      const data =
        source === "locker" ? savedCache.get(key) : incomingCache.get(key);

      return {
        source,
        key,
        data,
      };
    })
    .filter((item) => item.data);
}

// YYYY-MM-DD를 현지 시각으로 변환
function parseBatchDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return null;

  return date;
}

// 선택한 메모들 날짜 변경
async function openBatchDateDialog() {
  const items = getBatchItems();
  if (!items.length || batchBusy) return;

  const ui = createBatchDialog(
    "날짜 변경",
    `${items.length}개의 사진/메모 날짜를 변경합니다.`,
  );

  const dateInput = document.createElement("input");
  dateInput.type = "date";

  const now = new Date();
  dateInput.value = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  const note = document.createElement("p");
  note.textContent = "기존 시각은 유지하고 날짜만 변경해요.";

  ui.content.append(dateInput, note);

  const cancel = document.createElement("button");
  cancel.textContent = "취소";

  const confirm = document.createElement("button");
  confirm.className = "primary";
  confirm.textContent = "날짜 변경";

  ui.actions.append(cancel, confirm);

  cancel.onclick = () => ui.backdrop.remove();

  confirm.onclick = async () => {
    const selectedDay = parseBatchDay(dateInput.value);

    if (!selectedDay) {
      notify("올바른 날짜를 선택해 주세요.");
      return;
    }

    batchBusy = true;
    confirm.disabled = true;
    cancel.disabled = true;
    refreshBatchSelection();

    let success = 0;

    try {
      for (const item of items) {
        try {
          const oldTime =
            getTimestamp({
              timestamp: item.data.capturedAt,
            }) ??
            getTimestamp(item.data) ??
            Date.now();

          const oldDate = new Date(oldTime);

          const changed = new Date(
            selectedDay.getFullYear(),
            selectedDay.getMonth(),
            selectedDay.getDate(),
            oldDate.getHours(),
            oldDate.getMinutes(),
            oldDate.getSeconds(),
          );

          const path = item.source === "locker" ? "saved_memos" : "incoming";

          await db.ref(path).child(item.key).update({
            capturedAt: changed.getTime(),
            dateSource: "manual",
          });

          success++;
          batchSelected.delete(batchId(item.source, item.key));
        } catch (error) {
          console.error("날짜 변경 실패:", item.key, error);
        }
      }

      notify(`${success}개의 날짜를 변경했어요.`);
    } finally {
      batchBusy = false;
      ui.backdrop.remove();

      if (batchSelected.size === 0) {
        exitBatchMode();
      } else {
        refreshBatchSelection();
      }
    }
  };
}

// 삭제 확인창 생략 설정
const BATCH_SKIP_DELETE_KEY = "captureToMemo_skipDeleteConfirm";

function shouldSkipBatchDeleteConfirm() {
  try {
    return localStorage.getItem(BATCH_SKIP_DELETE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveSkipBatchDeleteConfirm(value) {
  try {
    localStorage.setItem(BATCH_SKIP_DELETE_KEY, value ? "true" : "false");
  } catch (error) {
    console.warn("삭제 확인 설정 저장 실패:", error);
  }
}

// 실제 Firebase 삭제
async function deleteBatchItems(items) {
  if (!items.length || batchBusy) return;

  batchBusy = true;
  refreshBatchSelection();

  let success = 0;

  try {
    for (const item of items) {
      try {
        const path = item.source === "locker" ? "saved_memos" : "incoming";

        await db.ref(path).child(item.key).remove();

        success++;
        batchSelected.delete(batchId(item.source, item.key));
      } catch (error) {
        console.error("메모 삭제 실패:", item.key, error);
      }
    }

    notify(`${success}개의 사진/메모를 삭제했어요.`);
  } finally {
    batchBusy = false;

    if (batchSelected.size === 0) {
      exitBatchMode();
    } else {
      refreshBatchSelection();
    }
  }
}

// 삭제 확인창
function openBatchDeleteDialog() {
  const items = getBatchItems();
  if (!items.length || batchBusy) return;

  if (shouldSkipBatchDeleteConfirm()) {
    deleteBatchItems(items);
    return;
  }

  const ui = createBatchDialog(
    "정말로 삭제하시겠습니까?",
    `선택한 ${items.length}개의 사진/메모가 삭제됩니다. 삭제 후 복구할 수 없어요.`,
  );

  const label = document.createElement("label");
  label.className = "batch-never-ask";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";

  const text = document.createElement("span");
  text.textContent = "다시 보지 않기";

  label.append(checkbox, text);
  ui.content.appendChild(label);

  const cancel = document.createElement("button");
  cancel.textContent = "취소";

  const confirm = document.createElement("button");
  confirm.className = "danger";
  confirm.textContent = "삭제";

  ui.actions.append(cancel, confirm);

  cancel.onclick = () => ui.backdrop.remove();

  confirm.onclick = () => {
    saveSkipBatchDeleteConfirm(checkbox.checked);
    ui.backdrop.remove();
    deleteBatchItems(items);
  };
}

// 하단 선택 도구 초기화
function initializeBatchSelection() {
  if ($("batch-toolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.id = "batch-toolbar";

  toolbar.innerHTML = `
    <div class="batch-toolbar-top">
      <span id="batch-selected-count">0개 선택됨</span>
      <div>
        <button type="button" id="batch-select-all-btn">
          전체 선택
        </button>
        <button type="button" id="batch-exit-btn">
          취소
        </button>
      </div>
    </div>
    <div class="batch-toolbar-actions">
      <button type="button" id="batch-date-btn">
        날짜 변경
      </button>
      <button type="button" id="batch-delete-btn">
        삭제
      </button>
    </div>
  `;

  document.body.appendChild(toolbar);

  $("batch-select-all-btn").onclick = toggleBatchSelectAll;
  $("batch-exit-btn").onclick = exitBatchMode;
  $("batch-date-btn").onclick = openBatchDateDialog;
  $("batch-delete-btn").onclick = openBatchDeleteDialog;

  refreshBatchSelection();
}

// 메인 및 보관함 사진의 기본 우클릭/길게 누르기 메뉴 차단
document.addEventListener(
  "contextmenu",
  (e) => {
    if (e.target.closest(".incoming-photo, .locker-card")) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

/* ==========================================
   작업대 ↔ 보관함 스와이프 화면 전환
========================================== */

function initializeScreenSwipe() {
  const viewport = document.getElementById("viewport");

  if (!viewport || viewport.dataset.swipeReady === "true") {
    return;
  }

  viewport.dataset.swipeReady = "true";

  const MAX_SWIPE_TIME = 700; // 0.7초 이내
  const DIRECTION_RATIO = 1.4; // 세로보다 가로 이동이 뚜렷해야 함

  let swipeStart = null;
  let lastSwipeTime = 0;

  function shouldIgnoreSwipe(target) {
    if (!(target instanceof Element)) return true;

    // 입력창, 버튼 등을 조작할 때 화면 이동 금지
    if (
      target.closest(
        "input, textarea, select, button, " +
          "[contenteditable], " +
          "#memo-toolbar, #daily-memory-panel, " +
          "#batch-toolbar, .batch-dialog-backdrop, " +
          "#deco-modal, #photo-date-modal, #photo-viewer",
      )
    ) {
      return true;
    }

    // 다중 선택 편집 모드일 때는 스와이프 비활성화
    if (
      document.body.classList.contains("batch-select-mode") ||
      (typeof batchMode !== "undefined" && batchMode)
    ) {
      return true;
    }

    return false;
  }

  function startSwipe(x, y, target) {
    if (shouldIgnoreSwipe(target)) {
      swipeStart = null;
      return;
    }

    swipeStart = {
      x,
      y,
      time: performance.now(),
      screen: currentScreen,
    };
  }

  function finishSwipe(x, y) {
    if (!swipeStart) return;

    const start = swipeStart;
    swipeStart = null;

    const dx = x - start.x;
    const dy = y - start.y;
    const duration = performance.now() - start.time;

    // 짧더라도 빠른 가로 스와이프면 인정
    const MIN_DISTANCE = 45; // 최소 45px
    const MIN_VELOCITY = 0.45; // 1ms당 0.45px
    const MAX_DURATION = 700; // 최대 0.7초

    const velocity = Math.abs(dx) / Math.max(duration, 1);

    // 빠른 스와이프만 허용
    if (
      duration > MAX_DURATION ||
      Math.abs(dx) < MIN_DISTANCE ||
      velocity < MIN_VELOCITY
    ) {
      return;
    }

    // 세로 스크롤과 구분
    if (Math.abs(dx) < Math.abs(dy) * 1.4) {
      return;
    }

    // 시작했을 때와 같은 화면이어야 함
    if (currentScreen !== start.screen) return;

    if (dx < 0 && currentScreen === "work") {
      // 왼쪽으로 스와이프 → 보관함
      lastSwipeTime = performance.now();
      showScreen("locker");
    } else if (dx > 0 && currentScreen === "locker") {
      // 오른쪽으로 스와이프 → 작업대
      lastSwipeTime = performance.now();
      showScreen("work");
    }
  }

  // 모바일 · 태블릿 터치
  viewport.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) {
        swipeStart = null;
        return;
      }

      const touch = e.touches[0];

      startSwipe(touch.clientX, touch.clientY, e.target);
    },
    { passive: true, capture: true },
  );

  viewport.addEventListener(
    "touchend",
    (e) => {
      if (!swipeStart || e.changedTouches.length !== 1) {
        swipeStart = null;
        return;
      }

      const touch = e.changedTouches[0];

      finishSwipe(touch.clientX, touch.clientY);
    },
    { passive: true, capture: true },
  );

  viewport.addEventListener(
    "touchcancel",
    () => {
      swipeStart = null;
    },
    { passive: true, capture: true },
  );

  // 스와이프 직후 발생하는 사진 클릭 방지
  viewport.addEventListener(
    "click",
    (e) => {
      if (performance.now() - lastSwipeTime < 650) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  // PC 마우스 드래그도 지원
  let mouseDragging = false;

  viewport.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;

      if (shouldIgnoreSwipe(e.target)) return;

      mouseDragging = true;
      startSwipe(e.clientX, e.clientY, e.target);
    },
    true,
  );

  window.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType !== "mouse" || !mouseDragging) return;

      mouseDragging = false;
      finishSwipe(e.clientX, e.clientY);
    },
    true,
  );

  window.addEventListener(
    "pointercancel",
    () => {
      mouseDragging = false;
    },
    true,
  );
}

// HTML 로딩 완료 후 한 번만 연결
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeScreenSwipe, {
    once: true,
  });
} else {
  initializeScreenSwipe();
}
