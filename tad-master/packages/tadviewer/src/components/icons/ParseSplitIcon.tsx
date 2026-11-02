import * as React from "react";

export interface ParseSplitIconProps {
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Custom Column Split / Delimiter Separator Icon for Toad Parse
 * Represents two central vertical columns with outward extraction arrows (←| |→).
 */
export const ParseSplitIcon: React.FC<ParseSplitIconProps> = ({
  size = 14,
  color = "currentColor",
  style,
  className,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill={color}
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", ...style }}
      aria-hidden="true"
    >
      {/* Left Vertical Pillar */}
      <rect x="163" y="87" width="49" height="338" rx="24" />
      {/* Right Vertical Pillar */}
      <rect x="300" y="87" width="49" height="338" rx="24" />
      {/* Left Arrow pointing outward with horizontal stem */}
      <path d="M79 173L0 256l79 83 35-39-35-37h84v-48h-84l35-37z" />
      {/* Right Arrow pointing outward with horizontal stem */}
      <path d="M433 173l-35 37 35 37h-84v48h84l-35 37 35 39 79-83z" />
    </svg>
  );
};

