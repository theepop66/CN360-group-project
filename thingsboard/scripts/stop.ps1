$ErrorActionPreference = 'Stop'
$cn360Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cn360ProcessFile = Join-Path $cn360Root 'thingsboard/.runtime/bridge-process.json'
if (Test-Path -LiteralPath $cn360ProcessFile) {
    $cn360Record = Get-Content -LiteralPath $cn360ProcessFile -Raw | ConvertFrom-Json
    $cn360Process = Get-CimInstance Win32_Process -Filter "ProcessId = $($cn360Record.pid)" -ErrorAction SilentlyContinue
    if ($cn360Process -and $cn360Process.CommandLine -match 'thingsboard[/\\]server\.mjs') { Stop-Process -Id $cn360Record.pid }
}
docker compose -f (Join-Path $cn360Root 'thingsboard/compose.yaml') --env-file (Join-Path $cn360Root 'thingsboard/.env') stop
Write-Output 'Monitoring stopped. Database and delivery journal retained.'
