$ErrorActionPreference="Stop"
$target="C:\Projects\Mumbai Civic Lens\mumbai-civic-lens"
$source=(Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if($source -ieq $target){Write-Host "Already at canonical location"; exit 0}
New-Item -ItemType Directory -Force -Path $target | Out-Null
if((Get-ChildItem $target -Force -ErrorAction SilentlyContinue).Count -gt 0){throw "Target is not empty: $target"}
Copy-Item (Join-Path $source "*") $target -Recurse -Force
Write-Host "Copied repository to $target. Open that folder as the only Claude workspace."
