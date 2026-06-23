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
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.exceptions import InvalidSignature

# API REST que expone endpoints para el mundo exterior y coordina todo el proceso de creación de bloques.

def connect_redis():
    while True:
        try:
            client = redis.Redis(host="redis", port=6379, decode_responses=True)
            client.ping()
            return client
        except Exception:
            print("Esperando Redis...")
            time.sleep(3)

r = connect_redis()

app = FastAPI()

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
                    heartbeat=30,
                    blocked_connection_timeout=300
                )
            )
            return connection
        except Exception:
            print("Esperando RabbitMQ...")
            time.sleep(3)

connection = connect_rabbitmq()
channel = connection.channel()
channel.queue_declare(queue='tareas_pool')  # NCT → TrP
channel.queue_declare(queue='soluciones')   # Workers → NCT

def ensure_connection():
    """Verifica que la conexión y el canal sigan vivos; si no, reconecta."""
    global connection, channel
    try:
        if connection.is_closed or channel.is_closed:
            raise Exception("conexion cerrada")
        connection.process_data_events(time_limit=0)
    except Exception:
        print("Conexión a RabbitMQ perdida, reconectando...")
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
    ensure_connection()
    try:
        return channel.basic_get(queue=queue, auto_ack=True)
    except Exception as e:
        print(f"Error en basic_get, reconectando: {e}")
        ensure_connection()
        return channel.basic_get(queue=queue, auto_ack=True)

def safe_basic_publish(routing_key: str, body: str):
    """basic_publish con reconexión automática si la conexión se cayó."""
    global channel
    ensure_connection()
    try:
        channel.basic_publish(exchange='', routing_key=routing_key, body=body)
    except Exception as e:
        print(f"Error en basic_publish, reconectando: {e}")
        ensure_connection()
        channel.basic_publish(exchange='', routing_key=routing_key, body=body)

# -------------------------
# CONFIGURACION
# -------------------------

TOTAL = 10000000

if not r.exists("difficulty"):
    r.set("difficulty", "00")

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
    r.rpush("pending_transactions", json.dumps(transaccion))

    r.rpush("logs", json.dumps({
        "timestamp": time.time(),
        "event": "transaccion_recibida",
        "data": transaccion
    }))

    return {"ok": True, "pending": r.llen("pending_transactions")}

#Orquesta la creación de un nuevo bloque en la blockchain.
# 1. Adquiere un lock en Redis ("minando") para evitar que las 2 réplicas del NCT creen bloques simultáneamente y rompan la cadena.
# 2. Arma el bloque con las transacciones pendientes y el hash del bloque anterior, pero SIN nonce,
# ese es el desafío que van a resolver los workers.
# 3. Publica el bloque como tarea en [tareas_pool]. El TrP lo subdivide en chunks y los distribuye entre los workers GPU (o CPU en fallback).
# 4. Espera bloqueado hasta que algún worker publique una solución en [soluciones]. Antes de cada lectura/escritura a RabbitMQ
# se verifica la conexión (ensure_connection) para reconectar automáticamente si el canal se cayó por inactividad prolongada durante la espera.
# 5. Verifica que el hash recibido sea válido y cumpla la dificultad actual. Lee la dificultad de Redis en este momento, no al inicio, porque el TrP
# puede haberla reducido durante el minado si detectó que no había GPU.
# 6. Guarda el bloque en Redis de dos formas:
# - En la lista "blockchain" para recorrer la cadena en orden.
# - Como hash "block:N" para acceso directo por índice.
# 7. Libera el lock en el bloque finally, pase lo que pase.
@app.post("/create-block")
def create_block():
    if r.exists("minando"):
        return {"error": "ya se esta minando un bloque"}

    r.set("minando", 1)

    try:
        pending = r.lrange("pending_transactions", 0, -1)
        if len(pending) == 0:
            r.delete("minando")
            return {"error": "sin transacciones pendientes"}

        pending = [json.loads(x) for x in pending]
        ultimo  = get_last_block()
        difficulty = r.get("difficulty")

        block = {
            "index":         r.llen("blockchain"),
            "timestamp":     time.time(),
            "transactions":  pending,
            "previous_hash": ultimo["block_hash"]
        }

        data = json.dumps(block, sort_keys=True)

        # Limpiar soluciones viejas
        while True:
            result = safe_basic_get('soluciones')
            if result is None:
                break
            _, _, body = result
            if body is None:
                break

        # Publicar UNA tarea al TrP — él se encarga de subdividir
        tarea_completa = {
            "difficulty": difficulty,
            "data":       data,
            "start":      0,
            "end":        TOTAL
        }
        safe_basic_publish('tareas_pool', json.dumps(tarea_completa))

        r.rpush("logs", json.dumps({
            "timestamp":  time.time(),
            "event":      "tarea_enviada_a_trp",
            "difficulty": difficulty
        }))

        # Esperar solución de cualquier worker
        body = None
        while body is None:
            result = safe_basic_get('soluciones')
            if result is not None:
                _, _, body = result
            if body is None:
                time.sleep(0.5)

        solucion = json.loads(body)
        nonce         = solucion["nonce"]
        hash_recibido = solucion["hash"]

        # Verificar solución — usa la dificultad actual (puede haber cambiado si TrP activó fallback)
        difficulty_actual = r.get("difficulty")
        if not verify_hash(data, nonce, hash_recibido, difficulty_actual):
            r.rpush("logs", json.dumps({
                "timestamp": time.time(),
                "event":     "solucion_invalida",
                "nonce":     nonce,
                "hash":      hash_recibido
            }))
            raise HTTPException(status_code=400, detail="La solución recibida no es válida")

        block["nonce"]      = nonce
        block["block_hash"] = hash_recibido

        if not validate_block(block, ultimo["block_hash"]):
            raise HTTPException(status_code=400, detail="El bloque no es coherente con la cadena")

        save_block(block)
        r.delete("pending_transactions")

        r.rpush("logs", json.dumps({
            "timestamp": time.time(),
            "event":     "bloque_creado",
            "index":     block["index"],
            "hash":      block["block_hash"]
        }))

        return block

    finally:
        r.delete("minando")

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
        raise HTTPException(status_code=400, detail="invalid_signature")
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
            if r.exists("minando"):
                continue
            pending = r.llen("pending_transactions")
            if pending == 0:
                continue
            # Llamar a la función de minado in-process (sin HTTP).
            try:
                _mine_one_block()
            except Exception as e:
                print(f"[auto-miner] error: {e}")
        except Exception as e:
            print(f"[auto-miner] loop error: {e}")

