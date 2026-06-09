"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { ConflictLogRow } from "~/app/actions/scimConflictLogActions";

interface ViewPayloadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auditRow: ConflictLogRow | null;
}

export function ViewPayloadDialog({
  open,
  onOpenChange,
  auditRow,
}: ViewPayloadDialogProps) {
  const t = useTranslations("admin.scim.conflicts");

  // React's default text-node escaping is the XSS defense here. The metadata
  // JSON is rendered as plain text inside a <pre> block; no raw-HTML sink,
  // no innerHTML, no markup injection vector.
  const rendered = auditRow
    ? JSON.stringify(auditRow.metadata ?? {}, null, 2)
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("viewDialogTitle")}</DialogTitle>
          <DialogDescription>
            {auditRow
              ? t("viewDialogDescription", {
                  entityType: auditRow.entityType,
                  entityId: auditRow.entityId,
                })
              : ""}
          </DialogDescription>
        </DialogHeader>

        <pre
          data-testid="scim-conflict-payload"
          className="max-h-[400px] overflow-auto rounded bg-muted px-3 py-2 text-xs font-mono"
        >
          <code>{rendered}</code>
        </pre>

        <DialogFooter>
          <Button
            type="button"
            variant="default"
            onClick={() => onOpenChange(false)}
            data-testid="scim-conflict-payload-close"
          >
            {t("close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
