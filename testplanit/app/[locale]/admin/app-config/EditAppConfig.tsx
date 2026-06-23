"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HelpPopover } from "@/components/ui/help-popover";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useState } from "react";

type AppConfig = {
  key: string;
  value: any;
};

interface EditAppConfigProps {
  config: AppConfig;
  open: boolean;
  onClose: () => void;
}

export function EditAppConfig({ config, open, onClose }: EditAppConfigProps) {
  const t = useTranslations("admin.appConfig");
  const tCommon = useTranslations("common");
  const [value, setValue] = useState(JSON.stringify(config.value, null, 2));
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { mutateAsync: updateAppConfig } = useClientQueries(schema).appConfig.useUpdate();

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
      onClose();
    } catch {
      setError(t("errors.invalidJson"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const translatedKey = tCommon(`fields.configKeys.${config.key}` as any);

  return (
    <Dialog open={open} onOpenChange={onClose}>
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
              onClick={onClose}
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
                ? tCommon("actions.submitting")
                : tCommon("actions.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
