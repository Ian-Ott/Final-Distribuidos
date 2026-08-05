from unittest.mock import patch

import trp

@patch("trp.scale_cpu_workers")
@patch("trp.r")
def test_restore_gpu(redis_mock, scale_mock):

    redis_mock.delete.return_value = 1
    redis_mock.get.return_value = "00"

    trp.restore_from_fallback()

    redis_mock.set.assert_any_call("difficulty", "00")

    scale_mock.assert_called_once_with(0)