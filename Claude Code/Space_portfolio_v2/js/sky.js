// The WebGL backdrop: a night launch, Earth orbit, then deep space, plus one lit planet
// per project card. Exposes window.__sky(state); js/main.js calls it once per frame.
// Events: 'sky-ready' once the scene can render, 'sky-loaded' once the Earth textures are in.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = innerWidth < 760;
const sat = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
const rand = (a, b) => a + Math.random() * (b - a);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('sky'), antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  document.body.classList.add('no-webgl');
  dispatchEvent(new Event('sky-loaded'));
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // 2x costs ~80% more pixels per frame for little visible gain on a starfield
renderer.setSize(innerWidth, innerHeight);
renderer.autoClear = false;

/* ---------- sky gradient + ground ridge (fullscreen quad) ---------- */
const NEAR = [new THREE.Color('#04060e'), new THREE.Color('#101c3d')];
const FAR = [new THREE.Color('#020309'), new THREE.Color('#070a18')];
const skyU = { uTop: { value: NEAR[0].clone() }, uBot: { value: NEAR[1].clone() }, uGround: { value: 1 } };
const bgScene = new THREE.Scene(), bgCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: skyU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `
    uniform vec3 uTop, uBot; uniform float uGround; varying vec2 vUv;
    void main() {
      vec3 col = mix(uBot, uTop, pow(vUv.y, .8));
      col += uGround * vec3(.32, .46, .85) * (1. - smoothstep(0., .7, distance(vUv, vec2(.5, -.02)))) * .3;  // city glow on the horizon
      float ridge = (.05 + .028 * sin(vUv.x * 6. + .5) + .016 * sin(vUv.x * 13. + 2.) + .009 * sin(vUv.x * 27. + 4.)) * uGround;
      col = mix(col, vec3(.008, .012, .026), (1. - smoothstep(ridge - .004, ridge, vUv.y)) * uGround);
      gl_FragColor = vec4(col, 1.);
      #include <colorspace_fragment>
    }`
})));

/* ---------- main scene ---------- */
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1, 6000);
const KEY = new THREE.Vector3(-1, .9, .8).normalize();
scene.add(new THREE.AmbientLight(0x8fb4ff, .75));
const key = new THREE.DirectionalLight(0xffffff, 3); key.position.copy(KEY); scene.add(key);
const rim = new THREE.DirectionalLight(0x8fcaff, 1.1); rim.position.set(1, -.3, -.6); scene.add(rim);

function discTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#fff'); g.addColorStop(.25, 'rgba(255,255,255,.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const disc = discTexture();
const glow = (color, opacity = 0) => new THREE.SpriteMaterial({ map: disc, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });

/* ---------- planet shader: terran / rocky / gas, coloured by 3D noise on the sphere ----------
   Noise is evaluated per fragment in object space, so the surface turns with the mesh and stays
   sharp at any size, with no texture to build on the main thread. */
const NOISE = `
  float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float v = 0., a = .5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= .5; } return v; }`;

const MODES = { terran: 0, rocky: 1, gas: 2 };
function planetMaterial(s) {
  const c = s.colors.map(h => new THREE.Color(h));
  while (c.length < 4) c.push(c[c.length - 1]);
  const storm = s.storm ? new THREE.Vector4(...new THREE.Vector3(...s.storm.at).normalize().toArray(), s.storm.r) : new THREE.Vector4(0, 1, 0, 0);
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uC0: { value: c[0] }, uC1: { value: c[1] }, uC2: { value: c[2] }, uC3: { value: c[3] },
      uMode: { value: MODES[s.mode] }, uScale: { value: s.scale || 2.2 }, uSeed: { value: s.seed || 0 },
      uBands: { value: s.bands || 18 }, uStorm: { value: storm }, uCaps: { value: s.caps ?? 1.1 },
      uClouds: { value: s.clouds || 0 }, uLight: { value: (s.light || KEY).clone() }, uAmbient: { value: s.ambient ?? .18 },
      uAtmo: { value: new THREE.Color(s.atmo || '#8fcaff') }, uOpacity: { value: s.opacity ?? 1 }, uTime: { value: 0 }
    },
    vertexShader: `
      varying vec3 vPos, vN, vViewN, vViewPos;
      void main() {
        vPos = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vViewN = normalMatrix * normal;
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uC0, uC1, uC2, uC3, uLight, uAtmo; uniform vec4 uStorm;
      uniform float uMode, uScale, uSeed, uBands, uCaps, uClouds, uAmbient, uOpacity, uTime;
      varying vec3 vPos, vN, vViewN, vViewPos;
      ${NOISE}
      void main() {
        vec3 n = normalize(vPos), p = n * uScale + uSeed;
        float lat = n.y, h = fbm(p);
        vec3 col;
        if (uMode < .5) {            // terran: ocean, land, ice, clouds
          vec3 sea = mix(uC0, uC1, smoothstep(.3, .52, h));
          vec3 land = mix(uC2, uC3, smoothstep(.45, .7, fbm(p * 2.3 + 7.)));
          col = mix(sea, land, smoothstep(.52, .56, h));
          col = mix(col, vec3(.92, .95, .98), smoothstep(.94, .99, abs(lat)));
          float cl = smoothstep(.52, .74, fbm(p * 1.7 + vec3(uTime * .01, 0., 0.) + 31.));
          col = mix(col, vec3(1.), cl * uClouds);
        } else if (uMode < 1.5) {    // rocky: mottled crust, dark maria, pits
          col = mix(uC0, uC1, smoothstep(.25, .75, h));
          col = mix(col, uC2, smoothstep(.55, .7, fbm(p * 3.1 + 5.)) * .75);
          col *= 1. - smoothstep(.74, .8, noise(p * 7.)) * .55;
        } else {                     // gas: warped latitude belts and a storm
          float w = (fbm(p * 1.2) - .5) * .5;
          col = mix(uC0, uC1, sin((lat + w) * uBands) * .5 + .5);
          col = mix(col, uC2, smoothstep(.55, 1., sin((lat + w) * uBands * .37 + 1.3) * .5 + .5) * .6);
          if (uStorm.w > 0.) col = mix(col, uC3, (1. - smoothstep(0., uStorm.w, distance(n, uStorm.xyz))) * .85);
        }
        if (uCaps < 1.) col = mix(col, vec3(1.), smoothstep(uCaps, 1., abs(lat)));
        float d = dot(normalize(vN), uLight);
        vec3 V = isOrthographic ? vec3(0., 0., 1.) : normalize(-vViewPos);  // per-pixel view direction
        float vFres = 1. - abs(dot(normalize(vViewN), V));
        vec3 lit = col * (uAmbient + smoothstep(-.15, 1., d) * .92) + uAtmo * pow(vFres, 3.) * (.25 + .6 * max(d + .3, 0.));
        gl_FragColor = vec4(lit, uOpacity);
        #include <colorspace_fragment>
      }`
  });
}

