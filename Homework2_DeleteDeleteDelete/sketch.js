const Engine = Matter.Engine;
const Bodies = Matter.Bodies;
const Composite = Matter.Composite;
const Body = Matter.Body;

let engine;
let apples = [];
let birds = [];
let imgs = {};

// ==========================================
// 📍 [위치 수정] 나뭇잎(leaf) 위치 및 크기 조절
// ==========================================
let leafX_ratio = 0.42; // 중심부로 살짝 이동 (기존 0.35)
let leafY_ratio = 0.4; // 나무 기둥과 맞게 살짝 아래로 (기존 0.35)
let leafW_ratio = 0.7; // 가로 크기 살짝 확대 (기존 0.6)
let leafH_ratio = 0.65; // 세로 크기 살짝 확대 (기존 0.55)

let nextSpawnTime = 0; // 다음 사과가 생성될 시간

//사과나무 흔들어재껴껴겨겨ㅕㄱ겨겨겨겨겨
let isHoldingTree = false;
let treePressTime = 0;
let treeStartX = 0;
let treeStartY = 0;
let isTreeShaking = false;

function preload() {
  imgs.sky = loadImage("sky.png");
  imgs.tree = loadImage("apple_tree.png");
  imgs.leaf = loadImage("leaf.png");
  imgs.apple1 = loadImage("apple_1.png");
  imgs.apple2 = loadImage("apple_2.png");
  imgs.apple3 = loadImage("apple_3.png");
  imgs.bird = loadImage("bird.png");
  imgs.nest = loadImage("bird_nest.png"); // 👈 [추가] 새 둥지 이미지 로드
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  imageMode(CENTER);

  engine = Engine.create();
  engine.gravity.y = 3.5;
}

