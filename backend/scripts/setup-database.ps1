<#
.SYNOPSIS
  Configura o PostgreSQL local para o StockGuard (desenvolvimento e testes).

.DESCRIPTION
  - Pede a senha do superusuario APENAS neste terminal (nao e gravada em lugar nenhum).
  - Cria os papeis stockguard_migrator / stockguard_app com senhas aleatorias.
  - Cria os bancos stockguard_dev e stockguard_test com privilegios minimos.
  - Gera backend/.env e backend/.env.test com credenciais e chaves aleatorias.

  Pode ser executado novamente com -Force: as senhas dos papeis sao
  regeneradas e os arquivos .env reescritos.

  Este arquivo usa apenas ASCII de proposito (Windows PowerShell 5.1 le
  scripts sem BOM como ANSI).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\setup-database.ps1
#>
param(
  [string]$PsqlPath = "",
  [string]$DbHost = "localhost",
  [int]$Port = 5432,
  [string]$SuperUser = "postgres",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$backendDir = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $backendDir ".env"
$envTestFile = Join-Path $backendDir ".env.test"
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()

function New-RandomBytes([int]$count) {
  $buffer = New-Object byte[] $count
  $rng.GetBytes($buffer)
  return ,$buffer
}

function New-HexSecret([int]$count) {
  return ((New-RandomBytes $count | ForEach-Object { $_.ToString("x2") }) -join "")
}

function New-Base64Secret([int]$count) {
  return [Convert]::ToBase64String((New-RandomBytes $count))
}

function Get-RandomChar([string]$set) {
  $value = [BitConverter]::ToUInt32((New-RandomBytes 4), 0)
  return $set[[int]($value % [uint32]$set.Length)]
}

function New-TempPassword {
  # 20 caracteres com maiusculas, minusculas, digitos e simbolos.
  $sets = @("ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "#%*+-_=?")
  $chars = New-Object System.Collections.Generic.List[char]
  foreach ($s in $sets) { $chars.Add((Get-RandomChar $s)) }
  $all = $sets -join ""
  while ($chars.Count -lt 20) { $chars.Add((Get-RandomChar $all)) }
  $shuffled = $chars | Sort-Object { [BitConverter]::ToUInt32((New-RandomBytes 4), 0) }
  return (-join $shuffled)
}

if (-not $PsqlPath) {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { $PsqlPath = $cmd.Source }
  elseif (Test-Path "D:\Postgre\bin\psql.exe") { $PsqlPath = "D:\Postgre\bin\psql.exe" }
  else { throw "psql nao encontrado. Informe -PsqlPath 'C:\caminho\psql.exe'." }
}

if (((Test-Path $envFile) -or (Test-Path $envTestFile)) -and -not $Force) {
  throw "backend/.env ou backend/.env.test ja existem. Rode novamente com -Force para regenerar as credenciais."
}

$adminEmail = (Read-Host "E-mail do primeiro administrador do StockGuard").Trim().ToLowerInvariant()
if ($adminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "E-mail invalido." }

$secure = Read-Host "Senha do superusuario '$SuperUser' do PostgreSQL" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

$migPw = New-HexSecret 24
$appPw = New-HexSecret 24
$adminTempPassword = New-TempPassword

try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  & $PsqlPath -h $DbHost -p $Port -U $SuperUser -d postgres -X -q `
    -v ON_ERROR_STOP=1 -v "mig_pw=$migPw" -v "app_pw=$appPw" `
    -f (Join-Path $PSScriptRoot "setup-database.sql")
  if ($LASTEXITCODE -ne 0) { throw "psql retornou codigo $LASTEXITCODE." }
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

function Write-EnvFile([string]$path, [string]$database, [bool]$isTest) {
  $lines = @(
    "# Gerado por scripts/setup-database.ps1. NAO versionar.",
    "NODE_ENV=$(if ($isTest) { 'test' } else { 'development' })",
    "HOST=127.0.0.1",
    "PORT=$(if ($isTest) { '3334' } else { '3333' })",
    "DATABASE_URL=postgresql://stockguard_app:$appPw@${DbHost}:$Port/$database",
    "MIGRATION_DATABASE_URL=postgresql://stockguard_migrator:$migPw@${DbHost}:$Port/$database",
    "FRONTEND_ORIGIN=http://localhost:3000",
    "TRUST_PROXY=false",
    "COOKIE_SECURE=false",
    "SESSION_TTL_HOURS=12",
    "SESSION_IDLE_MINUTES=30",
    "MFA_REQUIRED_ROLES=ADMIN",
    "MFA_ENCRYPTION_KEY=$(New-Base64Secret 32)",
    "AUDIT_HMAC_KEY=$(New-Base64Secret 32)",
    "APP_TIMEZONE=America/Sao_Paulo",
    "LOG_LEVEL=$(if ($isTest) { 'silent' } else { 'info' })",
    "EVIDENCE_STORAGE_DIR=$(if ($isTest) { 'storage/evidence-test' } else { 'storage/evidence' })"
  )
  if (-not $isTest) {
    $lines += "# Usado apenas por 'npm run db:seed'. Remova apos o primeiro acesso."
    $lines += "SEED_ADMIN_NAME=Administrador"
    $lines += "SEED_ADMIN_EMAIL=$adminEmail"
    $lines += "SEED_ADMIN_PASSWORD=$adminTempPassword"
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $utf8NoBom)
}

Write-EnvFile $envFile "stockguard_dev" $false
Write-EnvFile $envTestFile "stockguard_test" $true

Write-Host ""
Write-Host "Banco configurado com sucesso." -ForegroundColor Green
Write-Host "Arquivos gerados: backend/.env e backend/.env.test"
Write-Host ""
Write-Host "Senha TEMPORARIA do administrador ($adminEmail):" -ForegroundColor Yellow
Write-Host "  $adminTempPassword" -ForegroundColor Yellow
Write-Host "No primeiro acesso sera exigida a configuracao do MFA e a troca da senha."
