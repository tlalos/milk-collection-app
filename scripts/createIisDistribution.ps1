param(
  [string]$BasePath = "/milk/",
  [string]$Suffix = "milkbase"
)

$ErrorActionPreference = "Stop"

function Normalize-BasePath([string]$Value) {
  $trimmed = ""
  if ($null -ne $Value) {
    $trimmed = $Value.Trim()
  }
  if (-not $trimmed) {
    return "/"
  }
  if (-not $trimmed.StartsWith("/")) {
    $trimmed = "/$trimmed"
  }
  if (-not $trimmed.EndsWith("/")) {
    $trimmed = "$trimmed/"
  }
  return $trimmed
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$normalizedBasePath = Normalize-BasePath $BasePath
$previousBasePath = $env:VITE_BASE_PATH

Push-Location $repoRoot
try {
  $commit = (& git rev-parse --short HEAD).Trim()
  if (-not $commit) {
    throw "Could not read the current git commit."
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safeSuffix = ($Suffix -replace "[^A-Za-z0-9._-]+", "-").Trim("-")
  if (-not $safeSuffix) {
    $safeSuffix = "iis"
  }

  $packageName = "milk-collection-iis-$commit-$stamp-$safeSuffix"
  $stageRoot = Join-Path $repoRoot ".$packageName"
  $zipPath = Join-Path $repoRoot "$packageName.zip"

  if (Test-Path -LiteralPath $stageRoot) {
    throw "Stage folder already exists: $stageRoot"
  }
  if (Test-Path -LiteralPath $zipPath) {
    throw "Package already exists: $zipPath"
  }

  $env:VITE_BASE_PATH = $normalizedBasePath
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed."
  }

  New-Item -ItemType Directory -Path $stageRoot | Out-Null

  foreach ($item in @("dist", "public", "scripts", "server")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $item) -Destination $stageRoot -Recurse
  }

  foreach ($file in @(".env.example", "DEPLOYMENT.md", "README.md", "package-lock.json", "package.json", "web.config")) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $stageRoot
  }

  $indexHtml = Get-Content -LiteralPath (Join-Path $stageRoot "dist\index.html") -Raw
  $assetPrefix = $normalizedBasePath
  if ($assetPrefix -eq "/") {
    $assetPrefix = "/"
  }
  if ($indexHtml -notmatch [regex]::Escape("src=""$assetPrefix")) {
    throw "The packaged index.html does not reference assets under '$normalizedBasePath'."
  }

  $items = Get-ChildItem -LiteralPath $stageRoot
  Compress-Archive -Path $items.FullName -DestinationPath $zipPath -CompressionLevel Optimal

  [pscustomobject]@{
    Package = $zipPath
    Stage = $stageRoot
    Commit = $commit
    BasePath = $normalizedBasePath
    SizeBytes = (Get-Item -LiteralPath $zipPath).Length
  } | Format-List
}
finally {
  $env:VITE_BASE_PATH = $previousBasePath
  Pop-Location
}
