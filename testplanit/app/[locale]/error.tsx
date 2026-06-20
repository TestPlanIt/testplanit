"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex justify-center py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle>{t("common.errors.error")}</CardTitle>
          </div>
          <CardDescription>
            {t("common.errors.somethingWentWrong")}
          </CardDescription>
        </CardHeader>
        {error.digest && (
          <CardContent>
            <p className="text-xs text-muted-foreground">{error.digest}</p>
          </CardContent>
        )}
        <CardFooter>
          <Button onClick={() => reset()}>{t("search.errors.tryAgain")}</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
