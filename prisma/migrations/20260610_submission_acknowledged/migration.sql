-- ADR-019 Addendum D-1.1c: estado ACKNOWLEDGED para SubmissionStatus
-- SENT = aceptado por la API SENIAT; ACKNOWLEDGED = confirmación posterior del SENIAT.
-- Requerido por Z-4 / decision-tree árbol [5]: idempotencia verifica status IN (SENT, ACKNOWLEDGED).
-- ALTER TYPE ... ADD VALUE es additivo y seguro (no reescribe la tabla).

ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'ACKNOWLEDGED';
