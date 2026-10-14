let canvasItems = [];
let currentTarget = null;
let mergedItem = null;
let held = null;

let engine;
let physicsBodies = [];
let ground, leftWall, rightWall;
let lockerDOM;

function setup() {
  let canvas = createCanvas(600, 500);
  canvas.parent("canvas-container");
  textAlign(CENTER, CENTER);
  rectMode(CENTER);
  imageMode(CENTER);

  engine = Matter.Engine.create();
  lockerDOM = document.getElementById("locker");

  setTimeout(() => {
    let lW = lockerDOM.clientWidth;
    let lH = lockerDOM.clientHeight;

    ground = Matter.Bodies.rectangle(lW / 2, lH + 25, lW, 50, {
      isStatic: true,
    });
    leftWall = Matter.Bodies.rectangle(-25, lH / 2, 50, lH, { isStatic: true });
    rightWall = Matter.Bodies.rectangle(lW + 25, lH / 2, 50, lH, {
      isStatic: true,
    });
    Matter.Composite.add(engine.world, [ground, leftWall, rightWall]);

    if (window.db) {
      window.db.ref("saved_memos").on("child_added", (snapshot) => {
        let memoData = snapshot.val();
        memoData.fbKey = snapshot.key;
        spawnMemoInLocker(memoData);
      });
      window.db.ref("saved_memos").on("child_changed", (snapshot) => {
        let memoData = snapshot.val();
        memoData.fbKey = snapshot.key;
        spawnMemoInLocker(memoData);
      });
      window.db.ref("saved_memos").on("child_removed", (snapshot) => {
        removeMemoFromLocker(snapshot.key);
      });
    }
  }, 100);

  let canvasEl = canvas.elt;
  canvasEl.addEventListener("dragover", (e) => e.preventDefault());
  canvasEl.addEventListener("drop", (e) => {
    e.preventDefault();
    let type = e.dataTransfer.getData("type");
    let value = e.dataTransfer.getData("value");
    let fbKey = e.dataTransfer.getData("fbKey");
    let memoKey = e.dataTransfer.getData("memoKey");
    let label = e.dataTransfer.getData("label") || "";
    let longM = e.dataTransfer.getData("longM") || "";

    let rect = canvasEl.getBoundingClientRect();
    let mx = e.clientX - rect.left;
    let my = e.clientY - rect.top;

    if (type === "main") {
      let newItem = new DraggableItem(mx, my, value, 200);
      newItem.labelTxt = label;
      newItem.longMemo = longM;
      if (memoKey) newItem.memoKey = memoKey;
      canvasItems.push(newItem);

      if (memoKey) {
        removeMemoFromLocker(memoKey);
      }
      if (fbKey) {
        let el = document.getElementById(fbKey);
        if (el) el.remove();
        if (window.db) window.db.ref("incoming").child(fbKey).remove();
      }
    }
  });

  let trashBin = document.getElementById("trash-bin");
  trashBin.addEventListener("dragover", (e) => {
    e.preventDefault();
    trashBin.classList.add("drag-over");
  });
  trashBin.addEventListener("dragleave", (e) => {
    trashBin.classList.remove("drag-over");
  });
  trashBin.addEventListener("drop", (e) => {
    e.preventDefault();
    trashBin.classList.remove("drag-over");
    let source = e.dataTransfer.getData("source");
    if (source === "locker") {
      let mKey = e.dataTransfer.getData("memoKey");
      if (mKey) {
        removeMemoFromLocker(mKey);
        if (window.db) window.db.ref("saved_memos").child(mKey).remove();
      }
    }
  });
}

function draw() {
  background(255);
  for (let item of canvasItems) item.display();
  if (mergedItem) {
    mergedItem.display();
    if (held === mergedItem && mouseX > width) {
      fill(43, 194, 164, 50);
      rect(width / 2, height / 2, width, height);
    }
  }

  Matter.Engine.update(engine, 1000 / 60);
  if (lockerDOM && ground) {
    let lW = lockerDOM.clientWidth;
    let lH = lockerDOM.clientHeight;
    Matter.Body.setPosition(ground, { x: lW / 2, y: lH + 25 });
    Matter.Body.setPosition(leftWall, { x: -25, y: lH / 2 });
    Matter.Body.setPosition(rightWall, { x: lW + 25, y: lH / 2 });
  }

  for (let pb of physicsBodies) {
    pb.elem.style.left = pb.body.position.x - pb.w / 2 + "px";
    pb.elem.style.top = pb.body.position.y - pb.h / 2 + "px";
    pb.elem.style.transform = `rotate(${pb.body.angle}rad)`;
  }
}

