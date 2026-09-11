param(
  [string]$PortName = "",
  [int]$BaudRate = 9600,
  [int]$ReadWindowMs = 2500
)

$ErrorActionPreference = "Stop"

function Show-Ports {
  Write-Host "Available COM ports:"
  $ports = [System.IO.Ports.SerialPort]::GetPortNames() | Sort-Object
  if (-not $ports.Count) {
    Write-Host "  No COM ports found."
    return
  }
  foreach ($port in $ports) {
    Write-Host "  $port"
  }
}

function Parse-Reading([string]$Line) {
  $text = $Line.Trim()
  $match = [regex]::Match($text, "^(ST|US)\s*,\s*([A-Z]+)\s*,\s*([+-])\s*(\d+(?:[\.,]\d+)?)\s*kg$", "IgnoreCase")
  if (-not $match.Success) {
    return $null
  }

  $sign = if ($match.Groups[3].Value -eq "-") { -1 } else { 1 }
  $numberText = $match.Groups[4].Value.Replace(",", ".")
  $weight = 0.0
  if (-not [double]::TryParse($numberText, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$weight)) {
    return $null
  }

  [pscustomobject]@{
    Raw = $text
    Stable = $match.Groups[1].Value.ToUpperInvariant() -eq "ST"
    Mode = $match.Groups[2].Value.ToUpperInvariant()
    WeightKg = $sign * $weight
    CapturedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  }
}

Show-Ports

if (-not $PortName) {
  $PortName = Read-Host "Enter scale COM port, for example COM11"
}

Write-Host ""
Write-Host "Reading $PortName at $BaudRate baud for $ReadWindowMs ms..."

$port = New-Object System.IO.Ports.SerialPort $PortName,$BaudRate,"None",8,"One"
$port.ReadTimeout = 500
$port.WriteTimeout = 500

try {
  $port.Open()
  Start-Sleep -Milliseconds $ReadWindowMs
  $raw = $port.ReadExisting()
}
finally {
  if ($port.IsOpen) {
    $port.Close()
  }
}

Write-Host ""
Write-Host "Raw data:"
if ($raw.Trim()) {
  $raw.Trim().Split([Environment]::NewLine) | ForEach-Object { Write-Host "  $_" }
} else {
  Write-Host "  No data received."
}

$lines = $raw -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
$readings = @()
foreach ($line in $lines) {
  $reading = Parse-Reading $line
  if ($reading) {
    $readings += $reading
  }
}

Write-Host ""
if ($readings.Count) {
  $last = $readings[-1]
  Write-Host "Parsed reading:"
  Write-Host "  Weight kg : $($last.WeightKg)"
  Write-Host "  Stable    : $($last.Stable)"
  Write-Host "  Mode      : $($last.Mode)"
  Write-Host "  Time      : $($last.CapturedAt)"
  Write-Host ""
  Write-Host "SUCCESS: this computer can read the scale."
} else {
  Write-Host "FAILED: data was received but it did not match the expected scale format."
  exit 1
}
