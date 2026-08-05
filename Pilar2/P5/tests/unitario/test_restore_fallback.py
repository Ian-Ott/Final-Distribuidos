from unittest.mock import MagicMock
import prometheus_client
prometheus_client.REGISTRY.clear()
import trp


def test_restore(monkeypatch):

    fake = MagicMock()

    fake.delete.return_value = 1

    fake.get.return_value = "00"

    monkeypatch.setattr(trp, "r", fake)

    monkeypatch.setattr(trp, "scale_cpu_workers", lambda x: None)

    assert trp.restore_from_fallback() is True