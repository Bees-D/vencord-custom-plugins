param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$pluginRepository = "https://github.com/Bees-D/vencord-custom-plugins.git"
$localInstallRoot = Join-Path $env:LOCALAPPDATA "VencordCustomPlugins"
$targetDist = Join-Path $localInstallRoot "dist"
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("VencordCustomPlugins-" + [guid]::NewGuid().ToString("N"))
$upstreamRoot = Join-Path $workRoot "Vencord"
$pluginRoot = Join-Path $workRoot "plugins"

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $extraPaths = @(
        (Join-Path $env:ProgramFiles "nodejs"),
        (Join-Path $env:ProgramFiles "Git\cmd"),
        (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    $env:Path = (@($extraPaths) + @($machinePath, $userPath, $env:Path) | Where-Object { $_ }) -join [System.IO.Path]::PathSeparator
}

function Get-NodeMajorVersion {
    $nodeCommand = Get-Command "node" -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        return 0
    }

    $versionText = & $nodeCommand.Source --version 2>$null
    if ($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v?(\d+)\.') {
        return 0
    }
    return [int]$Matches[1]
}

function Install-WingetPackage([string]$PackageId) {
    $winget = Get-Command "winget" -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Windows Package Manager (winget) is required to install $PackageId. Install App Installer from the Microsoft Store, then run this installer again."
    }

    Write-Host "Installing prerequisite $PackageId with winget..."
    & $winget.Source install --id $PackageId --exact --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget could not install $PackageId (exit code $LASTEXITCODE)."
    }
    Refresh-ProcessPath
}

function Ensure-BuildTools {
    Refresh-ProcessPath
    $nodeMajor = Get-NodeMajorVersion
    if ($nodeMajor -lt 22) {
        $winget = Get-Command "winget" -ErrorAction SilentlyContinue
        if (-not $winget) {
            throw "Node.js 22 or newer is required. Install App Installer from the Microsoft Store to get winget, then rerun this installer."
        }

        if ($nodeMajor -eq 0) {
            Install-WingetPackage "OpenJS.NodeJS.LTS"
        } else {
            Write-Host "Updating Node.js to the current LTS required by Vencord..."
            & $winget.Source upgrade --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements
            if ($LASTEXITCODE -ne 0) {
                & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget --accept-source-agreements --accept-package-agreements --force
                if ($LASTEXITCODE -ne 0) {
                    throw "Could not update Node.js. Install OpenJS.NodeJS.LTS with winget and run the installer again."
                }
            }
            Refresh-ProcessPath
        }
    }

    if (-not (Get-Command "git" -ErrorAction SilentlyContinue)) {
        Install-WingetPackage "Git.Git"
    }

    $nodeMajor = Get-NodeMajorVersion
    if ($nodeMajor -lt 22) {
        throw "Node.js 22 or newer is still not available on PATH. Restart Windows Terminal and run the installer again."
    }

    if (-not (Get-Command "corepack" -ErrorAction SilentlyContinue)) {
        $npm = Get-Command "npm" -ErrorAction SilentlyContinue
        if (-not $npm) {
            throw "Corepack was not installed with Node.js and npm is unavailable. Reinstall OpenJS.NodeJS.LTS with winget."
        }

        Write-Host "Installing Corepack so Vencord can use its pinned pnpm version..."
        & $npm.Source install --global corepack
        if ($LASTEXITCODE -ne 0) {
            throw "Could not install Corepack with npm."
        }
        Refresh-ProcessPath
    }

    if (-not (Get-Command "git" -ErrorAction SilentlyContinue) -or -not (Get-Command "corepack" -ErrorAction SilentlyContinue)) {
        throw "Git or Corepack is still missing from PATH. Restart Windows Terminal and run the installer again."
    }
}

function Get-VerifiedInstallerCli([string]$Destination) {
    $headers = @{ "User-Agent" = "VencordCustomPluginsInstaller" }
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/Vencord/Installer/releases/latest" -Headers $headers
    $asset = $release.assets | Where-Object name -eq "VencordInstallerCli.exe" | Select-Object -First 1
    if (-not $asset -or -not $asset.digest -or -not $asset.digest.StartsWith("sha256:")) {
        throw "The latest official Vencord Installer release has no Windows CLI checksum."
    }

    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $Destination
    $actualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedHash = $asset.digest.Substring("sha256:".Length).ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "The downloaded official Vencord Installer CLI failed its SHA-256 check."
    }
}

