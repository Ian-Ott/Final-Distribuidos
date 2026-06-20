# ADR-008: Mock del NCT con estado persistente

**Estado**: Accepted
**Fecha**: 2026-06-20

## Contexto

El NCT (Nodo Coordinador de Tareas) lo construye el otro equipo del TP. Mientras no esté
disponible, la app necesita poder:

- Demostrar el flujo end-to-end (crear → emitir → comprar → validar).
- Permitir al validador en puerta consultar "¿esta entrada es de este usuario ahora?".
- Soportar transferencias que cambien el dueño actual y que se reflejen en consultas futuras.

Un mock que solo loguea y devuelve `confirmed` (como teníamos al principio) **no alcanza**:
no hay forma de simular las consultas read-only que el validador va a hacer.

## Decisión

`src/lib/nct/client.ts` opera en dos modos según la env `NCT_URL`:

- `mock` (default en dev): las operaciones (`submitMintBatch`, `submitTransfer`) **escriben
  en la tabla `Ticket` de Postgres** (ver [ADR-009](009-tabla-ticket-espejo-onchain.md)).
  Las queries (`getTicketsByOwner`, `getTicketOwner`) leen de esa tabla.
- URL real del NCT: las operaciones llaman al endpoint HTTP del NCT por la red.

El mock se comporta como una blockchain funcional desde el punto de vista de la app.

## Consecuencias

### Positivas
- El equipo puede desarrollar y demostrar el flujo completo sin esperar al NCT real.
- Cuando el NCT real esté listo, el código de la app no cambia — solo cambia la env.
- Los tests E2E pueden correr contra el mock sin necesidad de infra de blockchain.

### Negativas
- El mock no simula latencia de minado, ni la diferencia entre `pending` y `confirmed`. Eso
  significa que cuando el NCT real entre, vamos a tener que agregar manejo de UI para esos
  estados intermedios (no es trivial).
- El mock no falla nunca (no simula caída del NCT, timeouts, rechazos de tx). Cuando se
  integre el NCT real, vamos a descubrir bugs de manejo de errores.

### Abiertas
- Próxima iteración del mock: agregar simulación de `pending → confirmed` con delay
  configurable, y probabilidad de fallo configurable. Esto está en el roadmap (sección F del
  [pasos-a-seguir.md](../oculto/pasos-a-seguir.md)) pero no implementado todavía.

## Alternativas consideradas

### Mock stateless que solo loguea
Era lo original. No permite demostrar la mitad del flujo (validación, compra).

### Esperar al NCT real
Bloquea al equipo de frontend/backend indefinidamente. Mal trade-off de tiempo.

### Levantar un servicio Node aparte que actúe como NCT fake
Más cercano a la realidad pero overkill por ahora. Si el código de la app crece y necesitamos
simular delays/fallos sofisticados, esto se vuelve la opción correcta.
