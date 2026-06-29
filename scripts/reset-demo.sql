-- Reset de datos de la plataforma (Postgres) para dejar un estado limpio de demo.
-- Borra eventos, tickets, pagos, listings y operaciones NCT.
-- MANTIENE los usuarios (User) para no tener que volver a registrarse.
--
-- Si querés un borrón TOTAL incluyendo usuarios, descomentá la línea del final.
--
-- Uso (desde el pod de postgres):
--   psql -U entradas -d entradas -f reset-demo.sql
-- O ver scripts/reset-demo.ps1 para correrlo contra el cluster.

BEGIN;

-- CASCADE encadena las FKs; RESTART IDENTITY resetea los contadores.
-- El orden no importa con CASCADE, pero las listamos explícitas por claridad.
TRUNCATE TABLE
  "TicketListing",
  "Payment",
  "Ticket",
  "NctOperation",
  "Event"
RESTART IDENTITY CASCADE;

-- Borrón total (incluye usuarios). Descomentar solo si querés empezar de cero:
-- TRUNCATE TABLE "User" RESTART IDENTITY CASCADE;

COMMIT;
