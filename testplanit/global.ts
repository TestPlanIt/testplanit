import { locales } from "./i18n/navigation";
import messages from "./messages/en-US.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
    Messages: typeof messages;
  }
}
