# ADR-003: ECDSA con curva P-256, SHA-256, formato IEEE P1363

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

Para que la app firme en el navegador (con WebCrypto) y el server verifique en Node, los dos
lados tienen que coincidir en exactamente tres cosas: **curva**, **hash** y **formato de la firma**.

El detalle no obvio es el formato: ECDSA tiene dos codificaciones en uso:

- **IEEE P1363 / "raw"**: 64 bytes para P-256 (32 de `r` + 32 de `s` concatenados). Es lo que
  WebCrypto produce y consume por default.
- **DER (ASN.1)**: 70-72 bytes con headers. Es lo que el `node:crypto` clásico
  (`crypto.sign`/`crypto.verify`) produce y consume por default.

Si firmás con WebCrypto y verificás con el `node:crypto` clásico, **la verificación falla
aunque la firma sea válida**, simplemente porque están hablando formatos distintos. Esto es lo
que el [Stack Overflow #39554165](https://stackoverflow.com/questions/39554165/) compartido
por el profesor advierte.

## Decisión

- **Curva**: P-256 (`secp256r1`).
- **Hash**: SHA-256.
- **Formato de firma**: IEEE P1363 raw (64 bytes).

Para lograr compatibilidad sin conversiones manuales, el server **no usa** el `node:crypto`
clásico — usa `node:crypto.webcrypto.subtle`, que es la implementación de Web Crypto API
estándar dentro de Node y habla el mismo formato que el browser.

Implementado en [src/lib/crypto/common.ts](../../src/lib/crypto/common.ts),
[src/lib/crypto/client.ts](../../src/lib/crypto/client.ts) y
[src/lib/crypto/server.ts](../../src/lib/crypto/server.ts).

## Consecuencias

### Positivas
- Cero conversiones manuales DER ↔ raw.
- El test [scripts/test-ecdsa-roundtrip.mjs](../../scripts/test-ecdsa-roundtrip.mjs) verifica
  el roundtrip en cada cambio.

### Negativas
- Si alguien en el futuro introduce una librería que use DER (algunas libs de JWS/JWT, algunas
  libs de ed25519/secp256k1, etc.) hay que convertir explícitamente.

### Abiertas
- El NCT real va a tener que usar también P-256 + SHA-256 + P1363. **A confirmar con el
  equipo de blockchain** antes de la integración real, o vamos a tener un día de "las firmas
  no cuadran".

## Alternativas consideradas

### Curva secp256k1 (la de Bitcoin/Ethereum)
Tiene mejor soporte en libs cripto, pero WebCrypto **no la soporta nativa**. Habría que usar
una lib JS pura, que es más lenta y más superficie de ataque. P-256 está en el navegador, fin.

### Firma en formato DER + conversión manual
Complica el código sin ganar nada. P1363 raw va directo.
