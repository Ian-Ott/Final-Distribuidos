# ADR-001: Identidad por par de claves ECDSA P-256

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

El sistema necesita un mecanismo de identidad que sirva tanto para autenticación contra la app
como para firmar transacciones que se publican en la blockchain del NCT. Una identidad basada
solo en `email + password` no funciona contra la BC: la BC necesita que las operaciones
(emitir, transferir, validar) estén firmadas con una clave privada cuyo dueño es verificable
con una clave pública conocida.

El profesor confirmó esta dirección y compartió
[Stack Overflow #39554165](https://stackoverflow.com/questions/39554165/) como referencia.

## Decisión

Cada usuario tiene un **par de claves ECDSA P-256** generado en el navegador con WebCrypto.
La **clave pública** es su identidad on-chain (equivalente a una "wallet address"). La
**clave privada** se usa para firmar transacciones.

El email/password se mantiene como mecanismo de custodia y login (ver [ADR-002](002-custodia-hibrida-clave.md)),
pero NO es la identidad on-chain.

## Consecuencias

### Positivas
- El backend nunca puede falsificar operaciones a nombre del usuario.
- La identidad es portable: la misma pubkey representa al usuario en cualquier sistema que
  consuma la BC.
- Compatible con cualquier nodo de la red blockchain sin acuerdos previos.

### Negativas
- Si el usuario pierde acceso a su clave privada, pierde su identidad (ver [ADR-011](011-sin-recovery-password.md)).
- UX más compleja que un login tradicional — hay que explicar el modelo.

### Abiertas
- Cómo se firma una transferencia cuando el dueño no está online (ej: compra automática).
  Posibles soluciones: "operator key" delegada al organizador, pre-firma de permisos.
  A coordinar con el equipo del NCT.

## Alternativas consideradas

### Email + password como identidad (sin claves)
Lo descartamos porque rompe la promesa criptográfica del sistema: cualquier admin del backend
podría inventar transacciones a nombre de cualquier usuario.

### Wallet externa tipo MetaMask
UX desproporcionada para un TP académico, requiere que el usuario tenga una wallet instalada
antes de usar la app.
