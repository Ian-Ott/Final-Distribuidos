import os
import sys

import pytest
import pika

BASE = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
)

sys.path.insert(0, BASE)

@pytest.fixture
def rabbitmq_channel():
    connection = pika.BlockingConnection(
        pika.ConnectionParameters(
            host="localhost",
            port=5672
        )
    )

    channel = connection.channel()

    yield channel

    connection.close()