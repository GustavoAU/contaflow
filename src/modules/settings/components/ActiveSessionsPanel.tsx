// src/modules/settings/components/ActiveSessionsPanel.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useUser, useSession } from "@clerk/nextjs";
import { MonitorIcon, SmartphoneIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

// Inferred from user.getSessions() return type
type SessionItem = Awaited<ReturnType<NonNullable<ReturnType<typeof useUser>["user"]>["getSessions"]>>[number];

function DeviceIcon({ isMobile }: { isMobile?: boolean }) {
  if (isMobile) return <SmartphoneIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
  return <MonitorIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

export function ActiveSessionsPanel() {
  const { user, isLoaded: userLoaded } = useUser();
  const { session: currentSession } = useSession();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!userLoaded || !user) return;
    user.getSessions().then((list) => {
      setSessions(list);
      setIsLoaded(true);
    });
  }, [userLoaded, user]);

  function handleRevoke(sessionId: string) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;

    startTransition(async () => {
      setRevokingId(sessionId);
      try {
        await session.revoke();
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        toast.success("Sesión cerrada correctamente.");
      } catch {
        toast.error("No se pudo cerrar la sesión. Intenta de nuevo.");
      } finally {
        setRevokingId(null);
      }
    });
  }

  return (
    <div className="rounded-lg border p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldCheckIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold">Sesiones Activas</h2>
          <p className="text-muted-foreground text-sm">
            Dispositivos y navegadores con sesión activa en tu cuenta.
          </p>
        </div>
      </div>

      {/* Lista */}
      {!isLoaded ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          Cargando sesiones…
        </div>
      ) : sessions.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          No hay sesiones activas.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {sessions.map((session) => {
            const isCurrent = session.id === currentSession?.id;
            const activity = session.latestActivity;
            const isMobile = activity?.isMobile;
            const browserName = activity?.browserName ?? null;
            const ipAddress = activity?.ipAddress ?? null;
            const city = activity?.city ?? null;
            const country = activity?.country ?? null;
            const lastActiveAt = session.lastActiveAt;

            const locationParts = [city, country].filter(Boolean);
            const location = locationParts.length > 0 ? locationParts.join(", ") : null;
            const isRevoking = revokingId === session.id;

            return (
              <div
                key={session.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                {/* Icono + info */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <DeviceIcon isMobile={isMobile} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">
                        {browserName ?? "Navegador desconocido"}
                      </span>
                      {isCurrent && (
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Esta sesión
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {[
                        ipAddress,
                        location,
                        lastActiveAt
                          ? `Última actividad: ${lastActiveAt.toLocaleDateString("es-VE")}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>

                {/* Revocar */}
                {isCurrent ? (
                  <div className="w-20 shrink-0" />
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => handleRevoke(session.id)}
                    disabled={isRevoking}
                    aria-busy={isRevoking}
                  >
                    {isRevoking ? (
                      <Loader2Icon className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : (
                      "Cerrar"
                    )}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Al cerrar una sesión, ese dispositivo deberá iniciar sesión de nuevo. Tu sesión actual no
        puede ser revocada desde aquí.
      </p>
    </div>
  );
}