function draw() {
  Engine.update(engine);

  let leafX = width * leafX_ratio;
  let leafY = height * leafY_ratio;
  let leafW = width * leafW_ratio;
  let leafH = height * leafH_ratio;

  // 1. Sky (맨 뒤)
  image(imgs.sky, width / 2, height / 2, width, height);

  // 2. Leaf (하늘 앞, 나무 기둥 뒤)
  image(imgs.leaf, leafX, leafY, leafW, leafH);

  // 3. Apple Tree 기본 위치
  let treeW = width * 0.85;
  let treeH = treeW * 0.55;
  let treeX = width - treeW / 2 + 50;
  let treeY = height - treeH / 2;

  let renderTreeX = treeX;
  let renderTreeY = treeY;
  let renderLeafX = leafX;
  let renderLeafY = leafY;

  // 💡 [좌우 왕복 흔들기 및 누적 시간 2초 조건 로직 (0.2초 유예 시간 적용)]
  if (isHoldingTree && mouseIsPressed) {
    // 이전 프레임과 비교하여 마우스가 좌우로 움직인 방향(변화량) 체크
    let deltaX = mouseX - pmouseX;

    // 좌우로 왔다 갔다 하는지 확인하기 위해 방향 전환 감지 변수 활용
    let isMovingBackAndForth = abs(deltaX) > 0.3; // 판정을 살짝 널널하게(0.3) 조정

    if (isMovingBackAndForth) {
      isTreeShaking = true;
      let shakeX = random(-6, 6);
      let shakeY = random(-6, 6);

      renderTreeX += shakeX;
      renderTreeY += shakeY;
      renderLeafX += shakeX;
      renderLeafY += shakeY;

      // 움직임이 감지될 때마다 최근 활동 시간(lastActiveTime)을 갱신합니다.
      lastActiveTime = millis();

      // 💡 흔들고 있는 동안에만 유효한 누적 시간 증가
      if (typeof shakeStartTime === "undefined") {
        shakeStartTime = millis(); // 흔들기 시작한 시점
      }

      let shakenDuration = millis() - shakeStartTime; // 실제 흔든 누적 시간

      // 흔들린 누적 시간이 2초(2000밀리초) 이상이 되면 사과 전체 낙하!
      if (shakenDuration >= 2000) {
        for (let a of apples) {
          if (a.state === "ATTACHED") {
            a.fall(true);
          }
        }
        isHoldingTree = false;
        isTreeShaking = false;
        shakeStartTime = undefined;
        lastActiveTime = undefined;
      }
    } else {
      // 💡 마우스 움직임이 멈췄더라도, 마지막 활동 시간으로부터 0.2초(200ms) 이내라면 시간을 리셋하지 않고 유지합니다!
      if (
        typeof lastActiveTime !== "undefined" &&
        millis() - lastActiveTime < 200
      ) {
        isTreeShaking = true; // 떨림 유지
        // shakeStartTime은 유지되므로 시간이 리셋되지 않음
      } else {
        // 0.2초 이상 완전히 멈춰있을 때만 리셋
        isTreeShaking = false;
        shakeStartTime = undefined;
      }
    }
  } else {
    isHoldingTree = false;
    isTreeShaking = false;
    shakeStartTime = undefined;
    lastActiveTime = undefined;
  }

  // 💡 흔들림이 적용된 좌표로 나뭇잎과 나무 출력
  image(imgs.leaf, renderLeafX, renderLeafY, leafW, leafH);

  // (이 사이에 사과들을 그리는 루프가 위치합니다)

  image(imgs.tree, renderTreeX, renderTreeY, treeW, treeH);

  // 4. 🍎 사과 무작위 생성 (0.5초 ~ 2초 간격) -> 이 코드가 있는지 확인하세요!
  if (millis() > nextSpawnTime) {
    spawnApple(leafX, leafY, leafW, leafH);
    nextSpawnTime = millis() + random(400, 1500);
  }

  // 5. 나무 아래 절벽 쪽에 새 둥지 그리기
  let nestX = width * 0.82; // 둥지 X 위치 (필요시 조절 가능)
  let nestY = height * 0.835; // 둥지 Y 위치
  image(imgs.nest, nestX, nestY, 100, 70); // 둥지 크기 (가로 90, 세로 70)

  // 6. 새 업데이트 및 그리기
  for (let i = birds.length - 1; i >= 0; i--) {
    let b = birds[i];
    b.update();
    b.display();

    // 새가 사과와 부딪혔는지 체크 (새가 사과를 안 물고 있을 때만)
    if (!b.hasApple) {
      for (let a of apples) {
        if (a.state === "ATTACHED") {
          let d = dist(b.x, b.y, a.body.position.x, a.body.position.y);
          if (d < b.w / 2 + a.r) {
            a.state = "CARRIED";
            a.birdRef = b;
            b.hasApple = true; // 새 한 마리당 1개의 사과만
            Composite.remove(engine.world, a.body);
            break;
          }
        }
      }
    }

    if (b.x < -150 || b.x > width + 150) birds.splice(i, 1);
  }

  // 7. 사과 업데이트 및 그리기
  for (let i = apples.length - 1; i >= 0; i--) {
    let a = apples[i];
    a.update();
    a.display();

    // 삭제 조건
    if (a.state === "FALLING" && a.body.position.y > height + 100) {
      Composite.remove(engine.world, a.body);
      apples.splice(i, 1);
    } else if (
      a.state === "CARRIED" &&
      (a.birdRef.x < -150 || a.birdRef.x > width + 150)
    ) {
      apples.splice(i, 1);
    }
  }
}

// 사과 객체 클래스
// 사과 객체 클래스
class Apple {
  constructor(x, y) {
    this.r = 25;
    this.birthTime = millis();
    this.state = "ATTACHED";
    this.birdRef = null;

    this.body = Bodies.circle(x, y, this.r, {
      isStatic: true,
      restitution: 0.6,
      friction: 0.1,
    });
    Composite.add(engine.world, this.body);
  }

  update() {
    if (this.state === "ATTACHED") {
      let age = millis() - this.birthTime;
      // 9초 지나서 썩어 떨어질 때
      if (age >= 9000) {
        this.fall(false);
      }
    } else if (this.state === "CARRIED") {
      let offset = this.birdRef.direction === 1 ? 30 : -30;
      this.carriedX = this.birdRef.x + offset;
      this.carriedY = this.birdRef.y + 5;
    }
  }

