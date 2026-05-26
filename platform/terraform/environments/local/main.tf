terraform {
  required_version = ">= 1.5.0"

  required_providers {
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }
}

variable "cluster_name" {
  type    = string
  default = "nrdc-poc"
}

variable "repo_root" {
  type        = string
  description = "Absolute path to repository root"
}

resource "null_resource" "k3d_cluster" {
  triggers = {
    cluster_name = var.cluster_name
  }

  provisioner "local-exec" {
    command     = "powershell -ExecutionPolicy Bypass -File \"${var.repo_root}/scripts/ensure-k3d-cluster.ps1\" -ClusterName \"${var.cluster_name}\""
    interpreter = ["powershell", "-Command"]
  }

  provisioner "local-exec" {
    when        = destroy
    command     = "k3d cluster delete ${self.triggers.cluster_name}"
    interpreter = ["powershell", "-Command"]
    on_failure  = continue
  }
}

resource "null_resource" "import_images" {
  triggers = {
    cluster_name  = var.cluster_name
    backend_hash  = filemd5("${var.repo_root}/backend/Dockerfile")
    frontend_hash = filemd5("${var.repo_root}/frontend/Dockerfile")
    zeroclaw_hash = filemd5("${var.repo_root}/ops/docker/zeroclaw-ops/Dockerfile")
    entrypoint_hash = filemd5("${var.repo_root}/ops/docker/zeroclaw-ops/entrypoint.sh")
  }

  provisioner "local-exec" {
    command     = "powershell -ExecutionPolicy Bypass -File \"${var.repo_root}/scripts/import-images-k3d.ps1\" -ClusterName \"${var.cluster_name}\""
    interpreter = ["powershell", "-Command"]
  }

  depends_on = [null_resource.k3d_cluster]
}

output "cluster_name" {
  value = var.cluster_name
}

output "ingress_host" {
  value = "nrdc-poc.local"
}

output "platform_ready" {
  value = null_resource.import_images.id
}
