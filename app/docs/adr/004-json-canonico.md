# ADR-004: JSON canónico con keys ordenadas para firmar

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

Una firma ECDSA es sobre un array de bytes. Para firmar un objeto JavaScript hay que
serializarlo a bytes primero. El problema: `JSON.stringify` no garantiza orden de keys. Dos
objetos lógicamente iguales pueden serializarse distinto según cómo se construyeron:

```js
JSON.stringify({ a: 1, b: 2 })  // '{"a":1,"b":2}'
JSON.stringify({ b: 2, a: 1 })  // '{"b":2,"a":1}'  ← bytes distintos = firma distinta
```

Si el cliente serializa con un orden y el server con otro, la firma no verifica aunque el
contenido sea idéntico.

## Decisión

Toda serialización para firmar/verificar pasa por la función `canonicalize()` en
[src/lib/crypto/common.ts](../../src/lib/crypto/common.ts), que:

1. Ordena las keys de cada objeto alfabéticamente, recursivamente.
2. Serializa con `JSON.stringify` sin espacios.

Cliente y server llaman a la misma `canonicalize()` antes de firmar/verificar. La verificación
incluye la firma sobre `canonicalize(payload)`, no sobre el JSON crudo que llegó por la red.

## Consecuencias

### Positivas
- Mismo objeto → mismos bytes → misma firma, independientemente de cómo se construyó.
- Implementación trivial (~6 líneas).

### Negativas
- Es nuestra convención propia, no un estándar formal tipo JSON Canonicalization Scheme
  (RFC 8785). Si alguien externo verifica con JCS, no cuadraría.

### Abiertas
- **A confirmar con el equipo del NCT**: que ellos canonicalicen igual antes de verificar.
  Si ellos usan otro orden, otro escape de unicode, o serializan números de forma distinta
  (ej. `1.0` vs `1`), las firmas no verifican y nada del sistema funciona.
- Si se vuelve un problema cross-equipo, migrar a JCS (RFC 8785) que es un estándar y tiene
  implementaciones en muchos lenguajes.

## Alternativas consideradas

### Firmar el JSON tal como llega
Funciona si y solo si cliente y server siempre usan la misma serialización. Es frágil — un
día alguien usa una librería JSON distinta y todo se rompe.

### JSON Canonicalization Scheme (RFC 8785)
El estándar formal. Sería ideal a futuro, pero overkill para arrancar. Lo nuestro cubre el
99% de casos y es trivial de implementar en cualquier lenguaje.
