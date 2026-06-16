@AGENTS.md

# Contexto del proyecto

Este es el **subproyecto `app/`** del TP de SDyPP — la **capa web** (Frontend + Backend en el
diagrama de arquitectura). La blockchain propia (Nodo Coordinador de Tareas / NCT, workers de
minería con Proof of Work + CUDA, RabbitMQ, Redis, despliegue en GKE) la construyen los otros
equipos del grupo en `../Pilar1/` y `../Pilar2/`. **No tocar esas carpetas desde acá.**

## Qué tiene que hacer la app

Gestión y validación de entradas a eventos donde cada entrada es un activo único en la
blockchain del NCT. MVP actual = **CRUD de eventos por organizador + emisión firmada a la BC**.
Compra (MercadoPago), validación en puerta con QR y reventa quedan para iteraciones siguientes
— ver "Fuera de alcance" en `README.md`.

## Decisiones de arquitectura que se asumen en todo el código

### 1. Identidad ECDSA P-256, no email/password puro

El usuario tiene un **par de claves** generado en el browser con WebCrypto. La pública es su
identidad on-chain ("wallet address"). La privada firma transacciones (emisión, compra futura,
validación futura).

El email/password existe como mecanismo de **custodia** de la clave privada, no como auth
primaria:

- En registro, el cliente deriva una key AES-GCM con **PBKDF2-SHA256, 250.000 iteraciones**,
  sal aleatoria. Cifra la PKCS8 de la clave privada con esa key y manda el ciphertext al
  servidor.
- En login, el server devuelve `{encryptedPrivateKey, kdfSalt, kdfIv}` y el cliente las
  descifra con la password. La clave privada en claro **solo existe en memoria del browser**
  (`src/lib/identity-store.ts`) — nunca en localStorage, nunca en el server.
- Si el usuario olvida la password, **pierde la clave privada** (no hay recovery).
  Esto es intencional para mantener la promesa criptográfica. Si en el futuro se pide
  recuperación, hay que ofrecer mnemonic backup *opcional*, no recovery server-side.

**Antes de tocar cualquier código de auth o crypto, leer `src/lib/crypto/{common,client,server}.ts`.**

### 2. Validación en puerta = devolver al organizador (no marcar "usada")

Cuando se escanee un QR en la puerta del evento (próxima iteración), la transacción que se
genera **transfiere la entrada del asistente de vuelta al organizador**. No hay un campo
"usada" — la unicidad emerge naturalmente: si el dueño actual ya no es el asistente, el QR
firmado por el asistente no verifica. Diseñar las APIs de validación con este modelo en mente.

### 3. Formato canónico para firmar

El payload se serializa con `canonicalize()` en `src/lib/crypto/common.ts` (JSON con keys
ordenadas alfabéticamente). **Si el NCT del equipo usa otra serialización canónica al verificar
firmas, las firmas no van a cuadrar.** Coordinar con ellos antes de cambiar este formato o
cualquier campo del payload.

### 4. ECDSA: curva P-256, hash SHA-256, formato IEEE P1363 (raw, 64 bytes)

Compatibilidad WebCrypto ↔ `node:crypto.webcrypto`. Si en algún momento se introduce otra
librería para verificar (ej. una lib que use DER encoding por defecto), hay que convertir
explícitamente. Ver `scripts/test-ecdsa-roundtrip.mjs` para el test que cubre exactamente esto
(el problema citado del [SO #39554165](https://stackoverflow.com/questions/39554165/)).

## Stack y convenciones

- **Next.js 16 App Router** + TypeScript estricto, src dir, Tailwind 4.
  - Atención: estricto en `BufferSource` — `crypto.getRandomValues(new Uint8Array(n))`
    produce `Uint8Array<ArrayBufferLike>` que no satisface `ArrayBufferView<ArrayBuffer>`.
    Por eso `src/lib/crypto/common.ts` expone `randomBytes()` que devuelve
    `Uint8Array<ArrayBuffer>` explícito. Usar ese helper.
- **Prisma 7 + Postgres con driver adapter** (`@prisma/adapter-pg`). Prisma 7 ya no acepta
  `url` en el datasource block; va en `prisma.config.ts` leyendo de `DATABASE_URL`. El
  `PrismaClient` se construye **siempre** con `{ adapter }` (ver `src/lib/db.ts`).
- **Rutas dinámicas**: en Next 16 los `params` son `Promise<…>` — siempre hacer
  `const { id } = await params;`.
- **Server Components por default**; client components solo donde haga falta interactividad
  (forms, botones con `useState`). Los handlers de crypto son client-only por usar WebCrypto.
- **Validación** con `zod` en cada API route que reciba body.

## Integración con el NCT

`src/lib/nct/client.ts` tiene **un mock que loguea y devuelve `mock-<uuid>`** cuando `NCT_URL`
no está seteada o vale `"mock"`. Cuando los compas tengan el endpoint real, basta cambiar la
env var; el código ya hace `POST {NCT_URL}/transactions/mint` con `{eventId, organizerPublicKey,
ticketCount, signedPayload, signature}`. Antes de pasar a NCT real, **acordar con ellos**:

- URL exacta del endpoint.
- Formato canónico del payload (ver decisión 3 arriba).
- Modelo de batch (una tx con N outputs vs N txs).
- Qué devuelve al aceptar (id, hash, índice de bloque).

## Despliegue / cómo se corre

- **Docker Compose** (`docker-compose.yml`) levanta Postgres + app. El `Dockerfile` es
  multi-stage con Next standalone. El `docker/entrypoint.sh` espera la DB, corre
  `prisma migrate deploy`, arranca `node server.js`.
- En el runner se copia el **node_modules completo** desde el builder porque el CLI de Prisma
  (que corre `migrate deploy` en boot) necesita su árbol entero de dependencias, no alcanza
  con lo que vendoriza Next standalone.
- Para dev local con hot reload: `docker compose up -d postgres` + `npm run dev`.
- `next.config.ts` tiene `output: "standalone"` y `outputFileTracingRoot: __dirname`
  (sin el último, Next se queja de múltiples lockfiles porque arriba hay otro repo).

## Scripts útiles

- `node scripts/test-ecdsa-roundtrip.mjs` — verifica el roundtrip de firmas, no necesita
  DB ni server.
- `node scripts/smoke-e2e.mjs` — flujo completo (register organizador, crear evento, firmar
  emisión, verificar listado público y rechazo de doble emisión) contra el server vivo en
  `localhost:3000`. Útil después de cualquier cambio en API o crypto.

## Cosas que NO hacer

- No agregar emails/usernames como identidad sin coordinarlo — el modelo es `publicKey` =
  identidad on-chain.
- No persistir la clave privada en claro en ningún lado (ni server, ni localStorage, ni
  cookies). Solo en memoria del browser tras login.
- No modelar `Ticket` en la DB de la app salvo que se demuestre necesidad. La blockchain es
  la fuente de verdad sobre entradas y propiedad; si hace falta un cache para listados, que
  quede claramente etiquetado como tal.
- No "marcar entrada como usada" — diseñar las APIs como transferencias on-chain.
- No `npm uninstall <x> <y>` sin verificar después: en este entorno borró todas las dependencias
  más de una vez. Mejor editar `package.json` a mano y `npm install`.
- No usar el `Bash` con `cd` esperando que el cwd persista en la próxima llamada — en este
  setup a veces vuelve a `C:\Users\Gonza\programacion\SIP`. Usar paths absolutos o chainear
  `cd /e/.../app && <cmd>`.
