import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// Colors come from the theme tokens in src/index.css; literal colors in components are an error.
const COLOR_LITERAL = "Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\brgba?\\(|\\bhsla?\\(/]";

export default tseslint.config(
  // src/components/ui is shadcn output (update it with `npx shadcn@latest add/diff`), so it is not linted here
  { ignores: ["dist", "node_modules", ".env", "src/components/ui"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["src/components/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    rules: { "no-restricted-syntax": ["error", { selector: COLOR_LITERAL, message: "Use a theme color token (see src/index.css), not a literal color." }] },
  },
);
