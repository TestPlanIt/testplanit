"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter } from "~/lib/navigation";

import {
  Card, CardDescription, CardHeader,
  CardTitle
} from "@/components/ui/card";

import { PaginationProvider } from "~/lib/contexts/PaginationContext";
import Categories from "./Categories";
import Configurations from "./Configurations";

export default function FieldsPage() {
  return (
    <PaginationProvider>
      <Fields />
    </PaginationProvider>
  );
}

function Fields() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.configurations");
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
              <CardTitle>{tGlobal("common.fields.configurations")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
          </CardHeader>
        </Card>
        <div className="mt-4">
          <Categories />
        </div>

        <div className="mt-4">
          <Configurations />
        </div>
      </main>
    );
  }
}
