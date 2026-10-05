const Engine = Matter.Engine;
const Bodies = Matter.Bodies;
const Composite = Matter.Composite;
const Body = Matter.Body;

let engine;
let ground, leftWall, rightWall;
let platforms = []; // 기울어진 발판들을 담을 배열
let raindrops = []; // 떨어지는 네모 비를 담을 배열

function setup() {
  createCanvas(windowWidth, windowHeight);
  rectMode(CENTER);
  noStroke();

  // Matter setting
  engine = Engine.create();
  
  // 중력 설정
  engine.gravity.y = 1;

  // 1. 고정된 벽과 바닥 만들기 (isStatic: true)
  let margin = 50;
  ground = Bodies.rectangle(width / 2, height, width, margin, { isStatic: true });
  leftWall = Bodies.rectangle(0, height / 2, margin, height, { isStatic: true });
  rightWall = Bodies.rectangle(width, height / 2, margin, height, { isStatic: true });

  // 2. 기울기(Slope)를 가진 발판 만들기
  let platform1 = Bodies.rectangle(width * 0.3, height * 0.3, 300, 20, { 
    isStatic: true, 
    angle: 0.4 // 라디안 값으로 기울기 설정
  });
  let platform2 = Bodies.rectangle(width * 0.7, height * 0.6, 300, 20, { 
    isStatic: true, 
    angle: -0.4 
  });

  platforms.push({ body: platform1, w: 300, h: 20 });
  platforms.push({ body: platform2, w: 300, h: 20 });

  // 월드에 고정 객체들 추가
  Composite.add(engine.world, [ground, leftWall, rightWall, platform1, platform2]);
}

function draw() {
  background(0); // 배경은 검은색

  // 엔진 업데이트
  Engine.update(engine);

  // 3. 일정 시간마다 무작위 위치에서 비(네모) 내리기
  if (frameCount % 10 === 0) {
    let rw = random(15, 30);
    let rh = random(15, 30);
    
    let drop = Bodies.rectangle(random(50, width - 50), -50, rw, rh, {
      restitution: 0.95, // 탄성: 탱탱볼처럼 잘 튕김
      friction: 0.05,    // 마찰력
      density: random(0.001, 0.01)
    });
    
    raindrops.push({ body: drop, w: rw, h: rh });
    Composite.add(engine.world, drop);
  }

  // 4. 고정된 바닥 그리기
  fill(100); // 짙은 회색
  rect(ground.position.x, ground.position.y, width, 50);

  // 5. 기울어진 발판들 그리기
  fill(150); // 밝은 회색
  for (let i = 0; i < platforms.length; i++) {
    let p = platforms[i];
    push();
    translate(p.body.position.x, p.body.position.y);
    rotate(p.body.angle);
    rect(0, 0, p.w, p.h);
    pop();
  }

  // 6. 떨어지는 네모 비 그리기 (사라지지 않고 바닥과 발판 위에 쌓임)
  fill(135, 206, 235); // 하늘색 (Sky Blue)
  for (let i = 0; i < raindrops.length; i++) {
    let r = raindrops[i];
    push();
    translate(r.body.position.x, r.body.position.y);
    rotate(r.body.angle);
    rect(0, 0, r.w, r.h);
    pop();
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}