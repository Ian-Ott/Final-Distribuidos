# ADR-007: Postgres con driver adapter de Prisma 7

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

Necesitamos una DB para los datos de aplicación (usuarios, eventos, y el espejo local del
estado on-chain — ver [ADR-009](009-tabla-ticket-espejo-onchain.md)). Originalmente arrancamos
con SQLite para no obligar al setup, pero:

- Prisma 7 introduce **driver adapters obligatorios** (el `PrismaClient` no acepta `url` en
  el datasource del schema, requiere un adapter).
- Para alinear con la arquitectura GKE de los compas, conviene usar la misma engine que la
  prod (Postgres).
- SQLite no escala a varios pods en serverless ni soporta concurrencia real.

## Decisión

- **Postgres** como engine único (dev y prod).
- **Prisma 7** con el adapter `@prisma/adapter-pg` (basado en `node-postgres`).
- Conexión via `DATABASE_URL`, leída en `prisma.config.ts` y pasada al adapter en
  [src/lib/db.ts](../../src/lib/db.ts).
- **Docker Compose** levanta Postgres local para dev (ver [ADR-013](013-deploy-docker-compose.md)).

## Consecuencias

### Positivas
- Paridad dev/prod: el código que pasa los tests locales se comporta igual en prod.
- Soporta concurrencia real, transacciones, índices full-text si los necesitamos.
- Compatible con cualquier Postgres hosteado (Neon, Supabase, RDS, Cloud SQL) sin cambios de
  código.

### Negativas
- Setup más pesado que SQLite: hay que tener docker corriendo, o instalar Postgres, o usar
  un servicio hosteado.
- Connection pooling es algo a tener en cuenta si en algún momento corremos serverless.

### Abiertas
- Para producción, decidir qué Postgres usar. Si vamos por GKE, podemos meterlo en el cluster
  o usar Cloud SQL.

## Alternativas consideradas

### SQLite con `@prisma/adapter-better-sqlite3`
Cero setup. Lo descartamos porque no escala, no tiene paridad con prod, y no aporta nada que
Postgres no resuelva.

### Drizzle ORM
Más moderno, más rápido en algunos benchs. Lo descartamos por ecosistema más chico y porque
Prisma cubre nuestras necesidades sin fricción.

### Raw `pg` sin ORM
Sin tipos, más código boilerplate, sin migraciones automáticas. No vale la pena.
