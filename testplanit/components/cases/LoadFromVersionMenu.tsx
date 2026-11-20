"use client";

import { DateFormatter } from "@/components/DateFormatter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

interface LoadableVersion {
  version: number;
  createdAt: Date | string;
}

interface LoadFromVersionMenuProps {
  /** Every version of the case, newest first. */
  versions: LoadableVersion[];
  /** The version the case is at; it is what the form already holds. */
  currentVersion: number;
  /** Whether the form holds edits that loading a version would replace. */
  hasUnsavedEdits: () => boolean;
  onLoad: (version: number) => void;
  dateFormat?: string;
  timeFormat?: string;
  timezone?: string;
}

/** The versions an edit form can be filled from: all but the current one. */
export function loadableVersions<T extends LoadableVersion>(
  versions: T[] | null | undefined,
  currentVersion: number
): T[] {
  return (versions ?? []).filter(
    (version) => version.version !== currentVersion
  );
}

/**
 * Edit-form control that fills the form with the content of an earlier
 * version of the test case. Asks first when the form holds unsaved edits.
 */
export function LoadFromVersionMenu({
  versions,
  currentVersion,
  hasUnsavedEdits,
  onLoad,
  dateFormat,
  timeFormat,
  timezone,
}: LoadFromVersionMenuProps) {
  const t = useTranslations("repository.version");
  const tCommon = useTranslations("common");
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);

  const options = loadableVersions(versions, currentVersion);
  if (options.length === 0) return null;

  const choose = (version: number) => {
    if (hasUnsavedEdits()) {
      setPendingVersion(version);
    } else {
      onLoad(version);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={t("loadFromVersion")}
            title={t("loadFromVersion")}
            className="h-auto px-2 py-1"
            data-testid="load-from-version-button"
          >
            <History className="h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel>{t("loadFromVersion")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {options.map((option) => (
            <DropdownMenuItem
              key={option.version}
              onSelect={() => choose(option.version)}
              data-testid={`load-from-version-${option.version}`}
            >
              <div className="flex items-center space-x-1 whitespace-nowrap">
                <Badge className="text-xs text-primary-foreground">
                  {tCommon("version.prefix")}
                  {option.version.toString()}
                </Badge>
                <div className="flex text-xs">
                  <DateFormatter
                    date={option.createdAt}
                    formatString={
                      dateFormat && timeFormat
                        ? `${dateFormat} ${timeFormat}`
                        : undefined
                    }
                    timezone={timezone}
                  />
                </div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pendingVersion !== null}
        onOpenChange={(next) => {
          if (!next) setPendingVersion(null);
        }}
      >
        <AlertDialogContent data-testid="load-from-version-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("loadConfirmTitle", { version: pendingVersion ?? 0 })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("loadConfirmDescription", { version: pendingVersion ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="load-from-version-cancel">
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="load-from-version-confirm-action"
              onClick={() => {
                if (pendingVersion !== null) onLoad(pendingVersion);
                setPendingVersion(null);
              }}
            >
              {t("loadConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
