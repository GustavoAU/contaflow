// src/components/settings/LanguageSelector.tsx
"use client";

import { useTransition } from "react";
import { setLocaleAction } from "@/modules/settings/actions/locale.actions";
import { toast } from "sonner";

type Props = {
  currentLocale: string;
};

export function LanguageSelector({ currentLocale }: Props) {
  const [isPending, startTransition] = useTransition();

  function handleChange(locale: string) {
    startTransition(async () => {
      const result = await setLocaleAction(locale);
      if (result.success) {
        toast.success(
          locale === "es" ? "Idioma cambiado a Español" : "Language changed to English"
        );
        window.location.reload();
      } else {
        toast.error("Error al cambiar el idioma");
      }
    });
  }

  return (
    <div className="rounded-lg border bg-white p-6">
      <h2 className="font-semibold">Idioma / Language</h2>
      <p className="text-muted-foreground mt-1 mb-4 text-sm">Selecciona el idioma de la interfaz</p>
      <div className="flex gap-3">
        <button
          onClick={() => handleChange("es")}
          disabled={isPending || currentLocale === "es"}
          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            currentLocale === "es" ? "border-blue-600 bg-blue-50 text-blue-700" : "hover:bg-zinc-50"
          }`}
        >
          🇻🇪 Español
        </button>
        <button
          onClick={() => handleChange("en")}
          disabled={isPending || currentLocale === "en"}
          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
            currentLocale === "en" ? "border-blue-600 bg-blue-50 text-blue-700" : "hover:bg-zinc-50"
          }`}
        >
          🇺🇸 English
        </button>
      </div>
    </div>
  );
}