function doubleClicked() {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  for (let item of canvasItems) {
    if (item && item.hitTest && item.hitTest(mouseX, mouseY)) {
      openDecoModal(item);
      break;
    }
  }
}

function openDecoModal(item) {
  currentTarget = item;

  let previewImg = document.getElementById("popup-preview-img");
  let workspace = document.getElementById("popup-workspace");

  let oldStickers = workspace.querySelectorAll(".popup-sticker");
  oldStickers.forEach((s) => s.remove());

  if (item.isImage && item.valueStr) {
    previewImg.src = item.valueStr;
    previewImg.style.display = "block";
  } else {
    previewImg.style.display = "none";
  }

  document.getElementById("memo-input").value = item.labelTxt || "";
  document.getElementById("long-memo-input").value = item.longMemo || "";
  document.getElementById("deco-modal").style.display = "flex";
}

function addPopupSticker(type) {
  let workspace = document.getElementById("popup-workspace");
  let sticker = document.createElement("div");
  sticker.className = "popup-sticker";
  sticker.dataset.type = type;

  if (type === "rect") {
    sticker.style.width = "40px";
    sticker.style.height = "40px";
    sticker.style.backgroundColor = "rgba(255, 100, 100, 0.85)";
    sticker.style.borderRadius = "4px";
  } else if (type === "triangle") {
    sticker.style.width = "0";
    sticker.style.height = "0";
    sticker.style.borderLeft = "20px solid transparent";
    sticker.style.borderRight = "20px solid transparent";
    sticker.style.borderBottom = "35px solid rgba(100, 150, 255, 0.95)";
    sticker.style.backgroundColor = "transparent";
  } else if (type === "circle") {
    sticker.style.width = "40px";
    sticker.style.height = "40px";
    sticker.style.backgroundColor = "rgba(255, 200, 50, 0.85)";
    sticker.style.borderRadius = "50%";
  }

  sticker.style.left = "110px";
  sticker.style.top = "80px";

  let isDragging = false;
  let startX, startY;

  sticker.addEventListener("mousedown", (e) => {
    isDragging = true;
    startX = e.clientX - sticker.offsetLeft;
    startY = e.clientY - sticker.offsetTop;
    sticker.style.zIndex = 10;
    e.stopPropagation();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    let x = e.clientX - startX;
    let y = e.clientY - startY;

    x = Math.max(0, Math.min(x, workspace.clientWidth - sticker.offsetWidth));
    y = Math.max(0, Math.min(y, workspace.clientHeight - sticker.offsetHeight));

    sticker.style.left = x + "px";
    sticker.style.top = y + "px";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    sticker.style.zIndex = 5;
  });

  workspace.appendChild(sticker);
}

