"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { ArrowLeft, CloudDownload, FileJson } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useUrlParamWriter } from "~/hooks/useUrlParamWriter";
import { QaseImportPanel } from "./QaseImportPanel";
import { TestmoImportPanel } from "./TestmoImportPanel";

type ImportSource = "testmo" | "qase";

const SOURCES: { id: ImportSource; icon: LucideIcon }[] = [
  { id: "qase", icon: CloudDownload },
  { id: "testmo", icon: FileJson },
];

export default function AdminImportsPage() {
  const t = useTranslations("admin.imports");
  const tGlobal = useTranslations();
  const searchParams = useSearchParams();
  const writeUrlParams = useUrlParamWriter();

  const sourceParam = searchParams.get("source");
  const source = SOURCES.find((entry) => entry.id === sourceParam)?.id ?? null;

  const selectSource = (next: ImportSource | null) =>
    writeUrlParams(
      (params) => {
        if (next) {
          params.set("source", next);
        } else {
          params.delete("source");
        }
      },
      { history: "push" }
    );

  return (
    <Card>
      <CardHeader>
        <SectionHeader className="flex items-center gap-2">
          <CardTitle>{tGlobal("admin.menu.imports")}</CardTitle>
          <HelpPopover helpKey="imports" />
        </SectionHeader>
      </CardHeader>
      <CardContent className="space-y-6">
        {source === null ? (
          <div className="space-y-4" data-testid="import-source-chooser">
            <p className="text-sm text-muted-foreground">
              {t("sources.heading")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {[...SOURCES]
                .sort((a, b) =>
                  t(`sources.${a.id}.title`).localeCompare(
                    t(`sources.${b.id}.title`)
                  )
                )
                .map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`import-source-${id}`}
                    onClick={() => selectSource(id)}
                    className="flex items-start gap-3 rounded-md border p-4 text-left transition hover:border-primary hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
                  >
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <span className="space-y-1">
                      <span className="block font-semibold">
                        {t(`sources.${id}.title`)}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {t(`sources.${id}.description`)}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                className="text-lg font-semibold"
                data-testid="import-source-current"
              >
                {t("sources.importingFrom", {
                  source: t(`sources.${source}.title`),
                })}
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="import-source-change"
                onClick={() => selectSource(null)}
              >
                <ArrowLeft className="h-4 w-4" />
                {t("sources.change")}
              </Button>
            </div>
            {source === "testmo" ? <TestmoImportPanel /> : <QaseImportPanel />}
          </>
        )}
      </CardContent>
    </Card>
  );
}
