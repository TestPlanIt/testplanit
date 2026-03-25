"use client";

import { CaseExportTemplate } from "@prisma/client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useFindManyCaseExportTemplate,
  useFindManyCaseFields,
  useUpdateCaseExportTemplate,
  useUpdateManyCaseExportTemplate
} from "~/lib/hooks";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pencil } from "lucide-react";
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

interface EditQuickScriptTemplateModalProps {
  template: CaseExportTemplate;
}

export function EditQuickScriptTemplateModal({
  template,
}: EditQuickScriptTemplateModalProps) {
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
    isDefault: z.boolean(),
    isEnabled: z.boolean(),
  });

  const { mutateAsync: updateTemplate } = useUpdateCaseExportTemplate();
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
  const allTemplates = existingTemplates as CaseExportTemplate[] | undefined;

  const categoryOptions = useMemo(() => {
    if (!allTemplates) return [];
    return [
      ...new Set(allTemplates.map((t) => t.category).filter(Boolean)),
    ].sort();
  }, [allTemplates]);

  const frameworkOptions = useMemo(() => {
    if (!allTemplates) return [];
    return [
      ...new Set(allTemplates.map((t) => t.framework).filter(Boolean)),
    ].sort();
  }, [allTemplates]);

  const extensionOptions = useMemo(() => {
    if (!allTemplates) return [];
    return [
      ...new Set(allTemplates.map((t) => t.fileExtension).filter(Boolean)),
    ].sort();
  }, [allTemplates]);

  const languageOptions = useMemo(() => {
    if (!allTemplates) return [];
    return [
      ...new Set(allTemplates.map((t) => t.language).filter(Boolean)),
    ].sort();
  }, [allTemplates]);

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
      name: template.name,
      description: template.description || "",
      category: template.category,
      framework: template.framework,
      headerBody: template.headerBody || "",
      templateBody: template.templateBody,
      footerBody: template.footerBody || "",
      fileExtension: template.fileExtension,
      language: template.language,
      isDefault: template.isDefault,
      isEnabled: template.isEnabled,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: template.name,
        description: template.description || "",
        category: template.category,
        framework: template.framework,
        headerBody: template.headerBody || "",
        templateBody: template.templateBody,
        footerBody: template.footerBody || "",
        fileExtension: template.fileExtension,
        language: template.language,
        isDefault: template.isDefault,
        isEnabled: template.isEnabled,
      });
    }
  }, [open, template, form]);

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
      if (data.isDefault && !template.isDefault) {
        await updateManyTemplates({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      await updateTemplate({
        where: { id: template.id },
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
        <Button
          variant="outline"
          className="px-2 py-1 h-auto"
          data-testid="edit-export-template-button"
        >
          <Pencil className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[800px] lg:max-w-[1200px] max-h-[90vh] overflow-y-auto"
        data-testid="edit-export-template-dialog"
      >
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="edit-export-template-form"
          >
            <DialogHeader>
              <DialogTitle>{t("edit.title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("edit.title")}
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
                        data-testid="edit-export-template-name-input"
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
                        data-testid="edit-export-template-description-input"
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
                        data-testid="edit-export-template-category-input"
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
                        data-testid="edit-export-template-framework-input"
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
                        data-testid="edit-export-template-extension-input"
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
                        data-testid="edit-export-template-language-input"
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
                          disabled={form.watch("isDefault")}
                          data-testid="edit-export-template-enabled-switch"
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
                          data-testid="edit-export-template-default-switch"
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
                          data-testid="edit-export-template-header-textarea"
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
                          className="font-mono text-sm min-h-[400px] resize-y"
                          data-testid="edit-export-template-body-textarea"
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
                          data-testid="edit-export-template-footer-textarea"
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
                    className="mt-2 bg-stone-800 rounded-md overflow-auto p-4 text-sm max-h-[690px]"
                    data-testid="edit-export-template-preview"
                  >
                    <code
                      className={`language-${prismLanguage}`}
                      dangerouslySetInnerHTML={{ __html: highlightedPreview }}
                    />
                  </pre>
                ) : (
                  <pre
                    className="mt-2 p-3 bg-muted rounded-md text-sm font-mono overflow-auto max-h-[690px] whitespace-pre-wrap ring-1 ring-border"
                    data-testid="edit-export-template-preview"
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
                data-testid="edit-export-template-submit-button"
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
