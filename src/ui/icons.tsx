import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
});

export const IconShears = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="18" r="2.6" />
    <circle cx="11.5" cy="19.5" r="2.6" />
    <path d="M7.8 16.2 19.5 4.5M10.6 17.1 18 5.8l2.5-2.3" />
    <path d="M12.6 11.3 9.6 9" />
  </svg>
);

export const IconShape = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20c1.5-7 6-11 13-12.5" />
    <circle cx="18.5" cy="7" r="2.3" fill="currentColor" stroke="none" />
    <rect x="8.4" y="10.6" width="3.2" height="3.2" rx="0.6" transform="rotate(45 10 12.2)" />
  </svg>
);

export const IconWire = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 20 20 4" />
    <path d="M6.3 14.5c1.2 1.9 2.4 3 3.6 3.2M9.3 11.5c1.2 1.9 2.4 3 3.6 3.2M12.3 8.5c1.2 1.9 2.4 3 3.6 3.2M15.3 5.5c1.2 1.9 2.4 3 3.6 3.2" />
  </svg>
);

export const IconGrow = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21v-9" />
    <path d="M12 13c0-4 2.5-6.5 7-6.5 0 4-2.5 6.5-7 6.5Z" />
    <path d="M12 15.5c0-3.2-2-5.3-6-5.3 0 3.2 2 5.3 6 5.3Z" />
  </svg>
);

export const IconPot = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 10h18" />
    <path d="M4.5 10 6 16.5h12l1.5-6.5" />
    <path d="M7.5 16.5v2M16.5 16.5v2" />
    <path d="M12 10V4.5M12 7l2.5-2" />
  </svg>
);

export const IconSurface = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 17.5c2.5-.8 5-.8 7.5 0s5 .8 7.5 0 2.5-.5 3-.3" />
    <path d="M6 15c0-2 1.3-3.4 3.2-3.4S12.4 13 12.4 15" />
    <path d="M13.5 15.2c.3-1.4 1.3-2.3 2.6-2.3s2.2.9 2.4 2.2" />
    <path d="M9 8.5c.4-1.2 1.4-1.8 2.6-1.4M14.5 7c.8-1 2-1.2 3-.5" />
  </svg>
);

export const IconView = (p: P) => (
  <svg {...base(p)}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconUndo = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 7 4.5 11.5 9 16" />
    <path d="M5 11.5h9.5a5 5 0 0 1 0 10H12" />
  </svg>
);

export const IconRedo = (p: P) => (
  <svg {...base(p)}>
    <path d="m15 7 4.5 4.5L15 16" />
    <path d="M19 11.5H9.5a5 5 0 0 0 0 10H12" />
  </svg>
);

export const IconSound = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
    <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
  </svg>
);

export const IconMuted = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </svg>
);

export const IconRecenter = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    <circle cx="12" cy="12" r="7.5" />
  </svg>
);

export const IconMore = (p: P) => (
  <svg {...base(p)}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconCircleCheck = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.3 2.8 2.8L16.5 9.5" />
  </svg>
);

export const IconCircleX = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </svg>
);

export const IconStar = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="m12 3.2 2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7z" />
  </svg>
);

export const IconLock = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCamera = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8.5h3l1.5-2.5h7L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.2" r="3.4" />
  </svg>
);

export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </svg>
);

export const IconShare = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V4M8 7.5 12 3.5l4 4" />
    <path d="M7 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-1" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </svg>
);

export const IconUp = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
  </svg>
);

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconChevronDown = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.6v.2" />
  </svg>
);

export const IconTurntable = (p: P) => (
  <svg {...base(p)}>
    <ellipse cx="12" cy="16" rx="8.5" ry="3.5" />
    <path d="M12 12.5V4.5M9.5 7 12 4.5 14.5 7" />
  </svg>
);

export const IconSilhouette = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
  </svg>
);

export const IconPencil = (p: P) => (
  <svg {...base(p)}>
    <path d="M15.5 5 19 8.5 8.5 19H5v-3.5z" />
    <path d="m13 7.5 3.5 3.5" />
  </svg>
);

export const IconRotateLeft = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v4h4" />
  </svg>
);

export const IconRotateRight = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </svg>
);

export const IconArrow = ({ dir, ...p }: P & { dir: 'up' | 'down' | 'left' | 'right' }) => {
  const r = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg {...base(p)} style={{ transform: `rotate(${r}deg)` }}>
      <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
    </svg>
  );
};

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
);

/* Tab bar */

export const IconTabStudio = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21v-6.5M12 14.5c-1.5-1.5-3-2-5-2M12 12c1.2-1.4 2.6-2 4.5-2" />
    <path d="M5.5 13c-2 0-3-1-3-2.3s1.4-2.2 3-2.2c.4-1.6 1.8-2.5 3.4-2.2" />
    <path d="M14 6.5c.6-1.6 2-2.5 3.6-2.2 1.7.3 2.7 1.7 2.4 3.2 1.2.5 1.6 1.6 1.2 2.6-.4 1.2-1.7 1.6-3 1.3" />
    <path d="M6 21h12" />
  </svg>
);

export const IconTabChallenges = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="9.5" r="5.5" />
    <path d="m9 14.3-1.5 6.2 4.5-2.4 4.5 2.4-1.5-6.2" />
    <path d="m12 7 .9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" />
  </svg>
);

export const IconTabCollection = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 20.5h18M4.5 20.5v-15M19.5 20.5v-15M4.5 13h15" />
    <path d="M8 13v-2.5h3V13M13.5 13V9.5h3V13M8 20.5v-3.5h3.5v3.5" />
  </svg>
);

export const IconTabGallery = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
    <rect x="7" y="7" width="10" height="10" rx="1" />
    <path d="M9 15c1-2.5 2-3.5 3-3.5s2 1 3 3.5" />
  </svg>
);

/** Decorative tree mark used for placeholders and hero art. */
export const TreeMark = (p: P) => (
  <svg viewBox="0 0 120 120" fill="currentColor" aria-hidden {...p}>
    <path d="M58 104c1-14-2-26-9-36l5-2c5 7 8 15 9 23 3-11 9-20 18-26l3 4c-9 7-14 18-15 37z" />
    <ellipse cx="38" cy="58" rx="22" ry="9" />
    <ellipse cx="80" cy="50" rx="24" ry="9.5" />
    <ellipse cx="60" cy="31" rx="20" ry="9" />
    <ellipse cx="66" cy="72" rx="14" ry="6" />
    <path d="M34 104h52l-4 9H38z" opacity="0.7" />
  </svg>
);
