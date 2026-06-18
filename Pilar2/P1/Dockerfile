FROM nvidia/cuda:12.4.0-devel-ubuntu22.04 AS builder

WORKDIR /build

COPY brute_force_range.cu .

RUN nvcc \
    -gencode arch=compute_61,code=sm_61 \
    -O3 \
    brute_force_range.cu \
    -o minero



FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip3 install --no-cache-dir -r requirements.txt


COPY . .

# Copiar solamente el ejecutable compilado
COPY --from=builder /build/minero ./minero

EXPOSE 8000

CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]