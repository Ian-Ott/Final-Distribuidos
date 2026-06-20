# ADR-013: Deploy con Docker Compose, no Vercel

**Estado**: Accepted
**Fecha**: 2026-06-20

## Contexto

Inicialmente consideramos Vercel como deploy target porque Next.js está hecho ahí. Pero:

- Cada push disparaba un build automático que daba errores (en parte por la migración
  Postgres en cada deploy, en parte por config no terminada).
- Vercel es serverless, lo que complica el connection pooling con Postgres y agrega latencia
  de cold start.
- El resto del sistema (NCT, workers) corre en GKE / Compute Engine, no en Vercel. Mantener
  dos plataformas distintas suma operativa.

## Decisión

- **Dev local**: Docker Compose con dos servicios (`postgres` y `app`).
- **Prod**: Docker Compose en una VM, o el mismo Dockerfile montado como Deployment de
  Kubernetes en el cluster GKE de los compas (no decidido aún cuál de los dos).
- Desactivamos completamente Vercel — no debe disparar deploys en cada push.

Implementado en:
- [docker-compose.yml](../../docker-compose.yml)
- [Dockerfile](../../Dockerfile) (multi-stage con Next standalone output)
- [docker/entrypoint.sh](../../docker/entrypoint.sh) (espera DB, corre migrate deploy, arranca)

## Consecuencias

### Positivas
- Paridad dev/prod: el mismo `docker compose up` corre en cualquier máquina.
- Sin lock-in con Vercel.
- Si el equipo termina deployando todo el sistema en GKE, la app se suma sin fricción.

### Negativas
- Sin las features automáticas de Vercel (preview deploys, edge functions, image
  optimization remota).
- Hay que mantener Dockerfile y resolver TLS por cuenta propia (Let's Encrypt + Ingress en GKE,
  o reverse proxy si va a una VM).

### Abiertas
- Decisión final entre VM con Docker Compose vs Deployment en el cluster GKE. Depende de qué
  decidan los compas con su infra y si quieren mezclar todo o separar.

## Alternativas consideradas

### Vercel
Cómodo para iteración rápida, pero serverless + Postgres trae fricción (pooling, cold start)
y duplica plataformas con respecto al resto del sistema.

### Render / Railway / Fly.io
Equivalentes a Vercel en simplicidad, sin la fricción serverless. Quedan como plan B si
deploying en GKE/VM resulta complicado.
