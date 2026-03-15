"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { cn } from "~/utils";

interface TagChipProps {
  tagName: string;
  isExisting: boolean;
  isAccepted: boolean;
  onToggle: () => void;
  onEdit: (newName: string) => void;
}

export function TagChip({
  tagName,
  isExisting,
  isAccepted,
  onToggle,
  onEdit,
}: TagChipProps) {
  const t = useTranslations("autoTag.review");
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tagName);
  const inputRef = useRef<HTMLInputElement>(null);

  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (clickTimerRef.current) return; // ignore second click of double-click
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        onToggle();
      }, 200);
    },
    [onToggle],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      setEditValue(tagName);
      setIsEditing(true);
    },
    [tagName],
  );

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== tagName) {
      onEdit(trimmed);
    } else {
      setEditValue(tagName);
    }
    setIsEditing(false);
  }, [editValue, tagName, onEdit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setEditValue(tagName);
        setIsEditing(false);
      }
    },
    [commitEdit, tagName],
  );

  const tooltip = isExisting
    ? isAccepted
      ? t("tooltipAssign")
      : t("tooltipExisting")
    : t("tooltipNew");

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={handleKeyDown}
        className="h-6 w-32 px-2 py-0 text-xs"
        autoFocus
      />
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={isAccepted ? "default" : "outline"}
            className={cn(
              "cursor-pointer select-none transition-all",
              !isExisting && "outline-2 outline-offset-1 outline-primary/50",
              !isAccepted && "opacity-50",
            )}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
          >
            <Tag className="mr-1 h-3 w-3" />
            {tagName}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
