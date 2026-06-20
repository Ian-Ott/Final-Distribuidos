# ADR-005: Validación en puerta = transferencia al organizador

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

En un sistema tradicional de entradas, "validar" significa marcar un campo `usada = true` y
verificar que ese campo esté en `false` antes de dejar entrar. Eso requiere mantener un
estado extra y proteger contra race conditions (dos validadores escaneando el mismo QR a la vez).

En una blockchain, no tenemos un campo mutable como ese — tenemos transferencias de
propiedad. ¿Cómo representamos "usado"?

## Decisión

Al escanear un QR válido en la puerta, **se emite una transacción que transfiere la entrada
de vuelta al organizador**. La unicidad emerge naturalmente de la propiedad on-chain:

- Antes del escaneo: dueño = asistente. El QR firmado por el asistente prueba posesión y
  verifica.
- Después del escaneo: dueño = organizador. El mismo QR firmado por el asistente sigue siendo
  criptográficamente válido, pero la consulta de dueño actual a la BC ya no devuelve al
  asistente → el sistema rechaza el ingreso.

No existe un flag "usada" en ninguna parte.

## Consecuencias

### Positivas
- Cero estado extra que mantener/proteger.
- Aprovecha lo que la blockchain ya ofrece (cadena de custodia).
- La concurrencia se resuelve sola: la primera tx de devolución gana; las siguientes fallan
  porque el asistente ya no es dueño.
- Auditable: el historial de propietarios de cada entrada está en la cadena.

### Negativas
- "Validar" cuesta una transacción on-chain → tiene latencia (esperar que se mine).
- Si la red está lenta y hay muchísima gente entrando, se forma un cuello de botella en el
  pool de transacciones.

### Abiertas
- ¿Cómo se firma la tx de devolución? Tres opciones a discutir con el equipo del NCT:
  1. La firma del asistente sobre el QR alcanza como autorización (el sistema lo interpreta
     como "delego al validador transferir").
  2. El validador también firma con una clave del staff.
  3. Una combinación de ambas.
- Manejo del caso "tx pendiente, no confirmada": ¿el validador acepta optimista (deja pasar
  y revierte si la tx falla) o pesimista (espera a confirmación)?

## Alternativas consideradas

### Campo "usada" en una DB tradicional sincronizada con la BC
Volvemos a tener doble fuente de verdad y race conditions. Si los dos lados se desincronizan,
hay problemas serios.

### Una NFT por entrada con metadata mutable
Más cerca del modelo Ethereum/ERC-721. Mucho más complejo y el TP no lo requiere.
