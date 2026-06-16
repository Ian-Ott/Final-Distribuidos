# App — Plataforma de Entradas en Blockchain

Capa web (Frontend + Backend) del TP de Sistemas Distribuidos y Programación Paralela. Esta app
es la cara visible del sistema; la infraestructura de blockchain (NCT, workers de minería con
CUDA, RabbitMQ, Redis, despliegue en GKE) la construyen los otros equipos y vive en `Pilar1/` y
`Pilar2/` del monorepo.

## Qué hace

- Un **organizador** crea eventos y emite N entradas a la blockchain (cada entrada es un activo
  único con un dueño).
- Cualquiera ve los eventos publicados en `/events`.
- (Próximas iteraciones) comprador compra, validador escanea QR en la puerta y la entrada vuelve
  al organizador como transacción — así no puede usarse dos veces.

## Decisiones de diseño que conviene leer antes

1. **Identidad por par de claves ECDSA P-256.** El usuario no se identifica solo con email —
   tiene un par de claves generado en el navegador con WebCrypto. La pública es su "wallet
   address"; con la privada firma transacciones (emisión, compra, validación).
2. **Custodia híbrida.** Para soportar multi-dispositivo sin forzar al usuario a guardar una
   frase mnemónica, la clave privada se guarda en el backend **cifrada con una key derivada de
   la password del usuario** (PBKDF2-SHA256, 250k iteraciones, AES-GCM). La password nunca viaja
   en claro (bcrypt server-side) y la clave privada nunca está en claro server-side — todo el
   cifrado/descifrado ocurre en el browser.
3. **Validar = devolver al organizador**, no marcar "usada". Cuando el QR se escanea en puerta,
   se emite una transferencia que devuelve la entrada al organizador. La entrada deja de
   pertenecer al asistente, así que el mismo QR ya no sirve. (Esta parte queda para una
   iteración siguiente.)