function Test-StandardDiscordInstall([string]$Root) {
    if (Test-Path -LiteralPath (Join-Path $Root "resources\app.asar")) {
        return $true
    }

    if (-not (Test-Path -LiteralPath $Root)) {
        return $false
    }

    foreach ($appFolder in Get-ChildItem -LiteralPath $Root -Directory -Filter "app-*" -ErrorAction SilentlyContinue) {
        if (Test-Path -LiteralPath (Join-Path $appFolder.FullName "resources\app.asar")) {
            return $true
        }
    }
    return $false
}

function Configure-Vesktop([string]$VencordDirectory) {
    $dataPaths = @(
        (Join-Path $env:APPDATA "vesktop"),
        (Join-Path $env:APPDATA "Vesktop")
    )
    $exePaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\vesktop\Vesktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Vesktop\Vesktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Vesktop\Vesktop.exe")
    )
    $vesktopCommand = Get-Command "Vesktop.exe" -ErrorAction SilentlyContinue
    $dataPath = $dataPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    $detected = [bool]$dataPath -or (($exePaths | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0) -or [bool]$vesktopCommand
    if (-not $detected) {
        return $false
    }

    if (-not $dataPath) {
        $dataPath = $dataPaths[0]
        New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
    }

    $statePath = Join-Path $dataPath "state.json"
    $state = if (Test-Path -LiteralPath $statePath) {
        Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    } else {
        [pscustomobject]@{}
    }
    if ($null -eq $state) {
        $state = [pscustomobject]@{}
    }

    $resolvedVencordDirectory = [System.IO.Path]::GetFullPath($VencordDirectory)
    if ($state.vencordDir -ne $resolvedVencordDirectory) {
        if (Test-Path -LiteralPath $statePath) {
            Copy-Item -LiteralPath $statePath -Destination ($statePath + ".backup." + (Get-Date -Format "yyyyMMdd-HHmmss"))
        }
        $state | Add-Member -MemberType NoteProperty -Name "vencordDir" -Value $resolvedVencordDirectory -Force
        $tempStatePath = $statePath + ".tmp"
        ConvertTo-Json -InputObject $state -Depth 64 | Set-Content -LiteralPath $tempStatePath -Encoding UTF8
        Move-Item -LiteralPath $tempStatePath -Destination $statePath -Force
    }

    Write-Host "Configured Vesktop to load the custom Vencord build from $resolvedVencordDirectory"
    return $true
}

function Invoke-CustomDiscordInstall([string]$CliPath, [string]$Location) {
    Write-Host "Installing the custom build into $Location..."
    & $CliPath --install --location $Location
    if ($LASTEXITCODE -ne 0) {
        throw "Vencord Installer CLI could not patch $Location (exit code $LASTEXITCODE)."
    }
}

function Select-AdditionalClientFolder {
    while ($true) {
        $location = Read-Host "Enter another compatible client's install folder, or press Enter to finish"
        if ([string]::IsNullOrWhiteSpace($location)) {
            return
        }

        $location = [System.IO.Path]::GetFullPath($location.Trim('"'))
        if (-not (Test-StandardDiscordInstall $location)) {
            Write-Warning "No resources\app.asar was found in that folder or its app-* folders. The Vencord CLI needs the client's base install folder."
            continue
        }
        Invoke-CustomDiscordInstall $script:cliPath $location
    }
}

