import React from "react";

/** The colour key beside a status figure, so a row scans by colour first. */
export const ResultsTrendPip: React.FC<{
  color: string;
  className?: string;
}> = ({ color, className = "" }) => (
  <span
    aria-hidden="true"
    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${className}`}
    style={{ backgroundColor: color }}
  />
);
