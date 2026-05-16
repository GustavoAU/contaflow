// VAC-1: Cómputo de días hábiles según jornada laboral (LOTTT Art. 190)
// LUNES_VIERNES: solo lunes a viernes cuentan como hábiles
// LUNES_SABADO: lunes a sábado cuentan como hábiles
// LUNES_SABADO_MEDIO: lunes a viernes enteros + sábado como medio día

export type WorkScheduleType = "LUNES_VIERNES" | "LUNES_SABADO" | "LUNES_SABADO_MEDIO";

export function countWorkingDays(
  startDate: string,
  endDate: string,
  schedule: WorkScheduleType = "LUNES_VIERNES"
): number {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;

  let count = 0;
  const current = new Date(start);

  while (current <= end) {
    const dow = current.getDay(); // 0=Dom, 1=Lun, ..., 6=Sáb
    if (schedule === "LUNES_VIERNES") {
      if (dow >= 1 && dow <= 5) count++;
    } else if (schedule === "LUNES_SABADO") {
      if (dow >= 1 && dow <= 6) count++;
    } else {
      // LUNES_SABADO_MEDIO
      if (dow >= 1 && dow <= 5) count++;
      else if (dow === 6) count += 0.5;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}
