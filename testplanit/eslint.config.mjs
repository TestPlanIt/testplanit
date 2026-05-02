import nextConfig from "eslint-config-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const eslintConfig = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "dist/**",
      "next-env.d.ts",
      "playwright-report/**",
      "**/playwright-report/**",
      "e2e/test-results/**",
      "coverage/**",
    ],
  },
  {
    ignores: [
      "app/**/extensions/**",
      "components/tiptap/menus/**",
      "components/tiptap/panels/**",
      "components/tiptap/ui/**",
      "lib/hooks/**",
      ".cursorrules",
      "scripts/generate-version.js",
    ],
  },
  ...nextConfig,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    languageOptions: {
      // Explicitly use @typescript-eslint/parser so type-aware rules
      // (e.g. no-floating-promises) have access to the TS type checker.
      // eslint-config-next's default parser does not forward projectService.
      parser: tsParser,
      parserOptions: {
        // Enables TypeScript type-aware linting (required for
        // @typescript-eslint/no-floating-promises and similar rules).
        // `projectService` auto-discovers the nearest tsconfig without
        // requiring an explicit `project` path.
        projectService: {
          // Allow files outside the tsconfig include (e.g. vitest.config.mts)
          // to be linted without a parsing error.
          allowDefaultProject: ["vitest.config.mts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      next: {
        rootDir: "testplanit/",
      },
      react: {
        version: "detect",
      },
    },
    rules: {
      // Add any custom rules here
      "@next/next/no-html-link-for-pages": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",

      // Audit helpers return Promise<void>; unawaited audit calls
      // get flagged here. Also catches unrelated floating-promise bugs across the
      // codebase. Override to "off" for test files below
      // where promise-chaining patterns are common in Playwright/Vitest.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          ignoreVoid: true, // `void fn()` is the explicit opt-out for genuinely fire-and-forget cases
          ignoreIIFE: false,
        },
      ],

      // React specific rules
      "react/react-in-jsx-scope": "off", // Not needed in Next.js
      "react/jsx-uses-react": "off", // Not needed in Next.js
      "react/prop-types": "off", // We're using TypeScript for prop validation

      // Disable React Compiler rules from eslint-plugin-react-hooks v7.x
      // These are too strict for our current codebase
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-hooks/purity": "off",
      "react-hooks/incompatible-library": "warn", // Keep as warning
      "react-hooks/preserve-manual-memoization": "warn", // Advisory: React Compiler couldn't preserve a useMemo; not a correctness issue

      // Avoid hardcoded labels in component markup
      "react/jsx-no-literals": [
        "error",
        {
          noStrings: false, // Don't error on all strings
          allowedStrings: ["/", "-", "|", " ", ".", ":", ","], // Common separators that don't need translation
          ignoreProps: true, // Allow string literals in props
          noAttributeStrings: false, // Don't check attribute strings
        },
      ],

      // Consistently import navigation APIs from `~/lib/navigation`
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              message: "Please import from `~/lib/navigation` instead.",
            },
            {
              name: "next/navigation",
              importNames: [
                "redirect",
                "permanentRedirect",
                "useRouter",
                "usePathname",
              ],
              message: "Please import from `~/lib/navigation` instead.",
            },
          ],
        },
      ],
    },
  },
  // Relax rules that don't apply to test files
  {
    files: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
    ],
    rules: {
      "react/jsx-no-literals": "off",
      "react/display-name": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/incompatible-library": "off",
      "jsx-a11y/role-has-required-aria-props": "off",
      "no-restricted-imports": "off",
      // Tests legitimately use fire-and-forget patterns (Playwright promise chains,
      // Vitest expect().resolves assertions, intentional unawaited promises in
      // setup/teardown). The rule is enforced for production code only.
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
];

export default eslintConfig;
