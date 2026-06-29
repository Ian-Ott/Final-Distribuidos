# SDyPP — TP Integrador: Sistema de Entradas con Blockchain

Sistema distribuido de gestión de entradas a eventos donde cada entrada es un activo
criptográfico único en una blockchain propia con Proof of Work.

**Materia:** Sistemas Distribuidos y Programación Paralela (SDyPP)
**Universidad:** UNLU — Junio 2026

## Arquitectura general

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLUSTER GKE (propio)                        │
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────────┐  │
│  │ Frontend  │   │   NCT    │   │   TrP    │   │  Worker CPU    │  │
│  │ (Next.js) │   │ (FastAPI)│   │ (Python) │   │  (fallback)    │  │
│  │  ×2       │   │  ×2      │   │  ×1      │   │  ×2            │  │
│  └─────┬─────┘   └────┬─────┘   └────┬─────┘   └───────┬────────┘  │
│        │              │              │                  │           │
│        │         ┌────┴─────┐   ┌────┴─────┐           │           │
│        │         │  Redis   │   │ RabbitMQ │───────────┘           │
│        │         │  (AOF)   │   │          │                       │
│  ┌─────┴─────┐   └──────────┘   └────┬─────┘                       │
│  │ Postgres  │                       │                              │
│  └───────────┘                       │                              │
└──────────────────────────────────────┼──────────────────────────────┘
                                       │ IPs externas
                              ┌────────┴────────┐
                              │ CLUSTER PROFESOR │
                              │   (GPU nodes)    │
                              │                  │
                              │ ┌──────────────┐ │
                              │ │  GPU Server   │ │
                              │ │  (CUDA T4)   │ │
                              │ └──────┬───────┘ │
                              │ ┌──────┴───────┐ │
                              │ │  Workers ×4  │ │
                              │ └──────────────┘ │
                              └─────────────────┘
```

## Los tres pilares

El proyecto se divide en tres pilares que se integran en el sistema final:

| Pilar | Tema | Directorio |
|-------|------|------------|
| **Pilar 1** | Programación GPU con CUDA | [`Pilar1/`](Pilar1/) |
| **Pilar 2** | Blockchain distribuida con PoW | [`Pilar2/`](Pilar2/) |
| **Pilar 3** | CI/CD, IaC, deploy en GKE | [`infra/`](infra/), [`k8s/`](k8s/), [`.github/workflows/`](.github/workflows/) |

La **app web** ([`app/`](app/)) es la capa que integra todo: gestiona eventos y entradas,
firma transacciones con ECDSA, y se comunica con la blockchain para emitir, transferir y
validar tickets on-chain.

## Flujo end-to-end

1. **Organizador crea un evento** en la app web y emite N entradas → se firma con su clave
   privada ECDSA P-256 en el browser → el NCT recibe el `mint_batch` → los workers minan
   el bloque con PoW → las entradas quedan registradas en la blockchain.

2. **Asistente compra una entrada** → paga con MercadoPago → el webhook confirma el pago →
   se genera un `transfer` on-chain del organizador al comprador.

3. **Validación en puerta** → el asistente presenta un QR firmado con su clave privada →
   el validador escanea → se verifica la firma y el ownership en la blockchain → se transfiere
   la entrada de vuelta al organizador (la entrada queda "usada").

## Stack técnico

| Componente | Tecnología |
|------------|-----------|
| Frontend + Backend | Next.js 16 (App Router), TypeScript, Tailwind 4 |
| Base de datos | PostgreSQL 17 + Prisma 7 |
| Blockchain | Python (FastAPI), Redis, RabbitMQ |
| Minería GPU | CUDA C (compilado), workers Python |
| Infraestructura | GKE (Google Kubernetes Engine), Terraform/OpenTofu |
| Observabilidad | Prometheus, Grafana, Loki, Tempo, Alloy (ver [`k8s/gke/observability/`](k8s/gke/observability/)) |
| CI/CD | GitHub Actions (5 pipelines) |
| Pagos | MercadoPago Checkout Pro |
| Criptografía | ECDSA P-256, SHA-256, WebCrypto API |
| HTTPS | GKE Managed Certificate, dominio `tesera.tech` |

## Cómo correr localmente

```bash
# 1. Levantar Postgres
cd app && docker compose up -d postgres

# 2. Instalar dependencias y migrar
npm install
npx prisma migrate deploy

# 3. Arrancar el dev server
npm run dev
# → http://localhost:3000
```

Para el stack completo (app + blockchain):
```bash
docker compose up
```

## Documentación

- **ADRs** (decisiones de arquitectura): [`app/docs/adr/`](app/docs/adr/)
- **README de cada componente**: ver los READMEs dentro de cada directorio
- **CLAUDE.md**: contexto técnico para desarrollo con IA

## Estructura del repositorio

```
SDyPP-FINAL-ABC/
├── app/                    # App web (Next.js) — frontend + backend
├── Pilar1/                 # Prácticas de CUDA/GPU (Hit1-Hit7)
├── Pilar2/                 # Blockchain distribuida (P1-P5)
├── infra/                  # Terraform — infraestructura GCP
├── k8s/                    # Manifiestos Kubernetes
│   ├── gke/               # Cluster propio
│   │   ├── infra/         # Redis, RabbitMQ
│   │   └── apps/          # Frontend, NCT, TrP, workers, Postgres
│   └── profesor/          # Cluster del profesor (GPU workers)
└── .github/workflows/     # Pipelines CI/CD
```
