import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Capture to Memo — Album Edition / 3D cover scene
// index.html: importmap + <div id="three-glass-scene"></div> 필요
const mount = document.getElementById("three-glass-scene");
const cover = document.getElementById("cover");

if (mount && cover) {
  try {
    // 1. Scene, camera, renderer
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
    renderer.toneMappingExposure = 0.93; // 흰색이 날아가지 않도록
    renderer.transmissionResolutionScale = 0.65;
    mount.appendChild(renderer.domElement);

    // 2. Environment + lighting
    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(studio);
    scene.environment = envTarget.texture;
    studio.dispose();
    pmrem.dispose();

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(-4, 6, 7);
    scene.add(keyLight);
    const blueLight = new THREE.DirectionalLight(0x89aaff, 1.7);
    blueLight.position.set(4, 1, 5);
    scene.add(blueLight);

    // 3. Materials
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

    const cobalt = new THREE.MeshPhysicalMaterial({
      color: 0x2454ef,
      metalness: 0.12,
      roughness: 0.23,
      clearcoat: 0.9,
    });
    const paper = new THREE.MeshStandardMaterial({
      color: 0xf4f6fc,
      roughness: 0.91,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const edgeBlue = new THREE.MeshStandardMaterial({
      color: 0xb7c9f8,
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: 0x7599e2,
      metalness: 0.56,
      roughness: 0.22,
    });
    const white = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
    });

    // 4. Group for all objects
    const stage = new THREE.Group();
    scene.add(stage);
    const pagePivots = [];

    // Create a six-page book, each page joined to SAME spine position.
    function createBook() {
      const book = new THREE.Group();
      const spineX = -1.05;
      const pageWidth = 2.12;
      const pageHeight = 3.02;
      const pageCount = 6;

      // Solid book spine: clearly identifies this object as a book.
      const spine = new THREE.Mesh(
        new RoundedBoxGeometry(0.18, 3.31, 0.27, 4, 0.04),
        cobalt,
      );
      spine.position.set(spineX - 0.04, 0, -0.05);
      book.add(spine);

      // Back cover uses same hinge as pages.
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

      // Visible sheets; NOT stacked translucent glass panes.
      // The angled fan originates from one hinge, preventing overlaps.
      for (let i = 0; i < pageCount; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(spineX, 0, -0.085 + i * 0.014);

        const sheet = new THREE.Mesh(
          new RoundedBoxGeometry(pageWidth, pageHeight, 0.018, 3, 0.014),
          paper,
        );
        sheet.position.x = pageWidth / 2;
        pivot.add(sheet);

        // A faint blue line near each page's outer edge creates definition.
        const edge = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, pageHeight - 0.13, 0.023),
          edgeBlue,
        );
        edge.position.set(pageWidth - 0.065, 0, 0.009);
        pivot.add(edge);

        const baseAngle = -0.15 - i * 0.155;
        pivot.rotation.y = baseAngle;
        pivot.rotation.z = 0.005 + i * 0.008;
        pivot.userData.baseAngle = baseAngle;
        pivot.userData.baseZ = pivot.rotation.z;
        pagePivots.push(pivot);
        book.add(pivot);
      }

      // Front cover, without attached ring/ball.
      const frontPivot = new THREE.Group();
      frontPivot.position.set(spineX, 0, 0.08);
      const frontCover = new THREE.Mesh(
        new RoundedBoxGeometry(2.38, 3.29, 0.105, 4, 0.05),
        blueGlass,
      );
      frontCover.position.x = 2.38 / 2;
      frontPivot.add(frontCover);

      // Very subtle blue border on the cover (no circles or balls).
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

      frontPivot.userData.baseAngle = -1.17;
      frontPivot.rotation.y = frontPivot.userData.baseAngle;
      frontPivot.rotation.z = 0.045;
      book.add(frontPivot);

      return { book, frontPivot };
    }

    const { book: heroBook, frontPivot } = createBook();
    // 사용자가 확정한 책 위치, 크기 및 회전값 (변경 금지)
    const BOOK_BASE_Y = -0.6;
    heroBook.position.set(0.38, BOOK_BASE_Y, 0.2);
    heroBook.rotation.set(-0.29, 0.08, 0.08);
    heroBook.scale.setScalar(1.8);
    stage.add(heroBook);

    /* ==========================================
   메인 책을 복제한 인화실용 3D 메모 책
========================================== */

    function setupMemoDropBook() {
      const dropZone = document.getElementById("memo-drop-zone");
      const bookHost = document.getElementById("memo-book-3d");
      if (!dropZone || !bookHost) return;

      try {
        const bookScene = new THREE.Scene();
        bookScene.environment = scene.environment;
        bookScene.add(new THREE.AmbientLight(0xffffff, 1.45));

        const light = new THREE.DirectionalLight(0xffffff, 2.1);
        light.position.set(-3, 8, 6);
        bookScene.add(light);

        const fill = new THREE.DirectionalLight(0xcfe0ff, 1.0);
        fill.position.set(4, 5, -3);
        bookScene.add(fill);

        // 메인 책을 복제하므로 메인 화면은 변경되지 않음
        const memoBook = heroBook.clone(true);
        bookScene.add(memoBook);

        const spine = memoBook.children[0];
        const back = memoBook.children[1];
        const leaves = memoBook.children.slice(2, 8);
        const front = memoBook.children[8];

        if (!spine || !back || !front || leaves.length !== 6) {
          console.error("메모 책 파츠가 예상한 구조와 다릅니다.");
          return;
        }

        // =====================================
        // 1. 책 크기, 위치, 회전
        // =====================================

        const BOOK_SCALE = 1.12;

        memoBook.scale.setScalar(BOOK_SCALE);

        const BASE_Y = -0.42;
        memoBook.position.set(0.92, BASE_Y, -0.05);

        // 사용자가 직접 정한 회전값 유지!
        memoBook.rotation.set(-2.5, 0, 0);

        // =====================================
        // 2. 파란 책등 수정
        // =====================================

        // 실제 페이지가 회전하는 축으로 이동
        spine.position.set(back.position.x, 0, -0.15);

        // 표지보다 짧고 얇게
        spine.scale.set(0.58, 0.94, 0.55);

        // =====================================
        // 3. 표지 위치
        // =====================================

        back.position.z = -0.25;
        front.position.z = -0.24;

        back.rotation.set(0, -0.1, 0);
        front.rotation.set(0, -Math.PI + 0.1, 0);

        // =====================================
        // 4. 평상시에도 살짝 접힌 속지
        // =====================================

        const restAngles = [
          -0.3,
          -0.25,
          -0.2,
          -Math.PI + 0.2,
          -Math.PI + 0.25,
          -Math.PI + 0.3,
        ];

        leaves.forEach((leaf, i) => {
          leaf.rotation.set(0, restAngles[i], 0);
        });

        // =====================================
        // 5. 반복해서 넘어갈 페이지 한 장 복제
        // =====================================

        const turningPage = leaves[1].clone(true);

        turningPage.position.copy(leaves[1].position);
        turningPage.position.z = 0.095;
        turningPage.rotation.set(0, restAngles[1], 0);
        turningPage.visible = false;

        memoBook.add(turningPage);

        // =====================================
        // 6. 카메라와 렌더러
        // =====================================

        const bookCamera = new THREE.OrthographicCamera(-4, 4, 2, -2, 0.1, 60);

        bookCamera.position.set(0, 10.5, 6.2);
        bookCamera.lookAt(0, -0.5, 0);

        const bookRenderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        });

        bookRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

        bookRenderer.setClearColor(0xffffff, 0);
        bookRenderer.outputColorSpace = THREE.SRGBColorSpace;
        bookRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        bookRenderer.toneMappingExposure = 0.95;

        bookHost.replaceChildren(bookRenderer.domElement);

        function sizeBook() {
          const width = Math.max(1, bookHost.clientWidth);
          const height = Math.max(1, bookHost.clientHeight);
          const aspect = width / height;

          const halfWidth = Math.max(4.2, 1.95 * aspect);
          const halfHeight = halfWidth / aspect;

          bookCamera.left = -halfWidth;
          bookCamera.right = halfWidth;
          bookCamera.top = halfHeight;
          bookCamera.bottom = -halfHeight;

          bookCamera.updateProjectionMatrix();
          bookRenderer.setSize(width, height, false);
        }

        sizeBook();
        window.addEventListener("resize", sizeBook);

        // =====================================
        // 7. 책 접힘 + 페이지 반복 애니메이션
        // =====================================

        let fold = 0;
        let turnClock = 0;
        let lastTime = 0;

        // 페이지 한 장이 넘어가는 전체 주기
        const TURN_SECONDS = 1.0;

        function animateMemoBook(ms) {
          requestAnimationFrame(animateMemoBook);

          if (document.hidden) {
            lastTime = ms;
            return;
          }

          const dt = lastTime ? Math.min((ms - lastTime) / 1000, 0.05) : 1 / 60;

          lastTime = ms;

          // 사진이 책 위에 올라와 있는지 확인
          const hovered = dropZone.classList.contains("is-over");
          const targetFold = hovered ? 1 : 0;

          // 조금 더 접혔다가 자연스럽게 복귀
          fold += (targetFold - fold) * (1 - Math.exp(-18 * dt));

          leaves.forEach((leaf, i) => {
            leaf.rotation.y = restAngles[i] + (i < 3 ? -0.23 : 0.23) * fold;
          });

          back.rotation.y = -0.1 - 0.045 * fold;

          front.rotation.y = -Math.PI + 0.1 + 0.045 * fold;

          // 책 전체가 아주 조금 들림
          memoBook.position.y = BASE_Y + 0.025 * fold;

          // ===================================
          // 8. 한 장씩 반복해서 넘기기
          // ===================================

          if (hovered) {
            turnClock += dt;

            const phase = (turnClock % TURN_SECONDS) / TURN_SECONDS;

            // 0~0.84초: 페이지 넘어감
            // 0.84~1초: 사라졌다가 처음으로 복귀
            if (phase < 0.84) {
              const p = phase / 0.84;

              const eased = p * p * (3 - 2 * p);

              const from = restAngles[1] - 0.23 * fold;

              const to = -Math.PI + 0.25 + 0.23 * fold;

              turningPage.visible = true;

              turningPage.rotation.y = THREE.MathUtils.lerp(from, to, eased);

              turningPage.rotation.z = 0;
            } else {
              // 넘어간 페이지를 잠깐 숨김
              turningPage.visible = false;
            }
          } else {
            // 사진이 책에서 벗어나면 반복 중단
            turningPage.visible = false;
            turnClock = 0;
          }

          bookRenderer.render(bookScene, bookCamera);
        }

        requestAnimationFrame(animateMemoBook);
      } catch (error) {
        console.error("인화실 메모 책 오류:", error);
      }
    }

    setupMemoDropBook();

    // 메인 화면의 실제 사진 3장은 sketch.js에서 HTML 아크릴 카드로 구현합니다.
    // 여기에는 가짜 빈 폴라로이드 3D 오브젝트를 만들지 않습니다.

    // Independent glass ball + ring, AWAY from the book cover.
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.34, 32, 24),
      clearGlass,
    );
    orb.position.set(-3.3, 2.05, 0.6);
    stage.add(orb);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.56, 0.025, 12, 70),
      metal,
    );
    ring.position.set(-3.6, 2.3, 0.15);
    ring.rotation.set(0.5, 0.4, 0.25);
    stage.add(ring);

    // 6. Responsive placement: don't cover left-hand title
    function resizeScene() {
      const width = mount.clientWidth || window.innerWidth;
      const height = mount.clientHeight || window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);

      if (width < 700) {
        stage.scale.setScalar(0.72);
        stage.position.set(0.38, -0.12, 0);
      } else if (width < 1100) {
        stage.scale.setScalar(0.93);
        stage.position.set(0.55, 0, 0);
      } else {
        stage.scale.setScalar(1.06);
        stage.position.set(0.58, 0, 0);
      }
    }
    resizeScene();
    window.addEventListener("resize", resizeScene);

    renderer.render(scene, camera);
    cover.classList.add("three-ready");

    // 7. Slow, controlled floating/fan motion
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const mobile = window.matchMedia("(pointer: coarse)").matches;
    let lastFrame = 0;

    function animate(ms) {
      requestAnimationFrame(animate);
      if (document.hidden) return;
      if (ms - lastFrame < (mobile ? 33 : 16)) return;
      lastFrame = ms;

      const t = ms * 0.001;
      if (!reduceMotion) {
        heroBook.position.y = BOOK_BASE_Y + Math.sin(t * 0.75) * 0.085;
        heroBook.rotation.x = -0.29 + Math.sin(t * 0.32) * 0.018;
        heroBook.rotation.y = 0.08 + Math.cos(t * 0.3) * 0.03;
        heroBook.rotation.z = 0.08 + Math.sin(t * 0.36) * 0.018;

        orb.position.y = 2.05 + Math.cos(t * 0.68) * 0.1;
        ring.rotation.z = 0.25 + t * 0.04;
      }
      // 길게 이어진 표지-인화실 가로 이동에 맞춰 책이 완전히 펼쳐짐.
      const raw = Number(window.__ctmRoomProgress) || 0;
      const progress = THREE.MathUtils.clamp(raw, 0, 1);
      const coverProgress = THREE.MathUtils.clamp(progress * 1.4, 0, 1);
      const smooth = coverProgress * coverProgress * (3 - 2 * coverProgress);
      pagePivots.forEach((pivot, i) => {
        const local = THREE.MathUtils.clamp(progress * 2.17 - i * 0.1, 0, 1);
        const eased = local * local * (3 - 2 * local);
        const openAngle = -0.22 - i * 0.4;
        pivot.rotation.y =
          THREE.MathUtils.lerp(pivot.userData.baseAngle, openAngle, eased) +
          (reduceMotion
            ? 0
            : Math.sin(t * 0.95 - i * 0.31) * 0.015 * (1 - eased));
        pivot.rotation.z = pivot.userData.baseZ;
      });
      frontPivot.rotation.y =
        THREE.MathUtils.lerp(frontPivot.userData.baseAngle, -2.85, smooth) +
        (reduceMotion ? 0 : Math.sin(t * 0.7) * 0.02 * (1 - smooth));
      renderer.render(scene, camera);
    }
    requestAnimationFrame(animate);
  } catch (error) {
    console.error("glass3d.js 초기화 실패:", error);
    cover.classList.remove("three-ready");
  }
}