function ringMaterial(hex, opacity = .75) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(hex) }, uOpacity: { value: opacity } },
    vertexShader: 'varying float vR; void main(){ vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; varying float vR;
      void main() {
        float t = (vR - 1.42) / .73;                                        // 0 inner edge, 1 outer edge
        float gap = step(.16, abs(sin(t * 9.1))) * step(.02, abs(t - .63)); // ring divisions
        float a = mix(.05, .3 + .45 * abs(sin(t * 23.)), gap) * smoothstep(0., .04, t) * (1. - smoothstep(.96, 1., t));
        gl_FragColor = vec4(uColor, a * uOpacity);
        #include <colorspace_fragment>
      }`
  });
}

function makeRing(hex, opacity) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.42, 2.15, 128, 1), ringMaterial(hex, opacity));
  ring.rotation.x = Math.PI / 2 - .34;
  return ring;
}

/* ---------- starfield, dust, nebulae ---------- */
const STARS = mobile ? 2600 : 7000, DEPTH = 3000;
const starPos = new Float32Array(STARS * 3), starCol = new Float32Array(STARS * 3), tint = new THREE.Color();
for (let i = 0; i < STARS; i++) {
  const r = rand(140, 1240), a = rand(0, Math.PI * 2);
  starPos.set([Math.cos(a) * r, Math.sin(a) * r * .8, -rand(0, DEPTH)], i * 3);
  const roll = Math.random();
  tint.set(roll > .86 ? '#8fcaff' : roll > .78 ? '#ffd9b8' : '#ffffff').toArray(starCol, i * 3);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
const starMat = new THREE.PointsMaterial({ size: 5, map: disc, vertexColors: true, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending });
scene.add(new THREE.Points(starGeo, starMat));

const DUST = mobile ? 260 : 600, dustPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) dustPos.set([rand(-450, 450), rand(-350, 350), -rand(0, 900)], i * 3);
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ size: 2.4, map: disc, color: 0xbcd8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

const nebulae = ['#3b86ff', '#7c5cff', '#2f6fe0', '#ff9ec7', '#5aa6ff'].map((hex, i) => {
  const s = new THREE.Sprite(glow(hex));
  const size = rand(600, 1400);
  s.scale.set(size, size, 1);
  s.position.set(rand(-650, 650), rand(-400, 400), -600 - i * 400);
  s.userData.drift = rand(.15, .5);
  scene.add(s);
  return s;
});

/* ---------- Earth and Moon ---------- */
/* NASA imagery (public domain): Blue Marble NG for the surface, Black Marble 2016 for city lights,
   Blue Marble clouds; the ocean mask is derived from the surface map (see docs). */
let earthReady = false, earthDone;
const earthLoaded = new Promise(resolve => { earthDone = resolve; }), earthTextures = [];
// onLoad also fires after a failed item, so a missing texture never holds the launch
const texLoader = new THREE.TextureLoader(new THREE.LoadingManager(() => earthDone()));
const tex = (file, srgb) => {
  const t = texLoader.load('assets/earth/' + file);
  earthTextures.push(t);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
};
const SUN = new THREE.Vector3(-1, .6, -.2).normalize(); // lights the left of the limb, puts dusk over East Asia
const earthMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: {
    uDay: { value: tex(mobile ? 'day-2k.webp' : 'day-4k.webp', true) }, uNight: { value: tex('night-2k.webp', true) },
    uClouds: { value: tex('clouds-2k.webp') }, uWater: { value: tex('water-1k.webp') },
    uSun: { value: SUN }, uOpacity: { value: 0 }, uCloudShift: { value: 0 }
  },
  vertexShader: `
    varying vec2 vUv; varying vec3 vN, vW;
    void main() {
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform sampler2D uDay, uNight, uClouds, uWater; uniform vec3 uSun; uniform float uOpacity, uCloudShift;
    varying vec2 vUv; varying vec3 vN, vW;
    void main() {
      vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
      float d = dot(N, uSun), lit = max(d, 0.), day = smoothstep(-.1, .25, d);
      float cloud = texture2D(uClouds, vUv + vec2(uCloudShift, 0.)).r;
      cloud = smoothstep(.08, .9, cloud);
      vec3 col = texture2D(uDay, vUv).rgb * (.015 + 1.25 * lit);
      // sun glint on open water only
      float glint = pow(max(dot(N, normalize(uSun + V)), 0.), 70.) * texture2D(uWater, vUv).r * (1. - cloud);
      col += vec3(1., .93, .8) * glint * .85 * day;
      col = mix(col, vec3(.95) * (.01 + 1.0 * lit), cloud * .85);
      // city lights on the night side, dimmed under cloud
      vec3 night = texture2D(uNight, vUv).rgb;
      col += night * smoothstep(.12, .45, dot(night, vec3(.3, .6, .1))) * vec3(1., .78, .5) * 2.2 * (1. - day) * (1. - cloud * .85);
      // haze thickening toward the limb, blue on the day side, warm at the terminator
      float rim = pow(1. - max(dot(N, V), 0.), 3.);
      vec3 haze = mix(vec3(1., .55, .3), vec3(.35, .6, 1.), smoothstep(-.05, .35, d));
      col = mix(col, haze * (.15 + .9 * smoothstep(-.25, .6, d)), rim * .75);
      gl_FragColor = vec4(col, uOpacity);
      #include <colorspace_fragment>
    }`
});
const earth = new THREE.Mesh(new THREE.SphereGeometry(900, 192, 128), earthMat);
// turn India (lon 78E, lat 22N) toward the visible limb, just under the hero name:
// spin it to face the camera, then tip the pole away so it sits near the horizon
earth.rotation.set(THREE.MathUtils.degToRad(-76), -(Math.PI / 2 + THREE.MathUtils.degToRad(78)), 0);
scene.add(earth);

// atmosphere: a slightly larger back-face shell that glows just outside the limb
const atmoMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
  uniforms: { uSun: { value: SUN }, uOpacity: { value: 0 } },
  vertexShader: 'varying vec3 vN, vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `
    uniform vec3 uSun; uniform float uOpacity; varying vec3 vN, vW;
    void main() {
      vec3 N = normalize(vN);
      float edge = clamp(-dot(N, normalize(cameraPosition - vW)) / .22, 0., 1.); // 1 at the planet's limb, 0 at the shell's edge
      float a = pow(edge, 2.2) * (.15 + .85 * smoothstep(-.3, .5, dot(N, uSun)));
      gl_FragColor = vec4(vec3(.32, .58, 1.) * a * 1.4 * uOpacity, 1.);
      #include <colorspace_fragment>
    }`
});
const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(900 * 1.025, 128, 96), atmoMat);
atmosphere.renderOrder = 1; // after the Earth, so the Earth's depth hides the shell's far side
scene.add(atmosphere);
const moonMat = planetMaterial({ mode: 'rocky', colors: ['#5d6474', '#a9b2c4', '#3e4452'], scale: 3, seed: 11, opacity: 0, atmo: '#000000' });
const moon = new THREE.Mesh(new THREE.SphereGeometry(58, 40, 28), moonMat);
scene.add(moon);

/* ---------- satellites ---------- */
const satellites = [.5, .34, .62].map(scale => {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xd7e2f5, roughness: .4, metalness: .6, transparent: true, opacity: 0 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1e3f8f, roughness: .3, metalness: .5, transparent: true, opacity: 0 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(14, 14, 20), body));
  for (const s of [-1, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(30, .8, 13), panel); m.position.x = s * 23; g.add(m); }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), body);
  dish.position.y = 9; dish.rotation.x = -.5; g.add(dish);
  g.scale.setScalar(scale);
  g.userData.mats = [body, panel];
  scene.add(g);
  return g;
});

/* ---------- the payload: the Roadster with Starman at the wheel ----------
   A nod to the 2018 Falcon Heavy test flight. The car is "2011 Tesla Roadster 2.5 Sport" by Ddiaz Design
   (CC BY-NC-SA 4.0), made open-top (roof, side glass and roof trim removed) and compressed: assets/models/.
   Starman is drawn here. It appears once the rocket has climbed away and tumbles slowly above the Earth. */
const roadster = new THREE.Group();
roadster.rotation.set(.35, -.7, .15); // start in a three-quarter view
scene.add(roadster);
let carReady = false;

// reflections for the paint: black space, the blue Earth below, a hard sun
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, uniforms: { uSun: { value: SUN } },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `
    uniform vec3 uSun; varying vec3 vD;
    void main() {
      vec3 d = normalize(vD);
      vec3 c = vec3(.004, .006, .015)
             + vec3(.1, .28, .7) * (1. - smoothstep(-.6, .05, d.y))   // Earth below
             + vec3(.5, .7, 1.) * pow(1. - abs(d.y), 14.) * .2         // the bright limb at the horizon
             + vec3(1., .97, .9) * pow(max(dot(d, uSun), 0.), 500.) * 14.; // brighter and the paint blooms into a red haze
      gl_FragColor = vec4(c, 1.);
    }`
})));
const carEnv = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0).texture;

const carLoaded = new Promise(resolve => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load('assets/models/roadster.glb', gltf => {
  const model = gltf.scene; // metres, y up, nose toward +z, as authored

  // Starman in the left-hand driver's seat (model units): torso, helmet, visor, a hand on the wheel, an arm on the door
  const suit = new THREE.MeshStandardMaterial({ color: 0xd9dde4, roughness: .7 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x1a1408, roughness: .1, metalness: .9 });
  const hip = new THREE.Vector3(.33, .14, -.15), up = new THREE.Vector3(0, 1, 0);
  const part = (geo, m, at) => { const mesh = new THREE.Mesh(geo, m); mesh.position.copy(at); model.add(mesh); return mesh; };
  const limb = (a, b, r) => {
    const d = b.clone().sub(a), len = d.length();
    part(new THREE.CapsuleGeometry(r, Math.max(.01, len - 2 * r), 4, 10), suit, a.clone().add(b).multiplyScalar(.5))
      .quaternion.setFromUnitVectors(up, d.normalize());
  };
  const neck = hip.clone().add(new THREE.Vector3(0, .62, -.17));
  limb(hip, neck, .2);                                                                   // torso, leaning back into the seat
  const head = neck.clone().add(new THREE.Vector3(0, .2, -.02));
  part(new THREE.SphereGeometry(.17, 24, 16), suit, head);                               // helmet
  part(new THREE.SphereGeometry(.176, 24, 12, Math.PI / 2 - .9, 1.8, .95, 1.05), visor, head); // visor, facing forward
  const shoulderL = neck.clone().add(new THREE.Vector3(.2, -.08, 0)), shoulderR = neck.clone().add(new THREE.Vector3(-.2, -.08, 0));
  limb(shoulderL, new THREE.Vector3(.86, .6, -.05), .065);                                // arm resting on the door
  limb(shoulderR, new THREE.Vector3(.36, .52, .32), .065);                                // hand on the wheel

  const seen = new Set();
  model.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [o.material].flat()) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (m.transmission) { m.transmission = 0; m.transparent = true; m.opacity = .3; } // glass without an extra render pass
      m.envMap = carEnv; m.envMapIntensity = m === suit ? .45 : .9; // the white suit blooms if it mirrors the sun at full strength
    }
  });

  // nose toward +x like the rest of the scene, ~44 units long, centred on the group's origin
  const fit = new THREE.Group();
  fit.add(model);
  model.rotation.y = Math.PI / 2;
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(44 / Math.max(size.x, size.z));
  model.position.sub(new THREE.Box3().setFromObject(model).getCenter(new THREE.Vector3()));
  roadster.add(fit);
  carReady = true;
  resolve();
}, undefined, err => { console.warn('roadster model failed to load', err); resolve(); }));

/* ---------- the rocket: one lathed hull with an ogive nose, swept fins, engine bell, flame ---------- */
function hullTexture() {
  const c = Object.assign(document.createElement('canvas'), { width: 256, height: 1024 }), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 256, 0); // shading across the barrel
  [['#8f9aab', 0], ['#f4f7fb', .28], ['#ffffff', .55], ['#c9d2df', .82], ['#79828f', 1]].forEach(([col, t]) => g.addColorStop(t, col));
  x.fillStyle = g; x.fillRect(0, 0, 256, 1024);
  const band = (v0, v1, col) => { x.fillStyle = col; x.fillRect(0, (1 - v1) * 1024, 256, (v1 - v0) * 1024); }; // v runs bottom to top
  band(0, .055, '#1c222c'); band(.055, .062, '#6f7886'); band(.435, .492, '#1c222c'); band(.492, .498, '#6f7886'); band(.905, .912, '#2f6fe0');
  x.strokeStyle = 'rgba(110,124,145,.3)';
  for (let px = 16; px < 256; px += 32) { x.beginPath(); x.moveTo(px, 0); x.lineTo(px, 1024); x.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const rocket = new THREE.Group();
const R = 6;
const profile = [[.01, -48], [R * .8, -47.4], [R * .96, -45], [R, -42], [R, 24]].map(([r, y]) => new THREE.Vector2(r, y));
for (let i = 1; i <= 16; i++) profile.push(new THREE.Vector2(R * Math.pow(Math.cos(i / 16 * Math.PI / 2), .55), 24 + i * 2));
profile.push(new THREE.Vector2(.01, 57));
rocket.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 96), new THREE.MeshStandardMaterial({ map: hullTexture(), roughness: .34, metalness: .42 })));

const fin = new THREE.Shape();
fin.moveTo(R - .6, -26); fin.lineTo(R - .6, -46); fin.lineTo(R + 9.5, -49); fin.lineTo(R + 9.5, -40); fin.closePath();
const finGeo = new THREE.ExtrudeGeometry(fin, { depth: .9, bevelEnabled: false }).translate(0, 0, -.45);
const finMat = new THREE.MeshStandardMaterial({ color: 0xe8edf5, roughness: .38, metalness: .45 });
for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(finGeo, finMat); m.rotation.y = i * Math.PI / 2; rocket.add(m); }

const bell = [[1.5, -47.5], [1.9, -49.5], [2.7, -51.5], [3.8, -53.5], [5.1, -55.4], [5.6, -56.2]].map(([r, y]) => new THREE.Vector2(r, y));
rocket.add(new THREE.Mesh(new THREE.LatheGeometry(bell, 48), new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: .3, metalness: .95, side: THREE.DoubleSide })));

// flame: a hot core, an orange envelope and a long faint plume
const flames = [[6.2, 92, 0xff7a2a, .26], [4, 46, 0xffb04d, .7], [2, 24, 0xdff0ff, .95]].map(([r, len, color, base]) => {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, len, 32, 1, true), mat);
  mesh.rotation.x = Math.PI;
  mesh.position.y = -57 - len / 2;
  rocket.add(mesh);
  return { mesh, mat, base };
});
scene.add(rocket);

// exhaust: a recycled pool of additive puffs
const puffs = Array.from({ length: 22 }, () => {
  const mat = glow(0xffcfa0), sprite = new THREE.Sprite(mat);
  scene.add(sprite);
  return { sprite, mat, life: 0, vx: 0, vy: 0, size: 20 };
});
let puffNext = 0, puffClock = 0;

/* ---------- distant planets, held at a fixed distance ahead of the flying camera ---------- */
const outer = [
  { r: 150, x: 1620, y: -300, dist: 2700, appear: .5, mode: 'gas', colors: ['#1d3a73', '#2b4a86', '#6f8fd6', '#b39dff'], ring: '#b39dff' },
  { r: 70, x: -1480, y: 460, dist: 2500, appear: .6, mode: 'rocky', colors: ['#3d2230', '#7a4a5e', '#24121a'] },
  { r: 240, x: -1900, y: -620, dist: 3400, appear: .68, mode: 'gas', colors: ['#0f1f3a', '#1d3358', '#3b5a8a', '#1d3358'] },
  { r: 52, x: 1560, y: 560, dist: 2200, appear: .76, mode: 'rocky', colors: ['#2c4558', '#4a6f8a', '#1a2a36'] },
  { r: 100, x: -1320, y: -460, dist: 1900, appear: .84, mode: 'gas', colors: ['#4a3020', '#6b4a2e', '#a07850', '#6b4a2e'] }
].map(o => {
  const g = new THREE.Group();
  const mat = planetMaterial({ ...o, opacity: 0, seed: o.r });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(o.r, 48, 32), mat));
  const ring = o.ring && makeRing(o.ring, 0);
  if (ring) { ring.scale.setScalar(o.r); g.add(ring); }
  g.position.set(o.x, o.y, 0);
  scene.add(g);
  return { ...o, g, mat, ring, spin: rand(.04, .13) }; // rad/s
});

/* ---------- meteors ---------- */
const meteors = Array.from({ length: 4 }, () => {
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), mat);
  scene.add(line);
  return { line, mat, life: 0, wait: rand(1, 9), vx: 0 };
});
function launchMeteor(m) {
  const len = rand(90, 220);
  m.line.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(-len, -len * .55, 0)]);
  m.line.position.set(rand(-450, 450), rand(150, 500), -rand(300, 1000));
  m.vx = -rand(300, 540); // px per second
  m.life = 1;
}

/* ---------- project worlds ----------
   Each card's .planet-slot is measured every frame and a sphere is drawn over it in an
   orthographic scene where one unit is one CSS pixel: CSS owns layout, WebGL owns shading. */
const projScene = new THREE.Scene();
const projCamera = new THREE.OrthographicCamera(-innerWidth / 2, innerWidth / 2, innerHeight / 2, -innerHeight / 2, -4000, 4000);
const PROJ_LIGHT = new THREE.Vector3(-.55, .62, .9).normalize();

const WORLDS = {
  // retrieval: a cool teal ice giant with a ring
  rag: { mode: 'gas', colors: ['#0f5560', '#2fb5b8', '#c9f6f1', '#f0fffd'], bands: 22, storm: { at: [.6, .25, .75], r: .22 }, tilt: .14 },
  // tainted evidence: a blood-red rock with dark scars and a sickly moon
  tainted: { mode: 'rocky', colors: ['#3e0909', '#9a2a2a', '#140303'], scale: 2.6, tilt: -.3, moon: { color: '#a3c45a', size: .2, dist: 1.8 } },
  // atlas: an Earth-like world, for the maps of knowledge it draws
  atlas: { mode: 'terran', colors: ['#0d3466', '#2a7cc0', '#3f8a46', '#c2a86e'], clouds: .7, scale: 2.2, tilt: .2, moon: { color: '#c9d1dc', size: .18, dist: 1.85 } },
  // nutrinet: warm, banded like a citrus fruit, with a cheese-yellow moon
  nutrinet: { mode: 'gas', colors: ['#8a4b12', '#e3a24a', '#fff0c9', '#c0392b'], bands: 14, storm: { at: [-.5, -.2, .8], r: .2 }, tilt: -.18, moon: { color: '#f2d16b', size: .2, dist: 1.75 } },
  // convo-ease: a violet giant, rose storm and a pale ring
  convo: { mode: 'gas', colors: ['#2c1a5e', '#7d5bd6', '#e3d9ff', '#ff9ec7'], bands: 18, storm: { at: [.4, -.3, .85], r: .24 }, tilt: .3 }
};

const worlds = [...document.querySelectorAll('.planet-slot')].flatMap(slot => {
  const spec = WORLDS[slot.dataset.world];
  if (!spec) return [];
  const card = slot.closest('.planet-card');
  const group = new THREE.Group();
  group.rotation.z = spec.tilt || 0;
  const mat = planetMaterial({ ...spec, light: PROJ_LIGHT, seed: Math.random() * 50, atmo: getComputedStyle(card).getPropertyValue('--ring').trim() || '#8fcaff' });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 48), mat);
  group.add(sphere);
  const ringHex = getComputedStyle(card).getPropertyValue('--ring').trim();
  if (ringHex) group.add(makeRing(ringHex));
  let orbit = null;
  if (spec.moon) {
    orbit = new THREE.Group();
    orbit.rotation.set(.42, rand(0, Math.PI * 2), -.25);
    const m = new THREE.Mesh(new THREE.SphereGeometry(spec.moon.size, 32, 24),
      planetMaterial({ mode: 'rocky', colors: [spec.moon.color, spec.moon.color, '#000000'], light: PROJ_LIGHT, scale: 4, atmo: '#000000' }));
    m.position.x = spec.moon.dist;
    orbit.add(m);
    group.add(orbit);
  }
  projScene.add(group);
  const w = { slot, group, sphere, mat, orbit, spin: rand(.1, .18), hover: 0, hoverT: 0 };
  const on = () => { w.hoverT = 1; }, off = () => { w.hoverT = 0; };
  card.addEventListener('pointerenter', on); card.addEventListener('pointerleave', off);
  card.addEventListener('focusin', on); card.addEventListener('focusout', off);
  return [w];
});

function syncWorlds(dt, time) {
  let any = false;
  for (const w of worlds) {
    const r = w.slot.getBoundingClientRect();
    w.group.visible = r.width > 0 && r.bottom > -240 && r.top < innerHeight + 240;
    if (!w.group.visible) continue;
    any = true;
    w.hover += (w.hoverT - w.hover) * (1 - Math.pow(.88, dt * 60));
    w.group.position.set(r.left + r.width / 2 - innerWidth / 2, innerHeight / 2 - (r.top + r.height / 2), 0);
    w.group.scale.setScalar(r.width / 2 * (1 + w.hover * .09));
    w.sphere.rotation.y += w.spin * dt;
    w.mat.uniforms.uTime.value = time;
    if (w.orbit) w.orbit.rotation.y += .36 * dt;
  }
  return any;
}

/* ---------- post-processing: bloom, then a cool grade, vignette and film grain ----------
   Off on small screens and for reduced motion; the scene then renders straight to the canvas. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; varying vec2 vUv;
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); } // no sin(): no streaks
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float l = dot(col, vec3(.2126, .7152, .0722));
      col = mix(col * vec3(.94, .98, 1.1), col, smoothstep(0., .55, l));  // cool shadows only
      col = clamp((col - .5) * 1.06 + .5, 0., 1.);                        // gentle contrast
      vec2 d = vUv - .5; col *= 1. - .5 * dot(d, d);                      // vignette
      col += (hash(gl_FragCoord.xy + fract(uTime) * 311.7) - .5) * .032 * (1. - .6 * l); // grain
      gl_FragColor = vec4(col, 1.);
    }`
};

