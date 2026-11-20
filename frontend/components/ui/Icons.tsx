/** The handful of line icons direction G uses (from the prototype). All are
 *  decorative (`aria-hidden`); give the control around them its name. */
import { cn } from "@/lib/utils";

type IconProps = { className?: string; size?: number };

function Svg({
  size,
  className,
  strokeWidth,
  children,
}: IconProps & { strokeWidth: number; children: React.ReactNode }) {
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
      className={cn("shrink-0", className)}
    >
      {children}
    </svg>
  );
}

export const ChevronLeftIcon = ({ size = 16, className }: IconProps) => (
  <Svg size={size} className={className} strokeWidth={2.2}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const ChevronRightIcon = ({ size = 16, className }: IconProps) => (
  <Svg size={size} className={className} strokeWidth={2.2}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const ChevronDownIcon = ({ size = 14, className }: IconProps) => (
  <Svg size={size} className={className} strokeWidth={2.4}>
    <path d="M5 9l7 7 7-7" />
  </Svg>
);

export const SearchIcon = ({ size = 18, className }: IconProps) => (
  <Svg size={size} className={className} strokeWidth={2}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);

export const LockIcon = ({ size = 18, className }: IconProps) => (
  <Svg size={size} className={cn("text-muted", className)} strokeWidth={2}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const CheckIcon = ({ size = 16, className }: IconProps) => (
  <Svg size={size} className={className} strokeWidth={2.6}>
    <path d="M5 12l5 5 9-10" />
  </Svg>
);

export const CloseIcon = ({ size = 18, className }: IconProps) => (
  <Svg size={size} className={className} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
