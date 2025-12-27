"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CaseFields from "./CaseFields";
import ResultFields from "./ResultFields";
import Template from "./Templates";

export default function Fields() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.templates");
  const tGlobal = useTranslations();

  if (status !== "loading" && !session) {
    router.push("/");
  }

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <main>
        <Card>
          <CardHeader>
            <div className="text-primary text-2xl md:text-4xl">
              <CardTitle>{tGlobal("common.labels.templates")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
          </CardHeader>
        </Card>
        <div className="mt-4">
          <Template />
        </div>
        <div className="mt-4">
          <CaseFields />
        </div>
        <div className="mt-4">
          <ResultFields />
        </div>
      </main>
    );
  }
}
