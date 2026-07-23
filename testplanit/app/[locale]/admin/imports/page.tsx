"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";
import { TestmoImportPanel } from "./TestmoImportPanel";

export default function AdminImportsPage() {
  const t = useTranslations("admin.imports");
  const tGlobal = useTranslations();

  return (
    <Card>
      <CardHeader>
        <SectionHeader className="flex items-center gap-2">
          <CardTitle>{tGlobal("admin.menu.imports")}</CardTitle>
          <HelpPopover helpKey="imports" />
        </SectionHeader>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="testmo">
          <TabsList className="w-full">
            <TabsTrigger value="testmo" className="w-full">
              {t("tabs.testmoJson")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="testmo">
            <TestmoImportPanel />
          </TabsContent>
          <TabsContent value="testrail">
            <Alert>
              <AlertTitle>
                {tGlobal("repository.exportModal.comingSoon")}
              </AlertTitle>
              <AlertDescription>{t("comingSoon.description")}</AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
