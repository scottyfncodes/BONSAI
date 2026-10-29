import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type TreeLayout, bezierTangent } from '../tree/layout';
import { mulberry32, rngFor } from '../tree/rng';
import { type SpeciesDef, seasonOf, seasonProgress } from '../tree/species';
import type { BranchId, TreeState } from '../tree/types';
import { type V3, clamp } from '../tree/vec';
import { mapleLeafTexture } from './textures';
import { type FoliageCluster } from '../tree/foliage';

export { foliageClusters, type FoliageCluster } from '../tree/foliage';

/** Hard cap on instances to protect mobile GPUs. */
const MAX_INSTANCES = 7000;

/** Seasonal foliage colour (with gentle interpolation between seasons). */
export function foliageColor(sp: SpeciesDef, day: number): THREE.Color {
  const season = seasonOf(day);
  const idx = { spring: 0, summer: 1, autumn: 2, winter: 3 }[season];
  const nextIdx = (idx + 1) % 4;
  const prog = seasonProgress(day);
  const a = new THREE.Color(sp.foliage.colors[idx]);
  const b = new THREE.Color(sp.foliage.colors[nextIdx]);
  return a.lerp(b, Math.max(0, prog - 0.7) / 0.3 * 0.6);
}

/** Fraction of leaves still on a deciduous tree (leaf fall in late autumn, bare winter). */
export function leafPresence(sp: SpeciesDef, day: number): number {
  if (!sp.foliage.deciduous) return 1;
  const season = seasonOf(day);
  const p = seasonProgress(day);
  if (season === 'winter') return 0;
  if (season === 'autumn') return clamp(1 - Math.max(0, p - 0.45) / 0.5, 0, 1);
  if (season === 'spring') return clamp(0.25 + p * 3, 0, 1);
  return 1;
}

// --------------------------------------------------------------- geometries

let blobGeo: THREE.BufferGeometry | null = null;
/** A soft, lumpy cloud used for juniper foliage pads; top lighter than bottom. */
function juniperBlob(): THREE.BufferGeometry {
  if (blobGeo) return blobGeo;
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = g.getAttribute('position');
  const colors: number[] = [];
  const r = mulberry32(17);
  // Broad lobes give the pad its cloud outline; many small ones read as foliage sprays.
  const lobes = Array.from({ length: 12 }, () => [r() * 2 - 1, r() * 1.2 - 0.2, r() * 2 - 1, 0.1 + r() * 0.16, 6]);
  const sprays = Array.from({ length: 46 }, () => [r() * 2 - 1, r() * 1.6 - 0.4, r() * 2 - 1, 0.035 + r() * 0.05, 28]);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    let d = 1;
    let spray = 0;
    for (const [bx, by, bz, h, k] of lobes) {
      const dd = v.distanceTo(tmp.set(bx!, by!, bz!).normalize());
      d += h! * Math.exp(-dd * dd * k!);
    }
    for (const [bx, by, bz, h, k] of sprays) {
      const dd = v.distanceTo(tmp.set(bx!, by!, bz!).normalize());
      const e = h! * Math.exp(-dd * dd * k!);
      d += e;
      spray += e;
    }
    // Classic pad: flat, shadowed underside; soft dome on top.
    const y = v.y < 0 ? v.y * 0.3 : v.y * 0.72;
    pos.setXYZ(i, v.x * d, y * d, v.z * d);
    // Baked occlusion: dark underside, lit crown, bright spray tips.
    const up = clamp((v.y + 1) / 2, 0, 1);
    const shade = 0.42 + 0.5 * up * up + spray * 3.2;
    colors.push(shade, shade * 1.02, shade * 0.96);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  blobGeo = g;
  return g;
}

let tuftGeo: THREE.BufferGeometry | null = null;
/** A pine needle tuft: thin blades radiating up and outward. */
function pineTuft(): THREE.BufferGeometry {
  if (tuftGeo) return tuftGeo;
  const pos: number[] = [];
  const col: number[] = [];
  const r = mulberry32(31);
  const N = 46;
  for (let i = 0; i < N; i++) {
    const az = r() * Math.PI * 2;
    const el = 0.15 + r() * 1.25;
    const len = 0.75 + r() * 0.4;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).multiplyScalar(0.035);
    const tip = dir.clone().multiplyScalar(len);
    pos.push(-side.x, -side.y, -side.z, side.x, side.y, side.z, tip.x, tip.y, tip.z);
    col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1.15, 1.15, 1.05);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // Needles read best lit from "up": bias normals so tufts don't go black when back-lit.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) {
    const v = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).multiplyScalar(0.4).add(new THREE.Vector3(0, 0.6, 0)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  tuftGeo = g;
  return g;
}

