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

data "terraform_remote_state" "deploy" {
  backend = "local"
  config = {
    path = abspath("${path.module}/../../../../deploy/terraform/environments/local/terraform.tfstate")
  }
}

provider "helm" {
  kubernetes {
    config_path = "~/.kube/config"
  }
}

resource "helm_release" "zeroclaw_ops" {
  name             = "zeroclaw-ops"
  chart            = abspath("${path.module}/../../../helm/zeroclaw")
  namespace        = "ops"
  create_namespace = true
  wait             = false
  timeout          = 600

  values = [
    file("${path.module}/values-local.yaml")
  ]

  depends_on = [
    data.terraform_remote_state.platform,
    data.terraform_remote_state.deploy
  ]
}

output "zeroclaw_namespace" {
  value = "ops"
}

output "zeroclaw_service" {
  value = "zeroclaw-ops"
}

output "zeroclaw_port" {
  value = 42617
}
