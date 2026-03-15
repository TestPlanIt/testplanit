"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { useFindFirstRepositoryCases } from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";

export default function TestCaseDetails() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { caseId } = useParams();
  const t = useTranslations();

  const { data, isLoading } = useFindFirstRepositoryCases({
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
