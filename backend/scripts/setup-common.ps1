# Funcoes compartilhadas pelos scripts de configuracao do banco (somente ASCII).

$script:SgRng = [Security.Cryptography.RandomNumberGenerator]::Create()

function New-RandomBytes([int]$count) {
  $buffer = New-Object byte[] $count
  $script:SgRng.GetBytes($buffer)
  return ,$buffer
}

function New-HexSecret([int]$count) {
  $bytes = New-RandomBytes $count
  return ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
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

function Write-Utf8File([string]$path, [string[]]$lines) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), $utf8NoBom)
}

# Variaveis comuns aos arquivos .env (seguranca, sessao, chaves aleatorias).
function Get-CommonEnvLines([bool]$isTest) {
  return @(
    "FRONTEND_ORIGIN=http://localhost:3000",
    "TRUST_PROXY=127.0.0.1",
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
}
