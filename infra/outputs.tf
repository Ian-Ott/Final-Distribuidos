output "cluster_name" {
  value = google_container_cluster.primary.name
}

output "cluster_endpoint" {
  value     = google_container_cluster.primary.endpoint
  sensitive = true
}

output "cluster_location" {
  value = google_container_cluster.primary.location
}

output "artifact_registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "rabbitmq_ip" {
  value = google_compute_address.rabbitmq.address
}

output "frontend_ip" {
  value = google_compute_global_address.frontend.address
}
