# EUMBMS Windows Server 설치 스크립트 (PowerShell, 관리자 권한)
# 사용: .\scripts\install-windows.ps1 -DatabaseUrl "postgresql://eumbms:비밀번호@127.0.0.1:5432/eumbms?schema=public"
param(
  [Parameter(Mandatory = $true)] [string]$DatabaseUrl,
  [string]$InstallDir = "C:\EUMBMS",
  [switch]$Seed
)

$ErrorActionPreference = "Stop"
Write-Host "EUMBMS Windows 설치 시작"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 24가 필요합니다. https://nodejs.org 에서 LTS(24.x)를 설치하세요."
}
$nodeVersion = node -v
Write-Host "Node.js $nodeVersion"

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Warning "psql이 PATH에 없습니다. PostgreSQL 18 클라이언트를 설치하거나 PATH에 추가하세요."
}

$source = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Recurse -Force "$source\*" $InstallDir -Exclude @("node_modules", ".next")

Set-Location $InstallDir

Write-Host "── 의존성 설치 ──"
npm ci --no-audit --no-fund

if (-not (Test-Path ".env")) {
  $secret = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
  @"
DATABASE_URL="$DatabaseUrl"
SESSION_SECRET="$secret"
APP_NAME="EUMBMS"
ENABLE_COLLECTOR="0"
"@ | Set-Content -Encoding UTF8 ".env"
  Write-Host ".env 생성 완료"
}

Write-Host "── DB 마이그레이션 ──"
$env:DATABASE_URL = $DatabaseUrl
npx prisma migrate deploy
if ($Seed) {
  npx tsx prisma/seed.ts
}

Write-Host "── 빌드 ──"
npm run build

Write-Host "── 방화벽 (3000) ──"
New-NetFirewallRule -DisplayName "EUMBMS 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -ErrorAction SilentlyContinue | Out-Null

Write-Host "── 서비스 등록 안내 ──"
Write-Host "Windows 서비스로 등록하려면 NSSM(https://nssm.cc)을 사용하세요:"
Write-Host "  nssm install EUMBMS `"$env:ProgramFiles\nodejs\npm.cmd`" start"
Write-Host "  nssm set EUMBMS AppDirectory `"$InstallDir`""
Write-Host "  nssm set EUMBMS AppStdout `"$InstallDir\logs\server.log`""
Write-Host "  nssm start EUMBMS"
Write-Host ""
Write-Host "설치 완료: https://<서버IP>:3000  (초기 계정 admin@eumbms.local / Eumbms!2026 — 즉시 변경)"
Write-Host "게이트웨이: 같은 폴더에서 아래 환경변수 후 npm run gateway"
Write-Host "  `$env:EUMBMS_CENTRAL_URL='http://127.0.0.1:3000'"
Write-Host "  `$env:EUMBMS_GATEWAY_TOKEN='eum_...'"
