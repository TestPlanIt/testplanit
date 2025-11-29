import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "~/utils";
import { DateFormatter } from "@/components/DateFormatter";
import { DurationDisplay } from "@/components/DurationDisplay";
import { Tag } from "lucide-react";
export { DateTimeDisplay } from "./DateTimeDisplay";

interface MetadataItemProps {
  children: React.ReactNode;
  className?: string;
}

export function MetadataItem({ children, className }: MetadataItemProps) {
  return <span className={cn("text-xs", className)}>{children}</span>;
}

interface MetadataSeparatorProps {
  className?: string;
}

export function MetadataSeparator({ className }: MetadataSeparatorProps) {
  return <span className={cn("text-muted-foreground", className)}>{"•"}</span>;
}

interface MetadataListProps {
  items: (React.ReactNode | null | undefined)[];
  className?: string;
}

export function MetadataList({ items, className }: MetadataListProps) {
  const filteredItems = items.filter(Boolean);
  
  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      {filteredItems.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <MetadataSeparator />}
          {item}
        </React.Fragment>
      ))}
    </div>
  );
}

interface StatusBadgeProps {
  isCompleted: boolean;
  completedText: string;
  activeText: string;
  className?: string;
}

export function StatusBadge({ 
  isCompleted, 
  completedText, 
  activeText, 
  className 
}: StatusBadgeProps) {
  return (
    <Badge 
      variant="secondary" 
      className={cn(
        "text-xs",
        isCompleted ? "text-green-600" : "text-yellow-600",
        className
      )}
    >
      {isCompleted ? completedText : activeText}
    </Badge>
  );
}

interface TimeEstimateProps {
  label: string;
  seconds?: number;
  minutes?: number;
  className?: string;
}

export function TimeEstimate({ label, seconds, minutes, className }: TimeEstimateProps) {
  // Handle both seconds and minutes for backward compatibility
  const totalSeconds = seconds || (minutes ? minutes * 60 : 0);
  
  if (!totalSeconds) return null;
  
  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {label}: <DurationDisplay seconds={totalSeconds} />
    </span>
  );
}

interface TagListProps {
  tags: Array<{ id: number; name: string }>;
  maxVisible?: number;
  className?: string;
}

export function TagList({ tags, maxVisible = 3, className }: TagListProps) {
  if (!tags || tags.length === 0) return null;
  
  const visibleTags = tags.slice(0, maxVisible);
  const remainingCount = tags.length - maxVisible;
  
  return (
    <div className={cn("flex gap-1 items-center", className)}>
      {visibleTags.map((tag) => (
        <Badge key={tag.id} variant="outline" className="text-xs flex items-center gap-1">
          <Tag className="h-3 w-3" />
          {tag.name}
        </Badge>
      ))}
      {remainingCount > 0 && (
        <span className="text-xs text-muted-foreground">
          {"+"}{remainingCount}
        </span>
      )}
    </div>
  );
}

interface BadgeListProps {
  items: (React.ReactNode | null | undefined)[];
  className?: string;
}

export function BadgeList({ items, className }: BadgeListProps) {
  const filteredItems = items.filter(Boolean);
  
  return (
    <div className={cn("flex items-center gap-2 mt-1", className)}>
      {filteredItems.map((item, index) => (
        <React.Fragment key={index}>{item}</React.Fragment>
      ))}
    </div>
  );
}

interface ExternalLinkProps {
  url: string;
  className?: string;
}

export function ExternalLink({ url, className }: ExternalLinkProps) {
  return (
    <div className="mt-1">
      <span className={cn("text-xs text-blue-600 hover:underline", className)}>
        {url}
      </span>
    </div>
  );
}

interface DateDisplayProps {
  date: string | Date;
  label?: string;
  className?: string;
}

export function DateDisplay({ date, label, className }: DateDisplayProps) {
  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {label && <>{label}: </>}
      <DateFormatter date={date} />
    </span>
  );
}

interface SearchHighlightProps {
  highlights?: Record<string, string[]>;
  field: string;
  className?: string;
}

export function SearchHighlight({ highlights, field, className }: SearchHighlightProps) {
  if (!highlights?.[field]?.[0]) return null;

  return (
    <div className={cn("text-sm text-muted-foreground mt-2", className)}>
      <p
        className="line-clamp-2"
        dangerouslySetInnerHTML={{
          __html: highlights[field][0],
        }}
      />
    </div>
  );
}