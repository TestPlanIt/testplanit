"use client";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useFormContext } from "react-hook-form";
import { useFindManyLlmIntegration } from "~/lib/hooks/llm-integration";
import {
  LLM_FEATURE_LABELS,
  PROMPT_FEATURE_VARIABLES,
  type LlmFeature
} from "~/lib/llm/constants";
import { PromptVariableInserter } from "./PromptVariableInserter";

interface PromptFeatureSectionProps {
  feature: LlmFeature;
}

/**
 * Accordion item for a single LLM feature in the Add/Edit PromptConfig modals.
 * Uses useFormContext so it works inside any Form that has a `prompts.{feature}.*` shape.
 */
export function PromptFeatureSection({ feature }: PromptFeatureSectionProps) {
  const { control, setValue, watch } = useFormContext();
  const t = useTranslations("admin.prompts");

  const systemPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const userPromptRef = useRef<HTMLTextAreaElement | null>(null);

  const { data: integrations } = useFindManyLlmIntegration({
    where: { isDeleted: false, status: "ACTIVE" },
    include: { llmProviderConfig: true },
    orderBy: { name: "asc" },
  });

  const variables = PROMPT_FEATURE_VARIABLES[feature];
  const systemPromptValue: string = watch(`prompts.${feature}.systemPrompt`) ?? "";
  const userPromptValue: string = watch(`prompts.${feature}.userPrompt`) ?? "";

  const selectedIntegrationId: number | null = watch(`prompts.${feature}.llmIntegrationId`) ?? null;
  const selectedIntegration = integrations?.find((i: any) => i.id === selectedIntegrationId);
  const availableModels: string[] = selectedIntegration?.llmProviderConfig?.availableModels
    ? (Array.isArray(selectedIntegration.llmProviderConfig.availableModels)
      ? selectedIntegration.llmProviderConfig.availableModels.map((m: any) => typeof m === "string" ? m : m.name || m.id || String(m))
      : [])
    : [];

  return (
    <AccordionItem value={feature}>
      <AccordionTrigger className="text-sm">
        <span className="flex items-center gap-2">
          {t(`featureLabels.${feature}` as any) || LLM_FEATURE_LABELS[feature]}
          <span className="text-xs font-normal text-muted-foreground">
            {"("}
            {selectedIntegration
              ? `${selectedIntegration.name}${watch(`prompts.${feature}.modelOverride`) ? ` · ${watch(`prompts.${feature}.modelOverride`)}` : ""}`
              : t("llmIntegrationPlaceholder")}
            {")"}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 px-1">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={control}
            name={`prompts.${feature}.llmIntegrationId` as any}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("llmIntegration")}</FormLabel>
                <Select
                  value={field.value ? String(field.value) : ""}
                  onValueChange={(value) => {
                    if (value === "__clear__") {
                      setValue(`prompts.${feature}.llmIntegrationId`, null, { shouldDirty: true });
                      setValue(`prompts.${feature}.modelOverride`, null, { shouldDirty: true });
                    } else {
                      setValue(`prompts.${feature}.llmIntegrationId`, parseInt(value), { shouldDirty: true });
                    }
                  }}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("llmIntegrationPlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__clear__">{t("projectDefault")}</SelectItem>
                    {integrations?.map((integration: any) => (
                      <SelectItem key={integration.id} value={String(integration.id)}>
                        {integration.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`prompts.${feature}.modelOverride` as any}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("modelOverride")}</FormLabel>
                <Select
                  value={field.value ?? ""}
                  onValueChange={(value) => {
                    if (value === "__clear__") {
                      setValue(`prompts.${feature}.modelOverride`, null, { shouldDirty: true });
                    } else {
                      setValue(`prompts.${feature}.modelOverride`, value, { shouldDirty: true });
                    }
                  }}
                  disabled={!selectedIntegrationId}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("modelOverridePlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="__clear__">{t("integrationDefault")}</SelectItem>
                    {availableModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={control}
          name={`prompts.${feature}.systemPrompt` as any}
          render={({ field: { ref: fieldRef, ...fieldProps } }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel className="flex items-center">
                  {t("systemPrompt")}
                  <HelpPopover helpKey="promptConfig.systemPrompt" />
                </FormLabel>
                <PromptVariableInserter
                  variables={variables}
                  textareaRef={systemPromptRef}
                  currentValue={systemPromptValue}
                  onInsert={(val) =>
                    setValue(`prompts.${feature}.systemPrompt`, val, {
                      shouldDirty: true,
                    })
                  }
                />
              </div>
              <FormControl>
                <Textarea
                  ref={(el) => {
                    fieldRef(el);
                    systemPromptRef.current = el;
                  }}
                  rows={8}
                  className="font-mono text-xs"
                  {...fieldProps}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name={`prompts.${feature}.userPrompt` as any}
          render={({ field: { ref: fieldRef, ...fieldProps } }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel className="flex items-center">
                  {t("userPrompt")}
                  <HelpPopover helpKey="promptConfig.userPrompt" />
                </FormLabel>
                <PromptVariableInserter
                  variables={variables}
                  textareaRef={userPromptRef}
                  currentValue={userPromptValue}
                  onInsert={(val) =>
                    setValue(`prompts.${feature}.userPrompt`, val, {
                      shouldDirty: true,
                    })
                  }
                />
              </div>
              <FormControl>
                <Textarea
                  ref={(el) => {
                    fieldRef(el);
                    userPromptRef.current = el;
                  }}
                  rows={4}
                  className="font-mono text-xs"
                  {...fieldProps}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={control}
            name={`prompts.${feature}.temperature` as any}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center">
                  {t("temperature")}
                  <HelpPopover helpKey="promptConfig.temperature" />
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    {...field}
                    onChange={(e) => field.onChange(parseFloat(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`prompts.${feature}.maxOutputTokens` as any}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center">
                  {t("maxOutputTokens")}
                  <HelpPopover helpKey="promptConfig.maxOutputTokens" />
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min="1"
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
