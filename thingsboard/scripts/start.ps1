$ErrorActionPreference = 'Stop'
$cn360Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cn360Node = (Get-Command node).Source
& $cn360Node (Join-Path $PSScriptRoot 'setup.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Monitoring setup failed. Start Docker Desktop and review the preceding error.' }
$cn360Logs = Join-Path $cn360Root 'thingsboard/.runtime'
New-Item -ItemType Directory -Path $cn360Logs -Force | Out-Null
try {
    $cn360Health = Invoke-RestMethod -Uri 'http://127.0.0.1:8106/health' -TimeoutSec 2
    if ($cn360Health.status -eq 'ok') { Write-Output 'Monitoring bridge is already running.'; return }
} catch {}
$cn360Process = Start-Process -FilePath $cn360Node -ArgumentList 'thingsboard/server.mjs' -WorkingDirectory $cn360Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cn360Logs 'bridge.log') -RedirectStandardError (Join-Path $cn360Logs 'bridge-error.log')
@{ pid = $cn360Process.Id; script = 'thingsboard/server.mjs' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cn360Logs 'bridge-process.json')
Write-Output "Starting monitoring bridge (PID $($cn360Process.Id)). Dashboard: http://127.0.0.1:9090"
