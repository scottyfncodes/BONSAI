import * as THREE from 'three';
import { mulberry32 } from '../tree/rng';
import type { Season } from '../tree/species';
import { mapleLeafTexture } from './textures';

/**
 * A few drifting seasonal particles around the tree: spring petals, summer
 * light motes, autumn leaves, winter snow. Deliberately sparse – atmosphere,
 * not weather.
 */
interface P {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  phase: number;
  size: number;
}

const COUNT: Record<Season, number> = { spring: 16, summer: 18, autumn: 22, winter: 46 };

let dotTex: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

let petalTex: THREE.Texture | null = null;
export function petalTexture(): THREE.Texture {
  if (petalTex) return petalTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(56, 18, 54, 50, 32, 60);
  g.bezierCurveTo(10, 50, 8, 18, 32, 4);
  g.fill();
  petalTex = new THREE.CanvasTexture(c);
  petalTex.colorSpace = THREE.SRGBColorSpace;
  return petalTex;
}

export class SeasonParticles {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private rng = mulberry32(99);
  private floor = -0.6;
  private dummy = new THREE.Object3D();
  readonly season: Season;

  constructor(season: Season, floorY: number) {
    this.season = season;
    this.floor = floorY;
    const n = COUNT[season];
    const leafy = season === 'autumn' || season === 'spring';
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: season === 'autumn' ? mapleLeafTexture() : season === 'spring' ? petalTexture() : dotTexture(),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      alphaTest: leafy ? 0.3 : 0,
      opacity: season === 'summer' ? 0.7 : season === 'winter' ? 0.9 : 1,
      blending: season === 'summer' ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    const palette =
      season === 'autumn'
        ? ['#c4462a', '#d9633a', '#b8352a', '#d88b2f']
        : season === 'spring'
          ? ['#f4cfd0', '#f8dde0', '#eebcc0']
          : season === 'summer'
            ? ['#fff3c4', '#fde9a8']
            : ['#ffffff', '#f4f7fa'];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const p = this.spawn(true);
      this.ps.push(p);
      col.set(palette[i % palette.length]!);
      this.mesh.setColorAt(i, col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.update(0);
  }

  private spawn(anywhere: boolean): P {
    const r = this.rng;
    const s = this.season;
    const top = 4.2;
    const y = anywhere ? this.floor + r() * (top - this.floor) : top + r() * 0.6;
    const a = r() * Math.PI * 2;
    const rad = 0.6 + Math.sqrt(r()) * 2.4;
    const fall = s === 'winter' ? 0.32 + r() * 0.2 : s === 'summer' ? 0 : s === 'autumn' ? 0.42 + r() * 0.2 : 0.3 + r() * 0.15;
    return {
      pos: new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad),
      vel: new THREE.Vector3((r() - 0.3) * 0.12, -fall, (r() - 0.5) * 0.08),
      spin: new THREE.Vector3((r() - 0.5) * 3, (r() - 0.5) * 3, (r() - 0.5) * 3),
      rot: new THREE.Euler(r() * 6, r() * 6, r() * 6),
      phase: r() * 10,
      size: s === 'autumn' ? 0.07 + r() * 0.04 : s === 'spring' ? 0.045 + r() * 0.025 : s === 'winter' ? 0.025 + r() * 0.025 : 0.03 + r() * 0.03,
    };
  }

  update(dt: number): void {
    const t = performance.now() / 1000;
    for (let i = 0; i < this.ps.length; i++) {
      let p = this.ps[i]!;
      if (this.season === 'summer') {
        // Motes hang and wander in the warm air.
        p.pos.x += Math.sin(t * 0.4 + p.phase) * 0.06 * dt;
        p.pos.y += Math.sin(t * 0.3 + p.phase * 2) * 0.05 * dt;
        p.pos.z += Math.cos(t * 0.35 + p.phase) * 0.06 * dt;
      } else {
        p.pos.addScaledVector(p.vel, dt);
        // Flutter side to side as they fall.
        p.pos.x += Math.sin(t * 1.6 + p.phase) * 0.18 * dt;
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
        if (p.pos.y < this.floor) {
          p = this.spawn(false);
          this.ps[i] = p;
        }
      }
      const twinkle = this.season === 'summer' ? 0.7 + 0.3 * Math.sin(t * 2 + p.phase) : 1;
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.copy(p.rot);
      this.dummy.scale.setScalar(p.size * twinkle);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
