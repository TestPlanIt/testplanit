"use client";

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
import { useTranslations } from "next-intl";

export interface PendingTemplateSwitch {
  templateId: number;
  templateName: string;
  /** Display names of the fields whose entered values the switch discards. */
  lostFields: string[];
}

interface ConfirmTemplateSwitchDialogProps {
  pending: PendingTemplateSwitch | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asked before a template switch that would throw away something the user
 * entered. A switch that loses nothing applies without asking.
 */
export function ConfirmTemplateSwitchDialog({
  pending,
  onConfirm,
  onCancel,
}: ConfirmTemplateSwitchDialogProps) {
  const t = useTranslations("repository.templateSwitch");
  const tCommon = useTranslations("common");

  return (
    <AlertDialog
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent data-testid="confirm-template-switch-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description", {
              templateName: pending?.templateName ?? "",
              count: pending?.lostFields.length ?? 0,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc ps-6 text-sm">
          {pending?.lostFields.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="confirm-template-switch-cancel">
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="confirm-template-switch-confirm"
            onClick={onConfirm}
          >
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmTemplateSwitchDialog;
