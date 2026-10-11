$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskExtension = Join-Path $taskRoot 'extensions/reposprint'
$taskOutput = Join-Path $taskRoot 'public/downloads/reposprint-extension.zip'
$taskManifest = Get-Content (Join-Path $taskExtension 'manifest.json') -Raw | ConvertFrom-Json
Compress-Archive -LiteralPath $taskExtension -DestinationPath $taskOutput -Force
Write-Output "Extensão RepoSprint $($taskManifest.version): $taskOutput"