let composer = null, grade = null, bloom = null;
if (!reduce && innerWidth >= 900) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(bgScene, bgCamera));
  for (const [s, c] of [[scene, camera], [projScene, projCamera]]) {
    const pass = new RenderPass(s, c);
    pass.clear = false; pass.clearDepth = true;
    composer.addPass(pass);
  }
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .62, .62, .72);
  composer.addPass(bloom);
  composer.addPass((grade = new ShaderPass(GradeShader)));
  composer.addPass(new OutputPass());
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  Object.assign(projCamera, { left: -innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: -innerHeight / 2 });
  projCamera.updateProjectionMatrix();
  composer?.setSize(innerWidth, innerHeight);
}, { passive: true });

let visible = true;
document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

/* ---------- per frame ---------- */
let time = 0, camX = 0, camY = 0;
const setOpacity = (mats, v) => mats.forEach(m => { if (m.uniforms) m.uniforms.uOpacity.value = v; else m.opacity = v; });

window.__sky = function update(s) {
  if (!visible) return;
  const dt = s.dt || 1 / 60, f = dt * 60, p = s.progress, L = s.launchT, clutter = s.clutter ?? 1;
  time += dt;

  const far = sat(p, .05, .45);
  skyU.uTop.value.copy(NEAR[0]).lerp(FAR[0], far);
  skyU.uBot.value.copy(NEAR[1]).lerp(FAR[1], far);
  skyU.uGround.value = L < 0 ? 1 : Math.max(0, 1 - L * 2.6);

  const flyZ = reduce ? 0 : -p * DEPTH * .6;
  starMat.opacity = .35 + .65 * sat(Math.max(L, 0), .1, .7);
  dustMat.opacity = .5 * sat(p, .1, .4);
  dust.position.z = flyZ; // travels with the camera

  const neb = sat(p, .25, .6) * clutter;
  nebulae.forEach((n, i) => {
    n.material.opacity = neb * (.022 + i * .007);
    n.position.x += Math.sin(time * .12 + i) * n.userData.drift * .5 * f;
    n.position.y += Math.cos(time * .09 + i) * n.userData.drift * .3 * f;
  });

  // Earth fades in as we climb, then falls away as the page scrolls
  const homeIn = (L < 0 || !earthReady ? 0 : sat(L, .35, .9)) * (1 - sat(p, .06, .34));
  earthMat.uniforms.uOpacity.value = atmoMat.uniforms.uOpacity.value = homeIn;
  earthMat.uniforms.uCloudShift.value = time * .0004;  // clouds drift over the ground
  earth.visible = atmosphere.visible = homeIn > .01;
  if (!reduce) earth.rotateY(.0015 * dt);              // slow enough that India stays in view
  earth.position.set(0, -1150 - p * 900, -700 + flyZ * .35);
  atmosphere.position.copy(earth.position);
  const ma = time * .06;
  moon.position.set(earth.position.x + Math.cos(ma) * 1500, earth.position.y + 700 + Math.sin(ma) * 220, earth.position.z + Math.sin(ma) * 900);
  moonMat.uniforms.uOpacity.value = homeIn;
  moon.visible = earth.visible;

  const satIn = (L < 0 ? 0 : sat(L, .5, 1)) * (1 - sat(p, .1, .24));
  satellites.forEach((g, i) => {
    const t = time * (.05 + i * .02) + i * 2.2;
    g.position.set(Math.sin(t) * (360 + i * 170), Math.cos(t * .8) * (170 + i * 80) + 60, -620 - i * 300 + flyZ * .5);
    g.rotation.set(Math.sin(t * .4) * .3, t * .6, 0);
    g.visible = satIn > .02;
    setOpacity(g.userData.mats, satIn);
  });

  // the roadster: deployed once the rocket has left the frame, gone again as the hero scrolls away
  // it glides in from beyond the right edge and back out as the hero scrolls away: moving, not fading,
  // so its materials never change state (a transparency switch forces a shader recompile mid-flight)
  const carIn = carReady ? (L < 0 ? 0 : sat(L, .5, 1)) * (1 - sat(p, .03, .1)) : 0;
  roadster.visible = carIn > .001;
  if (roadster.visible) {
    const dist = 360, halfH = Math.tan(THREE.MathUtils.degToRad(31)) * dist, halfWd = halfH * camera.aspect;
    const k = 1 - Math.pow(1 - carIn, 3), away = 1 - k;
    roadster.scale.setScalar(Math.min(70, halfWd * .4) / 44); // ~10% of a desktop width, smaller on phones
    roadster.position.set(halfWd * (.55 + Math.sin(time * .05) * .05 + away * 1.2), halfH * (.5 + away * .3) + Math.sin(time * .3) * 3, 40 - dist + flyZ * .85);
    if (!reduce) { roadster.rotation.x += .04 * dt; roadster.rotation.y += .12 * dt; roadster.rotation.z += .025 * dt; }
  }

  for (const o of outer) {
    const v = sat(p, o.appear, o.appear + .12) * clutter;
    o.mat.uniforms.uOpacity.value = v * .5;
    if (o.ring) o.ring.material.uniforms.uOpacity.value = v * .3;
    o.g.position.z = flyZ - o.dist;
    o.g.rotation.y += o.spin * dt;
    o.g.visible = v > .01;
  }

  // the rocket: on the pad through the countdown, then a curving climb
  const halfW = Math.tan(THREE.MathUtils.degToRad(31)) * 290 * camera.aspect; // visible half-width at its depth
  let thrust = 0, stretch = 1;
  rocket.visible = !reduce && L < 1;
  if (rocket.visible) {
    const climb = Math.max(L, 0);
    rocket.position.set(halfW * .6, -80 + Math.pow(climb, 1.8) * 900, -250);
    rocket.rotation.z = -climb * .22;
    thrust = L < 0 ? .16 : 1;
    stretch = L < 0 ? .9 : 1 + L * .9;
  }
  const flick = .86 + Math.sin(time * 41) * .14;
  for (const fl of flames) {
    fl.mesh.scale.set(thrust * flick, thrust * stretch * flick, thrust * flick);
    fl.mat.opacity = thrust * fl.base * flick;
  }
  puffClock -= dt;
  if (rocket.visible && thrust > .3 && puffClock <= 0) {
    puffClock = 1 / 30;
    const q = puffs[puffNext++ % puffs.length];
    q.sprite.position.set(rocket.position.x + rand(-6, 6), rocket.position.y - 60, rocket.position.z + rand(-6, 6));
    Object.assign(q, { size: rand(15, 28), vy: -rand(108, 198), vx: rand(-48, 48), life: 1 });
  }
  for (const q of puffs) {
    if (q.life <= 0) { q.mat.opacity = 0; continue; }
    q.life -= dt;
    q.sprite.position.y += q.vy * dt;
    q.sprite.position.x += q.vx * dt;
    const size = q.size * (1 + (1 - q.life) * 1.6);
    q.sprite.scale.set(size, size, 1);
    q.mat.opacity = Math.max(0, q.life * q.life * .2); // additive: anything higher blooms to white
  }

  // camera: pointer parallax, a short shake at ignition, and the flight forward
  camX += (s.mouseX * 42 - camX) * (1 - Math.pow(.955, f));
  camY += (-s.mouseY * 28 - camY) * (1 - Math.pow(.955, f));
  const shake = L >= 0 && L < 1 ? sat(L, 0, .06) * (1 - sat(L, .1, .4)) * 4.5 : 0;
  camera.position.set(camX + rand(-.5, .5) * shake, camY + rand(-.5, .5) * shake, flyZ + 40);
  camera.lookAt(camX * .3, camY * .3, flyZ - 400);

  if (p > .3 && !reduce) for (const m of meteors) {
    if (m.life > 0) {
      m.line.position.x += m.vx * dt;
      m.line.position.y += m.vx * .55 * dt;
      m.life -= .84 * dt;
      m.mat.opacity = Math.max(0, Math.sin(m.life * Math.PI)) * .85 * clutter;
    } else if ((m.wait -= dt) <= 0) { m.wait = rand(3.5, 18); launchMeteor(m); }
  }

  const worldsOn = syncWorlds(dt, time);

  if (composer) {
    grade.uniforms.uTime.value = time;
    composer.render();
  } else {
    renderer.clear();
    renderer.render(bgScene, bgCamera);
    renderer.clearDepth();
    renderer.render(scene, camera);
    if (worldsOn) { renderer.clearDepth(); renderer.render(projScene, projCamera); }
  }
};

