$ErrorActionPreference = 'Stop'
$cn360Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
& (Join-Path $PSScriptRoot 'start.ps1')
$cn360DemoConfig = Join-Path $cn360Root 'thingsboard/software-offline.local.json'
if (-not (Test-Path -LiteralPath $cn360DemoConfig)) {
    $cn360Settings = Get-Content -LiteralPath (Join-Path $cn360Root 'thingsboard/software-offline.example.json') -Raw | ConvertFrom-Json
    $cn360BenchSettings = Join-Path $cn360Root 'n8n/software-bench.local.json'
    if (Test-Path -LiteralPath $cn360BenchSettings) {
        $cn360Settings.python = (Get-Content -LiteralPath $cn360BenchSettings -Raw | ConvertFrom-Json).python
    } elseif ($env:CN360_TEST_PYTHON) {
        $cn360Settings.python = $env:CN360_TEST_PYTHON
    } else {
        throw 'Copy thingsboard/software-offline.example.json to software-offline.local.json and set the Python path (Pillow required).'
    }
    $cn360Settings | ConvertTo-Json | Set-Content -LiteralPath $cn360DemoConfig
}
$cn360Running = docker ps --filter 'name=^/cn360-software-n8n$' --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the software demo container.' }
if ($cn360Running) { Write-Output 'A software profile is already running at http://127.0.0.1:8104. Stop it before switching profiles.'; return }
$cn360Node = (Get-Command node).Source
$cn360Logs = Join-Path $cn360Root 'n8n/.runtime/software-bench'
New-Item -ItemType Directory -Path $cn360Logs -Force | Out-Null
$cn360Arguments = @('n8n/scripts/software-bench.mjs', '--config', ('"' + $cn360DemoConfig + '"'))
$cn360Process = Start-Process -FilePath $cn360Node -ArgumentList $cn360Arguments -WorkingDirectory $cn360Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $cn360Logs 'supervisor.log') -RedirectStandardError (Join-Path $cn360Logs 'supervisor-error.log')
Write-Output "Starting offline software demo (PID $($cn360Process.Id)). Open http://127.0.0.1:8104 when ready."
