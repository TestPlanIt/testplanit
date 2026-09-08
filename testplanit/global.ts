import { locales } from "./i18n/navigation";

// We intentionally do NOT type `Messages` here. Typing it as the full
// en-US.json literal makes next-intl derive a message-key union so large it
// overflows tsc's union-complexity limit (TS2590), which OOM'd/hung
// `tsc --noEmit` in lint/precommit/CI. With `Messages` omitted, next-intl
// defaults it to `Record<string, any>`, so `t()` keys and namespaces resolve
// to `string` (no compile-time key checking) without the exploding union.
// That coverage is recovered by the static check in
// __tests__/i18n-message-keys.test.ts.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
  }
}
