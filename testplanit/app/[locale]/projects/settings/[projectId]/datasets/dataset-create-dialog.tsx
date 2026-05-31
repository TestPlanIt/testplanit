"use client";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";
import { useRouter } from "~/lib/navigation";

interface DatasetCreateDialogProps {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DatasetCreateDialog({
  projectId,
  open,
  onOpenChange,
}: DatasetCreateDialogProps) {
  const t = useTranslations("projects.settings.datasets");
  const tCreate = useTranslations("projects.settings.datasets.create");
  const queryClient = useQueryClient();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const formSchema = z.object({
    name: z
      .string()
      .min(1, tCreate("validationNameRequired"))
      .max(120, tCreate("validationNameTooLong")),
    description: z
      .string()
      .max(2000, tCreate("validationDescriptionTooLong"))
      .optional(),
  });

  type FormData = z.infer<typeof formSchema>;

  const form = useForm<FormData>({
    resolver: standardSchemaResolver(formSchema) as never,
    defaultValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ name: "", description: "" });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: FormData) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/datasets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          description: values.description || undefined,
        }),
      });
      if (!res.ok) {
        toast.error(tCreate("error"));
        setSubmitting(false);
        return;
      }
      const json = (await res.json()) as {
        dataSet: { id: number; name: string };
      };
      void queryClient.invalidateQueries({ queryKey: ["zenstack", "DataSet"] });
      toast.success(t("createSuccess", { name: json.dataSet.name }));
      onOpenChange(false);
      router.push(
        `/projects/settings/${projectId}/datasets/${json.dataSet.id}`
      );
    } catch {
      toast.error(tCreate("error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dataset-create-dialog">
        <DialogHeader>
          <DialogTitle>{tCreate("title")}</DialogTitle>
          <DialogDescription>{tCreate("description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="dataset-create-form"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tCreate("nameLabel")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={tCreate("namePlaceholder")}
                      data-testid="dataset-create-name"
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tCreate("descriptionLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder={tCreate("descriptionPlaceholder")}
                      data-testid="dataset-create-description"
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                {tCreate("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                data-testid="dataset-create-submit"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {tCreate("submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
