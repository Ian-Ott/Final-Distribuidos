from unittest.mock import patch, mock_open
import json
import prometheus_client
prometheus_client.REGISTRY.clear()
import trp

@patch("urllib.request.urlopen")
@patch("ssl.create_default_context")
def test_scale_cpu_workers(mock_ssl, mock_urlopen):

    token = mock_open(read_data="TOKEN")

    with patch("builtins.open", token):

        trp.scale_cpu_workers(2)

    request = mock_urlopen.call_args.args[0]

    body = json.loads(request.data.decode())

    assert body == {
        "spec": {
            "replicas": 2
        }
    }

    assert request.method == "PATCH"