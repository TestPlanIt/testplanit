"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUpdateAppConfig } from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";
import { HelpPopover } from "@/components/ui/help-popover";

type AppConfig = {
  key: string;
  value: any;
};

type EditAppConfigModalProps = {
  config: AppConfig;
};

export function EditAppConfigModal({ config }: EditAppConfigModalProps) {
  const t = useTranslations("admin.appConfig");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(JSON.stringify(config.value, null, 2));
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { mutateAsync: updateAppConfig } = useUpdateAppConfig();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const parsedValue = JSON.parse(value);
      await updateAppConfig({
        where: { key: config.key },
        data: { value: parsedValue },
      });
      setOpen(false);
    } catch (err) {
      setError(t("errors.invalidJson"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const translatedKey = tCommon(`fields.configKeys.${config.key}` as any);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="edit-config-button">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[800px]">
        <DialogHeader>
          <DialogTitle>{t("editConfig")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("editConfig")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key" className="flex items-center">
              {tCommon("fields.key")}
              <HelpPopover helpKey="appConfig.key" />
            </Label>
            <div className="text-sm text-muted-foreground">{translatedKey}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="value" className="flex items-center">
              {tCommon("fields.value")}
              <HelpPopover helpKey="appConfig.value" />
            </Label>
            <Textarea
              id="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              className="font-mono"
              rows={10}
              data-testid="app-config-value-input"
            />
          </div>
          {error && <div className="text-destructive text-sm">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              data-testid="app-config-submit-button"
            >
              {isSubmitting
                ? tCommon("status.submitting")
                : tCommon("actions.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
