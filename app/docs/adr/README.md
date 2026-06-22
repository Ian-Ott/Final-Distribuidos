# Architecture Decision Records (ADR)

Decisiones técnicas que afectan la app, con el contexto y el porqué.

## Por qué existe esto

Cuando alguien (un compa nuevo, vos dentro de 3 meses, el evaluador) abre el código y pregunta
"¿por qué esto es así?", la respuesta tiene que estar acá, no en la memoria de quien lo escribió.
Las ADRs son cortas, inmutables (no se editan, se reemplazan), y se numeran en orden.

## Cómo leer

| ADR | Título | Estado |
|---|---|---|
| [001](001-identidad-ecdsa.md) | Identidad por par de claves ECDSA P-256 | Accepted |
| [002](002-custodia-hibrida-clave.md) | Custodia híbrida de la clave privada | Accepted |
| [003](003-formato-firma-p1363.md) | ECDSA con curva P-256, SHA-256, formato IEEE P1363 | Accepted |
| [004](004-json-canonico.md) | JSON canónico con keys ordenadas para firmar | Accepted |
| [005](005-validacion-como-transferencia.md) | Validación en puerta = transferencia al organizador | Accepted |
| [006](006-stack-nextjs-fullstack.md) | Next.js como full-stack (no SPA + backend separado) | Accepted |
| [007](007-postgres-con-driver-adapter.md) | Postgres con driver adapter de Prisma 7 | Accepted |
| [008](008-mock-nct-con-estado.md) | Mock del NCT con estado persistente | Accepted |
| [009](009-tabla-ticket-espejo-onchain.md) | Tabla `Ticket` como espejo local del estado on-chain | Accepted |
| [010](010-sesiones-iron-session.md) | Sesiones server-side con iron-session | Accepted |
| [011](011-sin-recovery-password.md) | Sin recovery de password | Accepted |
| [012](012-tls-donde-cruza-internet.md) | TLS solo donde cruza redes no controladas | Accepted |
| [013](013-deploy-docker-compose.md) | Deploy con Docker Compose, no Vercel | Accepted |
| [014](014-qr-rotativo.md) | QR del asistente firmado con timestamp, rota cada 30s | Accepted |
| [015](015-reventa-entradas-validadas.md) | Reventa de entradas validadas | Accepted |
| [016](016-integracion-mercadopago.md) | Integración con MercadoPago (Checkout Pro) | Accepted |
| [017](017-reventa-p2p.md) | Reventa peer-to-peer entre asistentes (mock) | Accepted |
| [018](018-contrato-nct-ownership.md) | Contrato extendido del NCT (ownership de tickets + firma) | Accepted |

## Cómo escribir una nueva

Copiá [`_template.md`](_template.md), numerala como la siguiente (ej. `015-mi-decision.md`),
y agregala al índice de arriba. Reglas mínimas:

- **Título corto** (5-7 palabras), forma afirmativa.
- **Estado**: `Proposed` → `Accepted` → `Deprecated` o `Superseded by ADR-NNN`.
- **Contexto en una frase**: qué problema estábamos resolviendo.
- **Decisión en una frase**: qué elegimos.
- **Consecuencias** divididas en positivas/negativas/abiertas.
- **Alternativas consideradas** (al menos 1), con un párrafo cada una explicando por qué no.

Si una decisión cambia, **no edites la ADR vieja** — creás una nueva que la marque como
`Superseded`. Eso preserva el historial de pensamiento.

## Cuándo escribir una

Cuando tomamos una decisión que:

- Afecta la arquitectura o el modelo de datos.
- Tiene alternativas razonables que descartamos.
- Alguien razonablemente preguntaría "¿por qué así y no de otra forma?".

No hace falta ADR para: elegir una librería de UI menor, cambiar un color, agregar un campo
opcional, refactorizar internamente.
