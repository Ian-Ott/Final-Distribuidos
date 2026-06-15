from fastapi import FastAPI
from pydantic import BaseModel

import pika
import json
import time

app = FastAPI()

pending_transactions = []

blockchain = []

TOTAL = 1000000

WORKERS = 4

rango = TOTAL // WORKERS

genesis = {
    "index":0,
    "timestamp":time.time(),
    "transactions":[],
    "previous_hash":"0",
    "nonce":0,
    "hash":"GENESIS"
}

blockchain.append(genesis)


class Transaction(BaseModel):

    sender:str

    receiver:str

    amount:float


connection = pika.BlockingConnection(
    pika.ConnectionParameters("rabbitmq")
)

channel = connection.channel()


channel.queue_declare(
    queue='tareas'
)

channel.queue_declare(queue='soluciones')


@app.post("/transaction")

def transaction(tx:Transaction):

    pending_transactions.append(tx.dict())

    return {"ok":True}


@app.post("/create-block")

def create_block():

    if len(pending_transactions)==0:

        return {"error":"sin transacciones"}

    block = {

        "index":len(blockchain),

        "timestamp":time.time(),

        "transactions":pending_transactions.copy(),

        "previous_hash":blockchain[-1]["hash"]
    }

    for i in range(WORKERS):

        inicio = i * rango

        if i == WORKERS-1:

            fin = TOTAL

        else:

            fin = (i+1)*rango - 1

        tarea = {

            "difficulty":"00",

            "data":json.dumps(block),

            "start":inicio,

            "end":fin
        }

        channel.basic_publish(
        exchange='',
        routing_key='tareas',
        body=json.dumps(tarea)
    )
    body = None
    while body is None:

        method, properties, body = channel.basic_get(
            queue='soluciones',
            auto_ack=True
        )

        if body is None:

            time.sleep(1)
    solucion = json.loads(body)

    block["nonce"] = solucion["nonce"]

    block["hash"] = solucion["hash"]

    blockchain.append(block)

    pending_transactions.clear()

    return block


@app.get("/validate")

def validate():

    for i in range(1,len(blockchain)):

        actual = blockchain[i]

        previo = blockchain[i-1]

        if actual["previous_hash"] != previo["hash"]:

            return {"valid":False}

    return {"valid":True}

@app.get("/blockchain")
def get_blockchain():

    return {

        "total_bloques":len(blockchain),

        "blockchain":blockchain
    }