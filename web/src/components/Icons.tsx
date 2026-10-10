// Monoline 24px stroke icons (inline SVG, inherit currentColor).
import type { ReactNode, SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: ReactNode, displayName: string) {
  const C = ({ size = 20, ...rest }: P) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths}
    </svg>
  );
  C.displayName = displayName;
  return C;
}

export const IconTruck = make(
  <>
    <path d="M3 6h11v10H3z" />
    <path d="M14 10h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </>,
  'IconTruck',
);
export const IconStore = make(
  <>
    <path d="M4 9.5V20h16V9.5" />
    <path d="M3 9.5 5 4h14l2 5.5c0 1.4-1.1 2.5-2.5 2.5S16 10.9 16 9.5c0 1.4-1.1 2.5-2.5 2.5h-3C9.1 12 8 10.9 8 9.5 8 10.9 6.9 12 5.5 12S3 10.9 3 9.5z" />
    <path d="M10 20v-5h4v5" />
  </>,
  'IconStore',
);
export const IconWarehouse = make(
  <>
    <path d="M3 20V8l9-4 9 4v12" />
    <path d="M7 20v-8h10v8" />
    <path d="M7 15h10M7 18h10" />
  </>,
  'IconWarehouse',
);
export const IconHub = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <circle cx="4.5" cy="5" r="1.8" />
    <circle cx="19.5" cy="5" r="1.8" />
    <circle cx="4.5" cy="19" r="1.8" />
    <circle cx="19.5" cy="19" r="1.8" />
    <path d="m6 6.4 3.8 3.5M18 6.4l-3.8 3.5M6 17.6l3.8-3.5M18 17.6l-3.8-3.5" />
  </>,
  'IconHub',
);
export const IconMap = make(
  <>
    <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </>,
  'IconMap',
);
export const IconRoute = make(
  <>
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="6" r="2" />
    <path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" />
  </>,
  'IconRoute',
);
export const IconBox = make(
  <>
    <path d="M12 3 20 7v10l-8 4-8-4V7z" />
    <path d="m4 7 8 4 8-4M12 11v10" />
  </>,
  'IconBox',
);
export const IconChart = make(
  <>
    <path d="M4 4v16h16" />
    <path d="m7 15 4-4 3 3 5-6" />
  </>,
  'IconChart',
);
export const IconGauge = make(
  <>
    <path d="M4.5 18a9 9 0 1 1 15 0" />
    <path d="m12 13 4-5" />
    <circle cx="12" cy="13" r="1.2" />
  </>,
  'IconGauge',
);
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>,
  'IconSettings',
);
export const IconDocs = make(
  <>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 15h6M9 18h4" />
  </>,
  'IconDocs',
);
export const IconPlay = make(<path d="M7 4.5v15l12-7.5z" />, 'IconPlay');
export const IconStop = make(<rect x="6" y="6" width="12" height="12" rx="1" />, 'IconStop');
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, 'IconPlus');
export const IconTrash = make(
  <>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
  </>,
  'IconTrash',
);
export const IconEdit = make(
  <>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </>,
  'IconEdit',
);
export const IconSearch = make(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </>,
  'IconSearch',
);
export const IconFilter = make(<path d="M4 6h16M7 12h10M10 18h4" />, 'IconFilter');
export const IconChevronLeft = make(<path d="m15 6-6 6 6 6" />, 'IconChevronLeft');
export const IconChevronRight = make(<path d="m9 6 6 6-6 6" />, 'IconChevronRight');
export const IconChevronDown = make(<path d="m6 9 6 6 6-6" />, 'IconChevronDown');
export const IconChevronUp = make(<path d="m6 15 6-6 6 6" />, 'IconChevronUp');
export const IconCheck = make(<path d="m5 12.5 4.5 4.5L19 7.5" />, 'IconCheck');
export const IconAlert = make(
  <>
    <path d="M12 3.5 21.5 20h-19z" />
    <path d="M12 10v4.5M12 17.3v.2" />
  </>,
  'IconAlert',
);
export const IconInfo = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </>,
  'IconInfo',
);
export const IconClock = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </>,
  'IconClock',
);
export const IconClose = make(<path d="M6 6l12 12M18 6 6 18" />, 'IconClose');
export const IconMenu = make(<path d="M4 7h16M4 12h16M4 17h16" />, 'IconMenu');
export const IconLock = make(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </>,
  'IconLock',
);
export const IconUnlock = make(
  <>
    <rect x="5" y="10.5" width="14" height="10" rx="1.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 7.7-1.5" />
  </>,
  'IconUnlock',
);
export const IconUser = make(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </>,
  'IconUser',
);
export const IconCopy = make(
  <>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </>,
  'IconCopy',
);
export const IconRefresh = make(
  <>
    <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
    <path d="M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16" />
    <path d="M20 20v-4h-4" />
  </>,
  'IconRefresh',
);
export const IconLayers = make(
  <>
    <path d="m12 4 9 4.5-9 4.5-9-4.5z" />
    <path d="m3 13 9 4.5 9-4.5" />
  </>,
  'IconLayers',
);
export const IconExternal = make(
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </>,
  'IconExternal',
);
export const IconFlask = make(
  <>
    <path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" />
    <path d="M7.5 15h9" />
  </>,
  'IconFlask',
);
export const IconTag = make(
  <>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
    <circle cx="7.5" cy="7.5" r="1.3" />
  </>,
  'IconTag',
);
export const IconSpinner = ({ size = 20, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="os-spin" aria-hidden="true" {...rest}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
