"use client";

import { useSession } from "next-auth/react";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useRouter } from "~/lib/navigation";

export default function TestCaseDetails() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { caseId } = useParams();
  const t = useTranslations();

  const { data, isLoading } = useClientQueries(schema).repositoryCases.useFindFirst({
    where: { id: Number(caseId), isDeleted: false },
    select: { projectId: true },
  });

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading" || isLoading) return null;

  if (!data) {
    return (
      <div className="text-muted-foreground">{t("common.empty.testCase")}</div>
    );
  }

  // Redirect to the repository case page.
  router.replace(`/projects/repository/${data.projectId}/${caseId}`);
}
