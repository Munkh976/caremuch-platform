# Deploy the CareMuch frontend (phase-3) to the Fly.io dev app caremuch-platform.
# Windows PowerShell 5.1 compatible. Run from the repo root:  .\scripts\deploy.ps1
#
# Refuses to run unless:
#   - the current branch is phase-3;
#   - no build input has uncommitted changes (src, public, index.html, package*.json, Dockerfile, vite.config.ts,
#     tailwind.config.ts);
#   - HEAD equals origin/phase-3 after `git fetch`.
# Then it reads VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_SUPABASE_PROJECT_ID from .env.local, prints only
# their lengths (never the values), runs `fly deploy --app caremuch-platform` with them as --build-arg, and appends the
# commit, the time and the Fly release version to docs/deploys.md (commit that file afterwards).
# These three values are baked into the browser bundle; the publishable (anon) key is public by design.

# 'Continue': in PowerShell 5.1 a redirected native stderr line would otherwise stop the script; every step checks
# $LASTEXITCODE itself
$ErrorActionPreference = 'Continue'
$App = 'caremuch-platform'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Fail([string]$msg) { Write-Host "REFUSED: $msg" -ForegroundColor Red; exit 1 }

# --- git checks ---
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0) { Fail 'not a git repository' }
if ($branch -ne 'phase-3') { Fail "current branch is '$branch'; deploys come from phase-3 only" }

$inputs = @('src', 'public', 'index.html', 'package.json', 'package-lock.json', 'Dockerfile', 'vite.config.ts', 'tailwind.config.ts')
$dirty = git status --porcelain -- $inputs
if ($dirty) { Write-Host $dirty; Fail 'build inputs have uncommitted changes (listed above)' }

git fetch origin phase-3 --quiet
if ($LASTEXITCODE -ne 0) { Fail 'git fetch failed' }
$head = (git rev-parse HEAD).Trim()
$remote = (git rev-parse origin/phase-3).Trim()
if ($head -ne $remote) { Fail "HEAD $($head.Substring(0,7)) is not origin/phase-3 $($remote.Substring(0,7)); push or pull first" }

# --- build args from .env.local (values never printed) ---
$envFile = Join-Path $Root '.env.local'
if (-not (Test-Path $envFile)) { Fail '.env.local not found' }
$names = @('VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PROJECT_ID')
$vals = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*(VITE_SUPABASE_[A-Z_]+)\s*=\s*(.*)$') {
    $v = $matches[2].Trim()
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
    $vals[$matches[1]] = $v
  }
}
foreach ($n in $names) {
  $len = 0
  if ($vals.ContainsKey($n) -and $vals[$n]) { $len = $vals[$n].Length }
  Write-Host ("{0} length {1}" -f $n, $len)
  if ($len -eq 0) { Fail "$n is missing or empty in .env.local" }
}

# --- flyctl ---
$fly = $null
foreach ($c in @('fly', 'flyctl')) { $cmd = Get-Command $c -ErrorAction SilentlyContinue; if ($cmd) { $fly = $cmd.Source; break } }
if (-not $fly) { $p = Join-Path $env:USERPROFILE '.fly\bin\flyctl.exe'; if (Test-Path $p) { $fly = $p } }
if (-not $fly) { Fail 'flyctl not found (install it, then `fly auth login`)' }
& $fly auth whoami *> $null
if ($LASTEXITCODE -ne 0) { Fail 'flyctl is not logged in: run `fly auth login` first' }

# --- deploy ---
Write-Host "Deploying $($head.Substring(0,7)) to $App ..."
& $fly deploy --app $App `
  --build-arg "VITE_SUPABASE_URL=$($vals['VITE_SUPABASE_URL'])" `
  --build-arg "VITE_SUPABASE_PUBLISHABLE_KEY=$($vals['VITE_SUPABASE_PUBLISHABLE_KEY'])" `
  --build-arg "VITE_SUPABASE_PROJECT_ID=$($vals['VITE_SUPABASE_PROJECT_ID'])"
if ($LASTEXITCODE -ne 0) { Fail "fly deploy failed (exit $LASTEXITCODE); nothing recorded" }

# --- record ---
$release = '?'
$json = & $fly releases --app $App --json 2>$null
if ($LASTEXITCODE -eq 0 -and $json) {
  try { $rel = ($json | Out-String | ConvertFrom-Json) | Select-Object -First 1; if ($rel.Version) { $release = "v$($rel.Version)" } } catch { $release = '?' }
}
$log = Join-Path $Root 'docs\deploys.md'
if (-not (Test-Path $log)) {
  Set-Content -Path $log -Encoding UTF8 -Value @('# Deploys to Fly.io (caremuch-platform)', '', 'Appended by scripts/deploy.ps1.', '', '| Commit | Time (UTC) | Fly release |', '|---|---|---|')
}
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')
Add-Content -Path $log -Encoding UTF8 -Value ("| {0} | {1} | {2} |" -f $head.Substring(0,7), $stamp, $release)
Write-Host "Deployed $($head.Substring(0,7)) as $release; recorded in docs/deploys.md (commit it)."