let leafGeo: THREE.BufferGeometry | null = null;
function leafCard(): THREE.BufferGeometry {
  if (leafGeo) return leafGeo;
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -0.42);
  leafGeo = g;
  return g;
}

// --------------------------------------------------------------- meshes

export interface FoliageMesh {
  object: THREE.Object3D;
  /** Instance → branch mapping, for highlighting. */
  owners: BranchId[];
  meshes: THREE.InstancedMesh[];
  baseColors: THREE.Color[];
  dispose(): void;
}

/** Shared clock for foliage sway (seconds). Advanced by the stage while ambient motion runs. */
export const windTime = { value: 0 };
/** 0..1 snow lying on upward-facing foliage (winter). */
export const snowAmount = { value: 0 };

/**
 * Sway foliage in the wind, after instancing, in world units: taller foliage
 * moves more, neighbouring pads move together, the canopy never "swims".
 */
function addWind(
  m: THREE.Material,
  amp: number,
  extraFragment?: (shader: { fragmentShader: string }) => void,
  snowScale = 1,
  /** Fine world-space grain that breaks up smooth surfaces into foliage sprays (0 = none). */
  grain = 0,
): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uSnow = snowAmount;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFolPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uSnow;
varying vec3 vFolPos;
float folHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float folNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( folHash( i ), folHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( folHash( i + vec3( 0, 1, 0 ) ), folHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( folHash( i + vec3( 0, 0, 1 ) ), folHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( folHash( i + vec3( 0, 1, 1 ) ), folHash( i + 1.0 ), f.x ), f.y ), f.z );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  // Foliage sprays: crevices fall dark, tips catch the light.
  float g1 = folNoise( vFolPos * 38.0 );
  float g2 = folNoise( vFolPos * 95.0 );
  diffuseColor.rgb *= mix( 1.0, 0.62 + 0.5 * g1 + 0.22 * g2, ${grain.toFixed(2)} );
  // Snow settles on whatever faces the sky.
  float upness = dot( normalize( vNormal ), normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.93, 0.95, 0.97 ), uSnow * ${snowScale.toFixed(2)} * smoothstep( 0.35, 0.8, upness ) );`,
      );
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
  {
    vec3 ip = mvPosition.xyz;
    float h = clamp( ip.y / 3.0, 0.0, 1.3 );
    float gust = 0.65 + 0.35 * sin( uWindTime * 0.31 );
    float sx = sin( uWindTime * 1.15 + ip.x * 1.7 + ip.z * 1.1 ) * 0.7 + sin( uWindTime * 2.9 + ip.z * 3.3 ) * 0.3;
    float sz = cos( uWindTime * 0.95 + ip.z * 1.9 - ip.x * 0.8 ) * 0.6;
    mvPosition.xyz += vec3( sx, sx * 0.25, sz ) * ${amp.toFixed(4)} * h * gust;
  }
  vFolPos = mvPosition.xyz;
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`,
      );
    extraFragment?.(shader);
  };
}

const materials = new Map<string, THREE.Material>();
function foliageMaterial(sp: SpeciesDef): THREE.Material {
  let m = materials.get(sp.id);
  if (m) return m;
  if (sp.foliage.kind === 'palmate') {
    m = new THREE.MeshStandardMaterial({
      map: mapleLeafTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0,
    });
    // Thin leaves transmit light: shade both faces with the upward normal
    // instead of letting back faces go black.
    addWind(m, 0.03, (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize( vNormal );',
      );
    });
  } else if (sp.foliage.kind === 'needle') {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
    addWind(m, 0.018, undefined, 0.35, 0.35);
  } else {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    addWind(m, 0.012, undefined, 1, 1);
  }
  materials.set(sp.id, m);
  return m;
}

