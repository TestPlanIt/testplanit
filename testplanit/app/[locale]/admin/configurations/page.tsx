"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

import Configurations from "./Configurations";
import Categories from "./Categories";
import { PaginationProvider } from "~/lib/contexts/PaginationContext";

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
              <CardTitle>{t("title")}</CardTitle>
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