  display() {
    let age = millis() - this.birthTime;
    let currentImg = imgs.apple1;

    // 💡 상태(state) 상관없이 나이(age)에 따라 이미지가 무조건 유지되도록 수정
    if (age < 5000) {
      currentImg = imgs.apple1; // ~4.99초
    } else if (age >= 5000 && age < 8000) {
      currentImg = imgs.apple2; // 5초 ~ 7.99초
    } else if (age >= 8000) {
      currentImg = imgs.apple3; // 8초 ~
    }

    push();
    if (this.state === "CARRIED") {
      translate(this.carriedX, this.carriedY);
    } else {
      translate(this.body.position.x, this.body.position.y);
      rotate(this.body.angle);
    }
    image(currentImg, 0, 0, this.r * 2.5, this.r * 2.5);
    pop();
  }

  fall(isClicked) {
    if (this.state === "ATTACHED") {
      this.state = "FALLING";
      Body.setStatic(this.body, false); // 중력 활성화

      if (isClicked === true) {
        // 💡 마우스 클릭 시에만 톡 튀어오름
        Body.setVelocity(this.body, {
          x: random(-2, 2),
          y: -6,
        });
      } else {
        // 💡 썩어서 떨어질 때는 속도를 0으로 고정하여 튀어오름을 완전히 방지
        Body.setVelocity(this.body, {
          x: 0,
          y: 0,
        });
      }
    }
  }
}

// 새 객체 클래스
class Bird {
  constructor(leafY, leafH) {
    this.direction = random() > 0.5 ? 1 : -1;
    this.x = this.direction === 1 ? -100 : width + 100;

    // 나뭇잎 높이 부근에서 비행
    this.y = leafY + random(-leafH * 0.3, leafH * 0.3);
    this.speed = random(6, 11);
    this.w = 80;
    this.h = 50;
    this.hasApple = false;
  }

  update() {
    this.x += this.speed * this.direction;
  }

  display() {
    push();
    translate(this.x, this.y);
    // 💡 원본 이미지가 왼쪽을 보고 있으므로, 오른쪽(1)으로 갈 때 이미지를 뒤집어 줍니다!
    if (this.direction === 1) scale(-1, 1);
    image(imgs.bird, 0, 0, this.w, this.h);
    pop();
  }
}

// 투명한 영역 제외하고 나뭇잎 안쪽에만 사과 생성하기 (타원형 공식 적용)
function spawnApple(cx, cy, w, h) {
  let angle = random(TWO_PI);
  let r = sqrt(random(1)); // 중심에서부터의 거리 비율 (0~1)

  // 가로 반경(w/2)과 세로 반경(h/2)보다 조금 작게(0.8 곱함)
  // 설정하여 네모난 이미지 구석(투명한 곳)에는 사과가 생기지 않도록 방지
  let spawnX = cx + (w / 2) * 0.8 * r * cos(angle);
  let spawnY = cy + (h / 2) * 0.8 * r * sin(angle);

  apples.push(new Apple(spawnX, spawnY));
}

function mousePressed() {
  let leafY = height * leafY_ratio;
  let leafH = height * leafH_ratio;

  // 1. 🍎 개별 사과를 클릭했는지 가장 먼저 체크 (레벨 1)
  for (let a of apples) {
    if (a.state === "ATTACHED") {
      let d = dist(mouseX, mouseY, a.body.position.x, a.body.position.y);
      if (d < a.r) {
        a.fall(true); // 마우스 클릭 시 톡 튀어오름
        return; // 사과를 클릭했으면 아래 나무/둥지 로직은 실행 안 함
      }
    }
  }

  // 2. 새 둥지 클릭 체크
  let nestX = width * 0.82;
  let nestY = height * 0.835;
  let dNest = dist(mouseX, mouseY, nestX, nestY);
  if (dNest < 45) {
    birds.push(new Bird(leafY, leafH));
    return;
  }

  // 3. 🌳 나무(apple_tree)를 누르기 시작했는지 체크
  let treeW = width * 0.85;
  let treeH = treeW * 0.55;
  let treeX = width - treeW / 2 + 50;
  let treeY = height - treeH / 2;

  if (
    mouseX > treeX - treeW / 2 &&
    mouseX < treeX + treeW / 2 &&
    mouseY > treeY - treeH / 2 &&
    mouseY < treeY + treeH / 2
  ) {
    isHoldingTree = true;
    treePressTime = millis();
    treeStartX = mouseX;
    treeStartY = mouseY;
  }
}

// 💡 [추가] 마우스를 뗄 때 상태 초기화
function mouseReleased() {
  isHoldingTree = false;
  isTreeShaking = false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
