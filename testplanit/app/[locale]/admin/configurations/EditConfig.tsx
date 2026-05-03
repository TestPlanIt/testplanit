"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Configurations } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";
import { useUpdateConfigurations } from "~/lib/hooks";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { HelpPopover } from "@/components/ui/help-popover";

const FormSchema = (t: any) =>
  z.object({
    name: z.string().min(1, {
      message: t("fields.validation.nameRequired"),
    }),
  });

interface EditConfigurationProps {
  configuration: Configurations;
  open: boolean;
  onClose: () => void;
}

export function EditConfiguration({
  configuration,
  open,
  onClose,
}: EditConfigurationProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { mutateAsync: updateConfiguration } = useUpdateConfigurations();
  const tCommon = useTranslations("common");

  const form = useForm<z.infer<ReturnType<typeof FormSchema>>>({
    resolver: zodResolver(FormSchema(tCommon)),
    defaultValues: {
      name: configuration.name,
    },
  });

  const {
    formState: { errors },
  } = form;

  async function onSubmit(data: z.infer<ReturnType<typeof FormSchema>>) {
    setIsSubmitting(true);
    try {
      await updateConfiguration({
        where: { id: configuration.id },
        data: {
          name: data.name,
        },
      });

      onClose();
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: tCommon("errors.configurationNameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{tCommon("actions.edit")}</DialogTitle>
              <DialogDescription className="sr-only">
                {tCommon("actions.edit")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("name")}
                    <HelpPopover helpKey="config.name" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.type === "custom" &&
                  errors.root.message === "duplicate"
                    ? tCommon("errors.duplicate")
                    : tCommon("errors.unknown")}
                </div>
              )}
              <Button variant="outline" type="button" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("actions.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
