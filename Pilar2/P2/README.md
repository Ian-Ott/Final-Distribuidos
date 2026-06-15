# Pasos para ejecutar el Hit 2
## 1. Requisitos

Tener instalado **Python 3**.

Verificar instalación:

```bash
python --version
```
Tener instalado **Docker**.

Verificar instalación:

```bash
docker --version
```
Instalar dependencias:

```bash
cd ./Integrador/Pilar2/P2
```

```
pip install -r requirements.txt
```
---
# 2. Seleccionar ubicacion del Hit 2
Abrir una terminal y ejecutar:
```bash
cd ./Integrador/Pilar2/P2
```
---
# 3. Aplicar servicios mediante kubernetes
```bash
cd ./k8s
```
---
```bash
kubectl apply -R -f .  
```
# 4. Habilitar port-forward

```bash
kubectl port-forward service/blockchain-consumidor 8000:80
```
---
# 5. probar API

```bash
http://localhost:8000/docs
```
---

# 6. Agregar transacciones

```bash
curl -X POST http://localhost:8000/transaction \
-H "Content-Type: application/json" \
-d '{
"sender":"Juan",
"receiver":"Pedro",
"amount":10
}'
```
Respuesta esperada:
{
  "ok": true
}
---

# 7. Crear Bloque

```bash
curl -X POST http://localhost:8000/create-block
```
---

