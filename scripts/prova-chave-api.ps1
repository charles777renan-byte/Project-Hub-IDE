<#
.SYNOPSIS
  Prova na máquina das contas por chave de API (Tarefa 1 do plano
  docs/superpowers/plans/2026-11-21-contas-por-chave-de-api.md).

.DESCRIPTION
  Lê a chave de API da área de transferência, sem nunca a mostrar, e abre o Claude Code ou o Codex numa pasta de
  conta vazia, com a chave só no ambiente do programa. Depois procura a chave, e trechos do fim dela, nos arquivos que
  o programa criou. Nada é gravado no Project Hub.

  Antes de rodar, copie a chave no site do serviço (Console da Anthropic ou plataforma da OpenAI).

.EXAMPLE
  .\scripts\prova-chave-api.ps1 -Programa claude

.EXAMPLE
  .\scripts\prova-chave-api.ps1 -Programa claude -Interativo

.EXAMPLE
  .\scripts\prova-chave-api.ps1 -Programa codex

.EXAMPLE
  .\scripts\prova-chave-api.ps1 -Programa codex -Provedor

.EXAMPLE
  .\scripts\prova-chave-api.ps1 -Programa codex -Provedor -Ambiente

.EXAMPLE
  .\scripts\prova-chave-api.ps1 -Programa codex -Provedor -Interativo
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('claude', 'codex')]
  [string] $Programa,

  # Abre o programa no terminal, sem pergunta pronta, para ver o que ele pede na primeira vez.
  [switch] $Interativo,

  # Nome da variável que leva a chave. Padrão: ANTHROPIC_API_KEY (claude) ou OPENAI_API_KEY (codex).
  [ValidatePattern('^[A-Z][A-Z0-9_]{2,63}$')]
  [string] $Variavel,

  # Codex: um provedor com `env_key`, passado por `-c` na linha do programa (o caminho da conta API do Codex,
  # 2026-11-22). Sem ele, o Codex usa o provedor embutido, que exige login.
  [switch] $Provedor,

  # Codex com -Provedor: pede ao agente para rodar um comando que só diz se a variável da chave está visível
  # (VISIVEL ou AUSENTE), sem mostrá-la.
  [switch] $Ambiente
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$PERGUNTA = 'Responda apenas: ok'
$PRAZO_MS = 120000
$LISTA_MAX = 25
# Variáveis que o programa não pode herdar da máquina: a chave entra só pelo valor da área de transferência.
$HERDADAS_REMOVIDAS = @(
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'
)

function Get-FormaDaChave {
  param([string] $Programa, [string] $Chave)
  if ($Chave.Length -lt 20 -or $Chave.Length -gt 512) { return $false }
  if ($Chave -notmatch '^[A-Za-z0-9_-]+$') { return $false }
  if ($Programa -eq 'claude') {
    return $Chave.StartsWith('sk-ant-') -and -not $Chave.StartsWith('sk-ant-admin')
  }
  return $Chave.StartsWith('sk-') -and -not $Chave.StartsWith('sk-ant-') -and -not $Chave.StartsWith('sk-admin-')
}

# Os três textos procurados, do mais longo ao mais curto: a chave inteira, os 20 últimos e os 8 últimos caracteres.
function Get-Trechos {
  param([string] $Chave)
  return @(
    @{ Nome = 'chave inteira'; Texto = $Chave },
    @{ Nome = '20 ultimos caracteres'; Texto = $Chave.Substring($Chave.Length - 20) },
    @{ Nome = '8 ultimos caracteres'; Texto = $Chave.Substring($Chave.Length - 8) }
  )
}

function Hide-Chave {
  param([string] $Texto, [string] $Chave)
  if ([string]::IsNullOrEmpty($Texto)) { return '' }
  $saida = $Texto
  foreach ($trecho in (Get-Trechos -Chave $Chave)) {
    $saida = $saida.Replace($trecho.Texto, '[CHAVE]')
  }
  return $saida
}

