"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronLast } from "lucide-react";
import { Link } from "~/lib/navigation";

interface Version {
  version: number;
}

interface VersionNavigationProps {
  versions: Version[];
  currentVersion: string;
  currentVersionIndex?: number;
  onPrevVersion: () => void;
  onNextVersion: () => void;
  backHref: string;
  backTitle?: string;
}

export function VersionNavigation({
  versions,
  currentVersion,
  currentVersionIndex,
  onPrevVersion,
  onNextVersion,
  backHref,
  backTitle = "Back",
}: VersionNavigationProps) {
  if (!versions || versions.length <= 1) return null;

  return (
    <div className="flex items-center space-x-2">
      <Button
        variant="link"
        size="icon"
        onClick={onNextVersion}
        disabled={
          currentVersionIndex === undefined ||
          currentVersionIndex >= versions.length - 1
        }
        title="Older Version"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="link"
        size="icon"
        onClick={onPrevVersion}
        disabled={currentVersionIndex === undefined || currentVersionIndex <= 0}
        title="Newer Version"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Link href={backHref} title={backTitle}>
        <ChevronLast className="h-4 w-4" />
      </Link>
    </div>
  );
}