New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
try {
    Ensure-BuildTools

    $git = (Get-Command "git").Source
    $corepack = (Get-Command "corepack").Source
    Write-Host "Downloading the latest Vencord source..."
    & $git clone --depth 1 https://github.com/Vendicated/Vencord.git $upstreamRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Could not download the latest Vencord source."
    }

    Write-Host "Downloading both plugins and installer support files from GitHub..."
    & $git clone --depth 1 $pluginRepository $pluginRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Could not download the custom plugin repository."
    }

    foreach ($pluginName in @("everythingMoves", "themeStudio")) {
        $sourcePlugin = Join-Path $pluginRoot "plugins\$pluginName"
        $destinationPlugin = Join-Path $upstreamRoot "src\userplugins\$pluginName"
        if (-not (Test-Path -LiteralPath $sourcePlugin)) {
            throw "Plugin folder $sourcePlugin is missing from the GitHub repository."
        }
        if (Test-Path -LiteralPath $destinationPlugin) {
            throw "A Vencord plugin already uses the name $pluginName. Refusing to overwrite it."
        }
        New-Item -ItemType Directory -Force -Path $destinationPlugin | Out-Null
        Copy-Item -Path (Join-Path $sourcePlugin "*") -Destination $destinationPlugin -Recurse -Force
    }

    & (Join-Path $pluginRoot "installer\Patch-VencordCustomPlugins.ps1") -VencordRoot $upstreamRoot

    Push-Location $upstreamRoot
    try {
        Write-Host "Installing Vencord's pinned dependencies with Corepack..."
        & $corepack pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            throw "Vencord dependency installation failed (exit code $LASTEXITCODE)."
        }

        Write-Host "Building the newest Vencord source with both plugins..."
        & $corepack pnpm build --dev
        if ($LASTEXITCODE -ne 0) {
            throw "Vencord build failed (exit code $LASTEXITCODE)."
        }
    } finally {
        Pop-Location
    }

    $builtDesktopRenderer = Join-Path $upstreamRoot "dist\vencordDesktopRenderer.js"
    if (-not (Test-Path -LiteralPath $builtDesktopRenderer)) {
        throw "The Vencord build did not produce the desktop renderer."
    }
    $rendererText = [System.IO.File]::ReadAllText($builtDesktopRenderer)
    foreach ($pluginName in @("EverythingMoves", "ThemeStudio")) {
        if (-not $rendererText.Contains($pluginName)) {
            throw "The build output does not contain $pluginName."
        }
    }

    New-Item -ItemType Directory -Force -Path $localInstallRoot, $targetDist | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $upstreamRoot "dist") | Copy-Item -Destination $targetDist -Recurse -Force

    $cliPath = Join-Path $workRoot "VencordInstallerCli.exe"
    Get-VerifiedInstallerCli $cliPath

    $discordRoots = @(
        [pscustomobject]@{ Branch = "stable"; Path = (Join-Path $env:LOCALAPPDATA "Discord") },
        [pscustomobject]@{ Branch = "ptb"; Path = (Join-Path $env:LOCALAPPDATA "DiscordPTB") },
        [pscustomobject]@{ Branch = "canary"; Path = (Join-Path $env:LOCALAPPDATA "DiscordCanary") }
    )
    $standardClients = @($discordRoots | Where-Object { Test-StandardDiscordInstall $_.Path })

    $runningClients = @(Get-Process -Name "Discord", "DiscordPTB", "DiscordCanary", "Vesktop" -ErrorAction SilentlyContinue)
    if ($runningClients.Count -gt 0) {
        $clientNames = ($runningClients | Select-Object -ExpandProperty ProcessName -Unique) -join ", "
        Write-Host "Close these clients completely before continuing: $clientNames"
        Read-Host "After they close (including tray icons), press Enter"
        if (Get-Process -Name "Discord", "DiscordPTB", "DiscordCanary", "Vesktop" -ErrorAction SilentlyContinue) {
            throw "A Discord-compatible client is still running. Close it and rerun the installer."
        }
    }

    $vesktopDetected = Configure-Vesktop $targetDist
    $env:VENCORD_USER_DATA_DIR = $localInstallRoot
    $env:VENCORD_DEV_INSTALL = "1"
    try {
        if ($standardClients.Count -gt 0) {
            foreach ($client in $standardClients) {
                Write-Host "Installing the custom build into Discord $($client.Branch)..."
                & $cliPath --install --branch $client.Branch
                if ($LASTEXITCODE -ne 0) {
                    throw "Vencord Installer CLI could not patch Discord $($client.Branch) (exit code $LASTEXITCODE)."
                }
            }
        }

        if ($standardClients.Count -eq 0 -and -not $vesktopDetected) {
            Write-Host "No standard Discord or Vesktop installation was detected."
        }

        $addCustom = Read-Host "Install into another Discord-compatible client folder? Enter y to add one or more paths, or press Enter to skip"
        if ($addCustom -match "^[Yy]") {
            Select-AdditionalClientFolder
        }
    } finally {
        Remove-Item Env:VENCORD_USER_DATA_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:VENCORD_DEV_INSTALL -ErrorAction SilentlyContinue
    }

    Write-Host ""
    Write-Host "Custom Vencord build with EverythingMoves and Theme Studio is installed at:"
    Write-Host $targetDist
    if ($standardClients.Count -gt 0 -or $vesktopDetected) {
        Write-Host "Restart Discord or Vesktop to load the new build."
    } else {
        Write-Host "Restart the client you installed into to load the new build."
    }
    Write-Host "Both plugins are enabled by default. Favorite either from its star in Vencord plugin details."
} finally {
    if (Test-Path -LiteralPath $workRoot) {
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        $resolvedWorkRoot = [System.IO.Path]::GetFullPath($workRoot)
        $tempPrefix = $tempRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
        if (-not $resolvedWorkRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Split-Path -Leaf $resolvedWorkRoot).StartsWith("VencordCustomPlugins-")) {
            throw "Refusing to remove the installer work folder outside its expected temp location."
        }
        Remove-Item -LiteralPath $resolvedWorkRoot -Recurse -Force
    }
}
