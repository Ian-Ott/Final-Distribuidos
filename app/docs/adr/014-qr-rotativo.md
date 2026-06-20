# ADR-014: QR del asistente firmado con timestamp, rota cada 30s

**Estado**: Accepted
**Fecha**: 2026-06-20

## Contexto

El asistente tiene que presentar algún tipo de "credencial" al validador en la puerta del
evento. El validador escanea, verifica que el portador es el dueño legítimo, y dispara la
transferencia de devolución ([ADR-005](005-validacion-como-transferencia.md)).

Hay varias formas de armar esa credencial:

1. **QR estático con el ID de la entrada**: cualquiera con el ID puede intentar pasar.
2. **QR con ID + firma del dueño** sobre un payload fijo: alguien que vea el QR un rato antes
   puede tomar una foto y replay.
3. **QR firmado con un timestamp fresco** que rota cada N segundos: el replay tiene una
   ventana muy corta para ser explotable.

## Decisión

El QR contiene:

```json
{
  "payload": {
    "v": 1,
    "type": "ticket_proof",
    "ticketId": "...",
    "publicKey": "...",
    "issuedAt": "<ISO timestamp>"
  },
  "signature": "<firma ECDSA del payload con la privada del dueño>"
}
```

El componente del cliente ([src/components/ticket-qr.tsx](../../src/components/ticket-qr.tsx))
**re-firma cada 30 segundos**, generando un nuevo `issuedAt` y por lo tanto un nuevo QR. El
validador en puerta rechaza QRs con `issuedAt` más viejo que ~1 minuto (margen de tolerancia
para clock skew y latencia).

## Consecuencias

### Positivas
- Una foto del QR sirve durante ~1 minuto y después se invalida sola — ventana de replay
  acotada.
- Prueba real de posesión: solo quien tiene la privada desbloqueada puede firmar el
  timestamp fresco.
- No requiere coordinación con el validador (no necesita challenge-response).

### Negativas
- Requiere que la app del asistente esté abierta y activa para regenerar el QR — si pone el
  celu en bloqueo justo antes de la puerta, el QR puede estar al borde de vencer.
- Necesita la clave privada desbloqueada en memoria, así que el asistente tiene que haberse
  logueado en ese dispositivo recientemente.

### Abiertas
- Ventana de tolerancia exacta: ¿1 minuto? ¿30 segundos? ¿2 minutos? La elegimos cuando
  implementemos el endpoint de validación en el Sprint 2.
- Si los relojes del browser y el server divergen mucho, hay falsos rechazos. Considerar
  pedir al server un timestamp en la respuesta y usarlo como referencia.

## Alternativas consideradas

### QR estático con solo el ticketId
Trivial de replay-ear, no prueba posesión de la privada. Mal.

### Challenge-response: el validador genera un challenge, el asistente lo firma
Más seguro pero requiere que el validador y el asistente hablen entre sí (NFC, bluetooth, o
QR bidireccional). Demasiado overhead UX para el TP.

### QR rotativo con TOTP (cada 30s, deterministic)
Equivalente en seguridad al nuestro, requeriría un secret compartido y derivación de
contadores. Lo nuestro es más simple y aprovecha que ya tenemos firma ECDSA.
