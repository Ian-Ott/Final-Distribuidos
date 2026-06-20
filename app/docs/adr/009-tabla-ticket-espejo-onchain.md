# ADR-009: Tabla `Ticket` como espejo local del estado on-chain

**Estado**: Accepted
**Fecha**: 2026-06-20

## Contexto

Como el mock del NCT necesita estado persistente para soportar consultas read-only
([ADR-008](008-mock-nct-con-estado.md)), tenemos que decidir dónde y cómo guardarlo.

Hay tensión entre dos principios:

- La **blockchain debe ser la fuente de verdad** sobre quién es dueño de cada entrada. Si
  duplicamos esa info en nuestra DB, podemos desincronizarnos.
- El mock no tiene blockchain — tiene que vivir en algún lado.

## Decisión

Agregamos una tabla `Ticket` en Postgres con:

```
Ticket {
  id              cuid          // identificador único
  eventId         FK Event      // a qué evento pertenece
  ticketNumber    Int           // 1..ticketCount dentro del evento
  ownerPublicKey  String        // pubkey del dueño actual
  mintedAt        DateTime
  lastTransferAt  DateTime
  @@unique([eventId, ticketNumber])
  @@index([ownerPublicKey])
}
```

**Hoy** (mock): es la fuente de verdad. El mock escribe acá en cada mint/transfer.

**Mañana** (NCT real): pasa a ser un **cache/index local** de lo que vive on-chain. La fuente
de verdad será el NCT; la app puede consultar el cache para queries frecuentes (listar
entradas de un usuario, mostrar info en UI) y consultar el NCT para operaciones críticas
(validar dueño antes de aceptar una entrada en puerta).

Esto está documentado en el comentario del modelo en
[prisma/schema.prisma](../../prisma/schema.prisma).

## Consecuencias

### Positivas
- Permite que el flujo completo funcione contra el mock sin cambios en la app.
- La transición a NCT real es mecánica: el mismo código de lectura sigue funcionando, solo
  cambia la fuente de las escrituras.
- Las queries de lectura siguen siendo rápidas (Postgres local) incluso cuando se integre
  el NCT — evitamos round-trips para listados.

### Negativas
- Tiene riesgo de **desincronización** una vez integrado el NCT real. Si el NCT registra
  una transferencia y nuestra app no se entera, el cache miente.
- Para resolverlo: las operaciones críticas (validación en puerta) deben consultar al NCT
  directamente, no al cache. El cache sirve para UX (listados, vistas), no para autorización.

### Abiertas
- Cuando integremos el NCT real, definir un **mecanismo de sincronización del cache**:
  ¿webhook desde el NCT? ¿polling periódico? ¿reconstruir desde el NCT al arranque?
  A coordinar con el equipo de blockchain.

## Alternativas consideradas

### No persistir nada localmente, mock que vive en memoria
Se reinicia cada vez que reinicia el server, y no escala a múltiples instancias. Mal trade-off.

### Postgres con tabla `OnChainTransaction` que sea log append-only
Más fiel al modelo blockchain pero más complejo de consultar. La tabla `Ticket` actual es
materializada (estado actual), lo que hace las queries triviales.
