param(
  [string]$MsvcRoot = "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
)

$ErrorActionPreference = "Stop"

$env:VSWHERE = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $MsvcRoot) -and (Test-Path -LiteralPath $env:VSWHERE)) {
  $installPath = & $env:VSWHERE -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if ($installPath) {
    $tryPath = Join-Path $installPath "VC\Auxiliary\Build\vcvars64.bat"
    if (Test-Path -LiteralPath $tryPath) { $MsvcRoot = $tryPath }
  }
}

if (-not (Test-Path -LiteralPath $MsvcRoot)) {
  throw "MSVC vcvars64.bat not found. Pass -MsvcRoot <path>."
}

$testFile = Join-Path $PSScriptRoot "control_unit_state_test.cpp"
$libDir = Join-Path $PSScriptRoot "..\..\lib\ControlUnitState"
$libCpp = Join-Path $libDir "ControlUnitState.cpp"
$outDir = Join-Path $PSScriptRoot "build"

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$cmd = "call `"$MsvcRoot`" && cl /nologo /std:c++17 /EHsc /W4 /I `"$libDir`" /Fo$outDir\ /Fe`"$outDir\control_unit_state_test.exe`" `"$testFile`" `"$libCpp`" && `"$outDir\control_unit_state_test.exe`""
cmd /c $cmd
exit $LASTEXITCODE