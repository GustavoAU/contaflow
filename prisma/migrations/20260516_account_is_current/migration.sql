-- ítem 35: Balance General corriente vs no corriente (VEN-NIF BA-10 / IAS 1)
ALTER TABLE "Account" ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT false;
