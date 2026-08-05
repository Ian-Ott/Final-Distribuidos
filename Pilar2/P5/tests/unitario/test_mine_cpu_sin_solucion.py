import prometheus_client
prometheus_client.REGISTRY.clear()
from worker_cpu import mine_cpu


def test_mine_cpu_without_solution():

    nonce, h = mine_cpu(
        "abc",
        "0000000000",
        0,
        10
    )

    assert nonce is None

    assert h is None