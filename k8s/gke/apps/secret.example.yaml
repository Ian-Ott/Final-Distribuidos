# Plantilla del Secret de la app. NO commitear el archivo real con valores —
# este es solo el shape esperado. Copiar a `secret.yaml`, llenar valores
# (en base64 si fuera necesario, pero stringData los toma en texto plano)
# y aplicar con `kubectl apply -f secret.yaml -n sdypp`.
#
# Para evitar leak accidental, agregar a .gitignore: k8s/gke/apps/secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: sdypp
type: Opaque
stringData:
  # Mínimo 32 chars. Generar con: openssl rand -base64 48
  SESSION_PASSWORD: "REEMPLAZAR-CON-32+CHARS-RANDOM-DESDE-OPENSSL"
  # Token de MercadoPago (sandbox APP_USR-... o prod). Sin comillas extras.
  MP_ACCESS_TOKEN: "REEMPLAZAR-CON-TOKEN-MP"
