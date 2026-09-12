[CmdletBinding()]
param(
  [string]$Port = 'COM5',
  [int]$BaudRate = 9600,
  [int]$ReadWindowMs = 2500,
  [int]$AgentPort = 8795,
  [string]$OutputDirectory = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safePort = $Port -replace '[^A-Za-z0-9_-]', ''
$packageName = "weighbridge-agent-$safePort-$timestamp"
$packageDir = Join-Path $OutputDirectory $packageName
$templateDir = Join-Path $PSScriptRoot 'scale-agent-windows'

New-Item -ItemType Directory -Path $packageDir | Out-Null

Copy-Item -LiteralPath (Join-Path $root 'scripts\weighbridgeAgentPortable.mjs') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $root 'scripts\testWeighbridgePort.ps1') -Destination $packageDir
Copy-Item -Path (Join-Path $templateDir '*') -Destination $packageDir -Recurse

@"
WEIGHBRIDGE_ENABLED=true
WEIGHBRIDGE_SERIAL_PORT=$Port
WEIGHBRIDGE_BAUD_RATE=$BaudRate
WEIGHBRIDGE_READ_WINDOW_MS=$ReadWindowMs
WEIGHBRIDGE_AGENT_HOST=127.0.0.1
WEIGHBRIDGE_AGENT_PORT=$AgentPort
"@ | Set-Content -LiteralPath (Join-Path $packageDir '.env') -Encoding ASCII

@"
@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0testWeighbridgePort.ps1" -PortName $Port -BaudRate $BaudRate -ReadWindowMs $ReadWindowMs
pause
"@ | Set-Content -LiteralPath (Join-Path $packageDir 'TestScalePort.cmd') -Encoding ASCII

$zipPath = Join-Path $OutputDirectory "$packageName.zip"
Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Created $zipPath" -ForegroundColor Green
Write-Host "Copy this zip to the reception computer, unzip it to C:\MilkScaleAgent, then run InstallScaleAgentUserStartup.cmd."
