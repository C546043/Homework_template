import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const mount = document.getElementById("three-glass-scene");
const cover = document.getElementById("cover");

if (mount && cover) {
  try {
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 12.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    mount.appendChild(renderer.domElement);

    // ===== Environment =====
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;

    // ===== Lights =====
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-4, 5, 8);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xdfe9ff, 1.35);
    fill.position.set(5, -2, 5);
    scene.add(fill);

    const bluePoint = new THREE.PointLight(0x6b96ff, 20, 30);
    bluePoint.position.set(3, 1.8, 5);
    scene.add(bluePoint);

    const softPoint = new THREE.PointLight(0xffffff, 12, 30);
    softPoint.position.set(-2.8, 3, 6);
    scene.add(softPoint);

    // ===== Materials =====
    const clearGlass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.03,
      transmission: 1.0,
      thickness: 1.15,
      ior: 1.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.5,
    });

    const blueGlass = new THREE.MeshPhysicalMaterial({
      color: 0xdfe9ff,
      metalness: 0,
      roughness: 0.06,
      transmission: 1.0,
      thickness: 1.35,
      ior: 1.48,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.55,
    });

    const frostedGlass = new THREE.MeshPhysicalMaterial({
      color: 0xf5f8ff,
      metalness: 0,
      roughness: 0.18,
      transmission: 0.95,
      thickness: 0.25,
      ior: 1.45,
      clearcoat: 0.6,
      envMapIntensity: 1.25,
    });

    const cobalt = new THREE.MeshPhysicalMaterial({
      color: 0x2358ff,
      metalness: 0.08,
      roughness: 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });

    const paperMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
    });

    const silver = new THREE.MeshStandardMaterial({
      color: 0xe6ecfa,
      metalness: 0.72,
      roughness: 0.16,
    });

    // ===== Main stage =====
    const stage = new THREE.Group();
    scene.add(stage);

    // -------------------------------------
    // Decorative glass panels (reference #2 느낌)
    // -------------------------------------
    function makeGlassPanel(w, h, t, material) {
      const mesh = new THREE.Mesh(
        new RoundedBoxGeometry(w, h, t, 6, 0.05),
        material,
      );
      return mesh;
    }

    const panelA = makeGlassPanel(2.4, 4.2, 0.05, blueGlass);
    panelA.position.set(0.8, 0.2, -1.8);
    panelA.rotation.set(0.05, -0.35, -0.04);
    stage.add(panelA);

    const panelB = makeGlassPanel(2.3, 3.8, 0.05, clearGlass);
    panelB.position.set(1.9, 0.4, -1.0);
    panelB.rotation.set(0.03, -0.18, 0.02);
    stage.add(panelB);

    const panelC = makeGlassPanel(1.8, 3.1, 0.05, frostedGlass);
    panelC.position.set(2.8, -0.15, -0.2);
    panelC.rotation.set(0.0, -0.08, 0.03);
    stage.add(panelC);

    // -------------------------------------
    // Big hero book
    // -------------------------------------
    const bookRoot = new THREE.Group();
    stage.add(bookRoot);

    const pagePivots = [];
    const floatingPolaroids = [];

    function createBook() {
      const g = new THREE.Group();

      // 뒤표지
      const backCover = new THREE.Mesh(
        new RoundedBoxGeometry(2.35, 3.25, 0.11, 6, 0.06),
        blueGlass,
      );
      backCover.position.set(0.12, 0, -0.18);
      backCover.rotation.y = 0.18;
      g.add(backCover);

      // 책등
      const spine = new THREE.Mesh(
        new RoundedBoxGeometry(0.2, 3.35, 0.24, 5, 0.04),
        cobalt,
      );
      spine.position.set(-1.08, 0, -0.03);
      g.add(spine);

      // 페이지 여러 장
      const pageCount = 7;

      for (let i = 0; i < pageCount; i++) {
        const pivot = new THREE.Group();
        pivot.position.set(-1.02, 0, -0.02 + i * 0.008);

        const page = new THREE.Mesh(
          new RoundedBoxGeometry(2.14, 3.02, 0.03, 4, 0.03),
          paperMat,
        );
        page.position.x = 1.06;
        page.position.z = i * 0.01;

        const pageGlass = new THREE.Mesh(
          new RoundedBoxGeometry(2.16, 3.04, 0.012, 4, 0.02),
          i % 2 === 0 ? clearGlass : frostedGlass,
        );
        pageGlass.position.x = 1.06;
        pageGlass.position.z = 0.03 + i * 0.01;

        pivot.add(page);
        pivot.add(pageGlass);

        const baseOpen = -0.45 - i * 0.18;
        pivot.rotation.y = baseOpen;
        pivot.rotation.z = 0.03 + i * 0.015;
        pivot.userData.baseOpen = baseOpen;
        pivot.userData.index = i;

        g.add(pivot);
        pagePivots.push(pivot);
      }

      // 앞표지
      const frontPivot = new THREE.Group();
      frontPivot.position.set(-1.02, 0, 0.12);

      const frontCover = new THREE.Mesh(
        new RoundedBoxGeometry(2.38, 3.28, 0.12, 6, 0.06),
        blueGlass,
      );
      frontCover.position.x = 1.18;

      const frontFrame = new THREE.Mesh(
        new THREE.TorusGeometry(0.52, 0.018, 8, 80),
        silver,
      );
      frontFrame.position.set(0.82, 0.52, 0.12);

      const miniDisc = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 32, 24),
        clearGlass,
      );
      miniDisc.position.set(1.52, -0.72, 0.08);

      frontPivot.add(frontCover, frontFrame, miniDisc);
      frontPivot.rotation.y = -1.72;
      frontPivot.rotation.z = 0.12;
      frontPivot.userData.baseOpen = -1.72;

      g.add(frontPivot);
      g.userData.frontPivot = frontPivot;

      return g;
    }

    const heroBook = createBook();
    heroBook.position.set(0.6, 0.1, 0.2);
    heroBook.rotation.set(-0.08, -0.22, -0.12);
    heroBook.scale.set(1.6, 1.6, 1.6);
    bookRoot.add(heroBook);

    // -------------------------------------
    // Polaroid textures
    // -------------------------------------
    function makePhotoTexture(topColor, bottomColor, label = "") {
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 512;
      const ctx = c.getContext("2d");

      const g = ctx.createLinearGradient(0, 0, 512, 512);
      g.addColorStop(0, topColor);
      g.addColorStop(1, bottomColor);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 512);

      ctx.fillStyle = "rgba(255,255,255,0.42)";
      ctx.fillRect(38, 42, 436, 220);

      ctx.fillStyle = "rgba(34,67,188,0.11)";
      ctx.fillRect(68, 298, 160, 88);

      ctx.fillStyle = "rgba(80,120,220,0.14)";
      ctx.beginPath();
      ctx.arc(372, 158, 72, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(15,35,90,0.65)";
      ctx.font = "bold 28px sans-serif";
      if (label) ctx.fillText(label, 48, 474);

      const texture = new THREE.CanvasTexture(c);
      texture.needsUpdate = true;
      return texture;
    }

    function createPolaroid(label, colors) {
      const group = new THREE.Group();

      const frame = new THREE.Mesh(
        new RoundedBoxGeometry(1.15, 1.38, 0.06, 5, 0.05),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.92,
          metalness: 0,
        }),
      );

      const photo = new THREE.Mesh(
        new THREE.PlaneGeometry(0.92, 0.9),
        new THREE.MeshBasicMaterial({
          map: makePhotoTexture(colors[0], colors[1], label),
        }),
      );
      photo.position.set(0, 0.08, 0.04);

      const clip = new THREE.Mesh(
        new RoundedBoxGeometry(0.18, 0.28, 0.05, 4, 0.04),
        clearGlass,
      );
      clip.position.set(0, 0.82, 0.06);

      group.add(frame, photo, clip);
      return group;
    }

    const polaroid1 = createPolaroid("MEMO 01", ["#dce7ff", "#ffffff"]);
    polaroid1.position.set(-3.4, -1.0, 0.8);
    polaroid1.rotation.set(-0.22, 0.35, -0.32);
    stage.add(polaroid1);
    floatingPolaroids.push(polaroid1);

    const polaroid2 = createPolaroid("MEMO 02", ["#edf3ff", "#d5e3ff"]);
    polaroid2.position.set(3.4, 1.35, 1.0);
    polaroid2.rotation.set(0.08, -0.28, 0.22);
    stage.add(polaroid2);
    floatingPolaroids.push(polaroid2);

    const polaroid3 = createPolaroid("MEMO 03", ["#ffffff", "#ebf2ff"]);
    polaroid3.position.set(2.8, -2.0, 0.9);
    polaroid3.rotation.set(0.18, -0.2, -0.16);
    stage.add(polaroid3);
    floatingPolaroids.push(polaroid3);

    // -------------------------------------
    // Extra glass sphere / ring accents
    // -------------------------------------
    const orb1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.52, 40, 28),
      clearGlass,
    );
    orb1.position.set(-2.2, 1.9, 1.4);
    stage.add(orb1);

    const orb2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 40, 24),
      clearGlass,
    );
    orb2.position.set(3.2, 2.25, 1.6);
    stage.add(orb2);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.65, 0.045, 18, 80),
      clearGlass,
    );
    ring.position.set(-2.8, 2.25, 0.9);
    ring.rotation.set(0.9, 0.3, 0.45);
    stage.add(ring);

    // -------------------------------------
    // Resize
    // -------------------------------------
    function resizeScene() {
      const width = mount.clientWidth || window.innerWidth;
      const height = mount.clientHeight || window.innerHeight;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);

      if (width < 700) {
        stage.scale.setScalar(0.78);
        stage.position.set(0.55, -0.15, 0);
      } else if (width < 1100) {
        stage.scale.setScalar(1.0);
        stage.position.set(1.25, 0, 0);
      } else {
        stage.scale.setScalar(1.16);
        stage.position.set(2.05, 0.1, 0);
      }
    }

    resizeScene();
    window.addEventListener("resize", resizeScene);

    renderer.render(scene, camera);
    cover.classList.add("three-ready");

    // -------------------------------------
    // Animation
    // -------------------------------------
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    let lastRender = 0;

    function animate(time) {
      requestAnimationFrame(animate);

      if (document.hidden) return;

      const interval = coarsePointer ? 33 : 16;
      if (time - lastRender < interval) return;
      lastRender = time;

      const t = time * 0.001;

      if (!reduceMotion) {
        // 전체 스테이지의 큰 호흡
        stage.rotation.y = Math.sin(t * 0.24) * 0.08;
        stage.rotation.x = Math.cos(t * 0.22) * 0.03;

        // 책 자체가 둥둥
        heroBook.position.y = 0.1 + Math.sin(t * 0.9) * 0.12;
        heroBook.rotation.z = -0.12 + Math.sin(t * 0.48) * 0.03;
        heroBook.rotation.y = -0.22 + Math.cos(t * 0.35) * 0.07;

        // 촤라락 펼쳐지는 페이지
        pagePivots.forEach((pivot, i) => {
          const spread =
            Math.sin(t * 1.3 - i * 0.18) * 0.045 +
            Math.sin(t * 0.55 + i * 0.3) * 0.02;
          pivot.rotation.y = pivot.userData.baseOpen + spread;
          pivot.rotation.z =
            0.03 + i * 0.015 + Math.sin(t * 0.8 + i * 0.22) * 0.008;
        });

        // 앞표지가 살짝 함께 움직임
        heroBook.userData = heroBook.userData || {};
        const frontPivot = heroBook.children.find(
          (ch) =>
            ch.userData &&
            ch.userData.baseOpen !== undefined &&
            ch.children.length >= 3,
        );
        if (frontPivot) {
          frontPivot.rotation.y =
            frontPivot.userData.baseOpen + Math.sin(t * 1.1) * 0.04;
          frontPivot.rotation.z = 0.12 + Math.cos(t * 0.9) * 0.01;
        }

        // 패널의 느린 움직임
        panelA.rotation.y = -0.35 + Math.sin(t * 0.32) * 0.05;
        panelB.rotation.y = -0.18 + Math.cos(t * 0.27) * 0.04;
        panelC.rotation.y = -0.08 + Math.sin(t * 0.23) * 0.03;

        // 폴라로이드 떠다니기
        floatingPolaroids.forEach((p, i) => {
          const offset = i * 0.8;
          p.position.y += Math.sin(t * 0.001 + offset) * 0.0; // 안정성용
          p.position.y =
            [-1.0, 1.35, -2.0][i] + Math.sin(t * 0.9 + offset) * 0.16;
          p.rotation.z += 0;
          if (i === 0) {
            p.rotation.z = -0.32 + Math.sin(t * 0.7) * 0.08;
            p.rotation.y = 0.35 + Math.cos(t * 0.6) * 0.08;
          } else if (i === 1) {
            p.rotation.z = 0.22 + Math.sin(t * 0.62 + 1) * 0.06;
            p.rotation.y = -0.28 + Math.cos(t * 0.53 + 1) * 0.08;
          } else {
            p.rotation.z = -0.16 + Math.cos(t * 0.72 + 2) * 0.06;
            p.rotation.y = -0.2 + Math.sin(t * 0.59 + 2) * 0.08;
          }
        });

        orb1.position.y = 1.9 + Math.sin(t * 0.82) * 0.14;
        orb2.position.y = 2.25 + Math.cos(t * 0.9) * 0.11;
        ring.rotation.z = 0.45 + t * 0.12;
      }

      renderer.render(scene, camera);
    }

    requestAnimationFrame(animate);
  } catch (err) {
    console.error("Three scene init failed:", err);
    cover.classList.remove("three-ready");
  }
}
