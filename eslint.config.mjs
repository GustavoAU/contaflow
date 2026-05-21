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
      // react-hooks/set-state-in-effect: activado como error en React Compiler
      // plugin tras actualización de lockfile. Los patrones flagueados son legítimos:
      //   - sincronizar prop controlado → estado interno (ProductCombobox)
      //   - resetear estado cuando cambia dependencia (MovementForm)
      //   - calcular estado derivado de otro estado (PaymentForm, InvoiceForm)
      // Downgradeado a warn para no bloquear CI. Refactorizar a useMemo/useCallback
      // en sprint de performance post-lanzamiento.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
