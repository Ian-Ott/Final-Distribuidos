from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pika
import json
import time
import redis
import hashlib
import time

# -------------------------
# CONEXIONES
# -------------------------

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

def connect_rabbitmq():
    while True:
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq"))
            return connection
        except Exception:
            print("Esperando RabbitMQ...")
            time.sleep(3)

connection = connect_rabbitmq()
channel = connection.channel()
channel.queue_declare(queue='tareas')
channel.queue_declare(queue='soluciones')

# -------------------------
# CONFIGURACION DINAMICA
# -------------------------

TOTAL    = 10000000
WORKERS  = 4
rango    = TOTAL // WORKERS

# Dificultad inicial — se puede cambiar via endpoint
if not r.exists("difficulty"):
    r.set("difficulty", "00")

# -------------------------
# GENESIS
# -------------------------

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

# -------------------------
# HELPERS
# -------------------------

def verify_hash(data: str, nonce: int, expected_hash: str, difficulty: str) -> bool:
    """
    Verifica que MD5(data + nonce) empiece con el prefijo de dificultad
    y que coincida con el hash reportado por el worker.
    """
    text = data + str(nonce)
    calculated = hashlib.md5(text.encode()).hexdigest()
    return calculated == expected_hash and calculated.startswith(difficulty)

def validate_block(block: dict, previous_hash: str) -> bool:
    """
    Valida que el bloque tenga todos los campos requeridos
    y que su previous_hash sea correcto.
    """
    required_fields = ["index", "timestamp", "transactions", "previous_hash", "nonce", "block_hash"]
    for field in required_fields:
        if field not in block:
            return False
    return block["previous_hash"] == previous_hash

def get_last_block() -> dict:
    raw = r.lindex("blockchain", -1)
    return json.loads(raw)

def save_block(block: dict):
    """
    Guarda el bloque de dos formas en Redis:
    1. En la lista "blockchain" como JSON (para recorrer la cadena)
    2. Como hash de Redis con campos separados (como pide la consigna NCT.4)
    """
    # Lista general
    r.rpush("blockchain", json.dumps(block))

    # Hash con campos separados — clave: "block:{index}"
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

@app.post("/transaction")
def transaction(tx: Transaction):
    """Recibe una transacción y la agrega al pool de pendientes."""
    transaccion = tx.dict()
    r.rpush("pending_transactions", json.dumps(transaccion))

    evento = {
        "timestamp": time.time(),
        "event": "transaccion_recibida",
        "data": transaccion
    }
    r.rpush("logs", json.dumps(evento))

    return {"ok": True, "pending": r.llen("pending_transactions")}


@app.post("/create-block")
def create_block():
    """
    NCT.1 — Publica tareas de minería en RabbitMQ.
    NCT.2 — Espera que un worker encuentre la solución.
    NCT.3 — Verifica la solución antes de aceptarla.
    NCT.4 — Almacena el bloque en Redis.
    """
    if r.exists("minando"):
        return {"error": "ya se esta minando un bloque"}

    r.set("minando", 1)

    try:
        pending = r.lrange("pending_transactions", 0, -1)
        if len(pending) == 0:
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
            _, _, body = channel.basic_get(queue='soluciones', auto_ack=True)
            if body is None:
                break

        # NCT.1 — Publicar tareas dividiendo el rango entre workers
        for i in range(WORKERS):
            inicio = i * rango
            fin    = TOTAL if i == WORKERS - 1 else (i + 1) * rango - 1

            tarea = {
                "difficulty": difficulty,
                "data":       data,
                "start":      inicio,
                "end":        fin
            }
            channel.basic_publish(
                exchange='',
                routing_key='tareas',
                body=json.dumps(tarea)
            )

        r.rpush("logs", json.dumps({
            "timestamp": time.time(),
            "event":     "tareas_publicadas",
            "workers":   WORKERS,
            "difficulty": difficulty
        }))

        # NCT.2 — Esperar solución
        body = None
        while body is None:
            _, _, body = channel.basic_get(queue='soluciones', auto_ack=True)
            if body is None:
                time.sleep(0.5)

        solucion = json.loads(body)

        # NCT.3 — Verificar que la solución es válida
        nonce         = solucion["nonce"]
        hash_recibido = solucion["hash"]

        if not verify_hash(data, nonce, hash_recibido, difficulty):
            r.rpush("logs", json.dumps({
                "timestamp": time.time(),
                "event":     "solucion_invalida",
                "nonce":     nonce,
                "hash":      hash_recibido
            }))
            raise HTTPException(status_code=400, detail="La solución recibida no es válida")

        block["nonce"]      = nonce
        block["block_hash"] = hash_recibido

        # Validar coherencia con la cadena antes de guardar
        if not validate_block(block, ultimo["block_hash"]):
            raise HTTPException(status_code=400, detail="El bloque no es coherente con la cadena")

        # NCT.4 — Guardar en Redis
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


