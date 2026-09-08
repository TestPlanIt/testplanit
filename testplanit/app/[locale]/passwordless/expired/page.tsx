import { getTranslations } from "next-intl/server";
import { Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Locale } from "~/i18n/navigation";
import { Link } from "~/lib/navigation";

/**
 * Friendly terminal page for invalid, expired, superseded, or already-used
 * passwordless links. Always offers a path back to a fresh sign-in request.
 */
export default async function PasswordlessExpiredPage({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale });

  return (
    <div className="flex items-center justify-center py-16">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Clock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">
            {t("auth.passwordless.expiredTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("auth.passwordless.expiredBody")}
          </p>
          <Button asChild className="mt-2">
            <Link href="/signin">{t("auth.passwordless.requestNewLink")}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
