[CmdletBinding()]
param(
  [string]$TaskName = 'MilkCollectionScaleAgent'
)

$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'StopScaleAgent.ps1') -TaskName $TaskName

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task: $TaskName" -ForegroundColor Green
} else {
  Write-Host "Scheduled task already absent: $TaskName"
}
