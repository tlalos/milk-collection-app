[CmdletBinding()]
param(
  [string]$TaskName = 'MilkCollectionScaleAgent',
  [string]$AgentUrl = 'http://127.0.0.1:8795'
)

$ErrorActionPreference = 'Continue'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Task: $TaskName"
  Write-Host "State: $($task.State)"
  Write-Host "Last run: $($taskInfo.LastRunTime)"
  Write-Host "Last result: $($taskInfo.LastTaskResult)"
} else {
  Write-Host "Task not installed: $TaskName" -ForegroundColor Yellow
}

$startupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'Milk Collection Scale Agent.lnk'
if (Test-Path -LiteralPath $startupShortcut) {
  Write-Host "User startup shortcut: $startupShortcut"
} else {
  Write-Host 'User startup shortcut: not installed'
}

$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'weighbridgeAgentPortable\.mjs' }
if ($processes) {
  foreach ($process in $processes) {
    Write-Host "Agent process: running as PID $($process.ProcessId)"
  }
} else {
  Write-Host 'Agent process: not running' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "Health: $AgentUrl/health"
try {
  Invoke-RestMethod -Uri "$AgentUrl/health" -TimeoutSec 5 | ConvertTo-Json -Depth 8
} catch {
  Write-Host "Health check failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ''
Write-Host "Current weight: $AgentUrl/current-weight"
try {
  Invoke-RestMethod -Uri "$AgentUrl/current-weight" -TimeoutSec 10 | ConvertTo-Json -Depth 8
} catch {
  Write-Host "Weight check failed: $($_.Exception.Message)" -ForegroundColor Red
}