def _mine_one_block():
    """Versión interna de /create-block que también aplica los efectos
    ticket-aware al confirmar. Reutiliza la lógica de la API."""
    if r.exists("minando"):
        return None
    r.set("minando", 1)
    try:
        pending_raw = r.lrange("pending_transactions", 0, -1)
        if len(pending_raw) == 0:
            return None
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

        while True:
            result = safe_basic_get('soluciones')
            if result is None:
                break
            _, _, body = result
            if body is None:
                break

        tarea_completa = {
            "difficulty": difficulty,
            "data": data,
            "start": 0,
            "end": TOTAL,
        }
        safe_basic_publish('tareas_pool', json.dumps(tarea_completa))

        # Esperar solución.
        body = None
        while body is None:
            result = safe_basic_get('soluciones')
            if result is not None:
                _, _, body = result
            if body is None:
                time.sleep(0.5)

        solucion = json.loads(body)
        nonce = solucion["nonce"]
        hash_recibido = solucion["hash"]
        difficulty_actual = r.get("difficulty")
        if not verify_hash(data, nonce, hash_recibido, difficulty_actual):
            for tx in pending_txs:
                if tx.get("op_id"):
                    mark_operation_failed(tx["op_id"], "invalid_pow_solution")
            r.delete("pending_transactions")
            return None

        block["nonce"] = nonce
        block["block_hash"] = hash_recibido
        if not validate_block(block, ultimo["block_hash"]):
            for tx in pending_txs:
                if tx.get("op_id"):
                    mark_operation_failed(tx["op_id"], "block_invalid")
            r.delete("pending_transactions")
            return None

        save_block(block)
        r.delete("pending_transactions")

        # Aplicar efectos ticket-aware.
        confirmed_at = time.time()
        for tx in pending_txs:
            apply_confirmed_tx(tx, block["index"], confirmed_at)

        r.rpush("logs", json.dumps({
            "timestamp": confirmed_at,
            "event": "bloque_creado",
            "index": block["index"],
            "hash": block["block_hash"],
            "tx_count": len(pending_txs),
        }))
        return block
    finally:
        r.delete("minando")

# Lanzar el auto-miner solo en el proceso principal (uvicorn).
_miner_thread = threading.Thread(target=auto_miner_loop, daemon=True, name="auto-miner")
_miner_thread.start()

# Devuelve el historial de eventos que todos los servicios van escribiendo.
@app.get("/logs")
def get_logs():
    logs = r.lrange("logs", 0, -1)
    return [json.loads(x) for x in logs]

# Estado actual del sistema
@app.get("/status")
def status():
    return {
        "difficulty":    r.get("difficulty"),
        "total_bloques": r.llen("blockchain"),
        "pending_tx":    r.llen("pending_transactions"),
        "minando":       bool(r.exists("minando")),
    }