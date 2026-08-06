from unittest.mock import patch
import trp

@patch("trp.scale_cpu_workers")
@patch("trp.r")
def test_fallback_activa_cpu(redis_mock, scale_mock):

    redis_mock.set.return_value = True
    redis_mock.get.return_value = "00"

    trp.activate_fallback()

    redis_mock.set.assert_any_call("difficulty", "0")

    scale_mock.assert_called_once_with(2)