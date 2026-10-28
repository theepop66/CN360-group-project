param([string]$Output = (Join-Path $PSScriptRoot '../../../n8n/.runtime/controller-adapter'))
$ErrorActionPreference = 'Stop'
$adapterVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$adapterVs = & $adapterVswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $adapterVs) { throw 'MSVC C++ build tools were not found.' }
$adapterSetup = Join-Path $adapterVs 'VC/Auxiliary/Build/vcvars64.bat'
$adapterBuild = [System.IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force -Path $adapterBuild | Out-Null
$adapterInclude = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../lib/ControlUnitState'))
$adapterSource = Join-Path $PSScriptRoot 'controller_adapter.cpp'
$adapterLibrary = Join-Path $adapterInclude 'ControlUnitState.cpp'
$adapterExe = Join-Path $adapterBuild 'controller_adapter.exe'
$adapterCompile = "call `"$adapterSetup`" && cl /nologo /std:c++17 /EHsc /W4 /I `"$adapterInclude`" /Fo`"$adapterBuild/`" /Fe`"$adapterExe`" `"$adapterSource`" `"$adapterLibrary`""
cmd /c $adapterCompile
if ($LASTEXITCODE -ne 0) { throw 'Controller host adapter did not compile.' }
