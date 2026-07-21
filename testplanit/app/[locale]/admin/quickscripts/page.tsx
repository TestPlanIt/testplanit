"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "~/lib/navigation";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import QuickScriptTemplates from "./QuickScriptTemplates";

export default function QuickScriptTemplatesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.exportTemplates");

  if (status !== "loading" && !session) {
    router.push("/");
  }

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <main>
        <Card>
          <CardHeader>
            <SectionHeader>
              <CardTitle>{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </SectionHeader>
          </CardHeader>
        </Card>
        <div className="mt-4">
          <QuickScriptTemplates />
        </div>
      </main>
    );
  }
}
