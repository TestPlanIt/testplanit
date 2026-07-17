"use client";

import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RecordKeysConfigCard } from "./RecordKeysConfigCard";

export default function RecordKeysAdminPage() {
  const t = useTranslations("admin.recordKeys");
  const tMenu = useTranslations("admin.menu");
  const { data: session } = useSession();

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  return (
    <main>
      <Card>
        <CardHeader>
          <CardTitle>{tMenu("recordKeys")}</CardTitle>
          <CardDescription>{t("pageDescription")}</CardDescription>
        </CardHeader>
      </Card>
      <div className="mt-4">
        <RecordKeysConfigCard />
      </div>
    </main>
  );
}
