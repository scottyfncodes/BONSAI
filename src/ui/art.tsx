import type { SVGProps } from 'react';

/**
 * Hand-drawn interface art: the studio's hanko seal and sumi-e style
 * illustrations for the challenge cards. Pure SVG, no assets.
 */

const CJK_SERIF = "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', 'Noto Serif CJK JP', 'Songti SC', serif";

/** Vermilion hanko seal reading 盆栽 (bonsai), stacked vertically. */
export function Seal({ size = 30, ...p }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label="Bonsai seal" {...p}>
      <rect x="2" y="2" width="36" height="36" rx="5" fill="#c2412a" />
      <rect x="5" y="5" width="30" height="30" rx="3" fill="none" stroke="#fbeee0" strokeOpacity="0.55" strokeWidth="1" />
      <text x="20" y="19.2" textAnchor="middle" fontFamily={CJK_SERIF} fontSize="13.5" fontWeight="700" fill="#fbf3e6">
        盆
      </text>
      <text x="20" y="33" textAnchor="middle" fontFamily={CJK_SERIF} fontSize="13.5" fontWeight="700" fill="#fbf3e6">
        栽
      </text>
    </svg>
  );
}

/** Soft brush stroke: a few overlapping translucent strokes read as wet ink. */
function Brush({ d, w, color, o = 1 }: { d: string; w: number; color: string; o?: number }) {
  return (
    <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} strokeWidth={w * 1.25} opacity={0.18 * o} />
      <path d={d} strokeWidth={w} opacity={0.75 * o} />
      <path d={d} strokeWidth={w * 0.45} opacity={0.55 * o} transform="translate(0.6 -0.4)" />
    </g>
  );
}

/** Ink-wash foliage pad. */
function Pad({ cx, cy, rx, ry, color, o = 0.85 }: { cx: number; cy: number; rx: number; ry: number; color: string; o?: number }) {
  return (
    <g fill={color}>
      <ellipse cx={cx} cy={cy + ry * 0.25} rx={rx * 1.06} ry={ry * 0.85} opacity={0.22 * o} />
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} opacity={0.7 * o} />
      <ellipse cx={cx - rx * 0.25} cy={cy - ry * 0.35} rx={rx * 0.55} ry={ry * 0.55} opacity={0.35 * o} />
    </g>
  );
}

type Variant = 'windswept' | 'less' | 'exhibition';

/** Full-bleed painted scene for a challenge card (text sits on the left). */
export function ChallengeArt({ variant }: { variant: Variant }) {
  if (variant === 'windswept') {
    const ink = '#1f2a15';
    return (
      <svg className="hero-art" viewBox="0 0 360 150" preserveAspectRatio="xMaxYMid slice" aria-hidden>
        <defs>
          <linearGradient id="ws-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4d6631" />
            <stop offset="1" stopColor="#7d975a" />
          </linearGradient>
        </defs>
        <rect width="360" height="150" fill="url(#ws-sky)" />
        <circle cx="300" cy="38" r="20" fill="#e8ebd2" opacity="0.5" />
        {/* Wind streaks */}
        {[30, 52, 74].map((y, i) => (
          <path key={y} d={`M${150 + i * 14},${y} q40,-6 90,2 t70,-4`} stroke="#e9eed8" strokeWidth="1.4" fill="none" opacity={0.28 - i * 0.05} strokeLinecap="round" />
        ))}
        {/* Cliff */}
        <path d="M150,150 C175,118 200,112 232,110 C262,108 280,116 300,130 L330,150 Z" fill={ink} opacity="0.55" />
        {/* Tree streaming downwind */}
        <Brush d="M226,112 C224,96 230,84 246,76 C262,68 280,66 300,60" w={5} color={ink} />
        <Brush d="M246,77 C262,82 280,86 304,84" w={2.4} color={ink} />
        <Brush d="M236,92 C252,98 268,104 292,104" w={2} color={ink} />
        <Pad cx={306} cy={58} rx={26} ry={8} color={ink} />
        <Pad cx={312} cy={82} rx={20} ry={6.5} color={ink} />
        <Pad cx={296} cy={102} rx={17} ry={5.5} color={ink} />
      </svg>
    );
  }
  if (variant === 'less') {
    const ink = '#f1e9da';
    return (
      <svg className="hero-art" viewBox="0 0 360 150" preserveAspectRatio="xMaxYMid slice" aria-hidden>
        <defs>
          <linearGradient id="lm-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#24211e" />
            <stop offset="1" stopColor="#474039" />
          </linearGradient>
        </defs>
        <rect width="360" height="150" fill="url(#lm-sky)" />
        <circle cx="282" cy="52" r="30" fill="#efe6d4" opacity="0.92" />
        <circle cx="282" cy="52" r="46" fill="#efe6d4" opacity="0.08" />
        {/* A single, slender literati line */}
        <Brush d="M262,150 C258,128 266,112 262,96 C258,80 266,64 286,54" w={3.4} color="#1b1916" />
        <Brush d="M286,54 C296,50 304,50 312,52" w={1.6} color="#1b1916" />
        <Pad cx={310} cy={49} rx={18} ry={6} color="#1b1916" o={1} />
        <path d="M200,150 C230,138 300,136 360,142 L360,150 Z" fill={ink} opacity="0.06" />
      </svg>
    );
  }
  const ink = '#2a120b';
  return (
    <svg className="hero-art" viewBox="0 0 360 150" preserveAspectRatio="xMaxYMid slice" aria-hidden>
      <defs>
        <linearGradient id="ex-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9c3a22" />
          <stop offset="1" stopColor="#d6563a" />
        </linearGradient>
      </defs>
      <rect width="360" height="150" fill="url(#ex-sky)" />
      <g transform="translate(332 150) scale(0.82) translate(-332 -150) translate(24 0)">
      <circle cx="276" cy="66" r="44" fill="#f6e3cf" opacity="0.9" />
      {/* Stand and pot */}
      <rect x="226" y="128" width="104" height="6" rx="2" fill={ink} opacity="0.85" />
      <path d="M240,116 L316,116 L310,128 L246,128 Z" fill={ink} opacity="0.8" />
      {/* Tree with tiered pads */}
      <Brush d="M276,116 C270,104 280,96 274,84 C268,72 278,62 276,48" w={5.5} color={ink} />
      <Brush d="M274,96 C262,94 252,96 242,92" w={2.4} color={ink} />
      <Brush d="M276,80 C290,78 300,80 312,76" w={2.2} color={ink} />
      <Pad cx={242} cy={89} rx={20} ry={7} color={ink} />
      <Pad cx={312} cy={73} rx={22} ry={7.5} color={ink} />
      <Pad cx={276} cy={46} rx={24} ry={9} color={ink} />
      <Pad cx={258} cy={64} rx={14} ry={5} color={ink} o={0.7} />
      </g>
    </svg>
  );
}
