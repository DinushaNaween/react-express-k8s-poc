terraform {
  required_version = ">= 1.5.0"

  required_providers {
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }
}

data "terraform_remote_state" "platform" {
  backend = "local"
  config = {
    path = abspath("${path.module}/../../../../platform/terraform/environments/local/terraform.tfstate")
  }
}

provider "helm" {
  kubernetes {
    config_path = "~/.kube/config"
  }
}

resource "helm_release" "nrdc_poc" {
  name             = "nrdc-poc"
  chart            = abspath("${path.module}/../../../helm/nrdc-poc")
  namespace        = "nrdc-poc"
  create_namespace = true
  wait             = true
  timeout          = 300

  values = [
    file("${path.module}/values-local.yaml")
  ]

  depends_on = [data.terraform_remote_state.platform]
}

output "app_url" {
  value = "http://nrdc-poc.local"
}

output "release_name" {
  value = helm_release.nrdc_poc.name
}
