<#
.SYNOPSIS
  Configura o StockGuard em um projeto Supabase (desenvolvimento e testes).

.DESCRIPTION
  - Conecta pelo Session Pooler (IPv4) como "postgres".
  - Cria os papeis stockguard_migrator / stockguard_app com senhas aleatorias.
  - Cria os schemas stockguard (dados) e stockguard_test (testes automatizados),
    fora da API REST publica do Supabase.
  - Gera backend/.env e backend/.env.test.

  A senha do "postgres" e lida de $env:SUPABASE_DB_PASSWORD ou pedida no terminal.
  Ela nao e gravada em nenhum arquivo. Troque-a no painel do Supabase se tiver sido exposta.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\setup-supabase.ps1 -ProjectRef abcdefgh -AdminEmail voce@empresa.com
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$AdminEmail,
  [string]$PoolerHost = "aws-0-sa-east-1.pooler.supabase.com",
  [int]$Port = 5432,
  [string]$PsqlPath = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "setup-common.ps1")

$backendDir = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $backendDir ".env"
$envTestFile = Join-Path $backendDir ".env.test"

if ($ProjectRef -notmatch '^[a-z0-9]{10,40}$') { throw "ProjectRef invalido." }
$AdminEmail = $AdminEmail.Trim().ToLowerInvariant()
if ($AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "E-mail invalido." }

if (-not $PsqlPath) {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { $PsqlPath = $cmd.Source }
  elseif (Test-Path "D:\Postgre\bin\psql.exe") { $PsqlPath = "D:\Postgre\bin\psql.exe" }
  else { throw "psql nao encontrado. Informe -PsqlPath." }
}

if (((Test-Path $envFile) -or (Test-Path $envTestFile)) -and -not $Force) {
  throw "backend/.env ou backend/.env.test ja existem. Use -Force para regenerar as credenciais."
}

$superPassword = $env:SUPABASE_DB_PASSWORD
if (-not $superPassword) {
  $secure = Read-Host "Senha do usuario postgres do Supabase" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $superPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$migPw = New-HexSecret 24
$appPw = New-HexSecret 24
$adminTempPassword = New-TempPassword

try {
  $env:PGPASSWORD = $superPassword
  & $PsqlPath "host=$PoolerHost port=$Port dbname=postgres user=postgres.$ProjectRef sslmode=require connect_timeout=15" -X -q `
    -v ON_ERROR_STOP=1 -v "mig_pw=$migPw" -v "app_pw=$appPw" `
    -f (Join-Path $PSScriptRoot "setup-supabase.sql")
  if ($LASTEXITCODE -ne 0) { throw "psql retornou codigo $LASTEXITCODE." }
}
finally {
  $env:PGPASSWORD = $null
  $superPassword = $null
}

function Get-SupabaseUrl([string]$role, [string]$password) {
  return "postgresql://$role.${ProjectRef}:$password@${PoolerHost}:$Port/postgres?sslmode=require"
}

foreach ($isTest in @($false, $true)) {
  $lines = @(
    "# Gerado por scripts/setup-supabase.ps1. NAO versionar.",
    "NODE_ENV=$(if ($isTest) { 'test' } else { 'development' })",
    "HOST=127.0.0.1",
    "PORT=$(if ($isTest) { '3334' } else { '3333' })",
    "DATABASE_URL=$(Get-SupabaseUrl 'stockguard_app' $appPw)",
    "MIGRATION_DATABASE_URL=$(Get-SupabaseUrl 'stockguard_migrator' $migPw)",
    "DATABASE_SCHEMA=$(if ($isTest) { 'stockguard_test' } else { 'stockguard' })",
    "DATABASE_SSL=require"
  ) + (Get-CommonEnvLines $isTest)
  if (-not $isTest) {
    $lines += "# Usado apenas por 'npm run db:seed'. Remova apos o primeiro acesso."
    $lines += "SEED_ADMIN_NAME=Administrador"
    $lines += "SEED_ADMIN_EMAIL=$AdminEmail"
    $lines += "SEED_ADMIN_PASSWORD=$adminTempPassword"
  }
  Write-Utf8File $(if ($isTest) { $envTestFile } else { $envFile }) $lines
}

Write-Host "Supabase configurado. Arquivos gerados: backend/.env e backend/.env.test" -ForegroundColor Green
Write-Host "A senha temporaria do administrador esta em SEED_ADMIN_PASSWORD (backend/.env)." -ForegroundColor Yellow
