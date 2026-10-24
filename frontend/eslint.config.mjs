import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Wire shapes mirror the backend loosely (FastAPI payloads, SSE events,
      // LangGraph configs); a full structural typing pass is tracked work.
      "@typescript-eslint/no-explicit-any": "warn",
      // Init-from-URL / auth-sync effects legitimately call setState once.
      // The React-compiler lint can't see that these are intentional.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
