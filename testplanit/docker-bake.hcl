# Docker Bake configuration for building multiple targets efficiently
# This allows building both production and workers images in a single command,
# sharing the build cache between targets to avoid duplicate builds.
#
# Usage:
#   docker buildx bake --push
#   docker buildx bake --push production
#   docker buildx bake --push workers
#   docker buildx bake --push --set "*.tags=ghcr.io/testplanit/testplanit:custom"
#
# The "selfhost" group builds the public, domain-agnostic images used by the
# Helm chart / self-hosters: multi-arch and SELF_HOSTED=true (Next image
# optimizer off, no baked BASE_DOMAIN), published to a separate registry:
#   docker buildx bake --push selfhost

variable "REGISTRY" {
  default = "ghcr.io/testplanit/testplanit"
}

# Public self-host images (domain-agnostic). Distinct from REGISTRY so they are
# never confused with the SaaS images (which bake BASE_DOMAIN and are arm64-only).
variable "SELFHOST_REGISTRY" {
  default = "ghcr.io/testplanit/testplanit-selfhost"
}

variable "VERSION" {
  default = "latest"
}

variable "GIT_COMMIT" {
  default = ""
}

variable "BASE_DOMAIN" {
  default = "testplanit.com"
}

# Group to build all targets at once
group "default" {
  targets = ["production", "workers"]
}

# Shared configuration for all targets.
# Context is the repo root (one level up from this bake file) so the build uses
# the single root pnpm-lock.yaml + pnpm-workspace.yaml — there is no duplicate
# lockfile under testplanit/. The dockerfile path is relative to the context.
target "_common" {
  context = ".."
  dockerfile = "testplanit/Dockerfile"
  args = {
    VERSION = "${VERSION}"
    GIT_COMMIT = "${GIT_COMMIT}"
    BASE_DOMAIN = "${BASE_DOMAIN}"
  }
}

# Production image (Next.js server)
target "production" {
  inherits = ["_common"]
  target = "production"
  tags = [
    "${REGISTRY}:${VERSION}",
    "${REGISTRY}:latest"
  ]
}

# Workers image (background jobs)
target "workers" {
  inherits = ["_common"]
  target = "workers"
  tags = [
    "${REGISTRY}:${VERSION}-workers",
    "${REGISTRY}:latest-workers"
  ]
}

# ---- Public self-host images (domain-agnostic, multi-arch) ------------------
group "selfhost" {
  targets = ["production-selfhost", "workers-selfhost"]
}

# Like _common but SELF_HOSTED=true (optimizer off, no baked BASE_DOMAIN).
# Platform is set per-invocation: CI builds each arch natively on its own runner
# (see .github/workflows/release-selfhost.yml) and merges the manifest; a manual
# build defaults to the builder's host arch, or pass e.g.
#   --set "*.platform=linux/amd64,linux/arm64"  for a local multi-arch build.
target "_selfhost_common" {
  context = ".."
  dockerfile = "testplanit/Dockerfile"
  args = {
    VERSION = "${VERSION}"
    GIT_COMMIT = "${GIT_COMMIT}"
    SELF_HOSTED = "true"
  }
}

target "production-selfhost" {
  inherits = ["_selfhost_common"]
  target = "production"
  tags = [
    "${SELFHOST_REGISTRY}:${VERSION}",
    "${SELFHOST_REGISTRY}:latest"
  ]
}

target "workers-selfhost" {
  inherits = ["_selfhost_common"]
  target = "workers"
  tags = [
    "${SELFHOST_REGISTRY}:${VERSION}-workers",
    "${SELFHOST_REGISTRY}:latest-workers"
  ]
}
