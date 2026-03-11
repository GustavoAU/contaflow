// src/modules/settings/actions/locale.actions.ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export async function setLocaleAction(locale: string) {
  const validLocales = ["es", "en"];
  if (!validLocales.includes(locale)) return { success: false, error: "Idioma no válido" };

  const cookieStore = await cookies();
  cookieStore.set("locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 año
    sameSite: "lax",
  });

  revalidatePath("/", "layout");

  return { success: true };
}

export async function getLocaleAction() {
  const cookieStore = await cookies();
  return cookieStore.get("locale")?.value ?? "es";
}
