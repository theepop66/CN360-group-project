param([string]$LocateAnythingPath = 'D:\CN360\locate-anything.cpp', [switch]$Offline)
$ErrorActionPreference = 'Stop'
$cn360Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cn360Node = (Get-Command node).Source
$cn360Running = docker ps --filter 'name=^/cn360-software-n8n$' --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop before starting the native software profile.' }
if ($cn360Running) { throw 'Stop the existing software profile before selecting the native profile.' }
$cn360Config = Join-Path $cn360Root 'thingsboard/software-native.local.json'
& $cn360Node (Join-Path $PSScriptRoot 'configure-native.mjs') --source $LocateAnythingPath $(if ($Offline) { '--offline' })
if ($LASTEXITCODE -ne 0) { throw 'Native software configuration failed.' }
$cn360BridgeRecord = Join-Path $cn360Root 'thingsboard/.runtime/bridge-process.json'
if (Test-Path -LiteralPath $cn360BridgeRecord) {
    $cn360Info = Get-Content -LiteralPath $cn360BridgeRecord -Raw | ConvertFrom-Json
    $cn360Owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($cn360Info.pid)" -ErrorAction SilentlyContinue
    if ($cn360Owned -and $cn360Owned.CommandLine -match 'thingsboard[/\\]server\.mjs') { Stop-Process -Id $cn360Info.pid }
}
& (Join-Path $PSScriptRoot 'start.ps1')
$cn360Logs = Join-Path $cn360Root 'n8n/.runtime/software-bench'
New-Item -ItemType Directory -Path $cn360Logs -Force | Out-Null
$cn360Arguments = @('n8n/scripts/software-bench.mjs', '--config', ('"' + $cn360Config + '"'))
$cn360Process = Start-Process -FilePath $cn360Node -ArgumentList $cn360Arguments -WorkingDirectory $cn360Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cn360Logs 'supervisor.log') -RedirectStandardError (Join-Path $cn360Logs 'supervisor-error.log')
Write-Output "Starting native software inspection (PID $($cn360Process.Id)). See the supervisor log for model readiness."
