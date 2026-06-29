from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, Literal, Any
import pika
import ssl as ssl_mod
import json
import time
import redis
import hashlib
import base64
import uuid
import threading
import os
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.exceptions import InvalidSignature

import observability as obs
from prometheus_client import Counter, Gauge, Histogram

# API REST que expone endpoints para el mundo exterior y coordina todo el proceso de creación de bloques.

# --- Observabilidad ---------------------------------------------------------
log = obs.setup_logging("nct")
obs.setup_tracing("nct")
obs.instrument_requests()
obs.instrument_redis()
tracer = obs.get_tracer("nct")

# Métricas de dominio. Se incrementan en los mismos puntos donde ya se escribe
# a la lista "logs" de Redis, así toda señal de negocio queda también en Prometheus.
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


def connect_redis():
    while True:
        try:
            client = redis.Redis(host="redis", port=6379, decode_responses=True)
            client.ping()
            return client
        except Exception:
            log.warning("Esperando Redis...")
            time.sleep(3)

r = connect_redis()

app = FastAPI()
# /metrics para que Prometheus scrapee al NCT en su mismo puerto (8000).
_metrics_app = obs.metrics_asgi_app()
if _metrics_app is not None:
    app.mount("/metrics", _metrics_app)
obs.instrument_fastapi(app)
RABBIT_HEARTBEAT_SECONDS = int(os.getenv("RABBIT_HEARTBEAT_SECONDS", "180"))
RABBIT_KEEPALIVE_INTERVAL_SECONDS = int(os.getenv("RABBIT_KEEPALIVE_INTERVAL_SECONDS", "15"))

def rabbitmq_ssl_context():
    ctx = ssl_mod.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl_mod.CERT_NONE
    return pika.SSLOptions(ctx)

def connect_rabbitmq():
    while True:
        try:
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(
                    "rabbitmq",
                    port=5671,
                    ssl_options=rabbitmq_ssl_context(),
                    heartbeat=RABBIT_HEARTBEAT_SECONDS,
                    blocked_connection_timeout=300
                )
            )
            return connection
        except Exception:
            log.warning("Esperando RabbitMQ...")
            time.sleep(3)

connection = connect_rabbitmq()
channel = connection.channel()
channel.queue_declare(queue='tareas_pool')  # NCT → TrP
channel.queue_declare(queue='soluciones')   # Workers → NCT
rabbit_lock = threading.RLock()

def ensure_connection():
    """Verifica que la conexión y el canal sigan vivos; si no, reconecta."""
    global connection, channel
    with rabbit_lock:
        try:
            if connection.is_closed or channel.is_closed:
                raise Exception("conexion cerrada")
            connection.process_data_events(time_limit=0)
        except Exception:
            log.warning("Conexión a RabbitMQ perdida, reconectando...")
            try:
                connection.close()
            except Exception:
                pass
            connection = connect_rabbitmq()
            channel = connection.channel()
            channel.queue_declare(queue='tareas_pool')
            channel.queue_declare(queue='soluciones')

def safe_basic_get(queue: str):
    """basic_get con reconexión automática si la conexión se cayó."""
    global channel
    with rabbit_lock:
        ensure_connection()
        try:
            result = channel.basic_get(queue=queue, auto_ack=False)
        except Exception as e:
            log.warning(f"Error en basic_get, reconectando: {e}")
            ensure_connection()
            result = channel.basic_get(queue=queue, auto_ack=False)
        method, properties, body = result
        if method is None:
            return None
        return method, properties, body

def safe_basic_publish(routing_key: str, body: str):
    """basic_publish con reconexión automática si la conexión se cayó."""
    global channel
    with rabbit_lock:
        ensure_connection()
        try:
            channel.basic_publish(exchange='', routing_key=routing_key, body=body)
        except Exception as e:
            log.warning(f"Error en basic_publish, reconectando: {e}")
            ensure_connection()
            channel.basic_publish(exchange='', routing_key=routing_key, body=body)

def safe_basic_ack(delivery_tag):
    global channel
    with rabbit_lock:
        ensure_connection()
        channel.basic_ack(delivery_tag=delivery_tag)

def safe_queue_purge(queue: str):
    global channel
    with rabbit_lock:
        ensure_connection()
        result = channel.queue_purge(queue=queue)
        return getattr(result, "message_count", getattr(getattr(result, "method", None), "message_count", 0))

