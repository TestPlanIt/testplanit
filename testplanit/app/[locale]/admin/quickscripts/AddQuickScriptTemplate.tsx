"use client";

import { CaseExportTemplate } from "@prisma/client";
import { useMemo, useRef, useState } from "react";
import {
  useCreateCaseExportTemplate,
  useFindManyCaseExportTemplate,
  useFindManyCaseFields,
  useUpdateManyCaseExportTemplate
} from "~/lib/hooks";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CirclePlus } from "lucide-react";
import Mustache from "mustache";
import "prismjs/themes/prism-tomorrow.css";
import { highlightCode, mapLanguageToPrism } from "~/lib/utils/codeHighlight";
import { buildSampleFields, SAMPLE_CASE_BASE } from "./sampleCaseData";
import { TemplateVariableInserter } from "./TemplateVariableInserter";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";

import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";

export function AddQuickScriptTemplateModal() {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const t = useTranslations("admin.exportTemplates");
  const tCommon = useTranslations("common");

  const FormSchema: any = z.object({
    name: z.string().min(1, {
      message: tCommon("fields.validation.nameRequired"),
    }),
    description: z.string().optional(),
    category: z.string().min(1, {
      message: t("fields.validation.categoryRequired"),
    }),
    framework: z.string().min(1, {
      message: t("fields.validation.frameworkRequired"),
    }),
    headerBody: z.string().optional().default(""),
    templateBody: z.string().min(1, {
      message: t("fields.validation.templateBodyRequired"),
    }),
    footerBody: z.string().optional().default(""),
    fileExtension: z.string().min(1, {
      message: t("fields.validation.fileExtensionRequired"),
    }),
    language: z.string().min(1, {
      message: t("fields.validation.languageRequired"),
    }),
    isDefault: z.boolean().prefault(false),
    isEnabled: z.boolean().prefault(true),
  });

  const { mutateAsync: createTemplate } = useCreateCaseExportTemplate();
  const { mutateAsync: updateManyTemplates } =
    useUpdateManyCaseExportTemplate();

  const { data: existingTemplates } = useFindManyCaseExportTemplate({
    where: { isDeleted: false },
    select: {
      category: true,
      framework: true,
      fileExtension: true,
      language: true,
    },
  });
  const templates = existingTemplates as CaseExportTemplate[] | undefined;

  const categoryOptions = useMemo(() => {
    if (!templates) return [];
    return [
      ...new Set(templates.map((t) => t.category).filter(Boolean)),
    ].sort();
  }, [templates]);

  const frameworkOptions = useMemo(() => {
    if (!templates) return [];
    return [
      ...new Set(templates.map((t) => t.framework).filter(Boolean)),
    ].sort();
  }, [templates]);

  const extensionOptions = useMemo(() => {
    if (!templates) return [];
    return [
      ...new Set(templates.map((t) => t.fileExtension).filter(Boolean)),
    ].sort();
  }, [templates]);

  const languageOptions = useMemo(() => {
    if (!templates) return [];
    return [
      ...new Set(templates.map((t) => t.language).filter(Boolean)),
    ].sort();
  }, [templates]);

  const { data: caseFieldsData } = useFindManyCaseFields({
    where: { isEnabled: true, isDeleted: false },
    select: { systemName: true, type: { select: { type: true } } },
  });

  const sampleCase = useMemo(() => {
    const fields = buildSampleFields(caseFieldsData as any);
    return { ...SAMPLE_CASE_BASE, fields };
  }, [caseFieldsData]);

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      description: "",
      category: "",
      framework: "",
      headerBody: "",
      templateBody: "",
      footerBody: "",
      fileExtension: "",
      language: "",
      isDefault: false,
      isEnabled: true,
    },
  });

  const templateBodyRef = useRef<HTMLTextAreaElement>(null);

  const headerBody = form.watch("headerBody");
  const templateBody = form.watch("templateBody");
  const footerBody = form.watch("footerBody");
  const language = form.watch("language");

  const prismLanguage = useMemo(
    () => mapLanguageToPrism(language || ""),
    [language]
  );

  const preview = useMemo(() => {
    if (!headerBody && !templateBody && !footerBody) return "";
    try {
      Mustache.escape = (text: string) =>
        String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const renderedBody = templateBody
        ? Mustache.render(templateBody, sampleCase)
        : "";
      return [headerBody, renderedBody, footerBody]
        .filter(Boolean)
        .join("\n\n");
    } catch {
      return t("preview.error");
    }
  }, [headerBody, templateBody, footerBody, sampleCase, t]);

  const highlightedPreview = useMemo(
    () => (preview ? highlightCode(preview, prismLanguage) : ""),
    [preview, prismLanguage]
  );

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (data.isDefault) {
        await updateManyTemplates({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      await createTemplate({
        data: {
          name: data.name,
          description: data.description || null,
          category: data.category,
          framework: data.framework,
          headerBody: data.headerBody || null,
          templateBody: data.templateBody,
          footerBody: data.footerBody || null,
          fileExtension: data.fileExtension,
          language: data.language,
          isDefault: data.isDefault,
          isEnabled: data.isEnabled,
        },
      });

      setOpen(false);
      form.reset();
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: tCommon("errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="add-export-template-button">
          <CirclePlus className="w-4" />
          <span className="hidden md:inline">{t("add.button")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[800px] lg:max-w-[1200px] max-h-[90vh] overflow-y-auto"
        data-testid="export-template-dialog"
      >
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="export-template-form"
          >
            <DialogHeader>
              <DialogTitle>{t("add.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("add.title")}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("name")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("fields.placeholders.name")}
                        data-testid="export-template-name-input"
                        {...field}
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
                    <FormLabel>{tCommon("fields.description")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("fields.placeholders.description")}
                        data-testid="export-template-description-input"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.category")}</FormLabel>
                    <FormControl>
                      <ComboboxInput
                        options={categoryOptions}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder={t("fields.placeholders.category")}
                        emptyMessage={t("fields.combobox.typeNew")}
                        data-testid="export-template-category-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="framework"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.framework")}</FormLabel>
                    <FormControl>
                      <ComboboxInput
                        options={frameworkOptions}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder={t("fields.placeholders.framework")}
                        emptyMessage={t("fields.combobox.typeNew")}
                        data-testid="export-template-framework-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="fileExtension"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("fields.fileExtension")}</FormLabel>
                    <FormControl>
                      <ComboboxInput
                        options={extensionOptions}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder={t("fields.placeholders.fileExtension")}
                        emptyMessage={t("fields.combobox.typeNew")}
                        data-testid="export-template-extension-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tCommon("fields.locale")}</FormLabel>
                    <FormControl>
                      <ComboboxInput
                        options={languageOptions}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder={t("fields.placeholders.language")}
                        emptyMessage={t("fields.combobox.typeNew")}
                        data-testid="export-template-language-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-end gap-6 pb-2">
                <FormField
                  control={form.control}
                  name="isEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormLabel>{tCommon("fields.enabled")}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="export-template-enabled-switch"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isDefault"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormLabel>{tCommon("fields.default")}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="export-template-default-switch"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="headerBody"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.headerBody")}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t("fields.placeholders.headerBody")}
                          className="font-mono text-sm min-h-[100px] resize-y"
                          data-testid="export-template-header-textarea"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="templateBody"
                  render={({ field: { ref: fieldRef, ...fieldProps } }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>{t("fields.templateBody")}</FormLabel>
                        <TemplateVariableInserter
                          textareaRef={templateBodyRef}
                          currentValue={fieldProps.value}
                          onInsert={(val) =>
                            form.setValue("templateBody", val, {
                              shouldDirty: true,
                            })
                          }
                        />
                      </div>
                      <FormControl>
                        <Textarea
                          ref={(el) => {
                            fieldRef(el);
                            templateBodyRef.current = el;
                          }}
                          placeholder={t("fields.placeholders.templateBody")}
                          className="font-mono text-sm min-h-[400px] resize-y"
                          data-testid="export-template-body-textarea"
                          {...fieldProps}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="footerBody"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("fields.footerBody")}</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t("fields.placeholders.footerBody")}
                          className="font-mono text-sm min-h-[100px] resize-y"
                          data-testid="export-template-footer-textarea"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div>
                <label className="text-sm font-medium">
                  {t("preview.title")}
                </label>
                {highlightedPreview ? (
                  <pre
                    className="mt-2 bg-stone-800 rounded-md overflow-auto p-4 text-sm max-h-[400px]"
                    data-testid="export-template-preview"
                  >
                    <code
                      className={`language-${prismLanguage}`}
                      dangerouslySetInnerHTML={{ __html: highlightedPreview }}
                    />
                  </pre>
                ) : (
                  <pre
                    className="mt-2 p-3 bg-muted rounded-md text-sm font-mono overflow-auto max-h-[400px] whitespace-pre-wrap"
                    data-testid="export-template-preview"
                  >
                    {t("preview.empty")}
                  </pre>
                )}
              </div>
            </div>

            <DialogFooter>
              {form.formState.errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {form.formState.errors.root.message}
                </div>
              )}
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
                data-testid="export-template-submit-button"
              >
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
