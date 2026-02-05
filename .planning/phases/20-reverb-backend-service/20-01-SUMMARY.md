---
phase: 20-reverb-backend-service
plan: 01
subsystem: infra
tags: [docker, cuda, pytorch, fastapi, reverb, gpu]

# Dependency graph
requires:
  - phase: none
    provides: first plan of phase 20
provides:
  - Docker infrastructure for Reverb ASR service
  - GPU-enabled container with PyTorch + CUDA
  - Model cache volume for persistence
affects:
  - 20-02-PLAN (server.py implementation)
  - 23-kitchen-sink-integration (browser API client)

# Tech tracking
tech-stack:
  added:
    - pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime (Docker base)
    - fastapi>=0.115.0
    - uvicorn[standard]>=0.30.0
    - python-multipart>=0.0.9
    - rev-reverb==0.1.0
  patterns:
    - Docker Compose GPU reservation with deploy.resources.reservations.devices
    - Named volume for model cache persistence

key-files:
  created:
    - services/reverb/requirements.txt
    - services/reverb/Dockerfile
    - services/reverb/docker-compose.yml
  modified: []

key-decisions:
  - "PyTorch official Docker image chosen over nvidia/cuda base for pre-installed PyTorch"
  - "Model NOT pre-downloaded in Dockerfile to avoid HuggingFace auth issues"
  - "Port 8765 chosen to avoid conflicts with common dev ports"

patterns-established:
  - "GPU reservation via deploy.resources.reservations.devices in docker-compose"
  - "PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True for VRAM management"
  - "Named volume (reverb-cache) for HuggingFace model persistence"

# Metrics
duration: 1min
completed: 2026-02-05
---

# Phase 20 Plan 01: Docker Infrastructure Summary

**Docker container foundation for Reverb ASR with PyTorch CUDA 11.8, GPU reservation, and model cache volume**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-05T17:24:13Z
- **Completed:** 2026-02-05T17:25:12Z
- **Tasks:** 3
- **Files created:** 3

## Accomplishments
- Created services/reverb/ directory structure for Python backend
- Configured Dockerfile with PyTorch CUDA base and all system dependencies
- Set up docker-compose.yml with explicit NVIDIA GPU reservation
- Added model cache volume for persistent HuggingFace downloads

## Task Commits

Each task was committed atomically:

1. **Task 1: Create service directory and requirements.txt** - `94f4c22` (feat)
2. **Task 2: Create Dockerfile with CUDA base** - `d06c126` (feat)
3. **Task 3: Create docker-compose.yml with GPU reservation** - `75638b1` (feat)

## Files Created

- `services/reverb/requirements.txt` - Python dependencies (fastapi, uvicorn, python-multipart, rev-reverb)
- `services/reverb/Dockerfile` - Container definition with pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime base
- `services/reverb/docker-compose.yml` - GPU orchestration with nvidia driver reservation

## Decisions Made

1. **PyTorch official Docker image** - Chose `pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime` over `nvidia/cuda` base because PyTorch is pre-installed and configured for the CUDA version
2. **No model pre-download in Dockerfile** - Model downloads at first request to avoid HuggingFace authentication issues in build environments
3. **Port 8765** - Avoids conflicts with common development ports (3000, 5000, 8000, 8080)
4. **Named volume for cache** - `reverb-cache` volume persists /root/.cache between container restarts, avoiding repeated 1GB+ model downloads

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. GPU driver and NVIDIA Container Toolkit must be installed on host machine (assumed pre-existing).

## Next Phase Readiness

- Docker infrastructure ready for Plan 02 (server.py implementation)
- Dockerfile expects `server.py` to be COPY'd (will exist after Plan 02)
- Cannot build/run container until server.py is created
- GPU verification will happen at server startup (Pattern 1 from research)

---
*Phase: 20-reverb-backend-service*
*Completed: 2026-02-05*
