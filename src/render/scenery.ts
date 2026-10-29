import { mulberry32 } from '../tree/rng';
import type { Season } from '../tree/species';

/**
 * Painted backdrops: an ink-wash landscape behind the tree, built from SVG
 * layers. The same layers drive the live view (with parallax as the camera
 * turns) and are painted into exported portraits.
 */
export interface Scenery {
  id: string;
  /** Sky gradient, top → horizon → bottom. */
  sky: [string, string, string];
  /** The sun (or moon) disc behind the crown. */
  sun: { color: string; glow: string; r: number; x: number; y: number } | null;
  /** Mountain ridges, far → near: [ink colour, opacity]. */
  ridges: [string, number][];
  /** Mist colour that ridges dissolve into. */
  mist: string;
  /** Tiny ink birds in the distance. */
  birds: number;
  /** Text colour that reads on this backdrop. */
  ink: string;
  /** Floor colour where the display bench meets the backdrop. */
  floor: string;
}

const W = 1600;
const H = 1000;

export const SEASON_SCENERY: Record<Season, Scenery> = {
  spring: {
    id: 'spring',
    sky: ['#f6ece6', '#f5e7de', '#efe3d2'],
    sun: { color: '#e9967f', glow: '#f3c3b2', r: 92, x: 0.555, y: 0.25 },
    ridges: [
      ['#c6bfc4', 0.5],
      ['#ada6ab', 0.42],
      ['#8f8a8d', 0.3],
    ],
    mist: '#f3e8de',
    birds: 3,
    ink: '#2b2622',
    floor: '#e9ddcb',
  },
  summer: {
    id: 'summer',
    sky: ['#eef1e6', '#f2efe0', '#e8e4cf'],
    sun: { color: '#efcf8d', glow: '#f6e5bd', r: 96, x: 0.56, y: 0.24 },
    ridges: [
      ['#b9c2b3', 0.5],
      ['#9aa595', 0.42],
      ['#7f8a7a', 0.3],
    ],
    mist: '#eeeedd',
    birds: 2,
    ink: '#24261f',
    floor: '#e4dfc9',
  },
  autumn: {
    id: 'autumn',
    sky: ['#f7e7d3', '#f3dcc1', '#ead2b3'],
    sun: { color: '#cf4a2d', glow: '#eb9c79', r: 98, x: 0.56, y: 0.25 },
    ridges: [
      ['#c9b39f', 0.55],
      ['#ad9480', 0.45],
      ['#8c7564', 0.32],
    ],
    mist: '#f2e0c8',
    birds: 4,
    ink: '#33221a',
    floor: '#e8d4ba',
  },
  winter: {
    id: 'winter',
    sky: ['#d9dfe4', '#e2e6e8', '#e3e5e2'],
    sun: { color: '#f5f6f4', glow: '#ffffff', r: 84, x: 0.56, y: 0.24 },
    ridges: [
      ['#c3c8cc', 0.55],
      ['#a7aeb3', 0.45],
      ['#8a9196', 0.32],
    ],
    mist: '#eceeec',
    birds: 0,
    ink: '#22262a',
    floor: '#e2e3df',
  },
};

/** Portrait backdrops. */
export const PORTRAIT_SCENERY: Record<string, Scenery> = {
  paper: { ...SEASON_SCENERY.spring, id: 'paper', sky: ['#fbf7ee', '#f4eee1', '#e8dfcc'], ridges: [], birds: 0, sun: { color: '#d6553a', glow: '#efb39d', r: 70, x: 0.66, y: 0.2 }, floor: '#ebe2d1' },
  mist: { ...SEASON_SCENERY.summer, id: 'mist', sky: ['#eef1f1', '#e7ebe9', '#d9dfda'], sun: null, ridges: [['#c4cbc8', 0.6], ['#a9b2ae', 0.5], ['#8d9792', 0.38]], mist: '#e9edea', birds: 2, floor: '#dfe3dd' },
  dusk: SEASON_SCENERY.autumn,
  ink: {
    id: 'ink',
    sky: ['#2d2a27', '#24211f', '#191715'],
    sun: { color: '#efe7d6', glow: '#7d756a', r: 70, x: 0.64, y: 0.2 },
    ridges: [
      ['#4a4540', 0.7],
      ['#3a3632', 0.75],
      ['#2c2926', 0.8],
    ],
    mist: '#24211f',
    birds: 0,
    ink: '#f3ecdf',
    floor: '#1d1b19',
  },
  moss: { ...SEASON_SCENERY.summer, id: 'moss', sky: ['#e6ecd9', '#dbe3c8', '#c8d3ad'], ridges: [['#a7b58e', 0.55], ['#8a9a72', 0.48], ['#6e7e58', 0.36]], mist: '#dfe6cf', sun: { color: '#f2deac', glow: '#f6ecc9', r: 90, x: 0.58, y: 0.24 }, floor: '#d3dbbd' },
};

export interface SceneryLayer {
  /** Parallax depth: 0 = fixed sky, 1 = nearest ridge. */
  depth: number;
  svg: string;
}

