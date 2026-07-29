resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.zone

  deletion_protection = false

  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.gke_subnet.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
}

# Node pool para servicios de infraestructura (Redis, RabbitMQ)
resource "google_container_node_pool" "infra" {
  name     = "infra"
  location = var.zone
  cluster  = google_container_cluster.primary.name

  node_count = 1

  node_config {
    machine_type = "e2-medium"
    disk_type    = "pd-standard"
    disk_size_gb = 50

    labels = {
      pool = "infra"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# ============================================================================
# Node pool permanente para la aplicación.
# Acá viven los componentes críticos:
# - Frontend
# - NCT
# - TrP
# - Postgres
#
# No usa Spot para evitar que la aplicación completa quede caída cuando
# Google retire instancias Spot.
# ============================================================================
resource "google_container_node_pool" "apps_base" {
  name     = "apps-base"
  location = var.zone
  cluster  = google_container_cluster.primary.name

  node_count = 1

  node_config {
    machine_type = "e2-medium"
    disk_type    = "pd-standard"
    disk_size_gb = 50

    labels = {
      pool = "apps-base"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# ============================================================================
# Node pool Spot para escalar capacidad.
#
# Acá deberían ejecutarse únicamente:
# - Workers CPU
# - Jobs
# - Réplicas temporales
#
# Si Google elimina estas VMs, la aplicación sigue funcionando gracias al
# pool apps-base.
# ============================================================================
resource "google_container_node_pool" "apps_spot" {
  name     = "apps-spot"
  location = var.zone
  cluster  = google_container_cluster.primary.name

  autoscaling {
    min_node_count = 0
    max_node_count = 5
  }

  initial_node_count = 1

  node_config {
    machine_type = "e2-medium"
    spot         = true

    labels = {
      pool = "apps-spot"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# Node pool dedicado al stack de observabilidad (Prometheus, Grafana, Loki,
# Tempo, Alloy, Alertmanager, exporters).
#
# Por qué un pool aparte y no meterlo en infra/apps:
# - El stack LGTM pide ~2-3 GiB de RAM en total; los nodos infra/apps son
#   e2-medium (4 GiB) y ya están al límite con Redis/RabbitMQ/Postgres/NCT.
#   Apretarlo ahí causaría evicciones y falsos negativos en las propias
#   métricas (el observador no puede competir por recursos con lo observado).
# - on-demand (NO spot): si el nodo se va por preemption perdemos métricas y
#   alertas justo cuando más las necesitamos. Es el único pool que paga
#   on-demand a propósito — es el grueso del costo nuevo de esta feature.
# - El taint impide que cargas de la app se programen acá; solo los pods del
#   namespace observability (que declaran la toleration) aterrizan en este pool.
resource "google_container_node_pool" "monitoring" {
  name     = "monitoring"
  location = var.zone
  cluster  = google_container_cluster.primary.name

  node_count = 1

  node_config {
    machine_type = "e2-medium" 
    disk_type    = "pd-standard"
    disk_size_gb = 50

    labels = {
      pool = "monitoring"
    }

    # Solo el stack de observabilidad tolera este taint (ver los manifests en
    # k8s/gke/observability/, todos declaran la toleration correspondiente).
    taint {
      key    = "monitoring"
      value  = "true"
      effect = "NO_SCHEDULE"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}
