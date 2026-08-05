from unittest.mock import MagicMock

import trp


def test_publish_chunks(monkeypatch):

    published = []

    fake_channel = MagicMock()

    fake_channel.basic_publish.side_effect = lambda **kwargs: published.append(kwargs)

    monkeypatch.setattr(trp, "channel", fake_channel)

    tarea = {

        "task_id": "1",

        "difficulty": "00",

        "data": "hola",

        "start": 0,

        "end": 9999999

    }

    trp.subdivide_and_publish(tarea)

    assert len(published) == 4