def purge_stale_solutions(task_id: str):
    try:
        purged = safe_queue_purge("soluciones")
        if purged:
            r.rpush("logs", json.dumps({
                "timestamp": time.time(),
                "event": "soluciones_sobrantes_purgadas",
                "task_id": task_id,
                "count": purged,
            }))
    except Exception as e:
        r.rpush("logs", json.dumps({
            "timestamp": time.time(),
            "event": "purga_soluciones_fallo",
            "task_id": task_id,
            "error": str(e),
        }))

# NOTA: el rabbit_keepalive_loop fue removido. La razón:
# - pika.BlockingConnection NO es thread-safe, ni siquiera con RLock alrededor.
#   El lock evita calls simultáneos pero pika mantiene estado interno que se
#   corrompe al alternar entre threads. Esto causaba que algunas soluciones
#   se perdieran (solucion_tomada sin bloque_creado correspondiente).
# - El heartbeat AMQP de pika (heartbeat=RABBIT_HEARTBEAT_SECONDS=180) ya
#   mantiene viva la conexión sin necesidad de un thread externo.
# - Si la conexión muere, safe_basic_get/publish reconectan automáticamente.
# Con esto, el único thread que toca RabbitMQ es el auto-miner.

def wait_for_solution(task_id: str, timeout_seconds: int, data: str = None, difficulty: str = None):
    """Espera la solución de esta corrida y descarta mensajes inválidos.

    Si se pasan `data` y `difficulty`, también valida el hash de cada solución
    recibida y descarta las que no cumplen (en vez de retornar y matar la op).
    Antes una sola solución inválida hacía fallar toda la operación; ahora
    seguimos esperando otra mientras dure el timeout. Esto cubre el caso de
    workers que publican hashes inválidos esporádicamente (bug del binario
    CUDA bajo concurrencia, corrupción en GPU, etc.).
    """
    deadline = time.time() + timeout_seconds
    verify_inline = data is not None and difficulty is not None

    while time.time() < deadline:
        result = safe_basic_get('soluciones')
        if result is not None:
            method, _, body = result
            if body is not None:
                try:
                    solucion = json.loads(body)
                except json.JSONDecodeError:
                    safe_basic_ack(method.delivery_tag)
                    NCT_SOLUTIONS_REJECTED.labels(reason="invalid_json").inc()
                    r.rpush("logs", json.dumps({
                        "timestamp": time.time(),
                        "event": "solucion_descartada",
                        "task_id": task_id,
                        "reason": "invalid_json",
                    }))
                    continue

                solution_task_id = solucion.get("task_id")
                if solution_task_id != task_id:
                    safe_basic_ack(method.delivery_tag)
                    NCT_SOLUTIONS_REJECTED.labels(reason="stale_task").inc()
                    r.rpush("logs", json.dumps({
                        "timestamp": time.time(),
                        "event": "solucion_descartada",
                        "task_id": task_id,
                        "received_task_id": solution_task_id,
                    }))
                    continue

                if verify_inline:
                    nonce = solucion.get("nonce")
                    hash_recibido = solucion.get("hash")
                    if not verify_hash(data, nonce, hash_recibido, difficulty):
                        safe_basic_ack(method.delivery_tag)
                        NCT_SOLUTIONS_REJECTED.labels(reason="invalid_pow").inc()
                        r.rpush("logs", json.dumps({
                            "timestamp": time.time(),
                            "event": "solucion_descartada",
                            "task_id": task_id,
                            "reason": "invalid_pow",
                            "nonce": nonce,
                            "hash": hash_recibido,
                        }))
                        continue

                safe_basic_ack(method.delivery_tag)
                r.rpush("logs", json.dumps({
                    "timestamp": time.time(),
                    "event": "solucion_tomada",
                    "task_id": task_id,
                    "nonce": solucion.get("nonce"),
                    "hash": solucion.get("hash"),
                }))
                return solucion

        time.sleep(MINING_POLL_INTERVAL_SECONDS)

    NCT_MINING_TIMEOUTS.inc()
    r.rpush("logs", json.dumps({
        "timestamp": time.time(),
        "event": "minado_timeout",
        "task_id": task_id,
        "timeout_seconds": timeout_seconds,
    }))
    return None

