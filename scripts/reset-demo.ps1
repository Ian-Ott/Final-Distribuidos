# Reset completo de la demo: limpia Postgres (plataforma) y Redis (blockchain del NCT).
# Corre contra el cluster GKE actual (el que tengas seleccionado en kubectl).
#
# Uso:
#   .\scripts\reset-demo.ps1            # limpia datos, mantiene usuarios
#   .\scripts\reset-demo.ps1 -WipeUsers # también borra usuarios (borrón total)
#
# Requiere: kubectl apuntando al cluster, namespace sdypp.

param(
    [switch]$WipeUsers
)

$ns = "sdypp"
$ErrorActionPreference = "Stop"

Write-Host "==> 1/3  Limpiando Postgres (eventos, tickets, pagos, listings, ops)..." -ForegroundColor Cyan

$pgPod = kubectl get pod -n $ns -l app=postgres -o jsonpath='{.items[0].metadata.name}'
if (-not $pgPod) { throw "No encontré el pod de postgres en el namespace $ns" }

# OJO: las comillas dobles de los identificadores ("Event", "User") se pierden
# si el SQL se pasa como argumento (-c "...") porque PowerShell + kubectl exec
# las consumen, y las tablas de Prisma son case-sensitive. Por eso lo pasamos
# por STDIN con `kubectl exec -i`, que preserva el string tal cual.
if ($WipeUsers) {
    $tables = '"TicketListing","Payment","Ticket","NctOperation","Event","User"'
    Write-Host "    (incluyendo usuarios)" -ForegroundColor Yellow
} else {
    $tables = '"TicketListing","Payment","Ticket","NctOperation","Event"'
}
$truncate = "TRUNCATE TABLE $tables RESTART IDENTITY CASCADE;"

$truncate | kubectl exec -i -n $ns $pgPod -- psql -U entradas -d entradas
Write-Host "    Postgres limpio." -ForegroundColor Green

Write-Host "==> 2/3  Limpiando Redis (cadena, ownership, ops, logs)..." -ForegroundColor Cyan

$redisPod = kubectl get pod -n $ns -l app=redis -o jsonpath='{.items[0].metadata.name}'
if (-not $redisPod) { throw "No encontré el pod de redis en el namespace $ns" }

# FLUSHDB borra TODO el estado de la blockchain. El NCT recrea el bloque génesis
# y la dificultad al reiniciar (ver bloque GENESIS en nct.py).
kubectl exec -n $ns $redisPod -- redis-cli FLUSHDB
Write-Host "    Redis limpio." -ForegroundColor Green

Write-Host "==> 3/3  Reiniciando NCT para regenerar el bloque génesis..." -ForegroundColor Cyan
kubectl rollout restart deployment/blockchain-nct -n $ns
kubectl rollout status deployment/blockchain-nct -n $ns --timeout=120s

Write-Host ""
Write-Host "Listo. Plataforma y blockchain reseteadas." -ForegroundColor Green
Write-Host "Verificá: kubectl exec -n $ns deployment/blockchain-nct -- curl -s localhost:8000/status"
