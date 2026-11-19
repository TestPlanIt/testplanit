"use client";

import { ArrowRight, EyeOff, Rocket } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { CreateProjectWizard } from "@/admin/projects/CreateProjectWizard";
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  SetupChecklistItem,
  SetupChecklistItemKey,
} from "~/hooks/useSetupChecklist";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";

/** The home-page checklist of first steps on a new instance, for admins. */
export function SetupChecklistCard({
  items,
  doneCount,
  onDismiss,
  onMarkedChange,
  showDemoNote,
}: {
  items: SetupChecklistItem[];
  doneCount: number;
  onDismiss: () => void;
  onMarkedChange: (key: SetupChecklistItemKey, marked: boolean) => void;
  showDemoNote: boolean;
}) {
  const t = useTranslations("home.setupChecklist");
  const tCommon = useTranslations("common");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  return (
    <>
      <Card className="border-4 border-primary" data-testid="setup-checklist">
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary">
            <div className="flex items-center gap-1">
              <Rocket className="h-6 w-6" />
              <div>{t("title")}</div>
            </div>
          </CardTitle>
          <CardDescription data-testid="setup-checklist-progress">
            {t("progress", { done: doneCount, total: items.length })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="space-y-2">
            {items.map((item) => {
              const id = `setup-checklist-${item.key}`;
              return (
                <li
                  key={item.key}
                  className="flex min-h-9 items-center gap-2"
                  data-testid={`setup-checklist-item-${item.key}`}
                  data-done={item.done}
                >
                  <Checkbox
                    id={id}
                    checked={item.done}
                    // Done because the data exists: nothing to take back.
                    disabled={item.detected}
                    onCheckedChange={(checked) =>
                      onMarkedChange(item.key, checked === true)
                    }
                    className="h-5 w-5 disabled:cursor-default disabled:opacity-100"
                    data-testid={`setup-checklist-checkbox-${item.key}`}
                  />
                  <label
                    htmlFor={id}
                    className={cn(
                      "grow",
                      !item.detected && "cursor-pointer",
                      item.done && "text-muted-foreground line-through"
                    )}
                  >
                    {t(`items.${item.key}`)}
                  </label>
                  {!item.done &&
                    (item.href ? (
                      <Link
                        href={item.href}
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "no-underline"
                        )}
                        data-testid={`setup-checklist-open-${item.key}`}
                      >
                        {t("open")}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsWizardOpen(true)}
                        data-testid={`setup-checklist-open-${item.key}`}
                      >
                        {t("open")}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    ))}
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-end gap-2">
          {showDemoNote && (
            <p className="grow text-xs text-muted-foreground">
              {t("demoNote")}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsConfirmOpen(true)}
            data-testid="setup-checklist-hide"
          >
            <EyeOff className="h-4 w-4" />
            {t("hide")}
          </Button>
        </CardFooter>
      </Card>

      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogContent data-testid="setup-checklist-hide-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hideConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("hideConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDismiss}
              data-testid="setup-checklist-hide-confirm"
            >
              {t("hide")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isWizardOpen && (
        <CreateProjectWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
        />
      )}
    </>
  );
}