function fixAndMerge() {
  let labelTxt = document.getElementById("memo-input").value;
  let longMemoTxt = document.getElementById("long-memo-input").value;

  // 캔버스 크기를 작업대와 완전히 동일하게 1:1 세팅하여 이미지 축소(Shrinking) 방지
  let pg = createGraphics(260, 200);
  pg.textAlign(CENTER, CENTER);
  pg.rectMode(CENTER);
  pg.imageMode(CENTER);

  if (currentTarget && currentTarget.isImage && currentTarget.imgData) {
    pg.imageMode(CENTER);
    let maxW = 260;
    let maxH = 200;
    let aspect = currentTarget.imgData.width / currentTarget.imgData.height;
    let pW, pH;
    if (
      currentTarget.imgData.width / maxW >
      currentTarget.imgData.height / maxH
    ) {
      pW = maxW;
      pH = maxW / aspect;
    } else {
      pH = maxH;
      pW = maxH * aspect;
    }
    // 정중앙에 정확히 1:1 비율로 렌더링
    pg.image(currentTarget.imgData, 130, 100, pW, pH);
  }

  let workspace = document.getElementById("popup-workspace");
  let stickers = workspace.querySelectorAll(".popup-sticker");
  stickers.forEach((s) => {
    let type = s.dataset.type;
    let sLeft = parseInt(s.style.left) || 0;
    let sTop = parseInt(s.style.top) || 0;
    // 오프셋 없이 작업대 픽셀 좌표를 그대로 p5 그래픽스로 매핑
    let px = sLeft + 20;
    let py = sTop + 20;

    pg.push();
    pg.noStroke();
    if (type === "rect") {
      pg.fill(255, 100, 100, 220);
      pg.rect(px, py, 40, 40, 5);
    } else if (type === "triangle") {
      pg.fill(100, 150, 255, 220);
      pg.triangle(px, py - 20, px - 20, py + 20, px + 20, py + 20);
    } else if (type === "circle") {
      pg.fill(255, 200, 50, 220);
      pg.ellipse(px, py, 40, 40);
    }
    pg.pop();
  });

  let mergedImg = pg.get();
  mergedItem = new MergedObj(width / 2, height / 2, mergedImg, 260, 200);
  mergedItem.labelTxt = labelTxt;
  mergedItem.longMemo = longMemoTxt;
  if (currentTarget && currentTarget.memoKey) {
    mergedItem.memoKey = currentTarget.memoKey;
  }

  canvasItems = [];
  currentTarget = null;
  document.getElementById("memo-input").value = "";
  document.getElementById("long-memo-input").value = "";
  document.getElementById("deco-modal").style.display = "none";
}

function mousePressed() {
  if (mergedItem && mergedItem.hitTest(mouseX, mouseY)) {
    held = mergedItem;
    held.offsetX = held.x - mouseX;
    held.offsetY = held.y - mouseY;
    return;
  }
  for (let i = canvasItems.length - 1; i >= 0; i--) {
    let m = canvasItems[i];
    if (m && m.hitTest && m.hitTest(mouseX, mouseY)) {
      held = m;
      held.offsetX = m.x - mouseX;
      held.offsetY = m.y - mouseY;
      return;
    }
  }
}

function mouseDragged() {
  if (held !== null) {
    held.x = mouseX + held.offsetX;
    held.y = mouseY + held.offsetY;
  }
}

function mouseReleased() {
  if (held !== null) {
    if (held === mergedItem && mouseX > width) {
      saveToFirebase(mergedItem);
      mergedItem = null;
    }
    held = null;
  }
}

function saveToFirebase(mItem) {
  let dataUrl = mItem.img.canvas.toDataURL("image/png");
  let memoData = {
    image: dataUrl,
    labelTxt: mItem.labelTxt || "",
    longMemo: mItem.longMemo || "",
    timestamp: Date.now(),
  };

  if (window.db) {
    if (mItem.memoKey) {
      window.db.ref("saved_memos").child(mItem.memoKey).set(memoData);
    } else {
      window.db.ref("saved_memos").push(memoData);
    }
  }
}

function removeMemoFromLocker(mKey) {
  let pbIndex = physicsBodies.findIndex((pb) => pb.id === mKey);
  if (pbIndex !== -1) {
    Matter.Composite.remove(engine.world, physicsBodies[pbIndex].body);
    physicsBodies.splice(pbIndex, 1);
  }
  let el = document.getElementById("memo-" + mKey);
  if (el) el.remove();
}

