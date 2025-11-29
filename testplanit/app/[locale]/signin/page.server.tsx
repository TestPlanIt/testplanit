import { headers } from "next/headers";
import { redirect } from "~/lib/navigation";
import { cookies } from "next/headers";

export default async function SigninPage() {
  // Clear the NEXT_LOCALE cookie
  const cookieStore = await cookies();
  cookieStore.delete("NEXT_LOCALE");

  // Get browser's preferred language
  const headersList = await headers();
  const acceptLanguage = headersList.get("accept-language");

  // Parse accept-language header to get preferred locale
  let browserLocale = "en-US"; // default
  if (acceptLanguage) {
    // Look for es-ES or en-US in accept-language header
    if (acceptLanguage.includes("es")) {
      browserLocale = "es-ES";
    } else if (acceptLanguage.includes("en")) {
      browserLocale = "en-US";
    }
  }

  // Redirect to the correct locale version
  redirect({ href: `/signin`, locale: browserLocale as "en-US" | "es-ES" });
}
