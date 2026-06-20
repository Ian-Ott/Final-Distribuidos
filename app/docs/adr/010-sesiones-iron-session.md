# ADR-010: Sesiones server-side con iron-session

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

Necesitamos manejar sesiones de usuario después del login. Opciones típicas:

1. **JWT en localStorage**: cliente envía Bearer token en cada request.
2. **JWT en cookie**: similar pero la cookie viaja sola.
3. **Cookie de sesión cifrada server-side** (iron-session, express-session, etc.): la cookie
   contiene un blob cifrado/firmado por el server.

JWT en localStorage tiene problemas: vulnerable a XSS (cualquier script puede leerlo), y no
se puede revocar fácilmente.

## Decisión

Usamos **iron-session** con cookie `httpOnly`:

- La cookie va `httpOnly` → JavaScript del browser no la puede leer (mitiga XSS).
- La cookie va `sameSite=lax` → mitiga CSRF.
- En prod va `secure` (solo HTTPS).
- El server cifra/firma el contenido con `SESSION_PASSWORD` (env var de 32+ chars).

El payload de la sesión es chico: `{userId, email, publicKey, role}`. La clave privada
**NO** va en la sesión (vive solo en memoria del browser, ver [ADR-002](002-custodia-hibrida-clave.md)).

Implementado en [src/lib/session.ts](../../src/lib/session.ts).

## Consecuencias

### Positivas
- Inmune a XSS para robo de sesión (la cookie no se puede leer desde JS).
- Server controla el contenido de la sesión — puede invalidar, rotar password, etc.
- Sin librería de cliente: el browser maneja la cookie automáticamente.

### Negativas
- Las sesiones no se pueden compartir entre dominios sin más config (esto no es problema
  para single-domain).
- Si rotamos `SESSION_PASSWORD`, todas las sesiones existentes quedan inválidas (cosa que en
  algunos casos es bueno, en otros no).

### Abiertas
- En prod hay que generar un `SESSION_PASSWORD` aleatorio fuerte y guardarlo en un secret
  manager, no en `.env` versionado.

## Alternativas consideradas

### JWT en localStorage
Vulnerable a XSS, complicado de revocar. Descartado.

### NextAuth / Auth.js
Más completo (OAuth providers, multi-strategy) pero más config. Para login con email+password
custom (que es lo que necesitamos por la custodia híbrida), iron-session es más directo.
