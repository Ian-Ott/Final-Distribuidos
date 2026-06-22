# ADR-018: Contrato extendido del NCT (ownership de tickets + firma)

**Estado:** Aceptada
**Fecha:** 2026-06-21

## Contexto

Hasta ahora la app web corría contra un **mock interno** del NCT (ver
[ADR-008](008-mock-nct-con-estado.md) y [`src/lib/nct/client.ts`](../../src/lib/nct/client.ts)).
El mock soporta dos operaciones — `mint_batch` y `transfer` — con verificación
de firma y un índice de ownership por `ticket_id`.

El NCT real (`Pilar2/P5/nct.py`) que desplegamos en el cluster del profe tiene
un modelo distinto: una blockchain genérica de transferencias
`{sender, receiver, amount}`, sin concepto de ticket, sin firma. Si dejamos el
NCT como está, nuestra app no puede usarlo: no hay forma de preguntar "¿quién
es el dueño actual del ticket #42?" ni de evitar que cualquiera mande una tx
falsa firmando con la clave de otro.

## Decisión

**Extendemos el NCT** con un set de endpoints "ticket-aware" que conviven con
los existentes. La capa de PoW + RabbitMQ + workers GPU sigue igual; lo que
cambia es lo que va dentro de las transacciones y cómo se materializa el
estado.

### Endpoints nuevos (los que la app web usa)

| Método | Path | Para |
|---|---|---|
| `POST` | `/tx/mint` | Emitir N tickets de un evento al organizador |
| `POST` | `/tx/transfer` | Transferir un ticket entre dos pubkeys |
| `GET` | `/ops/{op_id}` | Status de una operación (PENDING/CONFIRMED/FAILED) |
| `GET` | `/tickets/{ticket_id}/owner` | Pubkey del dueño actual |
| `GET` | `/tickets/owner/{pubkey}` | Lista de ticket_ids que tiene una pubkey |

Los endpoints existentes (`POST /transaction`, `POST /create-block`,
`GET /blockchain`, `GET /block/{i}`, `GET /validate`, `GET /difficulty`,
`GET /status`, `GET /logs`) **no se tocan** — siguen funcionando como antes
para que cualquier consumidor genérico de la BC no se rompa.

### Schema de las transacciones extendidas

```json
{
  "op_id": "ck-abc123",
  "tx_type": "mint" | "transfer",
  "event_id": "evt-xyz",
  "ticket_id": "tk-42",        // solo en transfer
  "ticket_count": 100,          // solo en mint
  "from_pubkey": "BASE64...",   // solo en transfer
  "to_pubkey": "BASE64...",
  "reason": "purchase|validation|resale",  // solo en transfer
  "signed_payload": { ... },    // el objeto que se firmó
  "signature": "BASE64..."      // ECDSA P-256 sobre canonicalize(signed_payload)
}
```

### Formato de firma (alinea con la app)

- **Curva**: P-256 (secp256r1)
- **Hash**: SHA-256
- **Formato de firma**: IEEE P1363 (raw `r||s`, 64 bytes), base64
- **Public key**: SPKI DER, base64
- **Canonicalización**: JSON con keys ordenadas alfabéticamente
  (implementación en `app/src/lib/crypto/common.ts::canonicalize`)

El NCT verifica la firma de cada tx antes de aceptarla en el pending pool.
Si la firma no cuadra, devuelve `400`.

Para la firma de `transfer`, la pubkey que debe haber firmado es
`from_pubkey` (el dueño actual). Para `mint`, es la pubkey del organizador
(que recibe los tickets).

### Modelo async (consistente con nuestro mock)

1. `POST /tx/*` valida firma + ownership y **acepta inmediatamente** con
   `202 Accepted` + `{op_id, status: "PENDING"}`.
2. La tx queda en `pending_transactions` con el `op_id` adentro.
3. Un thread de fondo en el NCT dispara `create-block` cuando hay pending y
   nadie está minando (cada ~3s).
4. Cuando el bloque se mina, todas las txs adentro pasan a `CONFIRMED`,
   se actualiza el índice de ownership en Redis y se guarda
   `op:{op_id} → {status, block_index, confirmed_at}`.
5. La app web polea `GET /ops/{op_id}` para enterarse.

### Estado en Redis (nuevo)