# -------------------------
# CONFIGURACION
# -------------------------

TOTAL = 10000000
# Tope de la lista "logs" en Redis. Es telemetría/debug, no fuente de verdad,
# así que la acotamos para que no crezca sin límite y termine OOM-kileando a
# Redis (que es el cerebro de todo el sistema). El logs_janitor de abajo la
# trimea periódicamente a este tamaño.
MAX_LOGS = int(os.getenv("MAX_LOGS", "5000"))
LOGS_TRIM_INTERVAL_SECONDS = int(os.getenv("LOGS_TRIM_INTERVAL_SECONDS", "10"))
MINING_TIMEOUT_SECONDS = int(os.getenv("MINING_TIMEOUT_SECONDS", "180"))
MINING_POLL_INTERVAL_SECONDS = 0.5
MINING_LOCK_KEY = "minando"
MINING_LOCK_TTL_SECONDS = int(os.getenv("MINING_LOCK_TTL_SECONDS", str(MINING_TIMEOUT_SECONDS + 120)))

if not r.exists("difficulty"):
    r.set("difficulty", "00")

def acquire_mining_lock() -> str | None:
    token = str(uuid.uuid4())
    acquired = r.set(MINING_LOCK_KEY, token, nx=True, ex=MINING_LOCK_TTL_SECONDS)
    return token if acquired else None

def release_mining_lock(token: str):
    r.eval(
        """
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
        end
        return 0
        """,
        1,
        MINING_LOCK_KEY,
        token,
    )

# -------------------------
# GENESIS
# El bloque génesis es el primero de toda blockchain — no tiene transacciones ni fue minado.
# Su previous_hash es "0" porque no hay bloque anterior, y su block_hash es literalmente "GENESIS".
# Solo se crea si la blockchain está vacía.
if r.llen("blockchain") == 0:
    genesis = {
        "index": 0,
        "timestamp": time.time(),
        "transactions": [],
        "previous_hash": "0",
        "nonce": 0,
        "block_hash": "GENESIS"
    }
    r.rpush("blockchain", json.dumps(genesis))

# -------------------------
# MODELOS
# -------------------------

class Transaction(BaseModel):
    sender: str
    receiver: str
    amount: float

class DifficultyRequest(BaseModel):
    difficulty: str

# ============================================================================
# Modelos extendidos para la integración con la app de tickets (ADR-018).
# Cada operación lleva un op_id que el cliente usa para polear el estado
# hasta que el bloque se mina y queda CONFIRMED.
# ============================================================================

class MintTx(BaseModel):
    op_id: Optional[str] = None  # si no viene, lo generamos
    event_id: str
    organizer_pubkey: str  # base64 SPKI DER
    ticket_count: int = Field(gt=0, le=100_000)
    signed_payload: dict[str, Any]
    signature: str  # base64 P1363 (r||s, 64 bytes)

class TransferTx(BaseModel):
    op_id: Optional[str] = None
    event_id: str
    ticket_id: str
    from_pubkey: str
    to_pubkey: str
    reason: Literal["purchase", "validation", "resale"]
    signed_payload: dict[str, Any]
    signature: str

# -------------------------
# HELPERS
# -------------------------

# Recalculamos el hash y verificamos que el hash calculado localmente coincide con el que mandó el worker (no fue adulterado)
# Que ese hash cumple la dificultad requerida
def verify_hash(data: str, nonce: int, expected_hash: str, difficulty: str) -> bool:
    text = data + str(nonce)
    calculated = hashlib.md5(text.encode()).hexdigest()
    return calculated == expected_hash and calculated.startswith(difficulty)

# Verificamos que el bloque tiene todos los campos y que su previous_hash es el hash del bloque anterior
def validate_block(block: dict, previous_hash: str) -> bool:
    required_fields = ["index", "timestamp", "transactions", "previous_hash", "nonce", "block_hash"]
    for field in required_fields:
        if field not in block:
            return False
    return block["previous_hash"] == previous_hash

def get_last_block() -> dict:
    raw = r.lindex("blockchain", -1)
    return json.loads(raw)

