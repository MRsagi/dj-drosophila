/**
 * Low-poly stylized Drosophila DJ on decks — Three.js.
 * Driven by live mixer state (not biology). Funny & readable.
 */

import * as THREE from 'three';

function makeBodyMaterial(color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.35,
    roughness: 0.55,
    metalness: 0.15,
  });
}

function buildFly() {
  const root = new THREE.Group();
  root.name = 'fly';

  // Thorax
  const thorax = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 10, 8),
    makeBodyMaterial(0x3a2a18, 0x221408),
  );
  thorax.scale.set(1.1, 0.85, 1.2);
  root.add(thorax);

  // Abdomen (striped joke)
  const abdomen = new THREE.Group();
  abdomen.position.set(0, -0.05, -0.55);
  const abMat = makeBodyMaterial(0xc9a227, 0x5a4010);
  const abDark = makeBodyMaterial(0x1a1208, 0x0a0804);
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(
      new THREE.SphereGeometry(0.28 - i * 0.03, 8, 6),
      i % 2 === 0 ? abMat : abDark,
    );
    seg.position.z = -i * 0.18;
    seg.scale.set(1, 0.85, 1.1);
    abdomen.add(seg);
  }
  root.add(abdomen);

  // Head
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    makeBodyMaterial(0x2a1c10, 0x150e08),
  );
  head.position.set(0, 0.08, 0.48);
  root.add(head);

  // Compound eyes (big & red — readable gag)
  const eyeGeo = new THREE.SphereGeometry(0.2, 10, 8);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff2244,
    emissive: 0xaa1028,
    emissiveIntensity: 0.7,
    roughness: 0.35,
  });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.22, 0.12, 0.58);
  eyeL.scale.set(1.1, 1.3, 0.9);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.22;
  head.add(eyeL);
  head.add(eyeR);

  // Antennae
  const antMat = makeBodyMaterial(0x111111);
  for (const sx of [-1, 1]) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.35, 5), antMat);
    ant.position.set(sx * 0.12, 0.35, 0.55);
    ant.rotation.z = sx * 0.45;
    ant.rotation.x = -0.5;
    root.add(ant);
  }

  // Wings
  const wingGeo = new THREE.PlaneGeometry(0.7, 0.35);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xaaddee,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.2,
    metalness: 0.1,
    emissive: 0x224455,
    emissiveIntensity: 0.2,
  });
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  wingL.position.set(-0.45, 0.25, 0);
  wingL.rotation.y = 0.4;
  wingL.rotation.z = 0.3;
  const wingR = wingL.clone();
  wingR.position.x = 0.45;
  wingR.rotation.y = -0.4;
  wingR.rotation.z = -0.3;
  root.add(wingL);
  root.add(wingR);

  // Legs (simple sticks)
  const legMat = makeBodyMaterial(0x1a140c);
  const legs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.45, 4), legMat);
      leg.position.set(sx * (0.25 + i * 0.02), -0.35, 0.15 - i * 0.2);
      leg.rotation.z = sx * (0.55 + i * 0.08);
      leg.rotation.x = 0.2 * i;
      legs.add(leg);
    }
  }
  root.add(legs);

  // Tiny headphones (comedy)
  const hpBand = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.03, 6, 16, Math.PI),
    makeBodyMaterial(0x222222, 0x111111),
  );
  hpBand.rotation.x = Math.PI;
  hpBand.position.set(0, 0.28, 0.48);
  const cupL = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), makeBodyMaterial(0x333333, 0x1a1a1a));
  cupL.position.set(-0.3, 0.12, 0.48);
  cupL.scale.set(0.7, 1, 0.8);
  const cupR = cupL.clone();
  cupR.position.x = 0.3;
  root.add(hpBand);
  root.add(cupL);
  root.add(cupR);

  return { root, wingL, wingR, eyeL, eyeR, eyeMat, legs, abdomen, thorax, head };
}

