[CmdletBinding()]
param(
  [string]$TaskName = 'MilkCollectionScaleAgent'
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$runnerPath = Join-Path $root 'RunScaleAgentBackground.ps1'
$agentPath = Join-Path $root 'weighbridgeAgentPortable.mjs'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $runnerPath)) {
  throw "Missing $runnerPath"
}
if (-not (Test-Path -LiteralPath $agentPath)) {
  throw "Missing $agentPath"
}

$action = New-ScheduledTaskAction `
  -Execute $powershellPath `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Milk Collection local weighbridge scale agent' `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

Write-Host "Installed scheduled task: $TaskName" -ForegroundColor Green
Write-Host "Node: $nodePath"
Write-Host "Agent folder: $root"
Write-Host 'The agent now runs hidden after this Windows user logs in.'
Write-Host 'Use CheckScaleAgent.cmd to verify it, or StopScaleAgent.cmd to stop it.'
