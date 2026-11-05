import * as React from "react";

export interface SunIconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Custom Ergonomic Sun Icon for Native Theme Switching (Toad v2.1.2)
 * High-definition sun icon with glowing center and radiating beams.
 */
export const SunIcon: React.FC<SunIconProps> = ({
  size = 16,
  color = "currentColor",
  style,
  className,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", ...style }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.5" fill={color} />
      <line x1="12" y1="1.5" x2="12" y2="3.5" />
      <line x1="12" y1="20.5" x2="12" y2="22.5" />
      <line x1="4.5" y1="4.5" x2="6" y2="6" />
      <line x1="18" y1="18" x2="19.5" y2="19.5" />
      <line x1="1.5" y1="12" x2="3.5" y2="12" />
      <line x1="20.5" y1="12" x2="22.5" y2="12" />
      <line x1="4.5" y1="19.5" x2="6" y2="18" />
      <line x1="18" y1="6" x2="19.5" y2="4.5" />
    </svg>
  );
};

