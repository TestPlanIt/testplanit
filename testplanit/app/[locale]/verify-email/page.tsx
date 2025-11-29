"use client";

import { Suspense } from "react";
import VerifyEmail from "./VerifyEmail";
import { Loading } from "@/components/Loading";

export default function VerifyEmailPage() {
  return (
    <div className="items-center justify-center">
      <Suspense fallback={<Loading />}>
        <VerifyEmail />
      </Suspense>
    </div>
  );
}
