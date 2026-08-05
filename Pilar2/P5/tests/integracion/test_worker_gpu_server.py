import json
import responses
import worker

@responses.activate
def test_worker_gpu_llama_al_gpu_server():

    responses.add(
        responses.POST,
        worker.GPU_SERVER_URL,
        json={
            "stdout":
                "Nonce encontrado: 42\n"
                "Hash resultante: 0000abcd"
        },
        status=200
    )

    payload = {
        "difficulty": "0000",
        "data": "hola",
        "start": 0,
        "end": 1000
    }

    r = worker.requests.post(worker.GPU_SERVER_URL, json=payload)

    assert r.status_code == 200

    salida = r.json()["stdout"]

    assert "Nonce encontrado" in salida