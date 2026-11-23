$ErrorActionPreference = 'Stop'
$cn360Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$cn360Record = Join-Path $cn360Root 'n8n/.runtime/software-bench/running.json'
if (-not (Test-Path -LiteralPath $cn360Record)) { Write-Output 'No running software profile was recorded.'; exit 0 }
$cn360Info = Get-Content -LiteralPath $cn360Record -Raw | ConvertFrom-Json
if ($cn360Info.container -ne 'cn360-software-n8n') { throw 'Unexpected profile container identity.' }
$cn360MountsText = $null
try { $cn360MountsText = docker inspect cn360-software-n8n --format '{{json .Mounts}}' 2>$null }
catch { Write-Output 'Docker is unavailable; checking the owned host process.' }
if ($cn360MountsText) {
    $cn360Mounts = $cn360MountsText | ConvertFrom-Json
    if (-not ($cn360Mounts | Where-Object { $_.Name -eq 'cn360_software_n8n_data' })) { throw 'Container does not use the software profile volume.' }
    docker stop --timeout 3 cn360-software-n8n
}
$cn360Owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($cn360Info.pid)"
if ($cn360Owned -and $cn360Owned.CommandLine -match 'software-bench\.mjs') {
    taskkill /PID $cn360Info.pid /T /F
}
Write-Output 'Software profile stopped. Its Docker volume and original n8n installation are preserved.'
