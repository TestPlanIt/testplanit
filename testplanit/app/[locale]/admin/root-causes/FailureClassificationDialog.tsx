"use client";

import { ColorPicker } from "@/components/ColorPicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { schema } from "~/zenstack/schema";
import type { ClassificationRow } from "./types";

interface FailureClassificationDialogProps {
  open: boolean;
  onClose: () => void;
  /** Absent for Add. */
  classification?: ClassificationRow | null;
  /** Where a new entry lands: after the last one. */
  nextOrder: number;
}

/** Add/Edit form for one failure classification. */
export function FailureClassificationDialog({
  open,
  onClose,
  classification,
  nextOrder,
}: FailureClassificationDialogProps) {
  const t = useTranslations("admin.rootCauses");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tAdminStatuses = useTranslations("admin.statuses");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [colorId, setColorId] = useState<number | null>(
    classification?.colorId ?? null
  );
  // A new entry starts with a visible colour instead of a black swatch.
  const { data: defaultColor } = useClientQueries(schema).color.useFindFirst(
    { where: { order: 3, colorFamily: { name: "Blue" } } },
    { enabled: !classification }
  );
  useEffect(() => {
    if (!classification && defaultColor) {
      setColorId((current) => current ?? defaultColor.id);
    }
  }, [classification, defaultColor]);
  const pickerReady = !!classification || defaultColor !== undefined;
  const { mutateAsync: create } =
    useClientQueries(schema).failureClassification.useCreate();
  const { mutateAsync: update } =
    useClientQueries(schema).failureClassification.useUpdate();

  const FormSchema = z.object({
    name: z
      .string()
      .trim()
      .min(1, {
        message: tGlobal("common.fields.validation.nameRequired"),
      }),
    description: z.string().trim().max(1000),
  });

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: standardSchemaResolver(FormSchema),
    defaultValues: {
      name: classification?.name ?? "",
      description: classification?.description ?? "",
    },
  });

  const onSubmit = async (data: z.infer<typeof FormSchema>) => {
    setIsSubmitting(true);
    try {
      const payload = {
        name: data.name,
        description: data.description || null,
        colorId,
      };
      if (classification) {
        await update({ where: { id: classification.id }, data: payload });
      } else {
        await create({ data: { ...payload, order: nextOrder } });
      }
      onClose();
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        form.setError("name", {
          type: "custom",
          message: t("errors.nameExists"),
        });
      } else {
        console.error("Failed to save failure classification:", error);
        form.setError("root", {
          type: "custom",
          message: tGlobal("common.errors.unknown"),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = classification ? t("edit.title") : t("add.title");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[600px]">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="failure-classification-form"
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="sr-only">{title}</DialogDescription>
            </DialogHeader>
            <div className="flex items-start gap-3">
              <div className="space-y-2">
                <Label>{tAdminStatuses("fields.color")}</Label>
                {pickerReady && (
                  <ColorPicker
                    key={colorId ?? "none"}
                    initialColorId={colorId}
                    onColorSelect={setColorId}
                    compact
                  />
                )}
              </div>
              <div className="w-full">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tCommon("name")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          data-testid="failure-classification-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.description")}
                    <HelpPopover helpKey="rootCauseDescription" />
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      placeholder={t("descriptionPlaceholder")}
                      data-testid="failure-classification-description"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <DialogFooter>
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
                data-testid="failure-classification-submit"
              >
                {tCommon("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
