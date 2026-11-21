import globals from "globals";
import { cairnEslint } from "@cairn/config/eslint";

// Shared preset plus browser globals. Next.js pages/layouts must default-export.
export default [
  ...cairnEslint,
  { ignores: ["next-env.d.ts", ".next/**"] },
  { languageOptions: { globals: { ...globals.browser } } },
  { files: ["app/**/page.tsx", "app/**/layout.tsx", "*.config.*"], rules: { "no-restricted-syntax": "off" } }
];
