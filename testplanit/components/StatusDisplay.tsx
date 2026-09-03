import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn, type ClassValue } from "~/utils";
import {
  perceptualTextColor,
  statusSurfaceVars,
} from "~/utils/contrastingTextColor";

interface StatusDisplayProps {
  name: string;
  color?: string;
  /**
   * "dot" renders the coloured dot beside plain text; "filled" renders a
   * Badge painted with the status colour. Every filled status badge must go
   * through this variant so the text colour is always the computed
   * black/white pick — hand-rolled pills drifted (white text hardcoded on
   * one surface, computed on another) and the same status showed different
   * text colours on different screens.
   */
  variant?: "dot" | "filled";
  dotClassName?: ClassValue;
  nameClassName?: ClassValue;
  className?: ClassValue;
}

const StatusDisplay: React.FC<StatusDisplayProps> = ({
  name,
  color = "#B1B2B3",
  variant = "dot",
  dotClassName = "w-3 h-3 rounded-full",
  nameClassName = "",
  className,
}) => {
  if (variant === "filled") {
    return (
      <Badge
        data-status-surface
        className={cn(className)}
        style={{
          ...statusSurfaceVars(color),
          backgroundColor: color,
          color: perceptualTextColor(color),
        }}
      >
        {name}
      </Badge>
    );
  }

  return (
    <div
      className={cn(
        className ?? "flex items-center space-x-1 whitespace-nowrap"
      )}
    >
      <div className={cn(dotClassName)} style={{ backgroundColor: color }} />
      <div className={cn(nameClassName)}>{name}</div>
    </div>
  );
};

export default StatusDisplay;
