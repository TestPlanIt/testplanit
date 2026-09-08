"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CirclePlay, Combine, Lock, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";

interface TestRunNameDisplayProps {
  testRun:
    | {
        id?: number | string;
        name?: string;
        isDeleted?: boolean;
        configurationGroupId?: number | string | null;
        configuration?: { id: number; name: string } | null;
        compositionLockedAt?: Date | string | null;
      }
    | null
    | undefined;
  projectId?: number | string;
  showIcon?: boolean;
  fallbackPrefix?: string;
  className?: string;
  linkSuffix?: string;
}

export function TestRunNameDisplay({
  testRun,
  projectId,
  showIcon = true,
  fallbackPrefix = "Test Run",
  className,
  linkSuffix = "",
}: TestRunNameDisplayProps) {
  const t = useTranslations("common.labels");

  // Show the full name in a tooltip only when the rendered span is
  // actually clipped (e.g. a `truncate` className in a narrow layout).
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  useEffect(() => {
    const el = nameRef.current;
    if (!el) return;
    const measure = () => setIsTruncated(el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [testRun?.name]);

  if (!testRun) {
    return <span>{t("unknown")}</span>;
  }

  // Extract the values
  const name = testRun.name;
  const id = testRun.id;
  const isDeleted = testRun.isDeleted || false;
  const configurationGroupId = testRun.configurationGroupId;
  const configuration = testRun.configuration;
  const isCompositionLocked = !!testRun.compositionLockedAt;

  // Determine which icon to show
  let icon = null;
  if (showIcon) {
    if (isDeleted) {
      icon = <Trash className="h-4 w-4 shrink-0" />;
    } else {
      icon = <CirclePlay className="h-4 w-4 shrink-0" />;
    }
  }

  // Determine the display name
  const displayName = name || (id ? `${fallbackPrefix} ${id}` : t("unknown"));

  // Configuration indicator for multi-config test runs
  const configIndicator = configurationGroupId ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="ms-1 shrink-0">
          <Combine className="w-3 h-3 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-background/50">{t("multiConfiguration")}</p>
        {configuration && (
          <p className="flex text-xs text-background">
            <Combine className="w-3 h-3 shrink-0 me-1" />
            {configuration.name}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  ) : null;

  // Composition-lock indicator (BOR-1): shown when the run's case set is frozen.
  const lockIndicator = isCompositionLocked ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="ms-1 shrink-0">
          <Lock className="w-3 h-3 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("compositionLocked")}</TooltipContent>
    </Tooltip>
  ) : null;

  const content = (
    <>
      {icon}
      <Tooltip>
        <TooltipTrigger asChild>
          <span ref={nameRef} className={cn("min-w-0", className)}>
            {displayName}
          </span>
        </TooltipTrigger>
        {isTruncated && <TooltipContent>{displayName}</TooltipContent>}
      </Tooltip>
      {configIndicator}
      {lockIndicator}
    </>
  );

  // If deleted, don't make it a link - show with line-through and dimmed styling
  if (isDeleted) {
    return (
      <span className="flex items-center gap-1 min-w-0 text-muted-foreground/50 line-through">
        {content}
      </span>
    );
  }

  // If we have projectId and id, make it a link
  if (projectId && id) {
    return (
      <Link
        href={`/projects/runs/${projectId}/${id}${linkSuffix}`}
        className="flex items-center gap-1 min-w-0 hover:underline"
      >
        {content}
      </Link>
    );
  }

  return <span className="flex items-center gap-1 min-w-0">{content}</span>;
}
