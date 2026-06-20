# ADR-012: TLS solo donde cruza redes no controladas

**Estado**: Accepted
**Fecha**: 2026-06-20

## Contexto

El sistema completo tiene varios canales de comunicación:

- Browser ↔ app (Frontend + Backend nuestro): atraviesa internet.
- App ↔ NCT (en el cluster de los compas): atraviesa internet si la app no vive en el mismo
  cluster.
- App ↔ Postgres: atraviesa internet si Postgres está hosteada externa.
- NCT ↔ Redis, NCT ↔ RabbitMQ: tráfico interno del cluster GKE.
- Workers GPU (VMs separadas) ↔ RabbitMQ: cruza de Compute Engine al cluster, vía internet
  o VPN.

Encriptar **todo** con mTLS (vía service mesh tipo Istio) es overkill para un TP. No encriptar
nada es inseguro. Hay que decidir dónde sí.

## Decisión

**TLS/HTTPS obligatorio donde el tráfico atraviesa una red que no controlamos:**

- Browser ↔ app: HTTPS (Let's Encrypt o cert manual via Ingress).
- App ↔ NCT real: HTTPS (Ingress del cluster con cert).
- App ↔ Postgres hosteada: TLS (`sslmode=require` en el connection string).
- Workers GPU ↔ RabbitMQ: AMQPS (TLS sobre AMQP).

**HTTP plano aceptable dentro del cluster GKE** (pod-to-pod en la pod network privada):

- Frontend ↔ Backend, Backend ↔ NCT, NCT ↔ TrP, NCT ↔ Redis, NCT ↔ RabbitMQ.

Esto está documentado más a fondo en
[docs/oculto/explicacion-tecnica.md](../oculto/explicacion-tecnica.md) sección 8.

## Consecuencias

### Positivas
- Cero exposición de credenciales o payloads firmados en internet.
- Sin overhead de mTLS dentro del cluster (cero config de service mesh).

### Negativas
- Un atacante con acceso a la red interna del cluster puede leer tráfico entre pods. En
  producción real (banca, salud) esto no sería aceptable y requeriría mTLS — para el TP, sí.

### Abiertas
- Si el cluster en algún momento se comparte con otros proyectos, reconsiderar mTLS interno
  (Linkerd se instala con un comando y te da mTLS automático).

## Alternativas consideradas

### mTLS pod-to-pod con Istio o Linkerd
Ideal para prod real. Overkill para un TP.

### Cero TLS en ninguna parte
Mandar firmas y eventos por HTTP plano expone toda la operación. Aunque las firmas garantizan
**integridad** y **autenticidad**, no dan **confidencialidad** — el atacante leería todo.
