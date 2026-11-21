<# Stops ONLY the processes the start script launched (API and Vite). The Postgres container is left running. #>
$pidFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.demo-run\demo_pids.json'
if (-not (Test-Path $pidFile)) { Write-Host 'No launcher PID file; nothing to stop.'; exit 0 }
$p = Get-Content $pidFile -Raw | ConvertFrom-Json
function Stop-Tree($id) {
  if ($id) { try { taskkill /PID $id /T /F 2>&1 | Out-Null } catch { } }
}
Stop-Tree $p.viteShell
Stop-Tree $p.api
# Vite's node child holds port 5173 if the shell tree was already detached: stop only the listener on that port.
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Tree $_.OwningProcess }
Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
Write-Host 'Stopped API and Vite. Database container left running.'
