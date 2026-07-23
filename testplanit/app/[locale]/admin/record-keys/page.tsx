"use client";

import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { RecordKeysConfigCard } from "./RecordKeysConfigCard";

export default function RecordKeysAdminPage() {
  const tMenu = useTranslations("admin.menu");
  const { data: session } = useSession();

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  return (
    <main>
      <Card>
        <CardHeader>
          <SectionHeader className="flex items-center gap-2">
            <CardTitle>{tMenu("recordKeys")}</CardTitle>
            <HelpPopover helpKey="recordKeys" />
          </SectionHeader>
        </CardHeader>
      </Card>
      <div className="mt-4">
        <RecordKeysConfigCard />
      </div>
    </main>
  );
}
