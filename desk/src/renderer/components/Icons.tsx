/** Line icons for the nav rail and buttons. 24-unit viewBox, stroked in `currentColor`. */
import type { ReactNode, SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number };

function Icon({ size = 20, strokeWidth = 1.6, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function LogoMark(props: IconProps) {
  return (
    <Icon size={18} strokeWidth={2.2} {...props}>
      <path d="M4 18V8l5 4 5-6 6 4v8" />
    </Icon>
  );
}

export function FleetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </Icon>
  );
}

export function RunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5v7l5.5-3.5z" />
    </Icon>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Icon>
  );
}

/** A studbook: the open register, spine down the middle. */
export function StudbookIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 6.5c-1.6-1.4-3.7-2-6.5-2H4v13h1.5c2.8 0 4.9.6 6.5 2 1.6-1.4 3.7-2 6.5-2H20v-13h-1.5c-2.8 0-4.9.6-6.5 2z" />
      <path d="M12 6.5v13" />
      <path d="M7.5 9.5h1.5M7.5 12.5h1.5M15 9.5h1.5M15 12.5h1.5" />
    </Icon>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Icon size={14} strokeWidth={2.2} {...props}>
      <path d="M9 6l6 6-6 6" />
    </Icon>
  );
}

export function ChevronLeft(props: IconProps) {
  return (
    <Icon size={16} strokeWidth={2} {...props}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon size={16} strokeWidth={2.4} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Icon size={14} strokeWidth={2.4} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}