function spawnMemoInLocker(m) {
  let locker = select("#locker");
  let mKey = m.fbKey || m.memoKey || "memo_" + m.timestamp;

  removeMemoFromLocker(mKey);

  let div = createDiv("");
  div.class("saved-item");
  div.id("memo-" + mKey);
  div.attribute("draggable", "true");

  div.elt.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("source", "locker");
    e.dataTransfer.setData("memoKey", mKey);
    e.dataTransfer.setData("type", "main");
    e.dataTransfer.setData("value", m.image);
    e.dataTransfer.setData("label", m.labelTxt || "");
    e.dataTransfer.setData("longM", m.longMemo || "");
  });

  let img = createImg(m.image, "");
  div.child(img);

  if (m.labelTxt) {
    let labelDiv = createDiv("🏷️ " + m.labelTxt);
    labelDiv.class("locker-label");
    div.child(labelDiv);
  }

  locker.child(div);

  let lW = lockerDOM.clientWidth || 280;

  // 무조건 상단(허공)에서 떨어지도록 좌표 고정! (-150 ~ -50 사이에서 뚝 떨어짐)
  let startY = random(-150, -50);

  let boxSize = 120;
  let body = Matter.Bodies.rectangle(
    lW / 2 + random(-40, 40),
    startY,
    boxSize,
    boxSize,
    {
      restitution: 0.5,
      friction: 0.5,
      density: 0.05,
    },
  );
  Matter.Composite.add(engine.world, body);
  physicsBodies.push({
    id: mKey,
    elem: div.elt,
    body: body,
    w: boxSize,
    h: boxSize,
  });
}

class DraggableItem {
  constructor(x, y, valueStr, size) {
    this.x = x;
    this.y = y;
    this.size = size;
    this.w = size;
    this.h = size;
    this.offsetX = 0;
    this.offsetY = 0;
    this.labelTxt = "";
    this.longMemo = "";
    this.memoKey = null;
    this.valueStr = valueStr;
    this.isImage = valueStr.length > 100;
    if (this.isImage) {
      this.imgData = null;
      loadImage(valueStr, (img) => {
        this.imgData = img;
        let aspect = img.width / img.height;
        if (aspect > 1) {
          this.w = size;
          this.h = size / aspect;
        } else {
          this.h = size;
          this.w = size * aspect;
        }
      });
    } else {
      this.textStr = valueStr;
    }
  }
  display() {
    push();
    if (held === this) {
      drawingContext.shadowBlur = 10;
      drawingContext.shadowColor = "rgba(0,0,0,0.3)";
    }
    if (this.isImage) {
      if (this.imgData) {
        imageMode(CENTER);
        image(this.imgData, this.x, this.y, this.w, this.h);
      }
    } else {
      textSize(this.size);
      text(this.textStr, this.x, this.y);
    }

    if (this.labelTxt) {
      push();
      rectMode(CENTER);
      fill("#fffacd");
      stroke("#d4c879");
      strokeWeight(1.5);
      rect(this.x, this.y - this.h / 2 - 15, 140, 26, 4);
      fill("#333");
      noStroke();
      textAlign(CENTER, CENTER);
      textSize(12);
      text("🏷️ " + this.labelTxt, this.x, this.y - this.h / 2 - 15);
      pop();
    }
    pop();
  }
  hitTest(mx, my) {
    return (
      mx > this.x - this.w / 2 &&
      mx < this.x + this.w / 2 &&
      my > this.y - this.h / 2 &&
      my < this.y + this.h / 2
    );
  }
}

class MergedObj {
  constructor(x, y, img, w, h) {
    this.x = x;
    this.y = y;
    this.img = img;
    this.w = w;
    this.h = h;
    this.offsetX = 0;
    this.offsetY = 0;
    this.labelTxt = "";
    this.longMemo = "";
    this.memoKey = null;
  }
  display() {
    push();
    if (held === this) {
      drawingContext.shadowBlur = 20;
      drawingContext.shadowColor = "rgba(43,194,164,0.8)";
    }
    image(this.img, this.x, this.y);

    if (this.labelTxt) {
      push();
      rectMode(CENTER);
      fill("#fffacd");
      stroke("#d4c879");
      strokeWeight(1.5);
      rect(this.x, this.y - this.h / 2 - 15, 140, 26, 4);
      fill("#333");
      noStroke();
      textAlign(CENTER, CENTER);
      textSize(12);
      text("🏷️ " + this.labelTxt, this.x, this.y - this.h / 2 - 15);
      pop();
    }
    pop();
  }
  hitTest(mx, my) {
    return (
      mx > this.x - this.w / 2 &&
      mx < this.x + this.w / 2 &&
      my > this.y - this.h / 2 &&
      my < this.y + this.h / 2
    );
  }
}
