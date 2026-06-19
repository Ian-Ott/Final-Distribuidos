FROM nvidia/cuda:12.2.0-devel-ubuntu22.04 AS builder

WORKDIR /build

COPY brute_force_range.cu .


RUN nvcc \
    -gencode arch=compute_89,code=sm_89 \
    -O3 \
    brute_force_range.cu \
    -o minero


FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04

WORKDIR /app

RUN apt-get update && \
    apt-get install -y python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=builder /build/minero ./minero

CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]