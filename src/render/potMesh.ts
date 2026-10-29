import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type PotStyle, type SurfaceStyle, potColor, potDims } from '../game/pots';
import { mulberry32 } from '../tree/rng';
import { type MossPatch, clayMottleTexture, clayTexture, paintedSoilTexture, walnutTexture } from './textures';

/** Height of the soil surface at the rim (the pot body's top cap is just below). */
const SOIL_Y = 0.062;

export interface PotBuild {
  group: THREE.Group;
  /** Height of the floor the stand rests on. */
  groundY: number;
  dispose(): void;
}

function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function ovalShape(w: number, d: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absellipse(0, 0, w / 2, d / 2, 0, Math.PI * 2, false, 0);
  return s;
}

/**
 * Pot body: an outer wall shell with a lip, plus feet. Extruded downward from
 * the rim; the soil sits just below the rim at y ≈ 0.
 */
export function buildPot(pot: PotStyle, surface: SurfaceStyle, seed: number, winter = false): PotBuild {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const { width, depthZ, height } = potDims(pot);
  const color = potColor(pot.colorId);
  const glazed = color.material === 'glazed';
  const mat = glazed
    ? new THREE.MeshPhysicalMaterial({ color: color.hex, map: clayMottleTexture(), roughness: 0.28, clearcoat: 0.85, clearcoatRoughness: 0.18, sheen: 0.3, sheenColor: '#ffffff' })
    : new THREE.MeshStandardMaterial({ color: color.hex, map: clayMottleTexture(), roughness: 0.92, bumpMap: clayTexture(), bumpScale: 0.8 });
  disposables.push(mat);

  const rimY = 0.05;
  const shapeFor = (grow: number) => {
    if (pot.shape === 'rectangle' || pot.shape === 'crescent') {
      return roundedRect(width + grow, depthZ + grow, Math.min(width, depthZ) * (pot.shape === 'crescent' ? 0.3 : 0.08));
    }
    return ovalShape(width + grow, depthZ + grow);
  };

  // Body: extrude with a bevel for soft edges; taper by scaling the bottom.
  const bodyGeo = new THREE.ExtrudeGeometry(shapeFor(0), {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 3,
    curveSegments: 40,
  });
  bodyGeo.rotateX(Math.PI / 2);
  bodyGeo.translate(0, rimY - 0.02, 0);
  const taper = pot.shape === 'round' ? 0.72 : pot.shape === 'drum' ? 0.94 : pot.shape === 'cascade' ? 0.82 : 0.9;
  const pos = bodyGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = 1 - (1 - taper) * Math.pow(Math.min(1, Math.max(0, (rimY - y) / height)), pot.shape === 'round' ? 1.6 : 1);
    pos.setX(i, pos.getX(i) * f);
    pos.setZ(i, pos.getZ(i) * f);
  }
  bodyGeo.computeVertexNormals();
  disposables.push(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Lip: a slightly wider ring at the rim.
  const hole = shapeFor(-0.06);
  const lipShape = shapeFor(0.07);
  lipShape.holes.push(new THREE.Path(hole.getPoints(40).reverse()));
  const lipGeo = new THREE.ExtrudeGeometry(lipShape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 40,
  });
  lipGeo.rotateX(Math.PI / 2);
  lipGeo.translate(0, rimY + 0.03, 0);
  disposables.push(lipGeo);
  const lip = new THREE.Mesh(lipGeo, mat);
  lip.castShadow = true;
  group.add(lip);

  // Drum studs.
  if (pot.shape === 'drum') {
    const studGeo = new THREE.SphereGeometry(0.022, 8, 6);
    disposables.push(studGeo);
    for (const yy of [rimY - 0.08, rimY - height + 0.08]) {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const st = new THREE.Mesh(studGeo, mat);
        st.position.set((Math.cos(a) * width) / 2 * 1.01, yy, (Math.sin(a) * depthZ) / 2 * 1.01);
        group.add(st);
      }
    }
  }

  // Feet.
  const footGeo = new THREE.BoxGeometry(0.16, 0.07, 0.12);
  disposables.push(footGeo);
  const footY = rimY - 0.02 - height - 0.045;
  const fx = (width / 2) * taper * 0.72;
  const fz = (depthZ / 2) * taper * 0.72;
  const feet = pot.shape === 'round' || pot.shape === 'drum' || pot.shape === 'cascade'
    ? [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => [Math.cos(a + Math.PI / 2) * fx, Math.sin(a + Math.PI / 2) * fz])
    : [[-fx, -fz], [fx, -fz], [-fx, fz], [fx, fz]];
  for (const [x, z] of feet) {
    const f = new THREE.Mesh(footGeo, mat);
    f.position.set(x!, footY, z!);
    f.castShadow = true;
    group.add(f);
  }

  // Soil surface.
  const soilShape = shapeFor(-0.08);
  const soilGeo = new THREE.ShapeGeometry(soilShape, 40);
  soilGeo.rotateX(-Math.PI / 2);
  // Slight dome so the soil reads as mounded, not flat.
  const sp = soilGeo.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i) / (width / 2);
    const z = sp.getZ(i) / (depthZ / 2);
    // Sits above the pot body's bevelled top cap; trunk base and roots are buried beneath.
    sp.setY(i, 0.03 * Math.max(0, 1 - (x * x + z * z)) + SOIL_Y);
  }
  soilGeo.computeVertexNormals();
  // UVs span the soil once, so moss can be painted where it belongs.
  const uv = soilGeo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, sp.getX(i) / width + 0.5, sp.getZ(i) / depthZ + 0.5);
  disposables.push(soilGeo);
  const patches = mossPatches(seed, surface.moss, width / depthZ);
  const soilTex = paintedSoilTexture(`${seed}:${surface.moss.toFixed(2)}:${(width / depthZ).toFixed(2)}`, patches, winter);
  const soilMat = new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1 });
  disposables.push(soilMat);
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.receiveShadow = true;
  group.add(soil);

  // A few soft cushions give the painted moss some relief.
  const rng = mulberry32(seed ^ 0x51);
  if (patches.length) {
    const mossGeo = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv'));
    mossGeo.computeVertexNormals();
    const mossMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    disposables.push(mossGeo, mossMat);
    const per = 4;
    const moss = new THREE.InstancedMesh(mossGeo, mossMat, patches.length * per);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tones = winter ? ['#d9dfd8', '#e8ece6'] : ['#56722f', '#64823a', '#4a6429'];
    let n = 0;
    for (const p of patches) {
      for (let k = 0; k < per; k++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * p.r * 0.6;
        const px = (p.u - 0.5 + Math.cos(a) * d) * width;
        const pz = (p.v - 0.5 + Math.sin(a) * d) * depthZ;
        const nx = px / ((width - 0.18) / 2);
        const nz = pz / ((depthZ - 0.18) / 2);
        if (nx * nx + nz * nz > 1 || Math.hypot(px, pz) < 0.16) continue;
        const sz = 0.018 + rng() * 0.022;
        m.makeScale(sz * 1.5, sz * 0.6, sz * 1.5);
        m.setPosition(px, 0.03 * Math.max(0, 1 - (nx * nx + nz * nz)) + SOIL_Y + sz * 0.1, pz);
        moss.setMatrixAt(n, m);
        c.set(tones[Math.floor(rng() * tones.length)]!).multiplyScalar(0.9 + rng() * 0.2);
        moss.setColorAt(n, c);
        n++;
      }
    }
    moss.count = n;
    moss.receiveShadow = true;
    group.add(moss);
  }

  // Accent stones.
  const stoneColors = { river: '#7d7a74', slate: '#4a4d52', quartz: '#e8e3d8' };
  for (const s of surface.stones) {
    const r2 = mulberry32(Number.parseInt(s.id.replace(/\D/g, ''), 10) || 7);
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + r2() * 0.35;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * (s.kind === 'slate' ? 0.35 : 0.6), p.getZ(i) * k);
    }
    g.computeVertexNormals();
    const sm = new THREE.MeshStandardMaterial({ color: stoneColors[s.kind], roughness: s.kind === 'quartz' ? 0.5 : 0.8, flatShading: true });
    disposables.push(g, sm);
    const mesh = new THREE.Mesh(g, sm);
    mesh.scale.setScalar(0.06 + s.scale * 0.1);
    mesh.position.set((s.x * (width - 0.3)) / 2, SOIL_Y + 0.015, (s.z * (depthZ - 0.3)) / 2);
    mesh.rotation.y = s.rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Display stand (daiza): polished walnut, following the pot's footprint.
  const standTop = footY - 0.035;
  const standH = 0.075;
  const sw = width * 1.08 + 0.2;
  const sd = depthZ * 1.12 + 0.2;
  const standShape =
    pot.shape === 'rectangle' || pot.shape === 'crescent' ? roundedRect(sw, sd, Math.min(sw, sd) * 0.12) : ovalShape(sw, sd);
  const standGeo = new THREE.ExtrudeGeometry(standShape, {
    depth: standH,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.022,
    bevelSegments: 4,
    curveSegments: 48,
  });
  standGeo.rotateX(Math.PI / 2);
  standGeo.translate(0, standTop - 0.018, 0);
  // Planar UVs so the grain runs along the stand.
  const su = standGeo.getAttribute('uv');
  const spos = standGeo.getAttribute('position');
  for (let i = 0; i < su.count; i++) su.setXY(i, spos.getX(i) * 0.45 + spos.getY(i) * 0.6, spos.getZ(i) * 1.6 + spos.getY(i) * 0.6);
  const standMat = new THREE.MeshPhysicalMaterial({ map: walnutTexture(), roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.35 });
  disposables.push(standGeo, standMat);
  const stand = new THREE.Mesh(standGeo, standMat);
  stand.castShadow = true;
  stand.receiveShadow = true;
  group.add(stand);
  const legGeo = new THREE.CylinderGeometry(0.05, 0.065, 0.06, 18);
  disposables.push(legGeo);
  const legY = standTop - standH - 0.04 - 0.03;
  for (const [x, z] of [[-sw * 0.38, -sd * 0.3], [sw * 0.38, -sd * 0.3], [-sw * 0.38, sd * 0.3], [sw * 0.38, sd * 0.3]]) {
    const leg = new THREE.Mesh(legGeo, standMat);
    leg.position.set(x!, legY, z!);
    leg.castShadow = true;
    group.add(leg);
  }

  return {
    group,
    groundY: legY - 0.03,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Where moss grows: hugging the trunk and pooling toward the rim. */
function mossPatches(seed: number, coverage: number, aspect: number): MossPatch[] {
  const r = mulberry32(seed ^ 0x3c);
  const n = Math.round(coverage * 14);
  const out: MossPatch[] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    // Some patches around the nebari, most out toward the edge.
    const ring = i % 3 === 0 ? 0.12 + r() * 0.08 : 0.22 + r() * 0.2;
    out.push({
      u: 0.5 + Math.cos(a) * ring,
      v: 0.5 + Math.sin(a) * ring * Math.min(1.4, aspect),
      r: (0.06 + r() * 0.08) * (0.6 + coverage * 0.7),
    });
  }
  return out;
}
