import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["src/**/*.ts"],
    rules: {
      // GAS exposes all top-level functions as entry points (doGet, google.script.run handlers).
      // ESLint cannot distinguish these from truly unused code, so we disable this rule.
      // TypeScript's noUnusedLocals/noUnusedParameters in tsconfig covers local scope instead.
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["**/*.js", "**/*.mjs", "**/*.html"],
  },
);