@app.get("/blockchain")
def get_blockchain():
    """Devuelve toda la cadena de bloques."""
    bloques = r.lrange("blockchain", 0, -1)
    return [json.loads(x) for x in bloques]


@app.get("/block/{index}")
def get_block(index: int):
    """
    Devuelve un bloque por índice usando el hash de Redis
    con campos separados (estructura NCT.4).
    """
    key = f"block:{index}"
    if not r.exists(key):
        raise HTTPException(status_code=404, detail="Bloque no encontrado")

    block = r.hgetall(key)
    block["transactions"] = json.loads(block["transactions"])
    return block


@app.get("/validate")
def validate():
    """Valida la integridad completa de la cadena."""
    bloques = r.lrange("blockchain", 0, -1)
    bloques = [json.loads(x) for x in bloques]

    for i in range(1, len(bloques)):
        actual  = bloques[i]
        previo  = bloques[i - 1]

        # Verificar encadenamiento
        if actual["previous_hash"] != previo["block_hash"]:
            return {"valid": False, "error": f"bloque {i} tiene previous_hash incorrecto"}

        # Verificar que el hash del bloque es válido
        data = json.dumps({
            "index":        actual["index"],
            "timestamp":    actual["timestamp"],
            "transactions": actual["transactions"],
            "previous_hash": actual["previous_hash"]
        }, sort_keys=True)

        difficulty = r.get("difficulty")
        if not verify_hash(data, actual["nonce"], actual["block_hash"], difficulty):
            return {"valid": False, "error": f"bloque {i} tiene hash invalido"}

    return {"valid": True, "total_bloques": len(bloques)}


@app.get("/difficulty")
def get_difficulty():
    """Devuelve la dificultad actual."""
    return {"difficulty": r.get("difficulty")}


@app.post("/difficulty")
def set_difficulty(req: DifficultyRequest):
    """
    Cambia la dificultad del PoW dinamicamente.
    La dificultad es el prefijo que debe tener el hash (ej: '000').
    """
    if not all(c == '0' for c in req.difficulty):
        raise HTTPException(status_code=400, detail="La dificultad debe ser solo ceros (ej: '000')")

    r.set("difficulty", req.difficulty)

    r.rpush("logs", json.dumps({
        "timestamp":  time.time(),
        "event":      "dificultad_cambiada",
        "difficulty": req.difficulty
    }))

    return {"ok": True, "difficulty": req.difficulty}


@app.get("/logs")
def get_logs():
    """Devuelve el historial de eventos del sistema."""
    logs = r.lrange("logs", 0, -1)
    return [json.loads(x) for x in logs]


@app.get("/status")
def status():
    """Estado general del NCT."""
    return {
        "difficulty":        r.get("difficulty"),
        "total_bloques":     r.llen("blockchain"),
        "pending_tx":        r.llen("pending_transactions"),
        "minando":           bool(r.exists("minando")),
        "workers":           WORKERS
    }