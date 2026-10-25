import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// ============================================
// CAPTURE TO MEMO — 3D ALBUM SCENE
// Main Book / 6 Pages / Glass Material
// ============================================

const mount = document.getElementById("three-glass-scene");
const cover = document.getElementById("cover");

if (mount && cover) {
  try {
    // ====================================
    // 1. SCENE / CAMERA / RENDERER
    // ====================================

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

    camera.position.set(0, 0, 12.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    // 너무 밝게 날아가지 않도록 노출 낮춤
    renderer.toneMappingExposure = 0.93;

    renderer.transmissionResolutionScale = 0.65;

    mount.appendChild(renderer.domElement);

    // ====================================
    // 2. ENVIRONMENT & LIGHTING
    // ====================================

    const studio = new RoomEnvironment();

    const pmrem = new THREE.PMREMGenerator(renderer);

    const envTarget = pmrem.fromScene(studio);

    scene.environment = envTarget.texture;

    studio.dispose();
    pmrem.dispose();

    // 기본 조명
    scene.add(new THREE.AmbientLight(0xffffff, 1.2));

    // 흰색 메인 조명
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);

    keyLight.position.set(-4, 6, 7);
    scene.add(keyLight);

    // 파란색 보조 조명
    const blueLight = new THREE.DirectionalLight(0x89aaff, 1.7);

    blueLight.position.set(4, 1, 5);
    scene.add(blueLight);

    // ====================================
    // 3. MATERIALS
    // ====================================

    // 파란색 반투명 유리
    const blueGlass = new THREE.MeshPhysicalMaterial({
      color: 0x8dafff,

      metalness: 0,
      roughness: 0.085,

      transmission: 0.8,
      opacity: 1,

      ior: 1.48,
      thickness: 0.35,

      clearcoat: 1,
      clearcoatRoughness: 0.07,

      envMapIntensity: 1.55,
    });

    // 맑은 투명 유리
    const clearGlass = new THREE.MeshPhysicalMaterial({
      color: 0xf1f7ff,

      metalness: 0,
      roughness: 0.035,

      transmission: 1,
      opacity: 1,

      ior: 1.5,
      thickness: 0.7,

      clearcoat: 1,
      clearcoatRoughness: 0.035,

      envMapIntensity: 1.4,
    });

    // 책등 코발트 블루
    const cobalt = new THREE.MeshPhysicalMaterial({
      color: 0x2454ef,

      metalness: 0.12,
      roughness: 0.23,

      clearcoat: 0.9,
    });

    // 매트한 종이
    const paper = new THREE.MeshStandardMaterial({
      color: 0xf4f6fc,

      roughness: 0.91,
      metalness: 0,

      side: THREE.DoubleSide,
    });

    // 종이 끝부분의 은은한 파란색
    const edgeBlue = new THREE.MeshStandardMaterial({
      color: 0xb7c9f8,

      roughness: 0.75,
      side: THREE.DoubleSide,
    });

    // 링 재질
    const metal = new THREE.MeshStandardMaterial({
      color: 0x7599e2,

      metalness: 0.56,
      roughness: 0.22,
    });

    // 폴라로이드 프레임
    const white = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
    });

    // ====================================
    // 4. MAIN STAGE
    // ====================================

    const stage = new THREE.Group();
    scene.add(stage);

    const pagePivots = [];

    // =====================================
    // 가로 스크롤 ↔ 책 펼침 연결
    // =====================================

    // 0 = 메인 표지
    // 1 = 인화실
    let roomProgress = Math.min(
      1,
      Math.max(0, Number(window.__ctmRoomProgress) || 0),
    );

    // sketch.js에서 보내는 진행률 받기
    window.addEventListener("ctm-room-progress", (event) => {
      roomProgress = Math.min(
        1,
        Math.max(0, Number(event.detail?.progress) || 0),
      );
    });

    // ====================================
    // 5. CREATE MAIN BOOK
    // ====================================

    function createBook() {
      const book = new THREE.Group();

      // 모든 페이지가 공유할 책등 위치
      const spineX = -1.05;

      const pageWidth = 2.12;
      const pageHeight = 3.02;

      // 페이지 수: 6장
      const pageCount = 6;

      // --------------------------------
      // 5-1. 책등
      // --------------------------------

      const spine = new THREE.Mesh(
        new RoundedBoxGeometry(0.18, 3.31, 0.27, 4, 0.04),
        cobalt,
      );

      spine.position.set(spineX - 0.04, 0, -0.05);

      book.add(spine);

      // --------------------------------
      // 5-2. 뒤표지
      // --------------------------------

      const backPivot = new THREE.Group();

      backPivot.position.set(spineX, 0, -0.13);

      const backCover = new THREE.Mesh(
        new RoundedBoxGeometry(2.34, 3.28, 0.09, 4, 0.045),
        blueGlass,
      );

      backCover.position.x = 2.34 / 2;

      backPivot.add(backCover);

      backPivot.rotation.y = 0.1;

      book.add(backPivot);

      // --------------------------------
      // 5-3. 책 페이지 6장
      // --------------------------------

      for (let i = 0; i < pageCount; i++) {
        const pivot = new THREE.Group();

        // 각 페이지의 회전축을 책등에 일치
        pivot.position.set(spineX, 0, -0.085 + i * 0.014);

        // 종이 본체
        const sheet = new THREE.Mesh(
          new RoundedBoxGeometry(pageWidth, pageHeight, 0.018, 3, 0.014),
          paper,
        );

        // 종이의 왼쪽 끝이 책등에 연결됨
        sheet.position.x = pageWidth / 2;

        pivot.add(sheet);

        // 종이 바깥쪽 얇은 파란 선
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, pageHeight - 0.13, 0.023),
          edgeBlue,
        );

        edge.position.set(pageWidth - 0.065, 0, 0.009);

        pivot.add(edge);

        // 한 권의 책처럼 일정한 간격으로 펼침
        const baseAngle = -0.15 - i * 0.155;

        pivot.rotation.y = baseAngle;
        pivot.rotation.z = 0.005 + i * 0.008;

        // 애니메이션용 기본 각도
        pivot.userData.baseAngle = baseAngle;
        pivot.userData.baseZ = pivot.rotation.z;

        pagePivots.push(pivot);
        book.add(pivot);
      }

      // --------------------------------
      // 5-4. 앞표지
      // --------------------------------

      const frontPivot = new THREE.Group();

      frontPivot.position.set(spineX, 0, 0.08);

      const frontCover = new THREE.Mesh(
        new RoundedBoxGeometry(2.38, 3.29, 0.105, 4, 0.05),
        blueGlass,
      );

      frontCover.position.x = 2.38 / 2;

      frontPivot.add(frontCover);

      // 표지의 얇은 블루 테두리
      // 기존의 링과 공 장식은 완전히 제거
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(frontCover.geometry, 23),
        new THREE.LineBasicMaterial({
          color: 0x7099ff,
          transparent: true,
          opacity: 0.62,
        }),
      );

      border.position.copy(frontCover.position);

      frontPivot.add(border);

      // 표지 펼침 각도
      frontPivot.userData.baseAngle = -1.17;

      frontPivot.rotation.y = frontPivot.userData.baseAngle;

      frontPivot.rotation.z = 0.045;

      book.add(frontPivot);

      return {
        book,
        frontPivot,
      };
    }

    // ====================================
    // 6. HERO BOOK POSITION
    // ====================================

    const { book: heroBook, frontPivot } = createBook();

    //책 위치
    const BOOK_BASE_Y = -0.6;
    heroBook.position.set(0.38, BOOK_BASE_Y, 0.2);

    // X: 살짝 뒤로 눕히기
    // Y: 표지와 종이 함께 보이기
    // Z: 약간 왼쪽으로 기울이기
    heroBook.rotation.set(-0.29, 0.08, 0.08);

    // 메인 책 크기
    heroBook.scale.setScalar(1.8);

    stage.add(heroBook);

    // ====================================
    // 7. POLAROID TEXTURE
    // ====================================

    function makePhotoTexture(top, bottom, label) {
      const canvas = document.createElement("canvas");

      canvas.width = 256;
      canvas.height = 256;

      const ctx = canvas.getContext("2d");

      const gradient = ctx.createLinearGradient(0, 0, 256, 256);

      gradient.addColorStop(0, top);
      gradient.addColorStop(1, bottom);

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);

      // 부드러운 이미지 장식
      ctx.fillStyle = "rgba(255,255,255,.4)";
      ctx.fillRect(24, 25, 208, 110);

      ctx.fillStyle = "rgba(31,82,223,.16)";

      ctx.beginPath();
      ctx.arc(180, 86, 48, 0, Math.PI * 2);
      ctx.fill();

      // 사진 하단 라벨
      ctx.fillStyle = "#435888";
      ctx.font = "bold 15px Arial";

      ctx.fillText(label, 22, 234);

      const texture = new THREE.CanvasTexture(canvas);

      texture.colorSpace = THREE.SRGBColorSpace;

      return texture;
    }

    // ====================================
    // 8. CREATE POLAROID
    // ====================================

    function makePolaroid(label, a, b) {
      const group = new THREE.Group();

      // 사진 프레임
      const frame = new THREE.Mesh(
        new RoundedBoxGeometry(1.05, 1.28, 0.055, 3, 0.028),
        white,
      );

      group.add(frame);

      // 사진 이미지
      const picture = new THREE.Mesh(
        new THREE.PlaneGeometry(0.88, 0.87),

        new THREE.MeshBasicMaterial({
          map: makePhotoTexture(a, b, label),
          side: THREE.DoubleSide,
        }),
      );

      picture.position.set(0, 0.11, 0.036);

      group.add(picture);

      return group;
    }

    // ====================================
    // 9. FLOATING POLAROIDS
    // ====================================

    const photos = [
      {
        obj: makePolaroid("MEMO 01", "#d8e7ff", "#f9fbff"),
        x: -3.15,
        y: -1.55,
        z: 0.9,
        tilt: -0.24,
      },

      {
        obj: makePolaroid("MEMO 02", "#e2ebff", "#b6ccfa"),
        x: 3.08,
        y: 1.15,
        z: 0.5,
        tilt: 0.19,
      },

      {
        obj: makePolaroid("MEMO 03", "#f6f9ff", "#c4d8ff"),
        x: 2.8,
        y: -1.82,
        z: 1.0,
        tilt: -0.15,
      },
    ];

    photos.forEach(({ obj, x, y, z, tilt }) => {
      obj.position.set(x, y, z);
      obj.rotation.z = tilt;

      stage.add(obj);
    });

    // ====================================
    // 10. GLASS DECORATIONS
    // ====================================

    // 링과 공은 메인 책 표지에서 분리

    // 투명 유리 공
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 32, 24),
      clearGlass,
    );

    orb.position.set(-3.3, 2.05, 0.6);

    stage.add(orb);

    // 파란 금속 링
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.025, 12, 70),
      metal,
    );

    ring.position.set(-3.6, 2.3, 0.15);

    ring.rotation.set(0.5, 0.4, 0.25);

    stage.add(ring);

    // ====================================
    // 11. RESPONSIVE RESIZE
    // ====================================

    function resizeScene() {
      const width = mount.clientWidth || window.innerWidth;

      const height = mount.clientHeight || window.innerHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setSize(width, height, false);

      // 모바일
      if (width < 700) {
        stage.scale.setScalar(0.72);

        stage.position.set(0.38, -0.12, 0);

        // 태블릿
      } else if (width < 1100) {
        stage.scale.setScalar(0.93);

        stage.position.set(0.55, 0, 0);

        // 데스크톱
      } else {
        stage.scale.setScalar(1.06);

        stage.position.set(0.58, 0, 0);
      }
    }

    resizeScene();

    window.addEventListener("resize", resizeScene);

    // 첫 렌더링 성공
    renderer.render(scene, camera);

    cover.classList.add("three-ready");

    // ====================================
    // 12. ANIMATION SETTINGS
    // ====================================

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const mobile = window.matchMedia("(pointer: coarse)").matches;

    let lastFrame = 0;

    // ====================================
    // 13. ANIMATION LOOP
    // ====================================

    function animate(ms) {
      requestAnimationFrame(animate);

      if (document.hidden) return;

      // 모바일은 약 30fps
      if (ms - lastFrame < (mobile ? 33 : 16)) {
        return;
      }

      lastFrame = ms;

      const t = ms * 0.001;

      if (!reduceMotion) {
        // --------------------------------
        // 메인 책 부유 모션
        // --------------------------------

        heroBook.position.y = BOOK_BASE_Y + Math.sin(t * 0.75) * 0.085;

        heroBook.rotation.x = -0.29 + Math.sin(t * 0.32) * 0.018;

        heroBook.rotation.y = 0.08 + Math.cos(t * 0.3) * 0.03;

        heroBook.rotation.z = 0.08 + Math.sin(t * 0.36) * 0.018;

        // --------------------------------
        // 6장의 종이가 책등에서 움직임
        // --------------------------------

        // =====================================
        // 스크롤에 따라 6장 페이지 펼치기
        // =====================================

        pagePivots.forEach((pivot, i) => {
          // 페이지마다 약간씩 다른 시점에 펼쳐짐
          const part = THREE.MathUtils.clamp(
            roomProgress * 1.65 - i * 0.1,
            0,
            1,
          );

          // 움직임이 부드럽게 연결되도록
          const eased = part * part * (3 - 2 * part);

          // 인화실에 도착했을 때 완전히 펼쳐질 각도
          const openedAngle = -0.22 - i * 0.4;

          // 펼쳐진 뒤에는 종이 흔들림 감소
          const flutter = Math.sin(t * 0.95 - i * 0.31) * 0.025 * (1 - eased);

          pivot.rotation.y =
            THREE.MathUtils.lerp(pivot.userData.baseAngle, openedAngle, eased) +
            flutter;

          pivot.rotation.z =
            pivot.userData.baseZ +
            Math.sin(t * 0.65 + i * 0.22) * 0.004 * (1 - eased);
        });

        // =====================================
        // 앞표지도 함께 활짝 열기
        // =====================================

        const frontEase = THREE.MathUtils.clamp(roomProgress / 0.88, 0, 1);

        const frontSmooth = frontEase * frontEase * (3 - 2 * frontEase);

        frontPivot.rotation.y =
          THREE.MathUtils.lerp(
            frontPivot.userData.baseAngle,
            -2.85,
            frontSmooth,
          ) +
          Math.sin(t * 0.7) * 0.026 * (1 - frontSmooth);

        // --------------------------------
        // 폴라로이드 부유 모션
        // --------------------------------

        photos.forEach(({ obj, y, tilt }, i) => {
          obj.position.y = y + Math.sin(t * 0.72 + i * 1.5) * 0.1;

          obj.rotation.z = tilt + Math.sin(t * 0.55 + i) * 0.028;
        });

        // --------------------------------
        // 유리 공과 링
        // --------------------------------

        orb.position.y = 2.05 + Math.cos(t * 0.68) * 0.1;

        ring.rotation.z = 0.25 + t * 0.04;
      }

      renderer.render(scene, camera);
    }

    requestAnimationFrame(animate);
  } catch (error) {
    console.error("glass3d.js 초기화 실패:", error);

    // 3D 실패 시 기존 CSS 장식 표시
    cover.classList.remove("three-ready");
  }
}
