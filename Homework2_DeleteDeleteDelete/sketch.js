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

function preload() {
  imgs.sky = loadImage("sky.png");
  imgs.tree = loadImage("apple_tree.png"); // 절벽 포함된 나무 기둥
  imgs.leaf = loadImage("leaf.png"); // 나뭇잎
  imgs.apple1 = loadImage("apple_1.png");
  imgs.apple2 = loadImage("apple_2.png");
  imgs.apple3 = loadImage("apple_3.png");
  imgs.bird = loadImage("bird.png");
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  imageMode(CENTER);

  engine = Engine.create();
  engine.gravity.y = 1;
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

  // 3. Apple Tree (나뭇잎 앞, 우측 하단 정렬)
  let treeW = width * 0.9; // 나무 크기 확대 (기존 0.7에서 0.85로 변경)
  let treeH = treeW * 0.55; // 나무 세로 비율
  let treeX = width - treeW / 2 + 50;
  let treeY = height - treeH / 2;
  image(imgs.tree, treeX, treeY, treeW, treeH);

  // 4. 사과 무작위 생성 (0.5초 ~ 2초 간격)
  if (millis() > nextSpawnTime) {
    spawnApple(leafX, leafY, leafW, leafH);
    nextSpawnTime = millis() + random(500, 2000);
  }

  // 5. 새 생성
  if (frameCount % 130 === 0 && random() > 0.3) {
    birds.push(new Bird(leafY, leafH));
  }

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
    this.speed = random(4, 9);
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

// 마우스 클릭 시 사과 떨어뜨리기 (클릭했으므로 true 전달)
function mousePressed() {
  for (let a of apples) {
    if (a.state === "ATTACHED") {
      let d = dist(mouseX, mouseY, a.body.position.x, a.body.position.y);
      if (d < a.r) {
        a.fall(true); // 👈 true를 전달하여 톡 튀어오르게 만듦
        break;
      }
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
