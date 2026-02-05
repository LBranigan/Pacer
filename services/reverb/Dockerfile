# Reverb ASR Service Dockerfile
# Base: PyTorch with CUDA 11.8 for GPU acceleration
FROM pytorch/pytorch:2.4.0-cuda11.8-cudnn9-runtime

# System dependencies required by Reverb ASR
RUN apt-get update && apt-get install -y \
    ffmpeg \
    git \
    git-lfs \
    libsndfile1 \
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

# Copy server application (created in Plan 02)
COPY server.py .

EXPOSE 8765

# Run uvicorn ASGI server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
