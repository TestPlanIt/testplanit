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
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import {
  useCreatePromptConfig,
  useFindManyPromptConfig,
  useUpdatePromptConfig
} from "~/lib/hooks/prompt-config";
import { useCreatePromptConfigPrompt } from "~/lib/hooks/prompt-config-prompt";
import { LLM_FEATURES, type LlmFeature } from "~/lib/llm/constants";
import { FALLBACK_PROMPTS } from "~/lib/llm/services/fallback-prompts";
import { PromptFeatureSection } from "./PromptFeatureSection";

const featureKeys = Object.values(LLM_FEATURES);

const createFormSchema = (t: any) => {
  const promptFields: Record<string, z.ZodObject<any>> = {};
  for (const feature of featureKeys) {
    promptFields[feature] = z.object({
      systemPrompt: z.string().min(1, "System prompt is required"),
      userPrompt: z.string(),
      temperature: z.number().min(0).max(2),
      maxOutputTokens: z.number().min(1).max(1048576),
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

interface AddPromptConfigProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function getDefaultPromptValues(): Record<string, any> {
  const prompts: Record<string, any> = {};
  for (const feature of featureKeys) {
    const fallback = FALLBACK_PROMPTS[feature];
    prompts[feature] = {
      systemPrompt: fallback?.systemPrompt || "",
      userPrompt: fallback?.userPrompt || "",
      temperature: fallback?.temperature ?? 0.7,
      maxOutputTokens: fallback?.maxOutputTokens ?? 2048,
    };
  }
  return prompts;
}

export function AddPromptConfig({
  open,
  onClose,
  onSuccess,
}: AddPromptConfigProps) {
  const t = useTranslations("admin.prompts");
  const tAdd = useTranslations("admin.prompts.add");
  const tCommon = useTranslations("common");
  const [loading, setLoading] = useState(false);

  const { mutateAsync: createPromptConfig } = useCreatePromptConfig();
  const { mutateAsync: createPromptConfigPrompt } =
    useCreatePromptConfigPrompt();
  const { mutateAsync: updatePromptConfig } = useUpdatePromptConfig();
  const { data: existingDefaults } = useFindManyPromptConfig({
    where: { isDefault: true, isDeleted: false },
  });

  const formSchema = createFormSchema(t);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      isDefault: false,
      isActive: true,
      prompts: getDefaultPromptValues(),
    },
  });

  const onSubmit = async (values: FormData) => {
    setLoading(true);

    try {
      // If setting as default, unset existing defaults first
      if (values.isDefault && existingDefaults && existingDefaults.length > 0) {
        await Promise.all(
          existingDefaults.map((config) =>
            updatePromptConfig({
              where: { id: config.id },
              data: { isDefault: false },
            })
          )
        );
      }

      // Create the PromptConfig
      const config = await createPromptConfig({
        data: {
          name: values.name,
          description: values.description || null,
          isDefault: values.isDefault,
          isActive: values.isActive,
        },
      });

      if (config) {
        // Create PromptConfigPrompt for each feature
        for (const feature of featureKeys) {
          const promptData = values.prompts[feature] as {
            systemPrompt: string;
            userPrompt: string;
            temperature: number;
            maxOutputTokens: number;
          };
          await createPromptConfigPrompt({
            data: {
              promptConfigId: config.id,
              feature,
              systemPrompt: promptData.systemPrompt,
              userPrompt: promptData.userPrompt || "",
              temperature: promptData.temperature,
              maxOutputTokens: promptData.maxOutputTokens,
            },
          });
        }

        toast.success(tCommon("fields.success"));
        onSuccess();
      }
    } catch (error: any) {
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
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tAdd("title")}</DialogTitle>
          <DialogDescription>{tAdd("description")}</DialogDescription>
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
                    <Input placeholder="e.g. Custom Prompts" {...field} />
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
                    <Input
                      placeholder="Optional description..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="border rounded-lg p-4">
              <h3 className="text-sm font-medium mb-3">{t("features")}</h3>
              <Accordion type="single" collapsible className="w-full">
                {featureKeys.map((feature) => (
                  <PromptFeatureSection key={feature} feature={feature as LlmFeature} />
                ))}
              </Accordion>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tCommon("actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
