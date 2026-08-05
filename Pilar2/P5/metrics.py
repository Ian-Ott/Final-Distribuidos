from prometheus_client import Counter, Gauge, Histogram
#este archivo se encarga de definir una unica vez las metricas relacionadas con todos los servicios

#generic metrics
RABBIT_CONNECTED = Gauge("rabbit_connected", "Conexión con RabbitMQ")
REDIS_CONNECTED = Gauge("redis_connected", "Conexión con Redis")

#GPU-Server metrics
GPU_MINE_REQUESTS = Counter("gpu_mine_requests_total", "Pedidos de minado recibidos por el gpu-server")
GPU_SOLUTIONS = Counter("gpu_solutions_found_total", "Pedidos en los que el binario CUDA encontro nonce")
GPU_MINE_SECONDS = Histogram(
    "gpu_mine_duration_seconds", "Duracion de la corrida del binario CUDA",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60),
)
GPU_BUSY = Gauge(
    "gpu_busy",
    "1 mientras la GPU está minando"
)
GPU_HASHES_REQUESTED = Counter(
    "gpu_hashes_requested_total",
    "Hashes enviados al binario CUDA"
)
GPU_ERRORS = Counter(
    "gpu_errors_total",
    "Errores del binario CUDA"
)

#NCT metrics
NCT_BLOCKS = Counter("nct_blocks_total", "Bloques minados y confirmados")
NCT_MINING_SECONDS = Histogram(
    "nct_block_mining_seconds",
    "Tiempo desde que se publica la tarea hasta que llega una solucion valida",
    buckets=(0.5, 1, 2, 5, 10, 20, 30, 60, 120, 180),
)
NCT_TX_RECEIVED = Counter("nct_transactions_received_total", "Transacciones recibidas", ["tx_type"])
NCT_SOLUTIONS_REJECTED = Counter("nct_solutions_rejected_total", "Soluciones descartadas por el NCT", ["reason"])
NCT_MINING_TIMEOUTS = Counter("nct_mining_timeouts_total", "Veces que el minado supero el timeout")
NCT_PENDING_TX = Gauge("nct_pending_transactions", "Transacciones pendientes de minar")
NCT_BLOCKCHAIN_LEN = Gauge("nct_blockchain_length", "Cantidad de bloques en la cadena")
NCT_DIFFICULTY_ZEROS = Gauge("nct_difficulty_zeros", "Ceros de dificultad exigidos actualmente")
NCT_MINING_ACTIVE = Gauge("nct_mining_active", "1 si una replica tiene el lock de minado tomado")

#trp metrics
TRP_TASKS = Counter("trp_tasks_subdivided_total", "Tareas del NCT subdivididas")
TRP_CHUNKS = Counter("trp_chunks_published_total", "Sub-tareas (chunks) publicadas a los workers")
TRP_FALLBACK_ACTIVE = Gauge("trp_fallback_active", "1 si el fallback a CPU esta activo")
TRP_GPU_ALIVE = Gauge("trp_gpu_alive", "1 si el gpu-server tiene heartbeat vivo")
TRP_SCALE_EVENTS = Counter("trp_cpu_scale_events_total", "Eventos de escalado de worker-cpu", ["action"])
TRP_HASHES_ASSIGNED = Counter(
    "trp_hashes_assigned_total",
    "Hashes distribuidos por el TRP"
)
TRP_SUBDIVISION_SECONDS = Histogram(
    "trp_subdivision_duration_seconds",
    "Tiempo en subdividir una tarea"
)
TRP_MODE = Gauge(
    "trp_mode",
    "0 GPU - 1 CPU"
)

#worker generic metrics
WORKER_TASKS = Counter("worker_tasks_processed_total", "Tareas procesadas", ["worker_type"])
WORKER_SOLUTIONS = Counter("worker_solutions_found_total", "Soluciones encontradas", ["worker_type"])
WORKER_TASK_SECONDS = Histogram(
    "worker_task_duration_seconds", "Duracion del minado de una sub-tarea",
    ["worker_type"], buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30),
)
#worker cpu metrics
HASHES_TOTAL = Counter(
    "worker_hashes_total",
    "Hashes calculados",
    ["worker_type"]
)

#worker gpu metrics
GPU_REQUEST_ERRORS = Counter(
    "worker_gpu_request_errors_total",
    "Errores al llamar al GPU Server"
)