"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCreateAppConfig } from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CirclePlus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { HelpPopover } from "@/components/ui/help-popover";

export function AddAppConfigModal() {
  const t = useTranslations("admin.appConfig");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const FormSchema = z.object({
    key: z.string().min(1, {
      message: t("errors.keyRequired"),
    }),
    value: z.string().min(1, {
      message: t("errors.valueRequired"),
    }),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      key: "",
      value: "",
    },
  });

  const { mutateAsync: createAppConfig } = useCreateAppConfig();

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      const parsedValue = JSON.parse(data.value);
      await createAppConfig({
        data: {
          key: data.key,
          value: parsedValue,
        },
      });
      setOpen(false);
      form.reset();
    } catch (err) {
      form.setError("value", {
        type: "custom",
        message: t("errors.invalidJson"),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CirclePlus className="h-4 w-4" />
          {t("addConfig")}
        </Button>
      </DialogTrigger>
      <DialogContent data-testid="add-app-config-modal">
        <DialogHeader>
          <DialogTitle>{t("addConfig")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key" className="flex items-center">
              {tCommon("fields.key")}
              <HelpPopover helpKey="appConfig.key" />
            </Label>
            <Input
              id="key"
              {...form.register("key")}
              placeholder={tCommon("fields.placeholders.key")}
              data-testid="app-config-key-input"
            />
            {form.formState.errors.key && (
              <div className="text-destructive text-sm">
                {form.formState.errors.key.message}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="value" className="flex items-center">
              {tCommon("fields.value")}
              <HelpPopover helpKey="appConfig.value" />
            </Label>
            <Textarea
              id="value"
              {...form.register("value")}
              placeholder={t("valuePlaceholder")}
              className="font-mono"
              rows={10}
              data-testid="app-config-value-input"
            />
            {form.formState.errors.value && (
              <div className="text-destructive text-sm">
                {form.formState.errors.value.message}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
              data-testid="app-config-cancel-button"
            >
              {tCommon("actions.cancel")}
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
