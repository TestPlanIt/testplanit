"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TestmoImportPanel } from "./TestmoImportPanel";

export default function AdminImportsPage() {
  const t = useTranslations("admin.imports");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
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
              <AlertTitle>{t("comingSoon.title")}</AlertTitle>
              <AlertDescription>{t("comingSoon.description")}</AlertDescription>
            </Alert>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
