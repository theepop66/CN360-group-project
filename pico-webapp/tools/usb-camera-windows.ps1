#requires -Version 7.2
param(
    [ValidateSet('Inspect', 'Certificate')][string]$Action = 'Inspect',
    [string]$IpAddress,
    [string]$Directory
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($Action -eq 'Inspect') {
    # .NET works without the CIM privileges required by Get-NetAdapter.
    $adapters = @([System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | ForEach-Object {
        $properties = $_.GetIPProperties()
        [PSCustomObject]@{
            name = $_.Name
            description = $_.Description
            status = $_.OperationalStatus.ToString()
            addresses = @($properties.UnicastAddresses | Where-Object {
                $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork
            } | ForEach-Object { $_.Address.ToString() })
        }
    })
    ConvertTo-Json -InputObject @{ adapters = $adapters; powerShellPath = [Environment]::ProcessPath } -Depth 4 -Compress
    exit 0
}

$parsedIp = [System.Net.IPAddress]::Parse($IpAddress)
if ($parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { throw 'Use an IPv4 address.' }
if (-not $Directory) { throw 'A certificate directory is required.' }
$null = New-Item -ItemType Directory -Path $Directory -Force
$caPath = Join-Path $Directory 'phone-camera-ca.cer'
$certPath = Join-Path $Directory 'server.pem'
$keyPath = Join-Path $Directory 'server-key.pem'
$existing = @($caPath, $certPath, $keyPath) | Where-Object { Test-Path -LiteralPath $_ }
if ($existing.Count -eq 3) { exit 0 }
if ($existing.Count -gt 0) { throw 'Incomplete certificate set. Preserve it and choose another --state-dir.' }

$caKey = [System.Security.Cryptography.RSA]::Create(2048)
$serverKey = [System.Security.Cryptography.RSA]::Create(2048)
$ca = $null
$certificate = $null
try {
    $sha = [System.Security.Cryptography.HashAlgorithmName]::SHA256
    $padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    $caRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=CN360 USB Camera Test CA', $caKey, $sha, $padding)
    $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
    $caRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign, $true))
    $before = [DateTimeOffset]::UtcNow.AddMinutes(-5)
    $after = [DateTimeOffset]::UtcNow.AddDays(30)
    $ca = $caRequest.CreateSelfSigned($before, $after)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=CN360 USB Camera Test', $serverKey, $sha, $padding)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddIpAddress($parsedIp)
    $san.AddIpAddress([System.Net.IPAddress]::Loopback)
    $san.AddDnsName('localhost')
    $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $eku = [System.Security.Cryptography.OidCollection]::new()
    $null = $eku.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($eku, $true))
    $serial = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $serial[0] = ($serial[0] -band 0x7f) -bor 1
    $certificate = $request.Create($ca, $before, $after, $serial)
    [System.IO.File]::WriteAllBytes($caPath, $ca.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
    [System.IO.File]::WriteAllText($certPath, $certificate.ExportCertificatePem() + "`n" + $ca.ExportCertificatePem())
    [System.IO.File]::WriteAllText($keyPath, $serverKey.ExportRSAPrivateKeyPem())
} finally {
    if ($certificate) { $certificate.Dispose() }
    if ($ca) { $ca.Dispose() }
    $caKey.Dispose()
    $serverKey.Dispose()
}
