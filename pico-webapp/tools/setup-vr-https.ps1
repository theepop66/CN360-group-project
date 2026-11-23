#requires -Version 7.2
param(
    [Parameter(Mandatory = $true)][string]$IpAddress
)
$ErrorActionPreference = 'Stop'
$parsedIp = [System.Net.IPAddress]::Parse($IpAddress)
if ($parsedIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'Use the PC Wi-Fi IPv4 address, not the ESP32 IP.'
}
$certPath = Join-Path $PSScriptRoot 'dev-cert.pem'
$keyPath = Join-Path $PSScriptRoot 'dev-key.pem'
if ((Test-Path -LiteralPath $certPath) -or (Test-Path -LiteralPath $keyPath)) {
    throw 'Certificate files already exist. Preserve them before generating a replacement.'
}
# Create only files; do not install a root CA or change browser/OS trust.
# tools/*.pem is gitignored and the HUD server never serves tools/ files.
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$certificate = $null
try {
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
        'CN=CN360 PICO Local Development', $rsa,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $san.AddIpAddress($parsedIp)
    $san.AddIpAddress([System.Net.IPAddress]::Loopback)
    $san.AddDnsName('localhost')
    $request.CertificateExtensions.Add($san.Build())
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        ([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment), $true))
    $usage = [System.Security.Cryptography.OidCollection]::new()
    $null = $usage.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1'))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usage, $false))
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(14))
    # Write the key first and the certificate last. Never log private key bytes.
    [System.IO.File]::WriteAllText($keyPath, $rsa.ExportRSAPrivateKeyPem())
    [System.IO.File]::WriteAllText($certPath, $certificate.ExportCertificatePem())
    Write-Output "HTTPS certificate prepared for PC $IpAddress (14 days)."
    Write-Output "Certificate SHA256: $($certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256))"
    Write-Output "Headset URL: https://${IpAddress}:8443/?xrdebug=1"
    Write-Output 'This is a self-signed local development certificate. Browser trust must be reviewed on the headset.'
} finally {
    if ($null -ne $certificate) { $certificate.Dispose() }
    $rsa.Dispose()
}
