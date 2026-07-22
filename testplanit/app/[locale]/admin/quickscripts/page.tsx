"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";

import QuickScriptTemplates from "./QuickScriptTemplates";

export default function QuickScriptTemplatesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status !== "loading" && !session) {
    router.push("/");
  }

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <main>
        <QuickScriptTemplates />
      </main>
    );
  }
}
