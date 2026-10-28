import * as THREE from 'three';
import { clamp } from '../tree/vec';

export interface CameraPose {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

export const PITCH_LIMITS: [number, number] = [-0.12, 1.05];
export const DIST_LIMITS: [number, number] = [2.6, 14];

/** Damped orbit camera. All gestures write to `goal`; the camera eases toward it. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  pose: CameraPose;
  goal: CameraPose;
  home: CameraPose;
  /** Radians per second of automatic turntable spin (portrait mode). */
  autoOrbit = 0;
  /** Inertial yaw velocity after a flick. */
  spin = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 100);
    this.home = { yaw: 0.35, pitch: 0.2, distance: 8.6, target: [0, 1.2, 0] };
    this.pose = { ...this.home, target: [...this.home.target] };
    this.goal = { ...this.home, target: [...this.home.target] };
    this.apply();
  }

  /**
   * Where the composition should sit on screen: `center` is the fraction
   * from the top where the tree's middle lands, `fill` the fraction of the
   * view height it occupies. The Studio leaves room for its tool panels.
   */
  framing = { center: 0.36, fill: 0.5 };

  /** Choose a resting pose that fits tree and pot into the framing window. */
  setHome(height: number, width: number, potDepth: number, aspect: number): void {
    const total = height + potDepth;
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    const visibleH = Math.max(total / this.framing.fill, (width * 1.12) / Math.max(aspect, 0.3) / Math.min(1, this.framing.fill * 1.6));
    const distance = clamp(visibleH / (2 * tanHalf), 5, DIST_LIMITS[1]);
    const mid = height / 2 - potDepth / 2;
    // Lower the look-at point so the tree's middle sits `center` from the top.
    const shift = (0.5 - this.framing.center) * 2 * distance * tanHalf;
    this.home = { ...this.home, distance, target: [0, mid - shift * Math.cos(this.home.pitch), 0] };
  }

  reset(): void {
    this.goal = { ...this.home, yaw: this.nearestYaw(this.home.yaw), target: [...this.home.target] };
    this.spin = 0;
  }

  private nearestYaw(y: number): number {
    const twoPi = Math.PI * 2;
    return y + Math.round((this.goal.yaw - y) / twoPi) * twoPi;
  }

  orbit(dYaw: number, dPitch: number): void {
    this.goal.yaw += dYaw;
    this.goal.pitch = clamp(this.goal.pitch + dPitch, PITCH_LIMITS[0], PITCH_LIMITS[1]);
  }

  zoom(factor: number): void {
    this.goal.distance = clamp(this.goal.distance * factor, DIST_LIMITS[0], DIST_LIMITS[1]);
  }

  /** Pan in screen space (pixels), scaled so the content tracks the finger. */
  pan(dx: number, dy: number, viewportH: number): void {
    const worldPerPx = (2 * this.pose.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / viewportH;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const t = this.goal.target;
    const nx = t[0] - right.x * dx * worldPerPx + up.x * dy * worldPerPx;
    const ny = t[1] - right.y * dx * worldPerPx + up.y * dy * worldPerPx;
    const nz = t[2] - right.z * dx * worldPerPx + up.z * dy * worldPerPx;
    // Keep the tree in reach.
    this.goal.target = [clamp(nx, -2.5, 2.5), clamp(ny, -0.5, 3.6), clamp(nz, -2.5, 2.5)];
  }

  /** Advance easing; returns true while still moving. */
  update(dt: number, reducedMotion: boolean): boolean {
    if (this.autoOrbit) this.goal.yaw += this.autoOrbit * dt;
    if (Math.abs(this.spin) > 1e-4) {
      this.goal.yaw += this.spin * dt;
      this.spin *= Math.exp(-dt * 4);
    } else this.spin = 0;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 14);
    const p = this.pose;
    const g = this.goal;
    const before = p.yaw + p.pitch + p.distance + p.target[0] + p.target[1] + p.target[2];
    p.yaw += (g.yaw - p.yaw) * k;
    p.pitch += (g.pitch - p.pitch) * k;
    p.distance += (g.distance - p.distance) * k;
    p.target = [
      p.target[0] + (g.target[0] - p.target[0]) * k,
      p.target[1] + (g.target[1] - p.target[1]) * k,
      p.target[2] + (g.target[2] - p.target[2]) * k,
    ];
    this.apply();
    const after = p.yaw + p.pitch + p.distance + p.target[0] + p.target[1] + p.target[2];
    return Math.abs(after - before) > 1e-5 || this.autoOrbit !== 0 || this.spin !== 0;
  }

  apply(): void {
    const { yaw, pitch, distance, target } = this.pose;
    const cp = Math.cos(pitch);
    this.camera.position.set(
      target[0] + Math.sin(yaw) * cp * distance,
      target[1] + Math.sin(pitch) * distance,
      target[2] + Math.cos(yaw) * cp * distance,
    );
    this.camera.lookAt(target[0], target[1], target[2]);
    this.camera.updateMatrixWorld();
  }
}
