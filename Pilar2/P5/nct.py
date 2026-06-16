from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pika
import json
import time
import redis
import hashlib

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
channel.queue_declare(queue='tareas_pool')  # NCT → TrP
channel.queue_declare(queue='soluciones')   # Workers → NCT

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
# 4. Espera bloqueado hasta que algún worker publique una solución en [soluciones].
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
            _, _, body = channel.basic_get(queue='soluciones', auto_ack=True)
            if body is None:
                break

        # Publicar UNA tarea al TrP — él se encarga de subdividir
        tarea_completa = {
            "difficulty": difficulty,
            "data":       data,
            "start":      0,
            "end":        TOTAL
        }
        channel.basic_publish(
            exchange='',
            routing_key='tareas_pool',
            body=json.dumps(tarea_completa)
        )

        r.rpush("logs", json.dumps({
            "timestamp":  time.time(),
            "event":      "tarea_enviada_a_trp",
            "difficulty": difficulty
        }))

        # Esperar solución de cualquier worker
        body = None
        while body is None:
            _, _, body = channel.basic_get(queue='soluciones', auto_ack=True)
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