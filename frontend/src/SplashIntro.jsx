import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import "./SplashIntro.css";

/* ------------------------------------------------------------------ */
/*  Settings you can tweak                                             */
/* ------------------------------------------------------------------ */
const ARRIVE_S = 3.4; // seconds the drone takes to rise to the centre
const AUTO_ENTER_MS = 8500; // dashboard opens automatically after this
const FADE_MS = 700; // fade-out time before the dashboard shows
const GROUND_Y = -3.2;

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);
const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function can3D() {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#050d18");
  g.addColorStop(0.3, "#0d2b42");
  g.addColorStop(0.46, "#2a6a75");
  g.addColorStop(0.55, "#d9a46f");
  g.addColorStop(0.62, "#3d7b78");
  g.addColorStop(0.8, "#0f302d");
  g.addColorStop(1, "#071a18");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/*  Forest (instanced pine trees)                                      */
/* ------------------------------------------------------------------ */
const LAYERS = [
  { base: 0.9, h: 2.6, r: 1.5 },
  { base: 2.3, h: 2.4, r: 1.2 },
  { base: 3.7, h: 2.3, r: 0.9 },
];

function buildTrees() {
  const rand = mulberry32(2026);
  const trees = [];

  // Big trees near the camera frame the left and right edges.
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    trees.push({
      x: side * (5.6 + rand() * 3),
      z: -0.5 - rand() * 1.5,
      s: 1.3 + rand() * 0.4,
      w: 0.95 + rand() * 0.3,
    });
  }

  // The rest of the forest, getting denser towards the distance.
  for (let i = 0; i < 120; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const z = -2.5 - Math.pow(rand(), 0.8) * 48;
    const corridor = z > -8 ? 3.4 : 2.0;
    trees.push({
      x: side * (corridor + Math.pow(rand(), 1.3) * 24),
      z,
      s: 0.6 + rand() * 0.6,
      w: 0.85 + rand() * 0.35,
    });
  }

  return trees.map((t) => {
    const color = new THREE.Color().setHSL(
      0.33 + rand() * 0.07,
      0.42 + rand() * 0.15,
      0.1 + rand() * 0.1
    );
    return { ...t, color };
  });
}

