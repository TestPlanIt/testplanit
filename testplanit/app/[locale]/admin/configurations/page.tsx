"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";

import Categories from "./Categories";
import Configurations from "./Configurations";

export default function FieldsPage() {
  return <Fields />;
}

function Fields() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status !== "loading" && !session) {
    router.push("/");
  }

  if (status === "loading") return null;

  if (session && session.user.access === "ADMIN") {
    return (
      <main>
        <Categories />
        <div className="mt-4">
          <Configurations />
        </div>
      </main>
    );
  }
}
