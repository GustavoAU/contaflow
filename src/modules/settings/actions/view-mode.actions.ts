"use server";
// src/modules/settings/actions/view-mode.actions.ts
// Server Action para persistir la preferencia de Modo Gerencial.
// La cookie es httpOnly — solo legible servidor; se propaga en router.refresh().

import { cookies } from "next/headers";
import { auth } from "@clerk/nextjs/server";
import { VIEW_MODE_COOKIE, type ViewMode } from "@/lib/view-mode";

export async function setViewModeAction(mode: ViewMode): Promise<void> {
  const { userId } = await auth();
  if (!userId) return;

  const store = await cookies();
  store.set(VIEW_MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 año
  });
}
