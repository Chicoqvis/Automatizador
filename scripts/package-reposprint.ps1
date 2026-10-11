$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskExtension = Join-Path $taskRoot 'extensions/reposprint'
$taskOutput = Join-Path $taskRoot 'public/downloads/reposprint-extension.zip'
$taskManifest = Get-Content (Join-Path $taskExtension 'manifest.json') -Raw | ConvertFrom-Json
Compress-Archive -LiteralPath $taskExtension -DestinationPath $taskOutput -Force
$taskFiles = [ordered]@{}
Get-ChildItem -LiteralPath $taskExtension -File | Sort-Object Name | ForEach-Object { $taskFiles[$_.Name] = [IO.File]::ReadAllText($_.FullName) }
$taskBundle = @{version=$taskManifest.version;files=$taskFiles} | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $taskRoot 'public/downloads/reposprint-extension.json'),$taskBundle)
Write-Output "Extensão RepoSprint $($taskManifest.version): ZIP e pacote de arquivos preparados."
