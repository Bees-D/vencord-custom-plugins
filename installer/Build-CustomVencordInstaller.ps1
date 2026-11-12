param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "release")
)

$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "VencordCustomInstaller\VencordCustomInstaller.csproj"

if (-not (Get-Command "dotnet" -ErrorAction SilentlyContinue)) {
    throw "The .NET 8 SDK is required to build the installer."
}

& dotnet publish $project -c Release -o $OutputDirectory
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed (exit code $LASTEXITCODE)."
}

$exe = Join-Path $OutputDirectory "CustomVencordInstaller.exe"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "The installer was not produced at $exe."
}
Write-Host "Created installer: $exe"
