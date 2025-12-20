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

  return (
    <Select
      value={currentVersion?.toString() || versions[0].version.toString()}
      onValueChange={onVersionChange}
    >
      <SelectTrigger className="w-fit">
        <SelectValue placeholder="Select Version" />
      </SelectTrigger>
      <SelectContent>
        {versions.map((v) => (
          <SelectItem key={v.version} value={v.version.toString()}>
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
