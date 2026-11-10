param(
    [Parameter(Mandatory = $true)]
    [string]$VencordRoot
)

$ErrorActionPreference = "Stop"

$modalPath = Join-Path $VencordRoot "src\components\settings\tabs\plugins\PluginModal.tsx"
if (-not (Test-Path -LiteralPath $modalPath)) {
    throw "Vencord's plugin details component was not found at $modalPath"
}

$source = [System.IO.File]::ReadAllText($modalPath)
$pattern = '(?s)\{!pluginMeta\.userPlugin\s*&&\s*\(\s*(?<container><div className="vc-settings-modal-links">.*?</div>)\s*\)\}'
$match = [System.Text.RegularExpressions.Regex]::Match($source, $pattern)

if (-not $match.Success) {
    throw "Vencord's plugin favorite section changed. This installer stopped before building so it will not silently omit plugin favorites."
}

$container = $match.Groups["container"].Value
$updatedContainer = [System.Text.RegularExpressions.Regex]::Replace(
    $container,
    '(?s)(<FavoriteButton\b.*?/>)\s*(?=<WebsiteButton\b)',
    '$1{!pluginMeta.userPlugin && <>'
)
$updatedContainer = [System.Text.RegularExpressions.Regex]::Replace(
    $updatedContainer,
    '(?s)(<GithubButton\b.*?/>)',
    '$1</>}'
)

if ($updatedContainer -eq $container -or $updatedContainer -notmatch '\{!pluginMeta\.userPlugin && <>') {
    throw "Could not safely update Vencord's plugin favorite controls."
}

$patchedSource = $source.Remove($match.Index, $match.Length).Insert($match.Index, $updatedContainer)
[System.IO.File]::WriteAllText($modalPath, $patchedSource, [System.Text.UTF8Encoding]::new($false))