/** A soft ridgeline across the full width, from layered sines + seeded peaks. */
function ridgePath(seed: number, baseY: number, amp: number): string {
  const r = mulberry32(seed);
  const peaks = Array.from({ length: 5 }, () => ({ x: r() * W, h: 0.4 + r() * 0.6, w: 120 + r() * 260 }));
  const phase = r() * 10;
  const pts: string[] = [];
  for (let x = -40; x <= W + 40; x += 16) {
    let y = baseY;
    y -= Math.sin(x / 190 + phase) * amp * 0.25 + Math.sin(x / 73 + phase * 2) * amp * 0.06;
    for (const p of peaks) y -= p.h * amp * Math.exp(-(((x - p.x) / p.w) ** 2));
    pts.push(`${x.toFixed(0)},${y.toFixed(1)}`);
  }
  return `M-40,${H} L${pts.join(' L')} L${W + 40},${H} Z`;
}

const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">`;

export function sceneryLayers(sc: Scenery): SceneryLayer[] {
  const layers: SceneryLayer[] = [];
  const [top, mid, bottom] = sc.sky;
  let sky = `${svgOpen}<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${mid}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  if (sc.sun) {
    sky += `<radialGradient id="glow"><stop offset="0" stop-color="${sc.sun.glow}" stop-opacity="0.55"/><stop offset="1" stop-color="${sc.sun.glow}" stop-opacity="0"/></radialGradient>`;
  }
  sky += `</defs><rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  if (sc.sun) {
    const cx = sc.sun.x * W;
    const cy = sc.sun.y * H;
    sky += `<circle cx="${cx}" cy="${cy}" r="${sc.sun.r * 3.2}" fill="url(#glow)"/>`;
    sky += `<circle cx="${cx}" cy="${cy}" r="${sc.sun.r}" fill="${sc.sun.color}" opacity="0.92"/>`;
  }
  layers.push({ depth: 0, svg: `${sky}</svg>` });

  // Ridges: each fades from ink at the crest into mist below, like wet ink.
  sc.ridges.forEach(([color, opacity], i) => {
    const baseY = H * (0.5 + i * 0.07);
    const amp = 150 - i * 30;
    const id = `r${i}`;
    const svg =
      `${svgOpen}<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="${(0.3 + i * 0.03).toFixed(2)}" stop-color="${color}" stop-opacity="${opacity}"/>` +
      `<stop offset="${(0.62 + i * 0.05).toFixed(2)}" stop-color="${sc.mist}" stop-opacity="0"/></linearGradient></defs>` +
      `<path d="${ridgePath(97 + i * 31, baseY, amp)}" fill="url(#${id})"/></svg>`;
    layers.push({ depth: 0.25 + i * 0.3, svg });
  });

  if (sc.birds) {
    const r = mulberry32(7);
    let g = svgOpen;
    for (let i = 0; i < sc.birds; i++) {
      const x = 260 + r() * 520 + i * 40;
      const y = 150 + r() * 120;
      const s = 6 + r() * 5;
      g += `<path d="M${x - s},${y - s * 0.45} Q${x - s * 0.4},${y - s * 0.6} ${x},${y} Q${x + s * 0.45},${y - s * 0.65} ${x + s * 1.1},${y - s * 0.4}" fill="none" stroke="${sc.ridges[2]?.[0] ?? '#555'}" stroke-width="2" stroke-linecap="round" opacity="0.55"/>`;
    }
    layers.push({ depth: 0.15, svg: `${g}</svg>` });
  }

  // Low mist band hides the ridges' feet behind the bench.
  layers.push({
    depth: 0,
    svg:
      `${svgOpen}<defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="${sc.mist}" stop-opacity="0"/>` +
      `<stop offset="0.78" stop-color="${sc.mist}" stop-opacity="0.85"/><stop offset="1" stop-color="${sc.floor}" stop-opacity="1"/></linearGradient></defs>` +
      `<rect width="${W}" height="${H}" fill="url(#m)"/></svg>`,
  });
  return layers;
}

/** Horizontal parallax shift (in CSS px) for a layer at the given camera yaw. */
export function parallax(depth: number, yaw: number): number {
  return Math.sin(yaw) * depth * 46;
}

/** Paint the scenery onto a 2D canvas (used for portrait export). */
export async function paintScenery(g: CanvasRenderingContext2D, sc: Scenery, width: number, height: number, yaw: number): Promise<void> {
  const layers = sceneryLayers(sc);
  // Mimic preserveAspectRatio="xMidYMid slice".
  const scale = Math.max(width / W, height / H);
  const dw = W * scale;
  const dh = H * scale;
  const ox = (width - dw) / 2;
  const oy = (height - dh) / 2;
  const pxPerCss = width / 390;
  for (const layer of layers) {
    const svg = layer.svg.replace('width="100%" height="100%"', `width="${W}" height="${H}"`);
    const img = new Image();
    img.decoding = 'async';
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    try {
      await img.decode();
      g.drawImage(img, ox + parallax(layer.depth, yaw) * pxPerCss, oy, dw, dh);
    } catch {
      /* a layer that fails to decode is simply skipped */
    }
  }
}
