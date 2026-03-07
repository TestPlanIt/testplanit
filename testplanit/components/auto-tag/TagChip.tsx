"use client";

import { useState, useRef, useCallback } from "react";
import { Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(tagName);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setEditValue(tagName);
      setIsEditing(true);
      // Auto-focus happens via autoFocus prop
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
    <Badge
      variant={isAccepted ? "default" : "outline"}
      className={cn(
        "cursor-pointer select-none transition-all",
        !isExisting && "border-dashed",
        !isAccepted && "opacity-50",
      )}
      onClick={onToggle}
      onDoubleClick={handleDoubleClick}
    >
      <Tag className="mr-1 h-3 w-3" />
      {tagName}
      {!isExisting && (
        <span className="ml-1 text-[10px] font-normal opacity-70">New</span>
      )}
    </Badge>
  );
}
