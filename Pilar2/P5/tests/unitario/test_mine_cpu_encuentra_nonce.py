import hashlib
import prometheus_client
prometheus_client.REGISTRY.clear()
from worker_cpu import mine_cpu


def test_mine_cpu_finds_nonce():

    data = "hola"

    difficulty = "0"

    nonce, h = mine_cpu(data, difficulty, 0, 50000)

    assert nonce is not None

    assert h.startswith("0")

    assert hashlib.md5((data + str(nonce)).encode()).hexdigest() == h