"use client";

import { Badge } from "@/components/ui/badge";
import { DateFormatter } from "@/components/DateFormatter";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Version {
  id: number;
  version: number;
  createdAt: Date;
}

interface VersionSelectProps {
  versions: Version[];
  currentVersion: string | null;
  onVersionChange: (version: string) => void;
  userDateFormat?: string;
  userTimeFormat?: string;
}

export function VersionSelect({
  versions,
  currentVersion,
  onVersionChange,
  userDateFormat,
  userTimeFormat,
}: VersionSelectProps) {
  const t = useTranslations("repository.version");
  const tGlobal = useTranslations();

  if (!versions || versions.length <= 1) return null;

  // Find current version index to handle duplicate version numbers
  const currentIndex = versions.findIndex(
    (v) => v.version.toString() === currentVersion
  );

  return (
    <Select
      value={currentIndex >= 0 ? currentIndex.toString() : "0"}
      onValueChange={(indexStr) => {
        const idx = parseInt(indexStr, 10);
        if (idx >= 0 && idx < versions.length) {
          onVersionChange(versions[idx].version.toString());
        }
      }}
    >
      <SelectTrigger className="w-fit" data-testid="version-select-trigger">
        <SelectValue placeholder="Select Version" />
      </SelectTrigger>
      <SelectContent>
        {versions.map((v, index) => (
          <SelectItem key={`version-select-${index}`} value={index.toString()}>
            <div className="flex items-center space-x-1 whitespace-nowrap">
              <Badge className="text-primary-foreground text-xs">
                {tGlobal("common.version.prefix")}
                {v.version.toString()}
              </Badge>
              <div className="text-xs flex">
                <DateFormatter
                  date={v.createdAt}
                  formatString={
                    userDateFormat && userTimeFormat
                      ? `${userDateFormat} ${userTimeFormat}`
                      : undefined
                  }
                />
              </div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
