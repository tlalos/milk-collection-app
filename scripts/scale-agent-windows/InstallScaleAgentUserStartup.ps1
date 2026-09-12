[CmdletBinding()]
param(
  [string]$ShortcutName = 'Milk Collection Scale Agent.lnk'
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$vbsPath = Join-Path $root 'RunScaleAgentHidden.vbs'
$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder $ShortcutName
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $vbsPath)) {
  throw "Missing $vbsPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = 'Milk Collection local weighbridge scale agent'
$shortcut.Save()

& (Join-Path $root 'StopScaleAgent.ps1') -ErrorAction SilentlyContinue
wscript.exe $vbsPath
Start-Sleep -Seconds 2

Write-Host "Installed user startup shortcut: $shortcutPath" -ForegroundColor Green
Write-Host "Node: $nodePath"
Write-Host "Agent folder: $root"
Write-Host 'The agent now runs hidden when this Windows user logs in.'
Write-Host 'Use CheckScaleAgent.cmd to verify it, or StopScaleAgent.cmd to stop it.'
