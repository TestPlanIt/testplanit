"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CaseExportTemplate } from "@prisma/client";
import { ScrollText, Search, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  useFindManyCaseExportTemplate,
  useUpdateCaseExportTemplate,
  useUpdateManyCaseExportTemplate
} from "~/lib/hooks";
import { AddQuickScriptTemplateModal } from "./AddQuickScriptTemplate";
import { DeleteQuickScriptTemplateModal } from "./DeleteQuickScriptTemplate";
import { EditQuickScriptTemplateModal } from "./EditQuickScriptTemplate";

export default function QuickScriptTemplates() {
  const { data: session, status } = useSession();
  const t = useTranslations("admin.exportTemplates");
  const tCommon = useTranslations("common");

  const [filterText, setFilterText] = useState("");
  const [filterFramework, setFilterFramework] = useState("__all__");
  const [filterExtension, setFilterExtension] = useState("__all__");
  const [filterLanguage, setFilterLanguage] = useState("__all__");
  const [filterEnabled, setFilterEnabled] = useState("__all__");
  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<
    number | undefined
  >(undefined);

  const { mutateAsync: updateTemplate } = useUpdateCaseExportTemplate();
  const { mutateAsync: updateManyTemplates } =
    useUpdateManyCaseExportTemplate();

  const updateTemplateRef = useRef(updateTemplate);
  // eslint-disable-next-line react-hooks/refs
  updateTemplateRef.current = updateTemplate;

  const { data, isLoading } = useFindManyCaseExportTemplate(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );
  const templates = data as CaseExportTemplate[];

  const handleToggleEnabled = useCallback(
    async (id: number, isEnabled: boolean) => {
      try {
        await updateTemplateRef.current({
          where: { id },
          data: { isEnabled },
        });
      } catch (error) {
        console.error("Failed to update export template:", error);
      }
    },
    []
  );

  const handleToggleDefault = useCallback((id: number, _isDefault: boolean) => {
    setSelectedTemplateId(id);
    setIsAlertDialogOpen(true);
  }, []);

  const handleConfirmToggleDefault = async () => {
    setIsAlertDialogOpen(false);
    try {
      if (selectedTemplateId !== undefined) {
        await updateManyTemplates({
          where: { isDefault: true },
          data: { isDefault: false },
        });
        await updateTemplate({
          where: { id: selectedTemplateId },
          data: { isDefault: true, isEnabled: true },
        });
      }
    } catch (error) {
      console.error("Failed to update export template:", error);
    }
  };

  const uniqueFrameworks = useMemo(() => {
    if (!templates) return [];
    return [
      ...new Set(templates.map((t) => t.framework).filter(Boolean)),
    ].sort();
  }, [templates]);

  const uniqueExtensions = useMemo(() => {
    if (!templates) return [];
    return [...new Set(templates.map((t) => t.fileExtension))].sort();
  }, [templates]);

  const uniqueLanguages = useMemo(() => {
    if (!templates) return [];
    return [...new Set(templates.map((t) => t.language))].sort();
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    return templates.filter((tmpl) => {
      if (filterText.trim()) {
        const lower = filterText.toLowerCase();
        const matchesText =
          tmpl.name.toLowerCase().includes(lower) ||
          tmpl.category.toLowerCase().includes(lower) ||
          (tmpl.framework || "").toLowerCase().includes(lower) ||
          tmpl.language.toLowerCase().includes(lower) ||
          tmpl.fileExtension.toLowerCase().includes(lower);
        if (!matchesText) return false;
      }
      if (filterFramework !== "__all__" && tmpl.framework !== filterFramework)
        return false;
      if (
        filterExtension !== "__all__" &&
        tmpl.fileExtension !== filterExtension
      )
        return false;
      if (filterLanguage !== "__all__" && tmpl.language !== filterLanguage)
        return false;
      if (filterEnabled !== "__all__" && !tmpl.isEnabled) return false;
      return true;
    });
  }, [
    templates,
    filterText,
    filterFramework,
    filterExtension,
    filterLanguage,
    filterEnabled,
  ]);

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, CaseExportTemplate[]>();
    for (const tmpl of filteredTemplates) {
      const category = tmpl.category || "Other";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(tmpl);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTemplates]);

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <>
        <Card data-testid="quickscript-templates-section">
          <CardHeader>
            <div className="flex items-center justify-between text-primary">
              <div className="flex items-center justify-between text-primary text-xl md:text-2xl">
                <CardTitle>
                  <div className="flex items-center">
                    <ScrollText className="mr-1" />
                    {t("title")}
                  </div>
                </CardTitle>
              </div>
              <div>
                <AddQuickScriptTemplateModal />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="relative flex-1 min-w-50">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t("filterPlaceholder")}
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="pl-9"
                  data-testid="quickscript-templates-filter"
                />
              </div>
              <Select
                value={filterFramework}
                onValueChange={setFilterFramework}
              >
                <SelectTrigger
                  className="w-40"
                  data-testid="quickscript-templates-filter-framework"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("allFrameworks")}</SelectItem>
                  {uniqueFrameworks.map((fw) => (
                    <SelectItem key={fw} value={fw}>
                      {fw}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filterExtension}
                onValueChange={setFilterExtension}
              >
                <SelectTrigger
                  className="w-40"
                  data-testid="quickscript-templates-filter-extension"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {t("allFileExtensions")}
                  </SelectItem>
                  {uniqueExtensions.map((ext) => (
                    <SelectItem key={ext} value={ext}>
                      {ext}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterLanguage} onValueChange={setFilterLanguage}>
                <SelectTrigger
                  className="w-40"
                  data-testid="quickscript-templates-filter-language"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("allLanguages")}</SelectItem>
                  {uniqueLanguages.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterEnabled} onValueChange={setFilterEnabled}>
                <SelectTrigger
                  className="w-35"
                  data-testid="quickscript-templates-filter-enabled"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t("showAll")}</SelectItem>
                  <SelectItem value="enabled">{t("showEnabled")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-12 animate-pulse rounded-md bg-muted"
                  />
                ))}
              </div>
            ) : groupedByCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t("noResults")}
              </p>
            ) : (
              <Accordion
                type="multiple"
                defaultValue={groupedByCategory.map(([cat]) => cat)}
                className="w-full"
              >
                {groupedByCategory.map(([category, categoryTemplates]) => (
                  <AccordionItem value={category} key={category}>
                    <AccordionTrigger className="hover:no-underline">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{category}</span>
                        <Badge variant="secondary" className="text-xs">
                          {t("templateCount", {
                            count: categoryTemplates.length,
                          })}
                        </Badge>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="rounded-md border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="px-4 py-2 text-left font-medium">
                                {tCommon("name")}
                              </th>
                              <th className="px-4 py-2 text-left font-medium">
                                {t("fields.framework")}
                              </th>
                              <th className="px-4 py-2 text-left font-medium">
                                {t("fields.fileExtension")}
                              </th>
                              <th className="px-4 py-2 text-left font-medium">
                                {t("fields.language")}
                              </th>
                              <th className="px-4 py-2 text-center font-medium">
                                {tCommon("fields.enabled")}
                              </th>
                              <th className="px-4 py-2 text-center font-medium">
                                {tCommon("fields.default")}
                              </th>
                              <th className="px-4 py-2 text-center font-medium">
                                {tCommon("actions.actionsLabel")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {categoryTemplates.map((tmpl) => (
                              <tr
                                key={tmpl.id}
                                className="border-b last:border-b-0 hover:bg-muted/30"
                              >
                                <td className="px-4 py-2">{tmpl.name}</td>
                                <td className="px-4 py-2">{tmpl.framework}</td>
                                <td className="px-4 py-2">
                                  <code className="text-sm">
                                    {tmpl.fileExtension}
                                  </code>
                                </td>
                                <td className="px-4 py-2">{tmpl.language}</td>
                                <td className="px-4 py-2 text-center">
                                  <Switch
                                    checked={tmpl.isEnabled}
                                    onCheckedChange={(checked) =>
                                      handleToggleEnabled(tmpl.id, checked)
                                    }
                                    disabled={tmpl.isDefault}
                                  />
                                </td>
                                <td className="px-4 py-2 text-center">
                                  <Switch
                                    checked={tmpl.isDefault}
                                    disabled={tmpl.isDefault}
                                    onCheckedChange={(checked) =>
                                      handleToggleDefault(tmpl.id, checked)
                                    }
                                  />
                                </td>
                                <td className="px-4 py-2">
                                  <div className="flex justify-center gap-1">
                                    <EditQuickScriptTemplateModal
                                      key={`edit-${tmpl.id}`}
                                      template={tmpl}
                                    />
                                    {tmpl.isDefault ? (
                                      <Button
                                        variant="ghost"
                                        className="px-2 py-1 h-auto text-muted-foreground cursor-not-allowed"
                                        disabled
                                      >
                                        <Trash2 className="h-5 w-5" />
                                      </Button>
                                    ) : (
                                      <DeleteQuickScriptTemplateModal
                                        key={`delete-${tmpl.id}`}
                                        template={tmpl}
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
        <AlertDialog
          open={isAlertDialogOpen}
          onOpenChange={setIsAlertDialogOpen}
        >
          <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center">
                {t("confirmSetAsDefault")}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogDescription>
              {t("confirmSetAsDefaultDescription")}
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsAlertDialogOpen(false)}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleConfirmToggleDefault()}
                className="bg-destructive"
              >
                {tCommon("actions.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }
  return null;
}
