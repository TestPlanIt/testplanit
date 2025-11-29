"use client";

import { useEffect } from "react";
import { useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useFindFirstMilestones } from "~/lib/hooks";
import { useTranslations } from "next-intl";

export default function MilestoneDetails() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const milestoneId = params.milestoneId;
  const t = useTranslations();

  const { data, isLoading } = useFindFirstMilestones({
    where: { id: Number(milestoneId), isDeleted: false },
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
      <div className="text-muted-foreground">
        {t("milestones.errors.notFound")}
      </div>
    );
  }

  // Redirect to the milestone page in the correct project.
  router.replace(`/projects/milestones/${data.projectId}/${milestoneId}`);
}
