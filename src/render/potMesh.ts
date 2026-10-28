import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type PotStyle, type SurfaceStyle, potColor, potDims } from '../game/pots';
import { mulberry32 } from '../tree/rng';
import { clayTexture, soilTexture } from './textures';

export interface PotBuild {
  group: THREE.Group;
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
export function buildPot(pot: PotStyle, surface: SurfaceStyle, seed: number): PotBuild {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const { width, depthZ, height } = potDims(pot);
  const color = potColor(pot.colorId);
  const glazed = color.material === 'glazed';
  const mat = glazed
    ? new THREE.MeshPhysicalMaterial({ color: color.hex, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.25 })
    : new THREE.MeshStandardMaterial({ color: color.hex, roughness: 0.95, bumpMap: clayTexture(), bumpScale: 0.6 });
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
    sp.setY(i, 0.035 * Math.max(0, 1 - (x * x + z * z)) - 0.005);
  }
  soilGeo.computeVertexNormals();
  const uv = soilGeo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, sp.getX(i) * 1.6, sp.getZ(i) * 1.6);
  disposables.push(soilGeo);
  const soilMat = new THREE.MeshStandardMaterial({ map: soilTexture(), roughness: 1 });
  disposables.push(soilMat);
  const soil = new THREE.Mesh(soilGeo, soilMat);
  soil.receiveShadow = true;
  group.add(soil);

  // Moss: patches of small, soft cushions hugging the soil.
  const rng = mulberry32(seed ^ 0x51);
  const patches = Math.round(surface.moss * 16);
  if (patches > 0) {
    const mossGeo = mergeVertices(new THREE.IcosahedronGeometry(1, 2).deleteAttribute('normal').deleteAttribute('uv'));
    mossGeo.computeVertexNormals();
    const mossMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    disposables.push(mossGeo, mossMat);
    const perPatch = 16;
    const moss = new THREE.InstancedMesh(mossGeo, mossMat, patches * perPatch);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const tones = ['#6c873d', '#7f9a47', '#5a7334', '#8aa452'];
    let n = 0;
    for (let i = 0; i < patches; i++) {
      const a = rng() * Math.PI * 2;
      const rr = 0.3 + Math.sqrt(rng()) * 0.6;
      const cx = (Math.cos(a) * rr * (width - 0.25)) / 2;
      const cz = (Math.sin(a) * rr * (depthZ - 0.25)) / 2;
      const spread = 0.08 + rng() * 0.12 * surface.moss + 0.05;
      for (let k = 0; k < perPatch; k++) {
        const px = cx + (rng() - 0.5) * spread * 2;
        const pz = cz + (rng() - 0.5) * spread * 2;
        if (Math.hypot(px, pz) < 0.18) continue;
        const nx = px / ((width - 0.18) / 2);
        const nz = pz / ((depthZ - 0.18) / 2);
        if (nx * nx + nz * nz > 1) continue;
        const sz = 0.022 + rng() * 0.03;
        m.makeScale(sz * 1.2, sz * 0.8, sz * 1.2);
        m.setPosition(px, 0.035 * Math.max(0, 1 - (nx * nx + nz * nz)) + sz * 0.15, pz);
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
    mesh.position.set((s.x * (width - 0.3)) / 2, 0.02, (s.z * (depthZ - 0.3)) / 2);
    mesh.rotation.y = s.rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
