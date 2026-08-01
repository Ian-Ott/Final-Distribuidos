# CI/CD — GitHub Actions Pipelines 

Seis pipelines que despliegan cada capa del sistema independientemente.
Todos gatean por **Gitleaks** (secret scanning) antes de ejecutar.

## Pipelines

### Pipeline 1 — Infraestructura (`pipeline-1-infra.yml`)

**Trigger:** Push a `infra/**`

Provisiona la infraestructura GCP con OpenTofu:
1. Autentica con GCP via Workload Identity Federation.
2. `tofu init` → `tofu import` (idempotente) → `tofu plan` → `tofu apply`.
3. Crea/actualiza: VPC, GKE cluster, node pools, Artifact Registry, IAM.

### Pipeline 2 — Servicios base (`pipeline-2-services.yml`)

**Trigger:** Manual (`workflow_dispatch`) o después de Pipeline 1.

Despliega los servicios de infraestructura en GKE:
1. `kubectl apply` de `namespaces.yaml`.
2. `kubectl apply` de todo en `k8s/gke/infra/` (Redis, RabbitMQ).

### Pipeline 3 — Aplicaciones (`pipeline-3-apps.yml`)

**Trigger:** Push a `app/**`, `Pilar2/P5/**`, o `k8s/gke/apps/**`

El pipeline principal de la app:
1. **Build en paralelo** de 4 imágenes Docker:
   - `frontend` (Next.js)
   - `blockchain-nct` (FastAPI)
   - `blockchain-trp` (Python)
   - `blockchain-worker-cpu` (Python)
2. **Push** a Artifact Registry con tag `github.sha`.
3. **Deploy**: reemplaza `IMAGE_TAG` en los yamls con la imagen real y aplica con `kubectl`.

### Pipeline 4 — GPU Workers (`pipeline-4-gpu-workers.yml`)

**Trigger:** Push a `Pilar2/P5/gpu-server.py`, `Pilar2/P5/worker.py`, o `k8s/profesor/**`

Despliega al cluster del profesor:
1. Build de la imagen `blockchain-worker-gpu`.
2. Push a Artifact Registry.
3. Deploy al cluster externo usando kubeconfig de `KUBE_CONFIG_PROFESOR` (secret).

### Pipeline 5 — Observabilidad (`pipeline-5-observability.yml`)

**Trigger:** Push a `k8s/gke/observability/**` o ejecución manual.

Despliega el stack de observabilidad en el cluster GKE:
1. Autenticación mediante Workload Identity Federation.
2. Obtención de credenciales del cluster GKE.
3. Espera a que el node pool `monitoring` esté disponible.
4. Creación del namespace y RBAC de observabilidad.
5. Deploy de Prometheus, Grafana, Loki, Tempo, Alloy, Alertmanager y exporters.
6. Verificación del rollout de Prometheus y Grafana.

También puede ejecutarse automáticamente al finalizar con éxito el **Pipeline 1 - Infraestructura GKE**, garantizando que el node pool `monitoring` ya exista antes del despliegue.

### Pipeline 6 — Performance Testing (`pipeline-6-performance.yml`)

**Trigger:** Push a `locust/**`, `k8s/gke/observability/locust-deployment.yaml`, `k8s/gke/observability/locust-service.yaml` o ejecución manual.

Despliega la infraestructura de pruebas de rendimiento en el cluster GKE:
1. Build de la imagen `locust`.
2. Push a Artifact Registry.
3. Deploy de los recursos de Locust.
4. Actualización de la imagen del Deployment con el commit actual.
5. Verificación del rollout del Deployment.

### Gitleaks (`gitleaks.yml`)

**Workflow reutilizable** que escanea el historial de git completo buscando secrets
(API keys, tokens, passwords). Llamado como gate por todos los otros pipelines.

## Flujo de despliegue

```
Push a infra/     → P1 (Terraform) → P2 (Redis/RabbitMQ)
Push a app/       → P3 (Build 4 imágenes → Deploy a GKE)
Push a Pilar2/P5/ → P3 + P4 (Deploy a GKE + Profesor)
```

## Secrets necesarios en GitHub

| Secret | Uso |
|--------|-----|
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Auth con GCP via OIDC |
| `GCP_SERVICE_ACCOUNT` | Service account para Terraform y kubectl |
| `GCP_PROJECT_ID` | ID del proyecto GCP |
| `KUBE_CONFIG_PROFESOR` | Kubeconfig (base64) del cluster del profesor | 
