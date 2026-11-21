<#
 One-click stage launcher for the Follow the Rupee demo (hackathon branch only).
 Starts: Postgres container (if needed) -> mcl-api on 127.0.0.1:8080 -> Vite on localhost:5173.
 Never prints .env.local, database URLs or credentials. PIDs are stored outside Git.

 Why /health/ready alone is NOT enough: it probes only the civic_lens read pool. The demo reads civic_lens_monsoon through a
 separate pool, and on this branch the command (write) path is intentionally disabled (OF-H2-CMD-ROLE). So readiness is
 /health/capabilities (monsoonReads == AVAILABLE and commands == DISABLED) AND a real /v1/monsoon/overview 200.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$pidFile = Join-Path $root '.demo-run\demo_pids.json'
New-Item -ItemType Directory -Force -Path (Split-Path $pidFile) | Out-Null

function Wait-Http($url, $test, $seconds = 90) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200 -and (& $test $r.Content)) { return $true }
    } catch { }
    Start-Sleep -Milliseconds 700
  }
  return $false
}

# 1. database container
$running = podman ps --format '{{.Names}}' | Where-Object { $_ -eq 'mumbai-civic-lens_db_1' }
if (-not $running) { Write-Host 'Starting mumbai-civic-lens_db_1 ...'; podman start mumbai-civic-lens_db_1 | Out-Null; Start-Sleep -Seconds 6 }

# 2. API (prebuilt binary if it is newer than every Rust source, else cargo build first)
$exe = Join-Path $root 'target\debug\mcl-api.exe'
$newest = Get-ChildItem -Recurse -Path (Join-Path $root 'crates') -Include *.rs,Cargo.toml | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $exe) -or $newest.LastWriteTime -gt (Get-Item $exe).LastWriteTime) {
  Write-Host 'Building mcl-api (sources are newer than the binary) ...'
  $env:CARGO_REGISTRIES_CRATES_IO_PROTOCOL = 'git'
  cargo build -p mcl-api --locked
}
$logDir = Split-Path $pidFile
# Child output goes to files outside Git (never to this console) so no handle is inherited and nothing secret is echoed.
$api = Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'api.out.log') -RedirectStandardError (Join-Path $logDir 'api.err.log')

# 3. Vite
$vite = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'pnpm --filter web exec vite --host localhost --port 5173 --strictPort' -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'vite.out.log') -RedirectStandardError (Join-Path $logDir 'vite.err.log')

@{ api = $api.Id; viteShell = $vite.Id; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $pidFile -Encoding UTF8

# 4. triple readiness
$capOk = Wait-Http 'http://127.0.0.1:8080/health/capabilities' { param($c) $j = $c | ConvertFrom-Json; $j.monsoonReads -eq 'AVAILABLE' -and $j.commands -eq 'DISABLED' }
$ovOk = Wait-Http 'http://127.0.0.1:8080/v1/monsoon/overview' { param($c) $true }
$webOk = Wait-Http 'http://localhost:5173/' { param($c) $true }
Write-Host ("capabilities (monsoonReads=AVAILABLE, commands=DISABLED): {0}" -f $capOk)
Write-Host ("overview 200: {0}" -f $ovOk)
Write-Host ("web 200: {0}" -f $webOk)
if (-not ($capOk -and $ovOk -and $webOk)) { Write-Error 'Demo stack is not ready; run scripts\stop_hackathon_demo.ps1 and retry.'; exit 1 }
Write-Host ''
Write-Host 'Stage URL:   http://localhost:5173/'
Write-Host 'Capability:  http://127.0.0.1:8080/health/capabilities'
