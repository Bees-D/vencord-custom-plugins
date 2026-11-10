param(
    [string]$OutputPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "CustomVencordPluginsInstaller.zip")
)

$ErrorActionPreference = "Stop"
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("VencordCustomPluginsZip-" + [guid]::NewGuid().ToString("N"))
$outputDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($OutputPath))

New-Item -ItemType Directory -Force -Path $stageRoot, $outputDirectory | Out-Null
try {
    foreach ($fileName in @("Install-CustomVencord.cmd", "Install-CustomVencord.ps1", "README.md")) {
        $source = Join-Path $PSScriptRoot $fileName
        if (-not (Test-Path -LiteralPath $source)) {
            throw "Installer file is missing: $source"
        }
        Copy-Item -LiteralPath $source -Destination $stageRoot
    }

    $launchScript = Join-Path $stageRoot "Install-CustomVencord.ps1"
    $scriptText = [System.IO.File]::ReadAllText($launchScript)
    if (-not $scriptText.Contains("https://github.com/Bees-D/vencord-custom-plugins.git")) {
        throw "The installer is not configured for the public plugin repository."
    }

    Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $OutputPath -CompressionLevel Optimal -Force
    Write-Host "Created installer ZIP: $OutputPath"
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        $resolvedStageRoot = [System.IO.Path]::GetFullPath($stageRoot)
        $tempPrefix = $tempRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $resolvedStageRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Split-Path -Leaf $resolvedStageRoot).StartsWith("VencordCustomPluginsZip-")) {
            throw "Refusing to remove a ZIP staging folder outside its expected temp location."
        }
        Remove-Item -LiteralPath $resolvedStageRoot -Recurse -Force
    }
}
