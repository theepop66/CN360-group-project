#requires -Version 7.2
param([Parameter(Mandatory = $true)][string]$IpAddress)
$ErrorActionPreference = 'Stop'
$null = [System.Net.IPAddress]::Parse($IpAddress)
$statePath = Join-Path $env:LOCALAPPDATA "CN360\phone-camera\$IpAddress\running.json"
if (-not (Test-Path -LiteralPath $statePath)) { throw 'No saved camera server for this address.' }
$state = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json
$owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)"
if ($owned) {
    if ($owned.Name -ne 'node.exe' -or -not $owned.CommandLine.Contains($state.server) -or -not $owned.CommandLine.Contains('--phone-camera')) { throw 'The saved process ID belongs to another program. It was not stopped.' }
    Stop-Process -Id $state.pid
}
Remove-Item -LiteralPath $statePath
Write-Output 'Phone camera server stopped.'
