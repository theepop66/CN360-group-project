$ErrorActionPreference = 'Stop'
$cn360Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cn360Logs = Join-Path $cn360Root 'n8n/.runtime/software-bench'
New-Item -ItemType Directory -Path $cn360Logs -Force | Out-Null
$cn360Node = (Get-Command node).Source
$cn360Process = Start-Process -FilePath $cn360Node -ArgumentList 'n8n/scripts/software-bench.mjs' -WorkingDirectory $cn360Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cn360Logs 'supervisor.log') -RedirectStandardError (Join-Path $cn360Logs 'supervisor-error.log')
Write-Output "Starting software test profile (PID $($cn360Process.Id)). Open http://localhost:8104/ when ready."
