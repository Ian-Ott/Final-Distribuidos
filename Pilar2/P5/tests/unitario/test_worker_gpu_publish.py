from unittest.mock import MagicMock

import worker


def test_publish_solution():

    fake_channel = MagicMock()

    fake_channel.basic_publish.return_value = None

    worker.channel = fake_channel

    fake_channel.basic_publish(
        exchange="",
        routing_key="soluciones",
        body="{}"
    )

    fake_channel.basic_publish.assert_called_once()