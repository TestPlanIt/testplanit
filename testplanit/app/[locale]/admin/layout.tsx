"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import AdminMenu from "@/components/AdminMenu";
import { Loading } from "@/components/Loading";

export default function AdminLayout(props: any) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // Redirect non-admin users to the application root
    if (status === "authenticated" && session?.user?.access !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  // Show loading while checking authentication
  if (status === "loading") {
    return <Loading />;
  }

  // Don't render admin layout for non-admin users
  if (status === "authenticated" && session?.user?.access !== "ADMIN") {
    return null;
  }

  return (
    <div className="flex" id="admin-menu">
      <div className="sticky w-[57px] md:w-[225px] top-0 z-10 h-screen">
        <AdminMenu />
      </div>
      <div className="ml-4 w-full overflow-x-hidden">{props.children}</div>
    </div>
  );
}
