from fastapi import FastAPI
from pydantic import BaseModel
import subprocess
import json
import hashlib
import time

app = FastAPI()

# -------------------------
# MODELOS
# -------------------------

class MineRequest(BaseModel):
    difficulty: str
    data: str
    start: int
    end: int

class Transaction(BaseModel):
    sender: str
    receiver: str
    amount: float

# -------------------------
# BLOQUE
# -------------------------

pending_transactions = []
blockchain = []

genesis = {
    "index": 0,
    "timestamp": time.time(),
    "transactions": [],
    "previous_hash": "0",
    "nonce": 0,
    "hash": "GENESIS"
}

blockchain.append(genesis)

# -------------------------
# MINERÍA DIRECTA
# -------------------------

@app.post("/mine")
def mine(req: MineRequest):
    result = subprocess.run(
        [
            "./minero",
            req.data,         
            req.difficulty,   
            str(req.start),   
            str(req.end)      
        ],
        capture_output=True,
        text=True
    )

    return {
        "result": result.stdout
    }

# -------------------------
# TRANSACCIONES
# -------------------------

@app.post("/transaction")
def add_transaction(tx: Transaction):

    pending_transactions.append(tx.dict())

    return {
        "status": "stored",
        "count": len(pending_transactions)
    }

# -------------------------
# CREACIÓN DE BLOQUES
# -------------------------

def build_block():

    previous_hash = blockchain[-1]["hash"]

    block = {
        "index": len(blockchain),
        "timestamp": time.time(),
        "transactions": pending_transactions,
        "previous_hash": previous_hash
    }

    return block

@app.post("/create-block")
def create_block():

    if len(pending_transactions) == 0:
        return {
            "error": "No hay transacciones pendientes"
        }

    previous_hash = blockchain[-1]["hash"]

    block = {
        "index": len(blockchain),
        "timestamp": time.time(),
        "transactions": pending_transactions.copy(),
        "previous_hash": previous_hash
    }

    data = json.dumps(
        block,
        sort_keys=True
    )

    result = subprocess.run(
        [
            "./minero",
            data,
            "00",
            "0",
            "1000000"
        ],
        capture_output=True,
        text=True
    )
    print("STDOUT:")
    print(result.stdout)

    print("STDERR:")
    print(result.stderr)

    print("RETURN CODE:")
    print(result.returncode)

    salida = result.stdout

    nonce = None
    block_hash = None

    for linea in salida.splitlines():

        if linea.startswith("Nonce encontrado:"):
            nonce = int(linea.split(":")[1].strip())

        if linea.startswith("Hash resultante:"):
            block_hash = linea.split(":")[1].strip()

    if nonce is None or block_hash is None:
        return {
            "error": "No se encontró solución"
        }

    block["nonce"] = nonce
    block["hash"] = block_hash

    blockchain.append(block)

    pending_transactions.clear()

    return {
        "message": "Bloque agregado",
        "block": block
    }

#Endpoint para consultar la blockchain
@app.get("/chain")
def get_chain():

    return {
        "length": len(blockchain),
        "chain": blockchain
    }

#validacion
@app.get("/validate")
def validate_chain():

    for i in range(1, len(blockchain)):

        current = blockchain[i]
        previous = blockchain[i - 1]

        if current["previous_hash"] != previous["hash"]:
            return {
                "valid": False,
                "block": i
            }

    return {
        "valid": True
    }