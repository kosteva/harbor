# syntax=docker/dockerfile:1
# Forge Neo | NVIDIA GPU
# Adapted from upstream's neo/docker/Dockerfile:
# https://github.com/Haoming02/sd-webui-forge-classic/blob/neo/docker/Dockerfile
# - CUDA 13 / cu130 torch by default (Blackwell sm_120 kernels)
# - runs as the host user (UID/GID build args) instead of a fixed UID 99
# - Python requirements are installed at build time, not on every start
# - multi-arch (amd64 + arm64)

ARG CUDA_VERSION=13.0.2

FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu24.04

# See: https://download.pytorch.org/whl/
ARG TORCH_INDEX=cu130
ARG UID=1000
ARG GID=1000

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PYTHON_DOWNLOADS=automatic \
    UV_NO_CACHE=1 \
    TORCH_INDEX_URL=https://download.pytorch.org/whl/${TORCH_INDEX}

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        ffmpeg \
        git \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libtcmalloc-minimal4 \
    && rm -rf /var/lib/apt/lists/*

# ubuntu:24.04 ships an "ubuntu" user at 1000:1000; reuse whatever already
# owns the requested IDs so any host UID/GID works.
RUN existing_user="$(getent passwd "${UID}" | cut -d: -f1)" \
    && if [ -n "$existing_user" ]; then userdel -r "$existing_user" 2>/dev/null || userdel "$existing_user"; fi \
    && (getent group "${GID}" >/dev/null || groupadd -g "${GID}" forge) \
    && useradd -u "${UID}" -g "${GID}" -d /home/forge -m -s /bin/bash forge \
    && install -d -o "${UID}" -g "${GID}" /home/forge/sd-webui

WORKDIR /home/forge/sd-webui

COPY --from=forge-src --chown=${UID}:${GID} . /home/forge/sd-webui

USER forge

RUN uv venv venv --python 3.13 --seed

ENV VIRTUAL_ENV="/home/forge/sd-webui/venv" \
    PATH="/home/forge/sd-webui/venv/bin:$PATH" \
    PYTHON="/home/forge/sd-webui/venv/bin/python3.13"

# Same torch/torchvision versions as Forge's own default TORCH_COMMAND
RUN uv pip install torch==2.14.0 torchvision==0.29.0 \
    --index-url "${TORCH_INDEX_URL}"

# Run Forge's prepare_environment() (requirements + built-in extension
# installers) once at build time so container starts don't reinstall them
RUN python launch.py --skip-torch-cuda-test --skip-python-version-check --exit \
    && rm -rf /home/forge/.cache

RUN mkdir -p \
        models/Stable-diffusion \
        models/VAE \
        models/Lora \
        models/ControlNet \
        extensions \
        config \
        output \
        /home/forge/.cache

COPY --chown=${UID}:${GID} entrypoint.sh /home/forge/sd-webui/entrypoint.sh
RUN chmod +x /home/forge/sd-webui/entrypoint.sh

EXPOSE 7860

ENTRYPOINT ["/home/forge/sd-webui/entrypoint.sh"]
