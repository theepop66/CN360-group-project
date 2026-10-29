#requires -Version 7.2
param(
    [Parameter(Mandatory = $true)][string]$IpAddress,
    [int]$HttpPort = 8080,
    [int]$HttpsPort = 8443,
    [string]$NodePath = 'node'
)
$ErrorActionPreference = 'Stop'
$parsedIp = [System.Net.IPAddress]::Parse($IpAddress)
if ($parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Use the PC Wi-Fi IPv4 address.' }
foreach ($port in @($HttpPort, $HttpsPort)) {
    if ($port -lt 1024 -or $port -gt 65535) { throw 'Choose ports between 1024 and 65535.' }
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $port)
    try { $probe.Start() } finally { $probe.Stop() }
}
if ($HttpPort -eq $HttpsPort) { throw 'HTTP and HTTPS ports must differ.' }
$privateDir = Join-Path $env:LOCALAPPDATA "CN360\phone-camera\$IpAddress"
$null = New-Item -ItemType Directory -Path $privateDir -Force
$caPath = Join-Path $privateDir 'phone-camera-ca.cer'
$certPath = Join-Path $privateDir 'server.pem'
$keyPath = Join-Path $privateDir 'server-key.pem'
$existing = @($caPath, $certPath, $keyPath) | Where-Object { Test-Path -LiteralPath $_ }
if ($existing.Count -gt 0 -and $existing.Count -ne 3) { throw "Incomplete certificate files in $privateDir. Preserve them and choose a fresh setup directory before retrying." }
if ($existing.Count -eq 0) {
    $rsaCa = [System.Security.Cryptography.RSA]::Create(2048)
    $rsaServer = [System.Security.Cryptography.RSA]::Create(2048)
    try {
        $sha = [System.Security.Cryptography.HashAlgorithmName]::SHA256
        $padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
        $caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=CN360 Phone Camera Local CA', $rsaCa, $sha, $padding)
        $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
        $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign, $true))
        $before = [DateTimeOffset]::UtcNow.AddMinutes(-5)
        $after = [DateTimeOffset]::UtcNow.AddDays(30)
        $ca = $caRequest.CreateSelfSigned($before, $after)
        $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=CN360 Phone Camera', $rsaServer, $sha, $padding)
        $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $san.AddIpAddress($parsedIp)
        $san.AddIpAddress([System.Net.IPAddress]::Loopback)
        $san.AddDnsName('localhost')
        $request.CertificateExtensions.Add($san.Build())
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
        $usage = [System.Security.Cryptography.OidCollection]::new()
        $null = $usage.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usage, $true))
        $serial = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
        $serial[0] = $serial[0] -band 0x7f
        $certificate = $request.Create($ca, $before, $after, $serial)
        [System.IO.File]::WriteAllBytes($caPath, $ca.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
        [System.IO.File]::WriteAllText($certPath, $certificate.ExportCertificatePem() + "`n" + $ca.ExportCertificatePem())
        [System.IO.File]::WriteAllText($keyPath, $rsaServer.ExportRSAPrivateKeyPem())
    } finally { $rsaCa.Dispose(); $rsaServer.Dispose() }
}
$publicCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem([System.IO.File]::ReadAllText($certPath))
if ($publicCert.NotAfter.ToUniversalTime() -lt [DateTime]::UtcNow.AddHours(1)) { throw "Certificate expired or nearly expired. Renew the local setup in $privateDir and trust its new CA on the phone." }
$root = Split-Path -Parent $PSScriptRoot
$server = Join-Path $PSScriptRoot 'hud-server.mjs'
$stdoutPath = Join-Path $privateDir 'server.log'
$stderrPath = Join-Path $privateDir 'server-errors.log'
$nodeCommand = (Get-Command $NodePath -ErrorAction Stop).Source
# Camera-only bench: controller requests deliberately go to an unused loopback port.
$arguments = @('"' + $server + '"', '--http-port', $HttpPort, '--https-port', $HttpsPort, '--cert', '"' + $certPath + '"', '--key', '"' + $keyPath + '"', '--phone-ca', '"' + $caPath + '"', '--phone-camera', '--control-unit', 'http://127.0.0.1:1')
$process = Start-Process -FilePath $nodeCommand -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    $process.Refresh()
    if ($process.HasExited) { throw "Camera server stopped. See $stderrPath" }
    try {
        $pairingLine = (Get-Content -LiteralPath $stdoutPath | Select-String 'Phone pairing code').Line
        if (-not $pairingLine) { continue }
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$HttpPort/phone-camera.html" -TimeoutSec 1
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}
if (-not $ready) {
    $process.Kill()
    throw "Camera server did not become ready. See $stderrPath"
}
# Verify HTTPS against the generated CA without changing OS trust or disabling validation.
$tlsCheck = @'
const fs = require('node:fs');
const https = require('node:https');
const { X509Certificate } = require('node:crypto');
const ca = new X509Certificate(fs.readFileSync(process.argv[1])).toString();
const req = https.get('https://127.0.0.1:' + process.argv[2] + '/phone-camera.html', {ca}, res => {
  res.resume(); res.on('end', () => { if (res.statusCode !== 200) process.exitCode = 1; });
});
req.setTimeout(3000, () => req.destroy(new Error('HTTPS startup timed out')));
req.on('error', error => { console.error(error.message); process.exitCode = 1; });
'@
& $nodeCommand -e $tlsCheck $caPath $HttpsPort
if ($LASTEXITCODE -ne 0) { $process.Kill(); throw 'The generated HTTPS camera endpoint did not validate.' }
$state = @{ pid = $process.Id; server = $server; ip = $IpAddress; httpPort = $HttpPort; httpsPort = $HttpsPort; caSha256 = (Get-FileHash -LiteralPath $caPath -Algorithm SHA256).Hash }
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $privateDir 'running.json')
$instructions = @"
iPhone camera: https://${IpAddress}:$HttpsPort/phone-camera.html
PC/Pico HUD: https://${IpAddress}:$HttpsPort/?camera=phone
PC-only HUD (no certificate setup): http://localhost:$HttpPort/?camera=phone
Download public CA on iPhone: http://${IpAddress}:$HttpPort/phone-camera-ca.cer
CA SHA256: $($state.caSha256)
$pairingLine

Install the CA profile: Settings > General > VPN & Device Management.
Then Settings > General > About > Certificate Trust Settings > enable CN360 Phone Camera Local CA.
This is a local development CA. It expires after 30 days; remove it when testing ends.
Connect all devices to the same Wi-Fi; allow Node on Windows Private networks if prompted.
Open the camera URL in Safari, enter the pairing code, allow camera, then tap Start.
Keep the sender page visible. Leaving it stops the camera. Do not share the pairing code.
To control phone camera zoom, enter this code in HUD Connection settings > Phone camera control code.
The phone/browser must expose camera zoom support; the HUD shows confirmed camera settings only.
No AI run or servo motion is enabled by this launcher.
To stop this owned server: use tools/stop-phone-camera.ps1 -IpAddress $IpAddress
"@
$instructionsPath = Join-Path $privateDir 'connection.txt'
$instructions | Set-Content -LiteralPath $instructionsPath
Write-Output "Camera server ready. Instructions and pairing code: $instructionsPath"
Write-Output "PC HUD: http://localhost:$HttpPort/?camera=phone"
Write-Output "iPhone: https://${IpAddress}:$HttpsPort/phone-camera.html"
