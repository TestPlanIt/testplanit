# Docker Bake configuration for building multiple targets efficiently
# This allows building both production and workers images in a single command,
# sharing the build cache between targets to avoid duplicate builds.
#
# Usage:
#   docker buildx bake --push
#   docker buildx bake --push production
#   docker buildx bake --push workers
#   docker buildx bake --push --set "*.tags=ghcr.io/testplanit/testplanit:custom"

variable "REGISTRY" {
  default = "ghcr.io/testplanit/testplanit"
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

# Shared configuration for all targets
target "_common" {
  context = "."
  dockerfile = "Dockerfile"
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