function Forest() {
  const trees = useMemo(buildTrees, []);
  const trunkRef = useRef(null);
  const layerRefs = useRef([]);

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const trunk = trunkRef.current;
    if (!trunk) return;

    trees.forEach((t, i) => {
      dummy.position.set(t.x, GROUND_Y + 0.6 * t.s, t.z);
      dummy.scale.set(t.s * t.w, t.s, t.s * t.w);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);

      LAYERS.forEach((l, li) => {
        const mesh = layerRefs.current[li];
        if (!mesh) return;
        dummy.position.set(t.x, GROUND_Y + (l.base + l.h / 2) * t.s, t.z);
        dummy.scale.set(l.r * t.s * t.w, l.h * t.s, l.r * t.s * t.w);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, t.color);
      });
    });

    trunk.instanceMatrix.needsUpdate = true;
    layerRefs.current.forEach((m) => {
      if (!m) return;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }, [trees]);

  return (
    <group>
      <instancedMesh
        ref={trunkRef}
        args={[undefined, undefined, trees.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.18, 0.24, 1.2, 6]} />
        <meshStandardMaterial color="#3a2a20" roughness={1} />
      </instancedMesh>

      {LAYERS.map((_, i) => (
        <instancedMesh
          key={i}
          ref={(m) => {
            layerRefs.current[i] = m;
          }}
          args={[undefined, undefined, trees.length]}
          frustumCulled={false}
        >
          <coneGeometry args={[1, 1, 9]} />
          <meshStandardMaterial color="#ffffff" roughness={0.95} flatShading />
        </instancedMesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Ground, hills, sun, fireflies                                      */
/* ------------------------------------------------------------------ */
function Ground() {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, GROUND_Y, -30]}
      renderOrder={-1}
    >
      <planeGeometry args={[160, 80]} />
      <meshStandardMaterial color="#0f2d26" roughness={1} depthWrite={false} />
    </mesh>
  );
}

function Hills() {
  const hills = [
    [-30, 17, 12],
    [-14, 20, 9],
    [4, 18, 13],
    [22, 21, 10],
    [38, 17, 12],
  ];
  return (
    <group>
      {hills.map(([x, r, h], i) => (
        <mesh key={i} position={[x, GROUND_Y + h / 2 - 1, -58 - (i % 2) * 6]}>
          <coneGeometry args={[r, h, 6]} />
          <meshStandardMaterial color="#10343a" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Sun({ texture }) {
  return (
    <group>
      <sprite position={[-7, 1.2, -45]} scale={[40, 40, 1]}>
        <spriteMaterial
          map={texture}
          color="#ffcf94"
          transparent
          opacity={0.75}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </sprite>
      <sprite position={[-7, 1.2, -44]} scale={[9, 9, 1]}>
        <spriteMaterial
          map={texture}
          color="#fff1d6"
          transparent
          opacity={0.9}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </sprite>
    </group>
  );
}

function Fireflies() {
  const count = 140;
  const { geo, seeds } = useMemo(() => {
    const rand = mulberry32(77);
    const arr = new Float32Array(count * 3);
    const sd = [];
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 28;
      arr[i * 3 + 1] = GROUND_Y + rand() * 7;
      arr[i * 3 + 2] = 2 - rand() * 32;
      sd.push({ speed: 0.08 + rand() * 0.18, phase: rand() * 6.28 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return { geo: g, seeds: sd };
  }, []);

  useFrame((state, delta) => {
    const pos = geo.attributes.position;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      let y = pos.getY(i) + seeds[i].speed * delta;
      if (y > GROUND_Y + 7.5) y = GROUND_Y;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.6 + seeds[i].phase) * delta * 0.15);
    }
    pos.needsUpdate = true;
  });

  return (
    <points geometry={geo}>
      <pointsMaterial
        size={0.07}
        color="#c9fbff"
        transparent
        opacity={0.8}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        fog={false}
      />
    </points>
  );
}

/* ------------------------------------------------------------------ */
/*  The drone                                                          */
/* ------------------------------------------------------------------ */
const MOTORS = [
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

function Propeller({ propRef }) {
  return (
    <group ref={propRef} position={[0, 0.22, 0]}>
      <mesh>
        <boxGeometry args={[1.35, 0.012, 0.1]} />
        <meshStandardMaterial color="#cfd8de" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[1.35, 0.012, 0.1]} />
        <meshStandardMaterial color="#cfd8de" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.68, 32]} />
        <meshBasicMaterial
          color="#bfefff"
          transparent
          opacity={0.1}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function Eye({ side, eyeRef, matRef, glowRef, texture }) {
  const x = side * 0.22;
  return (
    <group position={[x, 0, 0.76]} rotation={[0, side * 0.35, -side * 0.32]}>
      <mesh ref={eyeRef}>
        <boxGeometry args={[0.24, 0.055, 0.03]} />
        <meshStandardMaterial
          ref={matRef}
          color="#7df3ff"
          emissive="#2ee6ff"
          emissiveIntensity={0.1}
          roughness={0.3}
        />
      </mesh>
      <sprite ref={glowRef} position={[0, 0, 0.05]} scale={[0.8, 0.45, 1]}>
        <spriteMaterial
          map={texture}
          color="#3fe9ff"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </sprite>
    </group>
  );
}

function Drone({ texture }) {
  const root = useRef(null);
  const propRefs = useRef([]);
  const eyeRefs = useRef([null, null]);
  const eyeMats = useRef([null, null]);
  const eyeGlows = useRef([null, null]);
  const eyeLight = useRef(null);
  const size = useThree((s) => s.size);
  const fit = clamp((size.width / size.height) * 0.9, 0.5, 1);

  useFrame((state, delta) => {
    const g = root.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const p = clamp(t / ARRIVE_S, 0, 1);
    const e = easeOutCubic(p);

    // Rise from below the screen to the centre, then hover.
    g.position.y =
      THREE.MathUtils.lerp(-6.2, 0.35, e) + Math.sin(t * 1.6) * 0.07 * e;
    g.position.z = THREE.MathUtils.lerp(2.5, 0, e);
    g.rotation.x = (1 - e) * -0.22 + Math.sin(t * 1.1) * 0.02;
    g.rotation.z = Math.sin(t * 0.9) * 0.035;

    // Looks slightly towards the mouse once it has arrived.
    const targetY = state.pointer.x * 0.45 * e;
    g.rotation.y += (targetY - g.rotation.y) * Math.min(1, delta * 3);

    // Propellers
    propRefs.current.forEach((pr, i) => {
      if (pr) pr.rotation.y += delta * (38 + (1 - e) * 20) * (i % 2 ? 1 : -1);
    });

    // Eyes power on after arrival, then blink now and then.
    const on = smoothstep(ARRIVE_S - 0.2, ARRIVE_S + 0.7, t);
    const warm = t < ARRIVE_S + 0.9 ? 0.7 + 0.3 * Math.sin(t * 40) : 1;
    const intensity = on * warm;
    const bt = t - ARRIVE_S - 0.8;
    const blinkTarget = bt > 0 && bt % 3.8 > 3.62 ? 0.12 : 1;

    for (let i = 0; i < 2; i++) {
      const eye = eyeRefs.current[i];
      const mat = eyeMats.current[i];
      const glow = eyeGlows.current[i];
      if (!eye || !mat || !glow) continue;
      eye.scale.y += (blinkTarget - eye.scale.y) * Math.min(1, delta * 30);
      mat.emissiveIntensity = 0.1 + 3.2 * intensity;
      glow.material.opacity = 0.75 * intensity * eye.scale.y;
    }
    if (eyeLight.current) eyeLight.current.intensity = 5 * intensity;
  });

  return (
    <group ref={root} position={[0, -6.2, 2.5]}>
      <group scale={fit}>
        {/* Main body */}
        <mesh scale={[0.85, 0.3, 0.7]}>
          <sphereGeometry args={[1, 40, 24]} />
          <meshStandardMaterial color="#1b2733" metalness={0.8} roughness={0.28} />
        </mesh>
        {/* Top shell */}
        <mesh position={[0, 0.2, -0.05]} scale={[0.62, 0.2, 0.5]}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshStandardMaterial color="#e6edf2" metalness={0.3} roughness={0.35} />
        </mesh>
        {/* Dark visor (the "face") */}
        <mesh position={[0, 0.0, 0.58]} scale={[0.5, 0.14, 0.2]}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshStandardMaterial color="#03060c" metalness={0.9} roughness={0.12} />
        </mesh>

        {/* Eyes */}
        <Eye
          side={-1}
          texture={texture}
          eyeRef={(m) => {
            eyeRefs.current[0] = m;
          }}
          matRef={(m) => {
            eyeMats.current[0] = m;
          }}
          glowRef={(m) => {
            eyeGlows.current[0] = m;
          }}
        />
        <Eye
          side={1}
          texture={texture}
          eyeRef={(m) => {
            eyeRefs.current[1] = m;
          }}
          matRef={(m) => {
            eyeMats.current[1] = m;
          }}
          glowRef={(m) => {
            eyeGlows.current[1] = m;
          }}
        />
        <pointLight
          ref={eyeLight}
          position={[0, 0, 1.3]}
          color="#3fe9ff"
          intensity={0}
          distance={5}
          decay={2}
        />

        {/* Arms (X shape) */}
        {[Math.PI / 4, -Math.PI / 4].map((a) => (
          <mesh key={a} rotation={[0, a, 0]}>
            <boxGeometry args={[2.9, 0.07, 0.13]} />
            <meshStandardMaterial color="#10161d" metalness={0.7} roughness={0.4} />
          </mesh>
        ))}

        {/* Motors, propellers and tip lights */}
        {MOTORS.map(([sx, sz], i) => (
          <group key={i} position={[sx * 1.03, 0.07, sz * 1.03]}>
            <mesh position={[0, 0.06, 0]}>
              <cylinderGeometry args={[0.15, 0.17, 0.2, 20]} />
              <meshStandardMaterial color="#2a3540" metalness={0.85} roughness={0.3} />
            </mesh>
            <Propeller
              propRef={(m) => {
                propRefs.current[i] = m;
              }}
            />
            <mesh position={[0, -0.04, sz * 0.19]}>
              <sphereGeometry args={[0.045, 12, 12]} />
              <meshStandardMaterial
                color={sz > 0 ? "#9ff6ff" : "#ff3d4a"}
                emissive={sz > 0 ? "#3fe9ff" : "#ff1f30"}
                emissiveIntensity={2.2}
              />
            </mesh>
          </group>
        ))}

        {/* Landing skids */}
        {[-1, 1].map((sz) => (
          <mesh key={sz} position={[0, -0.44, sz * 0.4]}>
            <boxGeometry args={[1.5, 0.04, 0.04]} />
            <meshStandardMaterial color="#10161d" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}
        {MOTORS.map(([sx, sz], i) => (
          <mesh key={i} position={[sx * 0.6, -0.31, sz * 0.4]}>
            <boxGeometry args={[0.04, 0.26, 0.04]} />
            <meshStandardMaterial color="#10161d" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}

        {/* Camera gimbal */}
        <mesh position={[0, -0.3, 0.5]}>
          <sphereGeometry args={[0.17, 20, 16]} />
          <meshStandardMaterial color="#0c1219" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.3, 0.65]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial
            color="#0a1a33"
            emissive="#2a7bff"
            emissiveIntensity={0.6}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/*  Scene + camera                                                     */
/* ------------------------------------------------------------------ */
function CameraRig() {
  useFrame((state, delta) => {
    const cam = state.camera;
    const k = Math.min(1, delta * 2);
    cam.position.x += (state.pointer.x * 0.5 - cam.position.x) * k;
    cam.position.y += (0.5 + state.pointer.y * 0.2 - cam.position.y) * k;
    cam.lookAt(0, 0, 0);
  });
  return null;
}

function Scene() {
  const glow = useMemo(makeGlowTexture, []);
  const sky = useMemo(makeSkyTexture, []);

  return (
    <>
      <primitive object={sky} attach="background" />
      <fog attach="fog" args={["#2a6168", 12, 80]} />

      <ambientLight intensity={0.6} color="#9fd8e6" />
      <directionalLight position={[-6, 5, -8]} intensity={2.4} color="#ffcf9a" />
      <directionalLight position={[4, 3, 8]} intensity={1.2} color="#bfe9ff" />

      <Sun texture={glow} />
      <Hills />
      <Ground />
      <Forest />
      <Fireflies />
      <Drone texture={glow} />
      <CameraRig />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Safety net: if 3D crashes, skip straight to the dashboard          */
/* ------------------------------------------------------------------ */
class IntroBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn("SplashIntro 3D failed, opening dashboard:", error);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  The page                                                           */
/* ------------------------------------------------------------------ */
export default function SplashIntro({ onComplete }) {
  const [leaving, setLeaving] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  const [ready, setReady] = useState(false);
  const doneRef = useRef(false);
  const supported = useMemo(can3D, []);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    window.setTimeout(onComplete, FADE_MS);
  }, [onComplete]);

  // No WebGL, or the user prefers reduced motion: skip the intro.
  useEffect(() => {
    if (!supported) onComplete();
  }, [supported, onComplete]);

  useEffect(() => {
    if (!supported) return undefined;
    const t1 = window.setTimeout(() => setShowTitle(true), 900);
    const t2 = window.setTimeout(() => setReady(true), ARRIVE_S * 1000 + 300);
    const t3 = window.setTimeout(finish, AUTO_ENTER_MS);
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("keydown", onKey);
    };
  }, [supported, finish]);

  if (!supported) return null;

  return (
    <div
      className={`splash-root${leaving ? " is-leaving" : ""}`}
      role="dialog"
      aria-label="AquaAirX intro"
    >
      <IntroBoundary onFail={finish}>
        <Canvas
          className="splash-canvas"
          dpr={[1, 2]}
          camera={{ position: [0, 0.5, 7.5], fov: 48, near: 0.1, far: 200 }}
          gl={{ antialias: true }}
        >
          <Scene />
        </Canvas>
      </IntroBoundary>

      <div className="splash-vignette" />

      <div className="splash-overlay">
        <button type="button" className="splash-skip" onClick={finish}>
          Skip intro ›
        </button>

        <header className={`splash-title${showTitle ? " show" : ""}`}>
          <p className="splash-kicker">AUTONOMOUS AERIAL INTELLIGENCE</p>
          <h1>
            AquaAir<span>X</span>
          </h1>
          <p className="splash-sub">Drone Monitoring System</p>
        </header>

        <footer className={`splash-footer${ready ? " show" : ""}`}>
          <span className="splash-badge">SIMULATOR / DEMO MODE</span>
          <p className="splash-note">
            Simulated drones only. No physical drones are connected.
          </p>
          <button type="button" className="splash-enter" onClick={finish}>
            Enter Dashboard
          </button>
        </footer>
      </div>
    </div>
  );
}
