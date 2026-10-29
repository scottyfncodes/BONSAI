import * as THREE from 'three';
import { mulberry32 } from '../tree/rng';
import type { SpeciesDef } from '../tree/species';

/** Procedural canvas textures – no binary assets to download. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const cache = new Map<string, THREE.Texture>();

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/**
 * Greyscale bark relief (white = raised). Used as both a colour modulation
 * map and a bump map so lighting picks out furrows as the tree turns.
 */
export function barkTexture(sp: SpeciesDef): THREE.Texture {
  return cached(`bark:${sp.id}`, () => {
    const size = 256;
    const [c, g] = canvas(size, size);
    const r = mulberry32(sp.id.length * 977);
    g.fillStyle = '#b8b8b8';
    g.fillRect(0, 0, size, size);
    if (sp.bark.pattern === 'fibrous') {
      // Long twisting fibres (juniper).
      for (let i = 0; i < 140; i++) {
        const x = r() * size;
        const w = 1 + r() * 4;
        const shade = 70 + r() * 150;
        g.strokeStyle = `rgb(${shade},${shade},${shade})`;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x, -10);
        const drift = (r() - 0.5) * 30;
        g.bezierCurveTo(x + drift, size * 0.33, x - drift, size * 0.66, x + drift * 0.5, size + 10);
        g.stroke();
        // Wrap horizontally so the seam is invisible.
        g.save();
        g.translate(x > size / 2 ? -size : size, 0);
        g.beginPath();
        g.moveTo(x, -10);
        g.bezierCurveTo(x + drift, size * 0.33, x - drift, size * 0.66, x + drift * 0.5, size + 10);
        g.stroke();
        g.restore();
      }
    } else if (sp.bark.pattern === 'plated') {
      // Irregular plates separated by dark fissures (pine).
      g.fillStyle = '#5a5a5a';
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 70; i++) {
        const x = r() * size;
        const y = r() * size;
        const w = 18 + r() * 30;
        const h = 26 + r() * 46;
        const s = 150 + r() * 90;
        g.fillStyle = `rgb(${s},${s},${s})`;
        for (const dx of [-size, 0, size]) {
          for (const dy of [-size, 0, size]) {
            g.beginPath();
            g.ellipse(x + dx, y + dy, w / 2, h / 2, (r() - 0.5) * 0.4, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    } else {
      // Smooth bark with faint horizontal lenticels (maple).
      for (let i = 0; i < 900; i++) {
        const s = 150 + r() * 70;
        g.fillStyle = `rgba(${s},${s},${s},0.35)`;
        g.fillRect(r() * size, r() * size, 2 + r() * 8, 1 + r());
      }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = 'rgba(120,120,120,0.25)';
        g.fillRect(r() * size, r() * size, 8 + r() * 14, 1.5);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = 4;
    return tex;
  });
}

/** Alpha-mapped single maple leaf. */
export function mapleLeafTexture(): THREE.Texture {
  return cached('leaf:maple', () => {
    const size = 128;
    const [c, g] = canvas(size, size);
    g.translate(size / 2, size * 0.92);
    g.fillStyle = '#fff';
    g.beginPath();
    const lobes = 7;
    for (let i = 0; i <= lobes * 2; i++) {
      const a = -Math.PI / 2 + ((i / (lobes * 2)) - 0.5) * Math.PI * 1.55;
      const lobe = i % 2 === 0;
      const center = 1 - Math.abs(i / (lobes * 2) - 0.5) * 1.1;
      const rr = lobe ? size * 0.5 * (0.55 + 0.45 * center) : size * 0.16;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr - size * 0.3;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    // Veins (slightly transparent so they read as subtle lines).
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1.5;
    for (let i = 0; i < lobes; i++) {
      const a = -Math.PI / 2 + ((i / (lobes - 1)) - 0.5) * Math.PI * 1.4;
      g.beginPath();
      g.moveTo(0, -size * 0.3);
      g.lineTo(Math.cos(a) * size * 0.38, Math.sin(a) * size * 0.38 - size * 0.3);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

/** Subtle clay grain for unglazed pots. */
export function clayTexture(): THREE.Texture {
  return cached('clay', () => {
    const size = 256;
    const [c, g] = canvas(size, size);
    const r = mulberry32(5);
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 2500; i++) {
      const s = 160 + r() * 95;
      g.fillStyle = `rgba(${s},${s},${s},0.5)`;
      g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  });
}

/** Soft radial blob used for the contact shadow under the pot. */
export function radialTexture(): THREE.Texture {
  return cached('radial', () => {
    const size = 128;
    const [c, g] = canvas(size, size);
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  });
}

/** Polished walnut grain for the display stand (colour map). */
export function walnutTexture(): THREE.Texture {
  return cached('walnut', () => {
    const w = 512;
    const h = 128;
    const [c, g] = canvas(w, h);
    const r = mulberry32(41);
    g.fillStyle = '#4a2f21';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const y = r() * h;
      const amp = 2 + r() * 6;
      const freq = 0.004 + r() * 0.01;
      const ph = r() * 10;
      const tone = r();
      g.strokeStyle = tone < 0.5 ? `rgba(30,17,11,${0.25 + r() * 0.35})` : `rgba(120,78,52,${0.15 + r() * 0.25})`;
      g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const yy = y + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.25;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  });
}

/** Low-contrast bench boards (greyscale, tinted by material colour). */
export function benchTexture(): THREE.Texture {
  return cached('bench', () => {
    const size = 512;
    const [c, g] = canvas(size, size);
    const r = mulberry32(77);
    g.fillStyle = '#d9d9d9';
    g.fillRect(0, 0, size, size);
    const boards = 5;
    for (let b = 0; b < boards; b++) {
      const y0 = (b * size) / boards;
      const shade = 210 + Math.round(r() * 30);
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(0, y0, size, size / boards);
      for (let i = 0; i < 40; i++) {
        const y = y0 + r() * (size / boards);
        const s = 180 + r() * 40;
        g.strokeStyle = `rgba(${s},${s},${s},0.35)`;
        g.lineWidth = 0.5 + r();
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(size * 0.3, y + (r() - 0.5) * 4, size * 0.7, y + (r() - 0.5) * 4, size, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(120,120,120,0.35)';
      g.fillRect(0, y0, size, 1.5);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.repeat.set(3, 3);
    tex.anisotropy = 4;
    return tex;
  });
}

/** White centre fading to black: used as an alpha map so the bench melts into the backdrop. */
export function fadeTexture(): THREE.Texture {
  return cached('fade', () => {
    const size = 256;
    const [c, g] = canvas(size, size);
    const grad = g.createRadialGradient(size / 2, size / 2, size * 0.12, size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.55, '#bbb');
    grad.addColorStop(1, '#000');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  });
}

/** Gentle tonal mottling for fired clay and glazes (multiplies the pot colour). */
export function clayMottleTexture(): THREE.Texture {
  return cached('clayMottle', () => {
    const size = 256;
    const [c, g] = canvas(size, size);
    const r = mulberry32(13);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 160; i++) {
      const x = r() * size;
      const y = r() * size;
      const rad = 8 + r() * 40;
      const s = 200 + r() * 55;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${s},${s * 0.97},${s * 0.93},0.35)`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 1500; i++) {
      const s = 150 + r() * 80;
      g.fillStyle = `rgba(${s},${s * 0.95},${s * 0.9},0.35)`;
      g.fillRect(r() * size, r() * size, 1.2, 1.2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  });
}

export interface MossPatch {
  u: number;
  v: number;
  r: number;
}

const soilCache = new Map<string, THREE.Texture>();

/**
 * Soil for one pot, painted once: akadama grit, a moss carpet in organic
 * patches, and in winter a dusting of snow. UVs span the whole soil surface.
 */
export function paintedSoilTexture(key: string, patches: MossPatch[], snow: boolean): THREE.Texture {
  const k = `${key}:${snow}`;
  const hit = soilCache.get(k);
  if (hit) return hit;
  if (soilCache.size > 12) {
    for (const t of soilCache.values()) t.dispose();
    soilCache.clear();
  }
  const size = 512;
  const [c, g] = canvas(size, size);
  const r = mulberry32(patches.length * 131 + 7);
  g.fillStyle = '#3a2c23';
  g.fillRect(0, 0, size, size);
  // Akadama and grit.
  for (let i = 0; i < 9000; i++) {
    const t = r();
    g.fillStyle = t < 0.45 ? `rgba(128,88,60,${0.45 + r() * 0.4})` : t < 0.8 ? 'rgba(40,30,24,0.7)' : 'rgba(170,140,106,0.55)';
    g.beginPath();
    g.arc(r() * size, r() * size, 0.8 + r() * 1.8, 0, Math.PI * 2);
    g.fill();
  }
  // Moss: many fine dots, dense at each patch centre and feathering out.
  const tones = ['#5c7a33', '#6f8f3d', '#4f6a2c', '#86a44c', '#3f5626'];
  for (const p of patches) {
    const cx = p.u * size;
    const cy = p.v * size;
    const rad = p.r * size;
    // A soft, solid carpet first, so the patch reads even when mipmapped…
    const base = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    base.addColorStop(0, 'rgba(84,112,46,0.95)');
    base.addColorStop(0.6, 'rgba(78,104,42,0.75)');
    base.addColorStop(1, 'rgba(70,94,38,0)');
    g.fillStyle = base;
    g.beginPath();
    // …with a lumpy, irregular outline rather than a perfect circle.
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const rr = rad * (0.75 + r() * 0.35);
      if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.fill();
    // Then tufts of brighter and darker moss on top.
    const n = Math.round(rad * rad * 2.2);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = rad * Math.sqrt(-Math.log(1 - r() * 0.98)) * 0.5;
      g.fillStyle = tones[Math.floor(r() * tones.length)]!;
      g.globalAlpha = 0.5 + r() * 0.5;
      g.beginPath();
      g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.6 + r() * 2.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  if (snow) {
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(245,247,250,${0.35 + r() * 0.5})`;
      g.beginPath();
      g.arc(r() * size, r() * size, 1 + r() * 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  soilCache.set(k, tex);
  return tex;
}
