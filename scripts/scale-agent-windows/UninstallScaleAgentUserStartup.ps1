[CmdletBinding()]
param(
  [string]$ShortcutName = 'Milk Collection Scale Agent.lnk'
)

$ErrorActionPreference = 'Stop'

$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder $ShortcutName

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host "Removed user startup shortcut: $shortcutPath"
} else {
  Write-Host "User startup shortcut not found: $shortcutPath"
}

& (Join-Path $PSScriptRoot 'StopScaleAgent.ps1') -ErrorAction SilentlyContinue
