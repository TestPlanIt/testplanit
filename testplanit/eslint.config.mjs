import nextConfig from "eslint-config-next";

const eslintConfig = [{
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "dist/**", "next-env.d.ts", "playwright-report/**", "coverage/**"]
}, {
  ignores: [
    "app/**/extensions/**",
    "components/tiptap/menus/**",
    "components/tiptap/panels/**",
    "components/tiptap/ui/**",
    "lib/hooks/**",
    ".cursorrules",
    "scripts/generate-version.js",
  ],
}, ...nextConfig, {
  files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
  rules: {
    "@typescript-eslint/no-require-imports": "off",
  },
}, {
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
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-empty-object-type": "off",
    "@typescript-eslint/no-unused-expressions": "off",
    "@typescript-eslint/no-non-null-asserted-optional-chain": "off",

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
}];

export default eslintConfig;