function buildDecks() {
  const group = new THREE.Group();
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 0.18, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x12161e, roughness: 0.7, metalness: 0.3 }),
  );
  table.position.y = -0.55;
  group.add(table);

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x1a2030,
    roughness: 0.4,
    metalness: 0.5,
    emissive: 0x0a1020,
    emissiveIntensity: 0.4,
  });
  const platterMat = new THREE.MeshStandardMaterial({
    color: 0x2a1018,
    emissive: 0x881030,
    emissiveIntensity: 0.5,
    roughness: 0.35,
  });

  function makeDeck(x, color) {
    const d = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 1.0), deckMat);
    const platter = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.05, 24), platterMat.clone());
    platter.material.emissive = new THREE.Color(color);
    platter.position.y = 0.1;
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.04, 0.15),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }),
    );
    label.position.set(0.4, 0.1, 0.35);
    d.add(base, platter, label);
    d.position.set(x, -0.4, 0.1);
    d.userData.platter = platter;
    return d;
  }

  const deckA = makeDeck(-1.15, 0xff4d8d);
  const deckB = makeDeck(1.15, 0x3ee0d0);

  // Mixer in the middle
  const mixer = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.15, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x0e1218, metalness: 0.6, roughness: 0.35 }),
  );
  mixer.position.set(0, -0.38, 0.05);
  const xfKnob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12),
    new THREE.MeshStandardMaterial({ color: 0xe0b44a, emissive: 0x886010, emissiveIntensity: 0.7 }),
  );
  xfKnob.position.set(0, -0.28, 0.25);
  group.add(deckA, deckB, mixer, xfKnob);

  return { group, deckA, deckB, xfKnob };
}

