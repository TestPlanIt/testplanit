"use client";

import { useTranslations } from "next-intl";
import React, { useState } from "react";

import { CreateProjectWizard } from "@/admin/projects/CreateProjectWizard";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Boxes, Rocket } from "lucide-react";
import { Button } from "./ui/button";

export const CreateFirstProjectCard: React.FC = () => {
  const t = useTranslations();
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  return (
    <>
      <Card
        className="border-4 border-primary"
        data-testid="create-first-project-card"
      >
        <CardHeader>
          <CardTitle className="text-xl font-semibold text-primary">
            <div className="flex items-center gap-1">
              <Rocket className="h-6 w-6" />
              <div>{t("home.getStarted.title")}</div>
            </div>
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("home.getStarted.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            type="button"
            onClick={() => setIsWizardOpen(true)}
            className="flex items-center transition-all duration-300 ease-in-out hover:ring-4 hover:ring-primary hover:ring-offset-2"
          >
            <Boxes className="shrink-0" />
            {t("home.getStarted.adminAddProject")}
          </Button>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          <div>{t("home.getStarted.footer")}</div>
        </CardFooter>
      </Card>

      {isWizardOpen && (
        <CreateProjectWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
        />
      )}
    </>
  );
};