window.__sky({ progress: 0, launchT: -1, clutter: 1, mouseX: 0, mouseY: 0, dt: 1 / 60 });
dispatchEvent(new Event('sky-ready'));

/* ---------- warm-up: do the one-off GPU work during the countdown, not during liftoff ----------
   Shaders compile and textures upload the first time an object is drawn, which used to be mid-launch
   (300-800 ms freezes). So: decode and upload every texture now, and compile every program now, with
   hidden objects shown just while the scene is walked. The countdown waits for this ('sky-loaded'). */
function compileHidden(s, c) {
  const shown = [];
  s.traverse(o => { if (!o.visible) { o.visible = true; shown.push(o); } });
  const ready = renderer.compileAsync(s, c); // walks the scene synchronously, then waits for the GPU
  shown.forEach(o => { o.visible = false; });
  return ready;
}

Promise.all([earthLoaded, carLoaded]).then(async () => {
  const textures = new Set(earthTextures);
  roadster.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v); });
  await Promise.all([...textures].map(t => t.image?.decode?.().catch(() => {}))); // <img> textures; glTF ones arrive as ImageBitmaps
  for (const t of textures) { renderer.initTexture(t); await new Promise(requestAnimationFrame); } // one upload per frame: small blips, not one long stall
  // the composer draws into render targets, which select different shader variants than the screen
  renderer.setRenderTarget(composer ? composer.readBuffer : null);
  const compiling = [compileHidden(scene, camera), compileHidden(projScene, projCamera)];
  renderer.setRenderTarget(null);
  await Promise.all(compiling);
}).catch(err => console.warn('warm-up skipped', err)).finally(() => {
  earthReady = true;
  dispatchEvent(new Event('sky-loaded'));
});
