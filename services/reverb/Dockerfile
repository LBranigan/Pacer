# Reverb ASR Service Dockerfile
# Base: PyTorch with CUDA 11.8 for GPU acceleration
FROM pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime

# System dependencies required by Reverb ASR
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    git-lfs \
    libsndfile1 \
    sox \
    && rm -rf /var/lib/apt/lists/*

# Initialize git-lfs for HuggingFace model download
RUN git lfs install

# Configure git to use HF_TOKEN for HuggingFace model download at runtime
# The token is passed via environment variable, not baked into the image
RUN git config --global credential.helper '!f() { echo "username=hf"; echo "password=${HF_TOKEN}"; }; f'

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Reverb ASR (separate layer for Docker caching)
RUN pip install --no-cache-dir rev-reverb==0.1.0

# Install NeMo ASR for Parakeet TDT (separate layer — ~1-2GB, rarely changes)
# NeMo can pull torch/torchaudio targeting wrong CUDA; restore all three for CUDA 11.8
RUN pip install --no-cache-dir "nemo_toolkit[asr]>=2.2" && \
    pip install --no-cache-dir torch==2.4.0 torchvision==0.19.0 torchaudio==2.4.0 --index-url https://download.pytorch.org/whl/cu118

# Copy server application (created in Plan 02)
COPY server.py .

EXPOSE 8765

# Run uvicorn ASGI server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765", "--timeout-keep-alive", "120"]
