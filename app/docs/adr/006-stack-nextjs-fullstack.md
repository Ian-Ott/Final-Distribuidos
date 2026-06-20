# ADR-006: Next.js como full-stack (no SPA + backend separado)

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

La capa web del TP necesita:

- Frontend con buena SEO en el listado público de eventos (links a eventos compartibles).
- Backend que hable con la blockchain de los compas.
- Sesiones server-side (la cookie con la sesión va en `httpOnly`, ver
  [ADR-010](010-sesiones-iron-session.md)).

Las opciones razonables son:

1. **SPA (Vite + React) + backend en Express/FastAPI/Spring**: dos repos o dos paquetes, dos
   deploys, dos lenguajes potencialmente.
2. **Next.js full-stack**: un repo, frontend + API routes en el mismo proyecto, todo TypeScript.
3. **Remix / TanStack Start**: similar a Next.js, filosofía parecida.

## Decisión

Usamos **Next.js 16 con App Router** como single full-stack project:

- Frontend con React Server Components por default, client components solo donde hace falta
  interactividad (forms, scanner de QR, generación del QR firmado).
- API routes en `src/app/api/**/route.ts` para el backend.
- Server actions disponibles si en algún momento simplifican formularios.

## Consecuencias

### Positivas
- Un solo repo, un solo deploy, un solo runtime.
- SSR gratis para SEO y previews sociales del listado público de eventos.
- Tipos compartidos automáticamente entre frontend y backend (mismo paquete).
- Hot reload integrado, dev experience pulida.

### Negativas
- Acoplamiento: si en algún momento queremos escalar el backend independientemente del
  frontend, hay que dividir.
- El equipo del NCT no va a tener visibilidad directa del código del backend (vive mezclado
  con el frontend en `src/app/api/`).

### Abiertas
- Si llega un momento en que el backend necesita lógica pesada o procesos largos, podríamos
  extraer un servicio Node aparte y dejar Next.js solo para frontend + proxy.

## Alternativas consideradas

### SPA + Express
Más boilerplate (config de CORS, manejo de auth cross-origin, sincronizar tipos), dos
servicios para mantener. No aporta nada que Next.js no resuelva.

### Vercel-only solutions tipo Remix
Equivalente funcional. Elegimos Next.js por ecosistema más grande y porque el equipo lo conoce.
