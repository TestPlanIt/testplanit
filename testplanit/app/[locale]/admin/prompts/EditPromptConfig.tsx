"use client";

import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { zodResolver } from "@hookform/resolvers/zod";
import { Edit, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import {
  useFindManyPromptConfig, useUpdatePromptConfig
} from "~/lib/hooks/prompt-config";
import { useCreatePromptConfigPrompt, useUpdatePromptConfigPrompt } from "~/lib/hooks/prompt-config-prompt";
import { LLM_FEATURES, type LlmFeature } from "~/lib/llm/constants";
import type { ExtendedPromptConfig } from "./columns";
import { PromptFeatureSection } from "./PromptFeatureSection";

const featureKeys = Object.values(LLM_FEATURES);

const createFormSchema = () => {
  const promptFields: Record<string, z.ZodObject<any>> = {};
  for (const feature of featureKeys) {
    promptFields[feature] = z.object({
      id: z.string().optional(),
      systemPrompt: z.string().min(1, "System prompt is required"),
      userPrompt: z.string(),
      temperature: z.number().min(0).max(2),
      maxOutputTokens: z.number().min(1).max(1048576),
      llmIntegrationId: z.number().nullable().optional(),
      modelOverride: z.string().nullable().optional(),
    });
  }

  return z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    isDefault: z.boolean(),
    isActive: z.boolean(),
    prompts: z.object(promptFields),
  });
};

type FormData = z.infer<ReturnType<typeof createFormSchema>>;

interface EditPromptConfigProps {
  config: ExtendedPromptConfig;
}

export function EditPromptConfig({ config }: EditPromptConfigProps) {
  const t = useTranslations("admin.prompts");
  const tEdit = useTranslations("admin.prompts.edit");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const { mutateAsync: updatePromptConfig } = useUpdatePromptConfig();
  const { mutateAsync: updatePromptConfigPrompt } =
    useUpdatePromptConfigPrompt();
  const { mutateAsync: createPromptConfigPrompt } =
    useCreatePromptConfigPrompt();
  const { data: existingDefaults } = useFindManyPromptConfig({
    where: { isDefault: true, isDeleted: false },
  });

  const formSchema = createFormSchema();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      isDefault: false,
      isActive: true,
      prompts: {},
    },
  });

  useEffect(() => {
    if (config && open) {
      const promptValues: Record<string, any> = {};
      for (const feature of featureKeys) {
        const existing = config.prompts?.find((p) => p.feature === feature);
        promptValues[feature] = {
          id: existing?.id || "",
          systemPrompt: existing?.systemPrompt || "",
          userPrompt: existing?.userPrompt || "",
          temperature: existing?.temperature ?? 0.7,
          maxOutputTokens: existing?.maxOutputTokens ?? 2048,
          llmIntegrationId: existing?.llmIntegrationId ?? null,
          modelOverride: existing?.modelOverride ?? null,
        };
      }

      form.reset({
        name: config.name,
        description: config.description || "",
        isDefault: config.isDefault,
        isActive: config.isActive,
        prompts: promptValues,
      });
    }
  }, [config, open, form]);

  const onSubmit = async (values: FormData) => {
    setLoading(true);

    try {
      // If setting as default, unset existing defaults first
      if (values.isDefault && existingDefaults && existingDefaults.length > 0) {
        await Promise.all(
          existingDefaults
            .filter((c) => c.id !== config.id)
            .map((c) =>
              updatePromptConfig({
                where: { id: c.id },
                data: { isDefault: false },
              })
            )
        );
      }

      // Update the PromptConfig
      await updatePromptConfig({
        where: { id: config.id },
        data: {
          name: values.name,
          description: values.description || null,
          isDefault: values.isDefault,
          isActive: values.isActive,
        },
      });

      // Update each PromptConfigPrompt
      for (const feature of featureKeys) {
        const promptData = values.prompts[feature] as {
          id?: string;
          systemPrompt: string;
          userPrompt: string;
          temperature: number;
          maxOutputTokens: number;
          llmIntegrationId?: number | null;
          modelOverride?: string | null;
        };
        if (promptData.id) {
          await updatePromptConfigPrompt({
            where: { id: promptData.id },
            data: {
              systemPrompt: promptData.systemPrompt,
              userPrompt: promptData.userPrompt || "",
              temperature: promptData.temperature,
              maxOutputTokens: promptData.maxOutputTokens,
              ...(promptData.llmIntegrationId
                ? { llmIntegration: { connect: { id: promptData.llmIntegrationId } } }
                : { llmIntegration: { disconnect: true } }),
              modelOverride: promptData.modelOverride || null,
            },
          });
        } else {
          // Create a new PromptConfigPrompt for features that don't have one yet
          await createPromptConfigPrompt({
            data: {
              promptConfig: { connect: { id: config.id } },
              feature,
              systemPrompt: promptData.systemPrompt,
              userPrompt: promptData.userPrompt || "",
              temperature: promptData.temperature,
              maxOutputTokens: promptData.maxOutputTokens,
              ...(promptData.llmIntegrationId
                ? { llmIntegration: { connect: { id: promptData.llmIntegrationId } } }
                : {}),
              modelOverride: promptData.modelOverride || null,
            },
          });
        }
      }

      toast.success(tCommon("fields.success"));

      setOpen(false);
    } catch (error: any) {
      console.error("Error updating prompt config:", error);
      const message =
        error?.info?.message || error?.message || "Unknown error occurred";
      toast.error(tCommon("errors.error"), {
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="px-2 py-1 h-auto"
      >
        <Edit className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tEdit("title")}</DialogTitle>
            <DialogDescription>{tEdit("description")}</DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("name")}
                      <HelpPopover helpKey="promptConfig.name" />
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                    <FormLabel className="flex items-center">
                      {tCommon("fields.description")}
                      <HelpPopover helpKey="promptConfig.description" />
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel className="flex items-center">
                          {tCommon("fields.isActive")}
                          <HelpPopover helpKey="promptConfig.isActive" />
                        </FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={form.watch("isDefault")}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isDefault"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel className="flex items-center">
                          {tCommon("fields.default")}
                          <HelpPopover helpKey="promptConfig.isDefault" />
                        </FormLabel>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={(checked) => {
                            field.onChange(checked);
                            if (checked) {
                              form.setValue("isActive", true);
                            }
                          }}
                          disabled={config.isDefault}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div>
                <h3 className="text-sm font-medium leading-none mb-2">{t("features")}</h3>
                <div className="border rounded-lg px-4 pb-4 pt-1">
                  <Accordion type="single" collapsible className="w-full">
                    {featureKeys.map((feature) => (
                      <PromptFeatureSection key={feature} feature={feature as LlmFeature} />
                    ))}
                  </Accordion>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {tCommon("actions.save")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