function buildClubRoom() {
  const group = new THREE.Group();
  // Floor
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 32),
    new THREE.MeshStandardMaterial({ color: 0x080a10, roughness: 0.85, metalness: 0.2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.65;
  group.add(floor);

  // Back wall glow strips
  for (let i = -3; i <= 3; i++) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2.2, 0.08),
      new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0xff4d8d : 0x3ee0d0,
        emissive: i % 2 === 0 ? 0xff4d8d : 0x3ee0d0,
        emissiveIntensity: 0.9,
      }),
    );
    strip.position.set(i * 0.7, 0.5, -2.2);
    group.add(strip);
  }

  // Disco-ish point (subtle)
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.25, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x88aaff,
      emissiveIntensity: 0.8,
      metalness: 0.9,
      roughness: 0.2,
    }),
  );
  orb.position.set(0, 2.2, -0.5);
  group.add(orb);

  return { group, orb, floor };
}

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createFlyDJ(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05060a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05060a, 0.045);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);
  camera.position.set(0, 1.35, 4.2);
  camera.lookAt(0, 0.15, 0);

  const hemi = new THREE.HemisphereLight(0x446688, 0x110808, 0.7);
  scene.add(hemi);
  const key = new THREE.PointLight(0xffaa66, 40, 12);
  key.position.set(2, 3, 2);
  scene.add(key);
  const fill = new THREE.PointLight(0x44aaff, 25, 10);
  fill.position.set(-2.5, 2, 1);
  scene.add(fill);
  const rim = new THREE.PointLight(0xff4d8d, 18, 8);
  rim.position.set(0, 1.5, -2);
  scene.add(rim);

  const room = buildClubRoom();
  scene.add(room.group);
  const decks = buildDecks();
  scene.add(decks.group);
  const fly = buildFly();
  fly.root.position.set(0, 0.15, 0.35);
  fly.root.scale.setScalar(0.85);
  scene.add(fly.root);

  // Spot on the fly
  const spot = new THREE.SpotLight(0xffe0a0, 60, 10, 0.45, 0.4, 1);
  spot.position.set(0, 3.5, 2);
  spot.target = fly.root;
  scene.add(spot);
  scene.add(spot.target);

  let jumpUntil = 0;
  let jumpVel = 0;
  let baseY = 0.15;
  let lean = 0;
  let bounce = 0;
  let glow = 0;
  let wingPhase = 0;
  let lastSkipAt = -10;
  let disposed = false;

  function resize() {
    const w = canvas.clientWidth || canvas.width || 800;
    const h = canvas.clientHeight || canvas.height || 420;
    const rw = Math.max(1, Math.floor(w));
    const rh = Math.max(1, Math.floor(h));
    renderer.setSize(rw, rh, false);
    camera.aspect = rw / rh;
    camera.updateProjectionMatrix();
  }

  /**
   * Drive from mixer / set-engine state.
   * PLAYING: lean hard left/right (edge). TRANSITION: animate across with xfader.
   * @param {{ xfader: number, volume: number, bass?: number, kick?: number, skipEvent?: object|null, now?: number, running?: boolean, setState?: string, activeEdge?: number }} state
   */
  function update(state) {
    if (disposed) return;
    const xf = state.xfader ?? 0;
    const vol = state.volume ?? 0.6;
    const bass = state.bass ?? 0;
    const kick = state.kick ?? 0;
    const now = state.now ?? performance.now() / 1000;
    const dt = 1 / 60;
    const setState = state.setState;
    const edge = state.activeEdge;

    // Crossfader / set-engine → body lean
    let leanTarget = xf * 0.55;
    let leanRate = 0.06;
    if (setState === 'PLAYING' || setState === 'INTRO') {
      // Hard park toward active edge — no mid-blend bobbing
      const e = edge != null ? edge : (xf <= 0 ? -1 : 1);
      leanTarget = e * 0.72;
      leanRate = 0.1;
    } else if (setState === 'TRANSITION') {
      leanTarget = xf * 0.65;
      leanRate = 0.12; // follow the blend across
    }
    lean += (leanTarget - lean) * leanRate;
    fly.root.rotation.y = lean * 0.9;
    fly.root.rotation.z = -lean * 0.35;
    fly.root.position.x += (lean * 0.45 - fly.root.position.x) * 0.12;

    // Master → bounce + glow
    bounce = vol * (0.04 + kick * 0.12);
    glow += ((vol * 0.8 + bass * 0.5) - glow) * 0.15;
    fly.eyeMat.emissiveIntensity = 0.5 + glow * 1.2;
    spot.intensity = 40 + glow * 50;
    key.intensity = 30 + glow * 25;

    // Bass → wing / leg pulse
    wingPhase += (0.4 + bass * 8 + kick * 4) * dt * 60;
    const flap = Math.sin(wingPhase) * (0.25 + bass * 0.5);
    fly.wingL.rotation.z = 0.3 + flap;
    fly.wingR.rotation.z = -0.3 - flap;
    fly.wingL.rotation.x = flap * 0.3;
    fly.wingR.rotation.x = flap * 0.3;
    fly.legs.scale.y = 1 + bass * 0.08;

    // Skip / GF → jump / escape gag
    if (state.skipEvent && state.skipEvent.at !== lastSkipAt) {
      lastSkipAt = state.skipEvent.at;
      jumpVel = 0.09;
      jumpUntil = now + 0.85;
    }
    if (now < jumpUntil) {
      fly.root.position.y += jumpVel;
      jumpVel -= 0.006;
      fly.root.rotation.x = -0.4;
      // Escape tumble
      fly.root.rotation.z += (state.skipEvent?.to === 'B' ? 0.08 : -0.08);
    } else {
      const targetY = baseY + Math.sin(now * 6) * bounce;
      fly.root.position.y += (targetY - fly.root.position.y) * 0.2;
      fly.root.rotation.x += (0 - fly.root.rotation.x) * 0.1;
    }

    // Platters spin with energy
    const spin = (0.04 + vol * 0.12 + kick * 0.08) * (state.running ? 1 : 0.02);
    decks.deckA.userData.platter.rotation.y += spin * (1 - Math.max(0, xf));
    decks.deckB.userData.platter.rotation.y += spin * (1 + Math.min(0, xf) * -1 + Math.max(0, xf));
    decks.xfKnob.position.x += (xf * 0.22 - decks.xfKnob.position.x) * 0.08;

    room.orb.rotation.y += 0.01;
    room.orb.rotation.x += 0.006;
  }

  function render() {
    if (disposed) return;
    renderer.render(scene, camera);
  }

  function dispose() {
    disposed = true;
    renderer.dispose();
  }

  resize();

  return { update, render, resize, dispose, scene, camera, renderer };
}
