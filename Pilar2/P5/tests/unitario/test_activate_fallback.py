from unittest.mock import MagicMock
import trp


def test_activate_fallback(monkeypatch):

    fake = MagicMock()

    fake.set.return_value = True

    fake.get.return_value = "00"

    monkeypatch.setattr(trp, "r", fake)

    monkeypatch.setattr(trp, "scale_cpu_workers", lambda x: None)

    assert trp.activate_fallback() is True