import React from "react";
import { cn, type ClassValue } from "~/utils";

interface StatusDotDisplayProps {
  name: string;
  color?: string;
  dotClassName?: ClassValue;
  nameClassName?: ClassValue;
  className?: ClassValue;
}

const StatusDotDisplay: React.FC<StatusDotDisplayProps> = ({
  name,
  color = "#B1B2B3",
  dotClassName = "w-3 h-3 rounded-full",
  nameClassName = "",
  className = "flex items-center space-x-1 whitespace-nowrap",
}) => (
  <div className={cn(className)}>
    <div className={cn(dotClassName)} style={{ backgroundColor: color }} />
    <div className={cn(nameClassName)}>{name}</div>
  </div>
);

export default StatusDotDisplay;
