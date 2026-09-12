$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

$logDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

$logPath = Join-Path $logDir 'scale-agent.log'
$agentPath = Join-Path $PSScriptRoot 'weighbridgeAgentPortable.mjs'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

while ($true) {
  $startedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -LiteralPath $logPath -Value "[$startedAt] Starting weighbridge agent with $nodePath"
  try {
    & $nodePath $agentPath *>> $logPath
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    $stoppedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logPath -Value "[$stoppedAt] Agent stopped with exit code $exitCode. Restarting in 5 seconds."
  } catch {
    $failedAt = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logPath -Value "[$failedAt] Agent failed: $($_.Exception.Message). Restarting in 5 seconds."
  }
  Start-Sleep -Seconds 5
}
