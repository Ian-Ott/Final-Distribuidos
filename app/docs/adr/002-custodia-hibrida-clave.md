# ADR-002: Custodia híbrida de la clave privada

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

Tras decidir que la identidad es por par de claves ECDSA ([ADR-001](001-identidad-ecdsa.md)),
hay que resolver dónde vive la clave privada. Hay dos extremos:

1. **Solo en el navegador (IndexedDB)**: el server nunca la ve, pero el usuario pierde
   acceso al cambiar de dispositivo.
2. **En el server en claro**: multi-dispositivo trivial, pero el server puede firmar a nombre
   del usuario — rompe la promesa criptográfica.

Ninguno es aceptable. El usuario quiere poder loguearse desde la compu y desde el celu sin
manejar frases mnemónicas.

## Decisión

**Custodia híbrida**: el navegador genera el par ECDSA, deriva una key AES-GCM con
**PBKDF2-SHA256 / 250.000 iteraciones / sal aleatoria** a partir de la password del usuario,
cifra la clave privada con esa key, y manda al server solo el **ciphertext** (más el salt y
el IV). El server bcrypt-ea la password para auth normal y guarda todo.

En cada login, el server devuelve el ciphertext y el cliente lo descifra con la password.
La clave privada en claro **vive únicamente en memoria del navegador** (ver
[identity-store.ts](../../src/lib/identity-store.ts)), nunca en localStorage ni en el server.

## Consecuencias

### Positivas
- Multi-dispositivo funciona con UX de login tradicional.
- El server nunca tiene acceso al claro de la privada: aunque le roben la DB, los blobs son
  inservibles sin la password de cada usuario.
- PBKDF2 con 250k iteraciones hace inviable el brute-force offline contra el ciphertext.

### Negativas
- Si el usuario olvida la password, **la clave se pierde para siempre** (ver
  [ADR-011](011-sin-recovery-password.md)).
- Cerrar la pestaña pierde la clave de memoria — hay que loguearse de nuevo para firmar.
  (Esto es a propósito: minimiza la ventana en que un atacante con acceso físico pueda firmar.)

### Abiertas
- Si en el futuro se ofrece "recordame en este dispositivo", habría que guardar la clave
  desbloqueada en IndexedDB con timeout — decisión separada y posterior.

## Alternativas consideradas

### Mnemonic backup (12 palabras tipo MetaMask)
Más seguro y portable, pero UX horrible para usuarios no técnicos. Podría agregarse en el
futuro como opción adicional al registro.

### Clave en server cifrada con una key del server
No agrega seguridad real — si el server puede descifrar, puede firmar.
