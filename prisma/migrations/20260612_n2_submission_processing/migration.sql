-- N2: Agrega PROCESSING a SubmissionStatus para claim atómico en transmit()
-- Previene doble transmisión bajo QStash retry concurrente (PA-121 Z-4)
ALTER TYPE "SubmissionStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
