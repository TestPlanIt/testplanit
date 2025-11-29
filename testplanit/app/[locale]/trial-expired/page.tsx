import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "~/lib/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function TrialExpiredPage() {
  const t = useTranslations("TrialExpired");

  const contactEmail =
    process.env.NEXT_PUBLIC_CONTACT_EMAIL || "sales@testplanit.com";
  const websiteUrl =
    process.env.NEXT_PUBLIC_WEBSITE_URL || "https://testplanit.com";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive animate-ping" />
          </div>
          <CardTitle className="text-3xl">{t("title")}</CardTitle>
          <CardDescription className="text-lg">
            {t("description")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-center text-muted-foreground">{t("nextSteps")}</p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" variant="outline">
              <Link href={websiteUrl}>{t("pricingPlans")}</Link>
            </Button>
            <Button asChild size="lg">
              <Link href={`mailto:${contactEmail}`}>{t("contactButton")}</Link>
            </Button>
          </div>
        </CardContent>

        <CardFooter>
          <Alert className="w-full">
            <AlertDescription className="text-center">
              {t("dataRetention")}
            </AlertDescription>
          </Alert>
        </CardFooter>
      </Card>
    </div>
  );
}
