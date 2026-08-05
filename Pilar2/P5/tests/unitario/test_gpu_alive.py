from unittest.mock import MagicMock
import trp

def test_gpu_alive_true(monkeypatch):
    redis_mock = MagicMock()
    redis_mock.exists.return_value = 1

    monkeypatch.setattr(trp, "r", redis_mock)

    assert trp.is_gpu_server_alive() is True


def test_gpu_alive_false(monkeypatch):
    redis_mock = MagicMock()
    redis_mock.exists.return_value = 0

    monkeypatch.setattr(trp, "r", redis_mock)

    assert trp.is_gpu_server_alive() is False