-- Revierte `Employee.workShift` y el enum `WorkShiftType`, añadidos hoy mismo en
-- 20260829_overtime_entry_art183.
--
-- Eran un DUPLICADO: `Employee.workSchedule` (enum `JornadaType`, con los mismos
-- tres valores DIURNA/NOCTURNA/MIXTA) ya existía con el comentario "Jornada
-- laboral LOTTT Arts. 173-177", ya estaba en el schema Zod, en EmployeeService y
-- con su selector en la ficha del empleado. No se comprobó antes de añadirlo.
--
-- Dos columnas para el mismo concepto legal es peor que ninguna: la siguiente
-- persona que toque esto no sabría cuál manda, y el cálculo del salario hora
-- (Art. 113) depende de acertar.
--
-- La columna se creó hace horas y sólo contiene el DEFAULT: no hay dato que
-- migrar. Lo declarado por el usuario vive en `workSchedule`, que no se toca.
ALTER TABLE "Employee" DROP COLUMN IF EXISTS "workShift";
DROP TYPE IF EXISTS "WorkShiftType";