# Guardamos el bloque de dos formas en Redis:
# En la lista blockchain: para recorrer toda la cadena en orden
# Como hash block:N: para acceder rápido a un bloque por índice sin recorrer toda la lista
def save_block(block: dict):
    r.rpush("blockchain", json.dumps(block))
    key = f"block:{block['index']}"
    r.hset(key, mapping={
        "previous_hash":  block["previous_hash"],
        "nonce":          str(block["nonce"]),
        "timestamp":      str(block["timestamp"]),
        "transactions":   json.dumps(block["transactions"]),
        "block_hash":     block["block_hash"]
    })

# -------------------------
# ENDPOINTS
# -------------------------

# Agregamos al pool de pendientes en Redis y loggea el evento.
@app.post("/transaction")
def transaction(tx: Transaction):
    transaccion = tx.dict()
    NCT_TX_RECEIVED.labels(tx_type="legacy").inc()
    r.rpush("pending_transactions", json.dumps(transaccion))

    r.rpush("logs", json.dumps({
        "timestamp": time.time(),
        "event": "transaccion_recibida",
        "data": transaccion
    }))

    return {"ok": True, "pending": r.llen("pending_transactions")}

# NOTA: el endpoint manual POST /create-block fue eliminado a propósito.
# Razones:
# - Duplicaba la lógica de minado de _mine_one_block() pero SIN aplicar los
#   efectos ticket-aware (apply_confirmed_tx) ni marcar las ops CONFIRMED, así
#   que dejaba mint/transfer colgados en PENDING para siempre (bug M1).
# - Corría en el threadpool de FastAPI tocando la conexión pika compartida con
#   el thread del auto-miner; pika.BlockingConnection no es thread-safe ni con
#   RLock, así que llamarlo concurrente con el auto-miner corrompía el canal
#   (bug M4).
# El auto-miner (auto_miner_loop -> _mine_one_block) es ahora el único camino
# de creación de bloques: dispara solo cuando hay pending y es el único hilo
# que toca RabbitMQ.

# Devolvemos toda la lista de Redis deserializada.
@app.get("/blockchain")
def get_blockchain():
    bloques = r.lrange("blockchain", 0, -1)
    return [json.loads(x) for x in bloques]

# Usamos el hash block:N de Redis para acceso directo por índice, sin recorrer toda la lista.
@app.get("/block/{index}")
def get_block(index: int):
    key = f"block:{index}"
    if not r.exists(key):
        raise HTTPException(status_code=404, detail="Bloque no encontrado")
    block = r.hgetall(key)
    block["transactions"] = json.loads(block["transactions"])
    return block

# Recorremos todos los bloques verificando dos cosas por cada uno:
# Que el previous_hash coincide con el block_hash del bloque anterior
# Que el hash del bloque es válido con la dificultad actual
@app.get("/validate")
def validate():
    bloques = r.lrange("blockchain", 0, -1)
    bloques = [json.loads(x) for x in bloques]

    for i in range(1, len(bloques)):
        actual = bloques[i]
        previo = bloques[i - 1]

        if actual["previous_hash"] != previo["block_hash"]:
            return {"valid": False, "error": f"bloque {i} tiene previous_hash incorrecto"}

        data = json.dumps({
            "index":         actual["index"],
            "timestamp":     actual["timestamp"],
            "transactions":  actual["transactions"],
            "previous_hash": actual["previous_hash"]
        }, sort_keys=True)

        difficulty = r.get("difficulty")
        if not verify_hash(data, actual["nonce"], actual["block_hash"], difficulty):
            return {"valid": False, "error": f"bloque {i} tiene hash invalido"}

    return {"valid": True, "total_bloques": len(bloques)}

# Obtenemos la dificultad
@app.get("/difficulty")
def get_difficulty():
    return {"difficulty": r.get("difficulty")}

# Escribimos la dificultad en Redis. 
@app.post("/difficulty")
def set_difficulty(req: DifficultyRequest):
    if not all(c == '0' for c in req.difficulty):
        raise HTTPException(status_code=400, detail="La dificultad debe ser solo ceros (ej: '000')")

    r.set("difficulty", req.difficulty)

    r.rpush("logs", json.dumps({
        "timestamp":  time.time(),
        "event":      "dificultad_cambiada",
        "difficulty": req.difficulty
    }))

    return {"ok": True, "difficulty": req.difficulty}

