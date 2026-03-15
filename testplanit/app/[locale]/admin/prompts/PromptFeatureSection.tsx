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
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useFormContext } from "react-hook-form";
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

  const variables = PROMPT_FEATURE_VARIABLES[feature];
  const systemPromptValue: string = watch(`prompts.${feature}.systemPrompt`) ?? "";
  const userPromptValue: string = watch(`prompts.${feature}.userPrompt`) ?? "";

  return (
    <AccordionItem value={feature}>
      <AccordionTrigger className="text-sm">
        {t(`featureLabels.${feature}` as any) || LLM_FEATURE_LABELS[feature]}
      </AccordionTrigger>
      <AccordionContent className="space-y-4 px-1">
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