4. **Compatibilidad ECDSA Node ↔ WebCrypto.** P-256, SHA-256, firmas en formato IEEE P1363 (raw,
   64 bytes). Ojo con esto si alguien intenta verificar firmas en otra librería que use DER
   — ver [Stack Overflow #39554165](https://stackoverflow.com/questions/39554165/) que motivó
   la elección.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind 4
- **Prisma 7** + Postgres (driver adapter `@prisma/adapter-pg`)
- **iron-session** para sesiones (cookie httpOnly)
- **WebCrypto** (cliente) / `node:crypto` (server) — ECDSA P-256, AES-GCM, PBKDF2
- **bcryptjs** para hash de password
- **Docker Compose** para orquestar app + Postgres

## Cómo correr

### Opción 1 — todo en Docker (recomendada)

```bash
docker compose up --build
# http://localhost:3000
```

Levanta Postgres + la app. El entrypoint espera la DB, corre `prisma migrate deploy` y arranca
`next start`. La password de sesión se puede overridear vía env (`SESSION_PASSWORD`).

### Opción 2 — dev local con hot reload

```bash
docker compose up -d postgres     # solo la DB
npm install
npx prisma migrate dev            # primera vez
npm run dev                       # http://localhost:3000
```

## Variables de entorno

Definidas en `.env` (local) y en `docker-compose.yml` (contenedor):

| Variable           | Default                                                          | Para qué                                           |
|--------------------|------------------------------------------------------------------|----------------------------------------------------|
| `DATABASE_URL`     | `postgres://entradas:entradas@localhost:5432/entradas`           | Conexión Postgres (lo lee `prisma.config.ts`)      |
| `SESSION_PASSWORD` | dev placeholder (mínimo 32 chars)                                | Cifrado del cookie de sesión (iron-session)        |
| `NCT_URL`          | `mock`                                                           | Endpoint del Nodo Coordinador. `mock` = loguea     |

## Estructura

```
src/
  app/
    (auth)/                    # /login, /register
    dashboard/                 # organizador: lista, crear, emitir
    events/                    # listado público + detalle
    api/
      auth/{login,logout,register}/
      me/                      # info de la sesión actual
      me/events/               # eventos del organizador logueado
      events/                  # CRUD eventos
      events/[id]/emit/...     # prepara payload + verifica firma + dispara NCT
  components/
    header-actions.tsx
  lib/
    db.ts                      # Prisma client (singleton + adapter pg)
    session.ts                 # iron-session config
    identity-store.ts          # cache en memoria de la clave privada desbloqueada (cliente)
    crypto/
      common.ts                # canonicalize, b64, randomBytes
      client.ts                # WebCrypto: generar par, derivar key, encrypt, sign
      server.ts                # verify con node:crypto.webcrypto
    nct/
      client.ts                # cliente HTTP del NCT (con mock)
prisma/
  schema.prisma                # User, Event
  migrations/                  # generadas por `prisma migrate dev`
docker/
  entrypoint.sh                # wait DB + migrate + start
scripts/
  test-ecdsa-roundtrip.mjs     # firma WebCrypto ↔ verify node:crypto
  smoke-e2e.mjs                # flujo completo register → create → emit
docker-compose.yml
Dockerfile
```

## Flujos principales

### Registro
1. Cliente pide email + password.
2. Cliente genera par ECDSA con WebCrypto, deriva una key AES-GCM con PBKDF2(password, salt),
   cifra la clave privada.
3. `POST /api/auth/register` con `{email, password, publicKey, encryptedPrivateKey, kdfSalt, kdfIv, role}`.
4. Server bcrypt-ea la password, persiste `User`, abre sesión.

### Login
1. `POST /api/auth/login` con `{email, password}`.
2. Server valida bcrypt, abre sesión, devuelve `{publicKey, encryptedPrivateKey, kdfSalt, kdfIv}`.
3. Cliente deriva la key con la password y descifra la privada. La guarda en memoria
   (`identity-store.ts`) — no en localStorage. Cerrar pestaña pierde la clave; hay que loguearse
   de nuevo.

### Crear y emitir evento (organizador)
1. `POST /api/events` → guarda `Event` con `status=DRAFT`.
2. `POST /api/events/{id}/emit/prepare` → devuelve el payload canónico a firmar.
3. Cliente firma con `crypto.subtle.sign(ECDSA, key, canonicalize(payload))`.
4. `POST /api/events/{id}/emit` con `{payload, signature}` → server verifica firma con la pubkey
   guardada, dispara `submitMintBatch()` al NCT, persiste `ncTBatchRef` y `status=EMITTED`.

### Validar entrada (próxima iteración)
Asistente abre la app, firma `{ticketId, timestamp}`. Validador escanea QR, manda al backend,
backend verifica firma + dueño + frescura, emite transferencia de vuelta al organizador.

## Integración con el NCT (lo de tus compañeros)

`src/lib/nct/client.ts` hoy hace mock — loguea la transacción y devuelve un `batchRef` fake. Para
conectarlo de verdad hay que acordar con el equipo de blockchain:

- **URL** del endpoint para publicar transacciones (`NCT_URL`).
- **Formato canónico** del payload a firmar — hoy uso JSON con keys ordenadas alfabéticamente
  (ver `canonicalize` en `src/lib/crypto/common.ts`). Si ellos usan otra serialización, la
  firma no va a verificar de su lado.
- **Modelo de batch de emisión**: ¿una tx con N outputs? ¿N transacciones independientes? ¿una
  "crear evento" más N "mint"?
- **Respuesta del NCT al aceptar**: qué identificador devuelve (id, hash, índice de bloque
  cuando esté minado).

## Verificación

```bash
# Roundtrip ECDSA WebCrypto ↔ node:crypto (no requiere DB ni server corriendo)
node scripts/test-ecdsa-roundtrip.mjs

# Flujo completo contra la app en localhost:3000
node scripts/smoke-e2e.mjs
```

`smoke-e2e.mjs` simula el navegador: genera par, registra organizador, crea evento, firma el
payload de emisión, dispara `emit`, lista eventos públicos, intenta re-emitir (debe rechazar).

## Fuera de alcance (todavía)

- Checkout con MercadoPago y asociación pago ↔ pubkey.
- Vista del validador en puerta (scanner de cámara + firma del asistente con timestamp).
- Reventa / transferencia entre usuarios.
- Recuperación de password (implicaría perder la clave privada — habría que ofrecer mnemonic
  backup opcional).