# ============================================================================
# Extensión para tickets: canonicalización + firma + ownership.
# Ver ADR-018 del repo de la app web.
# ============================================================================

def canonicalize(value: Any) -> str:
    """Serialización canónica JSON, alineada con app/src/lib/crypto/common.ts.
    Keys ordenadas alfabéticamente, sin espacios extra."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        return "{" + ",".join(json.dumps(k) + ":" + canonicalize(value[k]) for k in keys) + "}"
    raise ValueError(f"Tipo no canonicalizable: {type(value)}")

def verify_signature(pubkey_b64: str, payload: dict, signature_b64: str) -> bool:
    """Verifica ECDSA P-256 / SHA-256 / firma en formato IEEE P1363 (raw r||s).
    Devuelve True si la firma es válida sobre canonicalize(payload)."""
    try:
        pubkey_der = base64.b64decode(pubkey_b64)
        sig_raw = base64.b64decode(signature_b64)
        if len(sig_raw) != 64:
            return False
        r_int = int.from_bytes(sig_raw[:32], "big")
        s_int = int.from_bytes(sig_raw[32:], "big")
        sig_der = encode_dss_signature(r_int, s_int)
        key = load_der_public_key(pubkey_der)
        if not isinstance(key, ec.EllipticCurvePublicKey):
            return False
        msg = canonicalize(payload).encode("utf-8")
        key.verify(sig_der, msg, ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False

def save_operation(op_id: str, fields: dict):
    """Guarda/actualiza el estado de una operación en Redis."""
    payload = {k: (json.dumps(v) if not isinstance(v, str) else v) for k, v in fields.items()}
    r.hset(f"op:{op_id}", mapping=payload)

def get_operation(op_id: str) -> Optional[dict]:
    data = r.hgetall(f"op:{op_id}")
    if not data:
        return None
    # Re-deserializar campos no string.
    for k in ("block_index",):
        if k in data and data[k] not in (None, ""):
            try:
                data[k] = int(data[k])
            except ValueError:
                pass
    return data

def set_ticket_owner(ticket_id: str, new_owner: str, event_id: str):
    """Actualiza el índice de ownership cuando se confirma un mint o transfer."""
    old_owner = r.get(f"ticket_owner:{ticket_id}")
    if old_owner:
        r.srem(f"owner_tickets:{old_owner}", ticket_id)
    r.set(f"ticket_owner:{ticket_id}", new_owner)
    r.sadd(f"owner_tickets:{new_owner}", ticket_id)
    r.sadd(f"tickets_by_event:{event_id}", ticket_id)

def apply_confirmed_tx(tx: dict, block_index: int, confirmed_at: float):
    """Materializa los efectos de una tx ticket-aware al confirmarse el bloque."""
    op_id = tx.get("op_id")
    if not op_id:
        return  # tx legacy (formato sender/receiver/amount), nada que hacer
    tx_type = tx.get("tx_type")
    if tx_type == "mint":
        # Materializar N tickets numerados 1..N para el organizador.
        event_id = tx["event_id"]
        organizer = tx["to_pubkey"]
        count = int(tx["ticket_count"])
        for i in range(1, count + 1):
            ticket_id = f"{event_id}:{i}"
            set_ticket_owner(ticket_id, organizer, event_id)
    elif tx_type == "transfer":
        set_ticket_owner(tx["ticket_id"], tx["to_pubkey"], tx["event_id"])
    save_operation(op_id, {
        "status": "CONFIRMED",
        "block_index": block_index,
        "confirmed_at": str(confirmed_at),
    })

def mark_operation_failed(op_id: str, error_code: str):
    save_operation(op_id, {
        "status": "FAILED",
        "error_code": error_code,
        "failed_at": str(time.time()),
    })

# ---------------------------------------------------------------------------
# Endpoints ticket-aware
# ---------------------------------------------------------------------------

@app.post("/tx/mint", status_code=202)
def tx_mint(tx: MintTx):
    if not verify_signature(tx.organizer_pubkey, tx.signed_payload, tx.signature):
        NCT_SOLUTIONS_REJECTED.labels(reason="mint_bad_signature").inc()
        raise HTTPException(status_code=400, detail="invalid_signature")
    NCT_TX_RECEIVED.labels(tx_type="mint").inc()
    op_id = tx.op_id or f"op-{uuid.uuid4().hex[:12]}"
    record = {
        "op_id": op_id,
        "tx_type": "mint",
        "event_id": tx.event_id,
        "to_pubkey": tx.organizer_pubkey,
        "ticket_count": tx.ticket_count,
        "signed_payload": tx.signed_payload,
        "signature": tx.signature,
    }
    r.rpush("pending_transactions", json.dumps(record))
    save_operation(op_id, {
        "status": "PENDING",
        "tx_type": "mint",
        "event_id": tx.event_id,
        "submitted_at": str(time.time()),
    })
    return {"op_id": op_id, "status": "PENDING"}

@app.post("/tx/transfer", status_code=202)
def tx_transfer(tx: TransferTx):
    # Verificación de firma: solo exigimos firma real en transferencias donde
    # el dueño actual está online (validación en puerta). En compra/reventa
    # el platform actúa como mediador post-MP — ver E5 del roadmap y
    # ADR-018 para la deuda de "operator keys delegadas".
    if tx.reason == "validation":
        if not verify_signature(tx.from_pubkey, tx.signed_payload, tx.signature):
            raise HTTPException(status_code=400, detail="invalid_signature")
    # Validar ownership actual.
    current_owner = r.get(f"ticket_owner:{tx.ticket_id}")
    if current_owner is None:
        raise HTTPException(status_code=404, detail="ticket_not_found")
    if current_owner != tx.from_pubkey:
        raise HTTPException(status_code=409, detail="not_current_owner")
    NCT_TX_RECEIVED.labels(tx_type="transfer").inc()
    op_id = tx.op_id or f"op-{uuid.uuid4().hex[:12]}"
    record = {
        "op_id": op_id,
        "tx_type": "transfer",
        "event_id": tx.event_id,
        "ticket_id": tx.ticket_id,
        "from_pubkey": tx.from_pubkey,
        "to_pubkey": tx.to_pubkey,
        "reason": tx.reason,
        "signed_payload": tx.signed_payload,
        "signature": tx.signature,
    }
    r.rpush("pending_transactions", json.dumps(record))
    save_operation(op_id, {
        "status": "PENDING",
        "tx_type": "transfer",
        "event_id": tx.event_id,
        "ticket_id": tx.ticket_id,
        "submitted_at": str(time.time()),
    })
    return {"op_id": op_id, "status": "PENDING"}

@app.get("/ops/{op_id}")
def get_op(op_id: str):
    op = get_operation(op_id)
    if not op:
        raise HTTPException(status_code=404, detail="operation_not_found")
    return op

@app.get("/tickets/{ticket_id}/owner")
def get_ticket_owner(ticket_id: str):
    owner = r.get(f"ticket_owner:{ticket_id}")
    if not owner:
        raise HTTPException(status_code=404, detail="ticket_not_found")
    return {"ticket_id": ticket_id, "owner": owner}

@app.get("/tickets/owner/{pubkey}")
def get_tickets_by_owner(pubkey: str):
    ticket_ids = sorted(r.smembers(f"owner_tickets:{pubkey}"))
    return {"owner": pubkey, "ticket_ids": ticket_ids}

# ---------------------------------------------------------------------------
# Auto-miner: thread de fondo que dispara create-block cuando hay pending.
# Sin esto, las txs quedan colgadas para siempre porque create-block es
# manual. El thread vive en una réplica a la vez gracias al lock "minando".
# ---------------------------------------------------------------------------

AUTO_MINE_INTERVAL = 3  # segundos entre intentos

def auto_miner_loop():
    while True:
        try:
            time.sleep(AUTO_MINE_INTERVAL)
            pending = r.llen("pending_transactions")
            if pending == 0:
                continue
            # Llamar a la función de minado in-process (sin HTTP).
            try:
                _mine_one_block()
            except Exception as e:
                log.error(f"[auto-miner] error: {e}")
                r.rpush("logs", json.dumps({
                    "timestamp": time.time(),
                    "event": "auto_miner_error",
                    "error": str(e),
                }))
        except Exception as e:
            log.error(f"[auto-miner] loop error: {e}")
            r.rpush("logs", json.dumps({
                "timestamp": time.time(),
                "event": "auto_miner_loop_error",
                "error": str(e),
            }))

def _mine_one_block():
    """Versión interna de /create-block que también aplica los efectos
    ticket-aware al confirmar. Reutiliza la lógica de la API."""
    lock_token = acquire_mining_lock()
    if lock_token is None:
        return None
    NCT_MINING_ACTIVE.set(1)

    # Span raíz de la operación de minado. Todo lo que pase de acá en adelante
    # (incluido el viaje por TrP y los workers) cuelga de esta traza gracias a
    # la propagación del contexto que inyectamos en el payload de la tarea.
    mining_span_cm = tracer.start_as_current_span("mine_block")
    mining_span = mining_span_cm.__enter__()
    try:
        pending_raw = r.lrange("pending_transactions", 0, -1)
        if len(pending_raw) == 0:
            return None
        pending_count = len(pending_raw)
        pending_txs = [json.loads(x) for x in pending_raw]
        ultimo = get_last_block()
        difficulty = r.get("difficulty")
        block = {
            "index": r.llen("blockchain"),
            "timestamp": time.time(),
            "transactions": pending_txs,
            "previous_hash": ultimo["block_hash"],
        }
        data = json.dumps(block, sort_keys=True)
        task_id = str(uuid.uuid4())
        mining_span.set_attribute("task_id", task_id)
        mining_span.set_attribute("tx_count", pending_count)

        while True:
            result = safe_basic_get('soluciones')
            if result is None:
                break
            method, _, body = result
            safe_basic_ack(method.delivery_tag)
            if body is None:
                break

        tarea_completa = {
            "task_id": task_id,
            "difficulty": difficulty,
            "data": data,
            "start": 0,
            "end": TOTAL,
            # Contexto de traza W3C embebido en el payload: TrP lo extrae y
            # continúa la misma traza al subdividir/publicar a los workers.
            "_trace": obs.inject_trace_context(),
        }
        mine_start = time.time()
        safe_basic_publish('tareas_pool', json.dumps(tarea_completa))

        # Esperar solución.
        solucion = wait_for_solution(task_id, MINING_TIMEOUT_SECONDS, data=data, difficulty=difficulty)
        if solucion is None:
            return None
        nonce = solucion["nonce"]
        hash_recibido = solucion["hash"]
        # Verificamos contra la dificultad que le pedimos al worker, NO la
        # actual en Redis. Si el TrP cambió la dificultad (fallback CPU
        # activado/restaurado) mientras el worker minaba, su solución sigue
        # siendo válida para el contrato original. Releer aquí causaba
        # invalid_pow_solution espurios cuando el gpu-server flapeaba.
        if not verify_hash(data, nonce, hash_recibido, difficulty):
            calculated_debug = hashlib.md5((data + str(nonce)).encode()).hexdigest()
            r.rpush("logs", json.dumps({
                "timestamp": time.time(),
                "event": "pow_verify_failed_debug",
                "task_id": task_id,
                "nonce": nonce,
                "hash_recibido": hash_recibido,
                "hash_calculated": calculated_debug,
                "hashes_match": calculated_debug == hash_recibido,
                "difficulty_task": difficulty,
                "difficulty_now": r.get("difficulty"),
                "data_len": len(data),
                "data_sha256": hashlib.sha256(data.encode()).hexdigest(),
                "data_head": data[:200],
                "data_tail": data[-200:],
            }))
            for tx in pending_txs:
                if tx.get("op_id"):
                    mark_operation_failed(tx["op_id"], "invalid_pow_solution")
            r.ltrim("pending_transactions", pending_count, -1)
            return None

        block["nonce"] = nonce
        block["block_hash"] = hash_recibido
        if not validate_block(block, ultimo["block_hash"]):
            for tx in pending_txs:
                if tx.get("op_id"):
                    mark_operation_failed(tx["op_id"], "block_invalid")
            r.ltrim("pending_transactions", pending_count, -1)
            return None

        save_block(block)
        r.ltrim("pending_transactions", pending_count, -1)

        confirmed_at = time.time()
        NCT_BLOCKS.inc()
        NCT_MINING_SECONDS.observe(confirmed_at - mine_start)
        mining_span.set_attribute("block_index", block["index"])
        r.rpush("logs", json.dumps({
            "timestamp": confirmed_at,
            "event": "bloque_creado",
            "task_id": task_id,
            "index": block["index"],
            "hash": block["block_hash"],
            "tx_count": len(pending_txs),
        }))

        # Aplicar efectos ticket-aware sin ocultar que el bloque ya fue creado.
        for tx in pending_txs:
            try:
                apply_confirmed_tx(tx, block["index"], confirmed_at)
            except Exception as e:
                op_id = tx.get("op_id")
                if op_id:
                    mark_operation_failed(op_id, "apply_confirmed_tx_error")
                r.rpush("logs", json.dumps({
                    "timestamp": time.time(),
                    "event": "apply_confirmed_tx_error",
                    "task_id": task_id,
                    "op_id": op_id,
                    "tx_type": tx.get("tx_type"),
                    "error": str(e),
                }))

        purge_stale_solutions(task_id)
        return block
    finally:
        NCT_MINING_ACTIVE.set(0)
        mining_span_cm.__exit__(None, None, None)
        release_mining_lock(lock_token)

# ---------------------------------------------------------------------------
# Logs janitor: thread de fondo que acota la lista "logs" de Redis.
# La lista la escriben TODOS los servicios (NCT, TrP, workers) sobre la misma
# key, así que un solo trimmer acá la mantiene acotada para todos. Es su propio
# thread (no el del auto-miner) para que siga corriendo aún mientras un minado
# bloquea por hasta MINING_TIMEOUT_SECONDS. Sin esto la lista crecía sin límite
# y terminaba llenando la RAM de Redis -> OOM-kill -> se caía todo el sistema.
# ---------------------------------------------------------------------------
def logs_janitor_loop():
    while True:
        try:
            r.ltrim("logs", -MAX_LOGS, -1)
        except Exception as e:
            log.error(f"[logs-janitor] error: {e}")
        time.sleep(LOGS_TRIM_INTERVAL_SECONDS)

_logs_janitor_thread = threading.Thread(target=logs_janitor_loop, daemon=True, name="logs-janitor")
_logs_janitor_thread.start()

# Thread que refleja en Prometheus el estado que vive en Redis. Estos son
# gauges (valores instantáneos), no eventos, así que en vez de instrumentar
# cada endpoint los muestreamos cada pocos segundos desde una sola fuente.
METRICS_REFRESH_SECONDS = int(os.getenv("METRICS_REFRESH_SECONDS", "5"))

def metrics_updater_loop():
    while True:
        try:
            NCT_PENDING_TX.set(r.llen("pending_transactions"))
            NCT_BLOCKCHAIN_LEN.set(r.llen("blockchain"))
            diff = r.get("difficulty") or ""
            NCT_DIFFICULTY_ZEROS.set(len(diff))
            NCT_MINING_ACTIVE.set(1 if r.exists("minando") else 0)
        except Exception as e:
            log.warning(f"[metrics-updater] error: {e}")
        time.sleep(METRICS_REFRESH_SECONDS)

_metrics_updater_thread = threading.Thread(target=metrics_updater_loop, daemon=True, name="metrics-updater")
_metrics_updater_thread.start()

# Lanzar el auto-miner solo en el proceso principal (uvicorn).
_miner_thread = threading.Thread(target=auto_miner_loop, daemon=True, name="auto-miner")
_miner_thread.start()

# Devuelve el historial de eventos que todos los servicios van escribiendo.
@app.get("/logs")
def get_logs():
    logs = r.lrange("logs", 0, -1)
    return [json.loads(x) for x in logs]

# Liveness: solo confirma que el proceso uvicorn responde. NO toca Redis a
# propósito — si Redis está caído, el NCT no está "roto" (es Redis el que lo
# está), así que no queremos que k8s reinicie el NCT en bucle. Para eso está
# la readiness, que sí mira /status (saca al pod del Service mientras Redis no
# responda, sin matarlo).
@app.get("/healthz")
def healthz():
    return {"ok": True}

# Estado actual del sistema
@app.get("/status")
def status():
    return {
        "difficulty":    r.get("difficulty"),
        "total_bloques": r.llen("blockchain"),
        "pending_tx":    r.llen("pending_transactions"),
        "minando":       bool(r.exists("minando")),
    }
