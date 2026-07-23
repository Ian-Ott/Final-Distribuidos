# Pasos para ejecutar locust

---
1. Ejecutar el siguiente comando
kubectl port-forward svc/blockchain-nct 8000:80 -n sdypp

Luego en maquina local:
locust -f locustfile.py --host=http://127.0.0.1:8000

2. Abrir interfaz de locust y seleccionar carga

http://localhost:8089
