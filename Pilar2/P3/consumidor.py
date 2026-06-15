from fastapi import FastAPI
from pydantic import BaseModel

import pika
import json
import time
import redis

r = redis.Redis(
    host="redis",
    port=6379,
    decode_responses=True
)

app = FastAPI()



TOTAL = 1000000

WORKERS = 4

rango = TOTAL // WORKERS

if r.llen("blockchain")==0:

    genesis = {

        "index":0,

        "timestamp":time.time(),

        "transactions":[],

        "previous_hash":"0",

        "nonce":0,

        "hash":"GENESIS"
    }

    r.rpush(
        "blockchain",

        json.dumps(genesis)
    )


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
    transaccion = tx.dict()
    r.rpush(
    "pending_transactions",

    json.dumps(transaccion))

    evento = {

        "timestamp":time.time(),

        "event":"transaccion_recibida",

        "data":transaccion
    }

    r.rpush(

        "logs",

        json.dumps(evento)
    )


    return {"ok":True}


@app.post("/create-block")

def create_block():
    if r.exists("minando"):

        return {"error":"ya se esta minando un bloque"}

    r.set("minando",1)
    try:
        pending = r.lrange(
        "pending_transactions",
        0,
        -1
        )

        if len(pending)==0:

            return {"error":"sin transacciones"}
        
        pending = [

        json.loads(x)

        for x in pending
        ]   

        ultimo = json.loads(

            r.lindex(

                "blockchain",

                -1
            )
        )

        cantidad_bloques = r.llen(

        "blockchain"
        )

        

        block = {

            "index":cantidad_bloques,

            "timestamp":time.time(),

            "transactions":pending,

            "previous_hash":ultimo["hash"]
        }
        #limpiamos soluciones viejas
        while True:

            method, properties, body = channel.basic_get(

                queue='soluciones',

                auto_ack=True
            )

            if body is None:

                break

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

        r.rpush(

        "blockchain",

        json.dumps(block)
        )
        r.delete(
        "pending_transactions")

        evento = {

        "timestamp":time.time(),

        "event":"bloque_creado",

        "index":block["index"]
        }

        r.rpush(
            "logs",

            json.dumps(evento)
        )
    finally:
        r.delete("minando")
    

    return block


@app.get("/validate")

def validate():
    bloques = r.lrange(

        "blockchain",

        0,

        -1
    )
    bloques = [

        json.loads(x)

        for x in bloques
    ]

    for i in range(1, len(bloques)):

        actual = bloques[i]

        previo = bloques[i-1]

        if actual["previous_hash"] != previo["hash"]:

            return {"valid":False}


    return {"valid":True}

@app.get("/blockchain")

def get_blockchain():

    bloques = r.lrange(

        "blockchain",

        0,

        -1
    )

    return [

        json.loads(x)

        for x in bloques
    ]
