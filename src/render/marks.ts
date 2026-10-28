import * as THREE from 'three';
import { type TreeLayout, bezierPoint, frameAt, radiusAt } from '../tree/layout';
import type { SpeciesDef } from '../tree/species';
import type { TreeState } from '../tree/types';

/** Healing cut marks and dormant buds. */
export function buildMarks(tree: TreeState, layout: TreeLayout, sp: SpeciesDef): { group: THREE.Group; dispose(): void } {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const wounds = Object.values(tree.wounds).filter((w) => w.heal < 1 && layout.has(w.branchId));
  if (wounds.length) {
    const geo = new THREE.CylinderGeometry(1, 1, 0.25, 16);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, wounds.length);
    const fresh = new THREE.Color('#dcc196');
    const bark = new THREE.Color(sp.bark.base);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const z = new THREE.Vector3(0, 0, 1);
    wounds.forEach((w, i) => {
      const l = layout.get(w.branchId)!;
      const f = frameAt(l, w.t);
      const p = bezierPoint(l, w.t);
      const r = radiusAt(l, w.t);
      let dir: THREE.Vector3;
      let pos: THREE.Vector3;
      if (w.t >= 0.999) {
        dir = new THREE.Vector3(...f.t);
        pos = new THREE.Vector3(...p).addScaledVector(dir, 0.002);
      } else {
        dir = new THREE.Vector3(
          f.n[0] * Math.cos(w.roll) + f.b[0] * Math.sin(w.roll),
          f.n[1] * Math.cos(w.roll) + f.b[1] * Math.sin(w.roll),
          f.n[2] * Math.cos(w.roll) + f.b[2] * Math.sin(w.roll),
        ).normalize();
        pos = new THREE.Vector3(...p).addScaledVector(dir, r * 0.92);
      }
      const size = Math.min(w.size, r * 0.95) * (1 - 0.65 * w.heal);
      q.setFromUnitVectors(z, dir);
      m.compose(pos, q, new THREE.Vector3(size, size, Math.max(0.01, size * 0.35)));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, fresh.clone().lerp(bark, Math.min(1, w.heal * 1.3)));
    });
    mesh.castShadow = false;
    group.add(mesh);
  }

  const buds = Object.values(tree.buds).filter((b) => layout.has(b.branchId));
  if (buds.length) {
    const pine = sp.id === 'pine';
    const geo = new THREE.SphereGeometry(1, 8, 6);
    if (pine) geo.scale(0.7, 1.8, 0.7);
    const mat = new THREE.MeshStandardMaterial({
      color: pine ? '#cdbb83' : sp.id === 'maple' ? '#a5462f' : '#a9c56e',
      roughness: 0.6,
    });
    disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, buds.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    buds.forEach((b, i) => {
      const l = layout.get(b.branchId)!;
      const f = frameAt(l, b.t);
      const p = bezierPoint(l, b.t);
      const r = radiusAt(l, b.t);
      const out = b.t >= 0.999
        ? new THREE.Vector3(...f.t)
        : new THREE.Vector3(
            f.n[0] * Math.cos(b.roll) + f.b[0] * Math.sin(b.roll),
            f.n[1] * Math.cos(b.roll) + f.b[1] * Math.sin(b.roll),
            f.n[2] * Math.cos(b.roll) + f.b[2] * Math.sin(b.roll),
          );
      const s = 0.007 + Math.min(0.006, r * 0.15);
      const pos = new THREE.Vector3(...p).addScaledVector(out, r + s * 0.6);
      q.setFromUnitVectors(up, out.clone().add(new THREE.Vector3(0, 0.8, 0)).normalize());
      m.compose(pos, q, new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    });
    group.add(mesh);
  }

  return {
    group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
