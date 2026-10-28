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

/** Tileable soil / akadama texture. */
export function soilTexture(): THREE.Texture {
  return cached('soil', () => {
    const size = 256;
    const [c, g] = canvas(size, size);
    const r = mulberry32(99);
    g.fillStyle = '#3a2c23';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) {
      const s = r();
      const col = s < 0.45 ? `rgba(122,84,58,${0.45 + r() * 0.4})` : s < 0.8 ? `rgba(40,30,24,0.7)` : `rgba(160,132,100,0.55)`;
      g.fillStyle = col;
      const x = r() * size;
      const y = r() * size;
      const rr = 1 + r() * 2.4;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
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
