"use client";

import { Button } from "@/components/ui/button";
import { DuplicateResultsTable } from "@/components/duplicates/DuplicateResultsTable";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { Link } from "~/lib/navigation";

export default function DuplicatesPage() {
  const t = useTranslations("repository.duplicates");
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex items-center gap-2">
        <Link href={`/projects/repository/${projectId}`}>
          <Button variant="outline" size="icon" className="mr-2">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
          <p className="text-muted-foreground">{t("pageDescription")}</p>
        </div>
      </div>
      <DuplicateResultsTable projectId={projectId} />
    </div>
  );
}
