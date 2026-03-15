"use client";

import { Loading } from "@/components/Loading";
import { Suspense } from "react";
import VerifyEmail from "./VerifyEmail";

export default function VerifyEmailPage() {
  return (
    <div className="items-center justify-center">
      <Suspense fallback={<Loading />}>
        <VerifyEmail />
      </Suspense>
    </div>
  );
}
