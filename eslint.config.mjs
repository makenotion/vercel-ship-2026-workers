import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "app/**/*.{js,jsx,mjs,mts,ts,tsx}",
      "components/**/*.{js,jsx,mjs,mts,ts,tsx}",
      "lib/**/*.{js,jsx,mjs,mts,ts,tsx}",
    ],
    ignores: ["lib/db.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/db/core",
                "@/lib/db/core.ts",
                "**/lib/db/core",
                "**/lib/db/core.ts",
                "./db/core",
                "./db/core.ts",
                "../db/core",
                "../db/core.ts",
              ],
              message: "Use @/lib/db so Next's server-only guard stays in place.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "app/.well-known/workflow/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
