"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";

import CaseFields from "./CaseFields";
import ResultFields from "./ResultFields";
import Template from "./Templates";

export default function Fields() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status !== "loading" && !session) {
    router.push("/");
  }

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <main>
        <Template />
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
