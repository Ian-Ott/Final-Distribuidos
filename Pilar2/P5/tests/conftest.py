import pytest
import pika


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