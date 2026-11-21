// Shared flat ESLint config for every TypeScript package in the workspace.
// Flat config files must default-export; this is the only non-Next exception.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export const cairnEslint = tseslint.config(
  { ignores: ["test/fixtures/**", "dist/**", "artifacts/**", "cache/**", "types/**", ".next/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "No default exports (CLAUDE.md §5)." },
        { selector: "ThrowStatement > Literal", message: "Throw typed errors, never bare strings." }
      ]
    }
  }
);

export default cairnEslint;
