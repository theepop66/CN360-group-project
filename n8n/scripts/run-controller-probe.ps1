param([string]$Output = (Join-Path $PSScriptRoot '../.runtime/controller-probe'))
$ErrorActionPreference = 'Stop'
$probeRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$probeVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$probeVs = & $probeVswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $probeVs) { throw 'MSVC C++ build tools were not found.' }
$probeSetup = Join-Path $probeVs 'VC/Auxiliary/Build/vcvars64.bat'
$probeBuild = [System.IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path $probeBuild | Out-Null
$probeInclude = Join-Path $probeRoot '360ControlUnit/lib/ControlUnitState'
$probeSource = Join-Path $probeRoot '360ControlUnit/test/host/late_verdict_probe.cpp'
$probeLibrary = Join-Path $probeInclude 'ControlUnitState.cpp'
$probeExe = Join-Path $probeBuild 'late_verdict_probe.exe'
$probeCompile = "call `"$probeSetup`" && cl /nologo /std:c++17 /EHsc /W4 /I `"$probeInclude`" /Fo`"$probeBuild/`" /Fe`"$probeExe`" `"$probeSource`" `"$probeLibrary`""
cmd /c $probeCompile | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Controller acceptance probe did not compile.' }
$probeResult = & $probeExe
$probeExit = $LASTEXITCODE
$probeResult | Set-Content -LiteralPath (Join-Path $probeBuild 'result.json') -Encoding utf8
Write-Output $probeResult
exit $probeExit
