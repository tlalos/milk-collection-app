[CmdletBinding()]
param(
  [string]$TaskName = 'MilkCollectionScaleAgent'
)

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Write-Host "Stopped scheduled task: $TaskName"
} else {
  Write-Host "Scheduled task not found: $TaskName"
}

$processes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'weighbridgeAgentPortable\.mjs' }

foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
  Write-Host "Stopped agent process: $($process.ProcessId)"
}

if (-not $processes) {
  Write-Host 'No running weighbridge agent process was found.'
}