| Clave | Tipo | Contenido |
|---|---|---|
| `op:{op_id}` | hash | `{status, block_index, confirmed_at, error_code, tx_type, ticket_id?, event_id}` |
| `ticket_owner:{ticket_id}` | string | pubkey base64 del dueño actual |
| `owner_tickets:{pubkey}` | set | conjunto de ticket_ids que tiene esa pubkey |
| `tickets_by_event:{event_id}` | set | conjunto de ticket_ids del evento |

Los existentes (`blockchain`, `pending_transactions`, `block:N`, `difficulty`,
`logs`, `minando`) no se tocan.

## Cómo cambia el flujo end-to-end

1. **Emitir evento**: app envía `POST /tx/mint` firmado por el organizador
   con `ticket_count=N` → NCT responde 202 + op_id → app guarda op_id, marca
   evento como `MINTING` → app polea hasta `CONFIRMED` → marca evento
   `EMITTED` y materializa N filas en su tabla local `Ticket`.
2. **Comprar entrada**: webhook MP confirma pago → app envía
   `POST /tx/transfer` firmado por el organizador con `reason=purchase` →
   NCT responde 202 + op_id → app polea hasta `CONFIRMED` → reflejado en UI.
3. **Validar entrada**: validador escanea QR firmado por el asistente → app
   envía `POST /tx/transfer` firmado por el asistente con `reason=validation`
   → NCT responde 202 → app polea → marca `validatedAt` (ADR-015).
4. **Reventa P2P**: webhook MP confirma → app envía `POST /tx/transfer`
   firmado por el vendedor con `reason=resale` (ver ADR-017 para el problema
   abierto de "vendedor offline").

## Verificación de firma del lado del NCT (Python)

Usamos `cryptography` (paquete estándar de Python) para verificar:

```python
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

def verify_signature(pubkey_b64, payload_dict, signature_b64):
    pubkey_der = base64.b64decode(pubkey_b64)
    sig_raw = base64.b64decode(signature_b64)  # P1363: 64 bytes (r||s)
    r = int.from_bytes(sig_raw[:32], "big")
    s = int.from_bytes(sig_raw[32:], "big")
    sig_der = encode_dss_signature(r, s)
    key = load_der_public_key(pubkey_der)
    msg = canonicalize(payload_dict).encode("utf-8")
    try:
        key.verify(sig_der, msg, ec.ECDSA(hashes.SHA256()))
        return True
    except Exception:
        return False
```

## Cosas que decidimos NO cambiar del NCT

- El algoritmo de PoW (md5 + leading zeros) sigue igual.
- El TrP y los workers GPU no se enteran del cambio: siguen recibiendo
  bloques opacos como antes.
- La estructura del bloque sigue siendo
  `{index, timestamp, transactions, previous_hash, nonce, block_hash}`.
- El endpoint `POST /create-block` sigue existiendo y es manual; el thread
  de auto-mining usa la misma función internamente.

## Alternativas evaluadas

| Opción | Pro | Contra |
|---|---|---|
| **A. Pedirle al NCT cambios** (elegida) | Modelo limpio, firmas válidas, ownership trivial | Toca código del compañero |
| **B. Adaptar la app al modelo amount-only** | No tocamos su código | Perdemos firmas, ownership cuesta O(N) por query |
| **C. Híbrido (DB local + ancla en BC)** | Compromiso | La BC pasa a ser decorativa, no aporta |

## Consecuencias

- **Positivas**
  - Los workers GPU del profe efectivamente minan **nuestras** transacciones
    con datos reales — eso es lo que pide el TP.
  - La firma ECDSA tiene valor real (el NCT la verifica), no es cosmética.
  - La validación en puerta consulta la BC para saber el dueño actual.
- **Negativas**
  - Si el equipo BC quiere usar la BC para otra cosa con un schema distinto,
    los dos modelos tienen que convivir.
  - Verificación de firma en Python suma latencia (~1ms por tx) — despreciable.
- **Abiertas**
  - **Operator key / pre-firma para reventa**: ver ADR-017. No se resuelve
    acá porque depende de UX, no de la BC.
  - **Re-aplicar ownership desde la BC en arranque**: si Redis se cae y se
    recupera vacío, hoy perdemos el índice. Solución: re-scanear la cadena al
    arrancar y reconstruir los índices. Lo dejamos para una iteración futura.