export function buildFoliage(
  tree: TreeState,
  clusters: FoliageCluster[],
  sp: SpeciesDef,
  layout: TreeLayout,
): FoliageMesh {
  const group = new THREE.Group();
  const day = tree.day;
  const base = foliageColor(sp, day);
  const presence = leafPresence(sp, day);
  const kind = sp.foliage.kind;
  const perCluster = kind === 'scale' ? 3 : kind === 'palmate' ? 16 : 3;
  const budget = Math.min(MAX_INSTANCES, clusters.length * perCluster);
  const each = Math.max(1, Math.floor(budget / Math.max(1, clusters.length)));
  const geo = kind === 'scale' ? juniperBlob() : kind === 'palmate' ? leafCard() : pineTuft();
  const mesh = new THREE.InstancedMesh(geo, foliageMaterial(sp), Math.max(1, clusters.length * each));
  mesh.castShadow = true;
  // Upper pads shade the ones beneath: the depth that makes tiers read.
  mesh.receiveShadow = true;
  const owners: BranchId[] = [];
  const baseColors: THREE.Color[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const autumnPalette = ['#c4462a', '#d9633a', '#b8352a', '#d88b2f', '#a8452f'].map((c) => new THREE.Color(c));
  let n = 0;
  for (const c of clusters) {
    const r = rngFor(tree.seed, c.branchId, Math.round(c.pos[0] * 1000), Math.round(c.pos[2] * 1000));
    const owner = tree.branches[c.branchId];
    const vigorTint = owner ? 0.85 + 0.25 * owner.vigor : 1;
    for (let k = 0; k < each; k++) {
      if (kind === 'palmate' && r() > presence) continue;
      if (kind === 'scale') {
        p.set(c.pos[0] + (r() - 0.5) * c.size * 1.3, c.pos[1] + (r() - 0.5) * c.size * 0.35, c.pos[2] + (r() - 0.5) * c.size * 1.3);
        const sc = c.size * (0.7 + r() * 0.45);
        s.set(sc * (1.05 + r() * 0.3), sc, sc * (1.05 + r() * 0.3));
        e.set(0, r() * Math.PI * 2, 0);
      } else if (kind === 'palmate') {
        const a = r() * Math.PI * 2;
        const rad = c.size * (0.15 + r() * 1.05);
        p.set(c.pos[0] + Math.cos(a) * rad, c.pos[1] + (r() - 0.35) * c.size * 0.6, c.pos[2] + Math.sin(a) * rad);
        const sc = c.size * (0.85 + r() * 0.35);
        s.set(sc, sc, sc);
        e.set((r() - 0.5) * 0.9, a + Math.PI / 2 + (r() - 0.5) * 0.8, (r() - 0.5) * 0.9);
      } else {
        const l = layout.get(c.branchId);
        const tan = l ? bezierTangent(l, 1) : ([0, 1, 0] as V3);
        p.set(c.pos[0] + (r() - 0.5) * c.size * 0.8, c.pos[1] - c.size * 0.15, c.pos[2] + (r() - 0.5) * c.size * 0.8);
        const sc = c.size * (1 + r() * 0.35);
        s.set(sc, sc * 0.85, sc);
        e.set(tan[2] * 0.4 + (r() - 0.5) * 0.4, r() * Math.PI * 2, -tan[0] * 0.4 + (r() - 0.5) * 0.4);
      }
      q.setFromEuler(e);
      m.compose(p, q, s);
      mesh.setMatrixAt(n, m);
      let col = base.clone();
      // Inner and lower parts of a pad sit in its own shade.
      if (kind === 'scale') col.multiplyScalar(0.82 + 0.3 * clamp((p.y - c.pos[1]) / c.size + 0.5, 0, 1));
      if (kind === 'palmate' && seasonOf(day) === 'autumn') {
        col = autumnPalette[Math.floor(r() * autumnPalette.length)]!.clone();
      }
      col.multiplyScalar((0.82 + r() * 0.3) * vigorTint);
      mesh.setColorAt(n, col);
      owners.push(c.branchId);
      baseColors.push(col);
      n++;
    }
  }
  mesh.count = n;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return {
    object: group,
    owners,
    meshes: [mesh],
    baseColors,
    dispose() {
      mesh.dispose();
    },
  };
}

/** Recolour instances owned by highlighted branches. */
export function highlightFoliage(f: FoliageMesh, ids: Set<BranchId> | null, color: THREE.Color, mix: number): void {
  const mesh = f.meshes[0];
  if (!mesh) return;
  const tmp = new THREE.Color();
  for (let i = 0; i < f.owners.length; i++) {
    const baseC = f.baseColors[i]!;
    if (ids && ids.has(f.owners[i]!)) tmp.copy(baseC).lerp(color, mix);
    else tmp.copy(baseC);
    mesh.setColorAt(i, tmp);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