# Para cada arquivo da pasta, o trecho mais longo da chave que ele contém. Só o caminho relativo sai daqui.
function Find-TrechosNaPasta {
  param([string] $Pasta, [string] $Chave)
  $achados = @()
  $trechos = Get-Trechos -Chave $Chave
  foreach ($arquivo in (Get-ChildItem -LiteralPath $Pasta -Recurse -File -Force -ErrorAction SilentlyContinue)) {
    $relativo = $arquivo.FullName.Substring($Pasta.Length).TrimStart('\')
    try {
      $bytes = [System.IO.File]::ReadAllBytes($arquivo.FullName)
    } catch {
      $achados += [pscustomobject]@{ Arquivo = $relativo; Achado = '(nao foi possivel ler)' }
      continue
    }
    $textos = @(
      [System.Text.Encoding]::UTF8.GetString($bytes),
      [System.Text.Encoding]::Unicode.GetString($bytes)
    )
    foreach ($trecho in $trechos) {
      $casou = $false
      foreach ($texto in $textos) { if ($texto.Contains($trecho.Texto)) { $casou = $true } }
      if ($casou) {
        $achados += [pscustomobject]@{ Arquivo = $relativo; Achado = $trecho.Nome }
        break
      }
    }
  }
  return $achados
}

function Get-ListaDeArquivos {
  param([string] $Pasta)
  return @(Get-ChildItem -LiteralPath $Pasta -Recurse -File -Force -ErrorAction SilentlyContinue |
      ForEach-Object { $_.FullName.Substring($Pasta.Length).TrimStart('\') })
}

# O executável e os argumentos para iniciar o programa. Um .cmd do npm precisa passar pelo cmd.exe.
function Get-Lancamento {
  param([string] $Programa, [string[]] $Argumentos)
  $comando = Get-Command $Programa -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $comando) { throw "O programa '$Programa' nao foi encontrado no PATH." }
  $caminho = $comando.Source
  $aspas = ($Argumentos | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
  if ($caminho -match '\.(cmd|bat)$') {
    return @{ Arquivo = $env:ComSpec; Argumentos = '/d /s /c ""' + $caminho + '" ' + $aspas + '"' }
  }
  return @{ Arquivo = $caminho; Argumentos = $aspas }
}

function Invoke-Prova {
  $nomeVariavel = $Variavel
  if (-not $nomeVariavel) {
    $nomeVariavel = if ($Programa -eq 'claude') { 'ANTHROPIC_API_KEY' } else { 'OPENAI_API_KEY' }
  }
  $variavelDaPasta = if ($Programa -eq 'claude') { 'CLAUDE_CONFIG_DIR' } else { 'CODEX_HOME' }

  $chave = ((Get-Clipboard) -join '').Trim()
  try {
    if (-not (Get-FormaDaChave -Programa $Programa -Chave $chave)) {
      $servico = if ($Programa -eq 'claude') { 'da Anthropic' } else { 'da OpenAI' }
      Write-Host "Forma inesperada: a area de transferencia nao tem uma chave de API $servico."
      Write-Host 'Nada foi executado. Copie a chave no site e rode de novo.'
      return
    }
    Write-Host 'Forma ok.'

    # Caminho curto: o Codex abre um socket dentro da pasta da conta, e o Windows limita esse caminho a 108 caracteres.
    $base = Join-Path $env:TEMP ('pc-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    $conta = Join-Path $base 'conta'
    $trabalho = Join-Path $base 'trabalho'
    New-Item -ItemType Directory -Path $conta, $trabalho | Out-Null

    # O provedor da conta API do Codex: só valores sem aspas, chaves nem `<`, para passar também por um `.cmd`.
    $provedorArgs = @()
    if ($Programa -eq 'codex' -and $Provedor) {
      $provedorArgs = @(
        '-c', 'model_provider=ph-openai',
        '-c', 'model_providers.ph-openai.name=OpenAI',
        '-c', 'model_providers.ph-openai.base_url=https://api.openai.com/v1',
        '-c', "model_providers.ph-openai.env_key=$nomeVariavel",
        '-c', 'model_providers.ph-openai.wire_api=responses',
        '-c', 'model_providers.ph-openai.requires_openai_auth=false',
        '-c', 'shell_environment_policy.ignore_default_excludes=false'
      )
    }
    $pergunta = $PERGUNTA
    if ($Ambiente) {
      if ($Programa -ne 'codex' -or -not $Provedor) { throw '-Ambiente vale só para -Programa codex -Provedor.' }
      $pergunta = "Rode exatamente este comando no PowerShell e responda apenas com a saida dele: " +
        "if (`$env:$nomeVariavel) { 'VISIVEL' } else { 'AUSENTE' }"
    }

    if ($Interativo) {
      $argumentos = $provedorArgs
    } elseif ($Programa -eq 'claude') {
      $argumentos = @('-p', $pergunta)
    } else {
      $argumentos = $provedorArgs + @('exec', '--skip-git-repo-check', $pergunta)
    }
    $lancamento = Get-Lancamento -Programa $Programa -Argumentos $argumentos

    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $lancamento.Arquivo
    $info.Arguments = $lancamento.Argumentos
    $info.WorkingDirectory = $trabalho
    $info.UseShellExecute = $false
    foreach ($nome in $HERDADAS_REMOVIDAS) { $info.EnvironmentVariables.Remove($nome) }
    $info.EnvironmentVariables[$variavelDaPasta] = $conta
    $info.EnvironmentVariables[$nomeVariavel] = $chave

    $codigo = $null
    $saida = ''
    if ($Interativo) {
      Write-Host ''
      Write-Host "Abrindo $Programa numa pasta de conta vazia. Anote se ele pergunta algo antes de responder"
      Write-Host '(aceitar a chave, tema, confianca na pasta). Mande uma pergunta curta e feche o programa.'
      Write-Host ''
      $processo = [System.Diagnostics.Process]::Start($info)
      $processo.WaitForExit()
      $codigo = $processo.ExitCode
    } else {
      $info.RedirectStandardOutput = $true
      $info.RedirectStandardError = $true
      $info.RedirectStandardInput = $true
      $processo = [System.Diagnostics.Process]::Start($info)
      $processo.StandardInput.Close()
      $lendoSaida = $processo.StandardOutput.ReadToEndAsync()
      $lendoErro = $processo.StandardError.ReadToEndAsync()
      if ($processo.WaitForExit($PRAZO_MS)) {
        $processo.WaitForExit()
        $codigo = $processo.ExitCode
      } else {
        & taskkill.exe /PID $processo.Id /T /F | Out-Null
        $codigo = '(prazo de 120 s esgotado; o programa foi encerrado)'
      }
      $saida = Hide-Chave -Texto ($lendoSaida.Result + "`n" + $lendoErro.Result) -Chave $chave
    }

    $achados = @(Find-TrechosNaPasta -Pasta $base -Chave $chave)
    $arquivos = @(Get-ListaDeArquivos -Pasta $base)

    # O que importa fica no fim, perto da pergunta: a lista de arquivos vem antes e é cortada.
    Write-Host ''
    Write-Host '===== Relatorio ====='
    $comProvedor = if ($provedorArgs.Count -gt 0) { ', provedor com env_key' } else { '' }
    Write-Host "Programa: $Programa ($nomeVariavel, $variavelDaPasta vazia$comProvedor)"
    Write-Host ("Arquivos criados ({0}):" -f $arquivos.Count)
    $arquivos | Select-Object -First $LISTA_MAX | ForEach-Object { Write-Host "  $_" }
    if ($arquivos.Count -gt $LISTA_MAX) { Write-Host ("  ... e mais {0}" -f ($arquivos.Count - $LISTA_MAX)) }
    if (-not $Interativo) {
      Write-Host 'Saida (chave mascarada, primeiras 40 linhas):'
      ($saida.Trim() -split "`r?`n" | Select-Object -First 40) | ForEach-Object { Write-Host "  $_" }
    }
    Write-Host 'Trechos da chave nos arquivos:'
    if ($achados.Count -eq 0) { Write-Host '  nenhum' }
    foreach ($achado in $achados) { Write-Host ("  {0}: {1}" -f $achado.Arquivo, $achado.Achado) }
    Write-Host "Codigo de saida: $codigo"
    Write-Host '====================='
    Write-Host ''

    $resposta = Read-Host "Apagar a pasta temporaria $base ? (s/n)"
    if ($resposta -match '^[sS]') {
      Remove-Item -LiteralPath $base -Recurse -Force
      Write-Host 'Pasta apagada.'
    } else {
      Write-Host "A pasta ficou em $base. Ela pode ter trechos da chave: apague quando terminar."
    }
    $limpar = Read-Host 'Limpar a area de transferencia agora? (s/n)'
    if ($limpar -match '^[sS]') {
      & $env:ComSpec /d /c 'type nul | clip'
      Write-Host 'Area de transferencia limpa. Se o historico do Windows (Win+V) estiver ligado, apague a chave dele.'
    }
  } finally {
    $chave = $null
    [System.GC]::Collect()
  }
}

# Carregado com ". .\prova-chave-api.ps1" (nos testes), só define as funções.
if ($MyInvocation.InvocationName -ne '.') { Invoke-Prova }
