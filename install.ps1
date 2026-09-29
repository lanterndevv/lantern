# Lantern: instalador de un comando (Windows PowerShell 5.1+ y 7).
#   irm https://raw.githubusercontent.com/lanterndevv/lantern/master/install.ps1 | iex
# Variables de entorno: LANTERN_VERSION=vX.Y.Z (versión fija), LANTERN_RELEASES_BASE (solo pruebas).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest es muy lento en PS 5.1 con la barra de progreso
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$es = (Get-Culture).TwoLetterISOLanguageName -eq 'es'
function T($esText, $enText) { if ($es) { $esText } else { $enText } }
function Fail($esText, $enText) { Write-Host ''; Write-Host ('Error: ' + (T $esText $enText)) -ForegroundColor Red; throw (T $esText $enText) }

$base = if ($env:LANTERN_RELEASES_BASE) { $env:LANTERN_RELEASES_BASE } else { 'https://github.com/lanterndevv/lantern/releases' }
$url = if ($env:LANTERN_VERSION) { "$base/download/$($env:LANTERN_VERSION)" } else { "$base/latest/download" }

$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
if ($arch -ne 'AMD64') { Fail "arquitectura no soportada: $arch (solo x64)." "unsupported architecture: $arch (x64 only)." }
$name = 'lantern-installer-windows-x64.exe'

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('lantern-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    Write-Host (T 'Descargando el asistente de Lantern (windows-x64)...' 'Downloading the Lantern installer (windows-x64)...')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$url/$name" -OutFile "$tmp\$name"
        Invoke-WebRequest -UseBasicParsing -Uri "$url/SHA256SUMS" -OutFile "$tmp\SHA256SUMS"
    } catch { Fail "no se pudo descargar desde $url (¿sin conexión, o esa versión no existe?)." "could not download from $url (offline, or that version does not exist?)." }

    $want = $null
    foreach ($l in Get-Content "$tmp\SHA256SUMS") { if ($l -match "^\s*([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($name))\s*$") { $want = $Matches[1]; break } }
    if (-not $want) { Fail "$name no figura en SHA256SUMS." "$name is not listed in SHA256SUMS." }
    $got = (Get-FileHash -Algorithm SHA256 "$tmp\$name").Hash
    if ($got -ne $want.ToUpperInvariant()) { Fail 'el hash SHA-256 no coincide: descarga corrupta o manipulada. No se instala nada.' 'SHA-256 mismatch: corrupt or tampered download. Nothing was installed.' }
    Write-Host (T 'Verificado (SHA-256).' 'Verified (SHA-256).')

    $dir = Join-Path $env:LOCALAPPDATA 'Lantern\bin'
    $exe = Join-Path $dir 'lantern.exe'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Copy-Item "$tmp\$name" $exe -Force
    Unblock-File $exe

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    if (($userPath -split ';') -notcontains $dir) {
        [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $dir).TrimStart(';')), 'User')
        $env:Path += ";$dir"
        Write-Host (T "Añadido $dir al PATH (abre una terminal nueva para usar «lantern»)." "Added $dir to PATH (open a new terminal to use 'lantern').")
    }
    Write-Host (T "Instalado en $exe." "Installed at $exe.")
} finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
& $exe
