<#
.SYNOPSIS
  Prova na máquina da retomada de uma conversa entre contas do Claude Code (Tarefa 1 do plano
  docs/superpowers/plans/2026-11-22-troca-automatica-de-conta.md).

.DESCRIPTION
  Começa uma conversa curta numa conta (a pasta de dados de origem), copia o transcript dela para a mesma posição na
  pasta de outra conta (a de destino) e tenta retomar a conversa nessa outra conta com `claude --resume <id>`.
  Responde se o Claude Code aceita, numa conta, uma conversa começada em outra. Nada é gravado no Project Hub.

  A primeira rodada gasta uma chamada mínima da conta de origem; a segunda, uma da conta de destino. O script avisa
  antes e pede confirmação.

.EXAMPLE
  .\scripts\prova-retomada-entre-contas.ps1 -ContaDestino "$env:APPDATA\@project-hub\desktop\accounts\claude\<id>"

.EXAMPLE
  .\scripts\prova-retomada-entre-contas.ps1 -ContaDestino "$env:APPDATA\@project-hub\desktop\accounts\claude\<id>" -Interativo
#>
[CmdletBinding()]
param(
  # Pasta de dados da conta onde a conversa começa. Padrão: CLAUDE_CONFIG_DIR da máquina, ou ~\.claude.
  [string] $ContaOrigem,

  # Pasta de dados de uma conta extra conectada, onde a conversa é retomada.
  [Parameter(Mandatory = $true)]
  [string] $ContaDestino,

  # Abre `claude --resume <id>` no terminal, na conta de destino, em vez da pergunta pronta.
  [switch] $Interativo
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$PALAVRA = 'girassol'
$PERGUNTA_ORIGEM = "Guarde a palavra $PALAVRA. Responda apenas: ok"
$PERGUNTA_DESTINO = 'Qual palavra eu pedi para guardar? Responda apenas a palavra.'
$PRAZO_MS = 180000
# Variáveis que o programa não pode herdar da máquina: a conta entra só pela pasta.
$HERDADAS_REMOVIDAS = @('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CONFIG_DIR')

function Get-ContaOrigemPadrao {
  if ($env:CLAUDE_CONFIG_DIR) { return $env:CLAUDE_CONFIG_DIR }
  return Join-Path $HOME '.claude'
}

# Caminho completo e sem barra no fim, para comparar duas pastas.
function Get-PastaNormalizada {
  param([string] $Pasta)
  return [System.IO.Path]::GetFullPath($Pasta).TrimEnd('\', '/')
}

function Test-MesmaPasta {
  param([string] $A, [string] $B)
  return [string]::Equals((Get-PastaNormalizada $A), (Get-PastaNormalizada $B), [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-IdDeSessao {
  param([string] $Id)
  return $Id -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
}

# O transcript da sessão: `<conta>\projects\<pasta>\<id>.jsonl`. Sem ele, $null.
function Find-Transcript {
  param([string] $Conta, [string] $SessionId)
  $projetos = Join-Path $Conta 'projects'
  if (-not (Test-Path -LiteralPath $projetos)) { return $null }
  $achado = Get-ChildItem -LiteralPath $projetos -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName "$SessionId.jsonl" } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
  return $achado
}

# Copia o transcript (e a pasta de subagentes da sessão, se existir) para a mesma posição na conta de destino.
# Devolve os caminhos criados no destino, para a limpeza no fim.
function Copy-Transcript {
  param([string] $Transcript, [string] $SessionId, [string] $Destino)
  $pastaProjeto = Split-Path -Leaf (Split-Path -Parent $Transcript)
  $alvo = Join-Path (Join-Path $Destino 'projects') $pastaProjeto
  New-Item -ItemType Directory -Force -Path $alvo | Out-Null
  $criados = @()
  $arquivo = Join-Path $alvo "$SessionId.jsonl"
  Copy-Item -LiteralPath $Transcript -Destination $arquivo -Force
  $criados += $arquivo
  $subagentes = Join-Path (Join-Path (Split-Path -Parent $Transcript) $SessionId) 'subagents'
  if (Test-Path -LiteralPath $subagentes) {
    $pastaSessao = Join-Path $alvo $SessionId
    New-Item -ItemType Directory -Force -Path (Join-Path $pastaSessao 'subagents') | Out-Null
    Get-ChildItem -LiteralPath $subagentes -File -Filter 'agent-*.jsonl' | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path (Join-Path $pastaSessao 'subagents') $_.Name) -Force
    }
    $criados += $pastaSessao
  }
  return $criados
}

# O executável e os argumentos para iniciar o programa. Um .cmd do npm precisa passar pelo cmd.exe.
function Get-Lancamento {
  param([string[]] $Argumentos)
  $comando = Get-Command 'claude' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $comando) { throw "O programa 'claude' nao foi encontrado no PATH." }
  $caminho = $comando.Source
  $aspas = ($Argumentos | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
  if ($caminho -match '\.(cmd|bat)$') {
    return @{ Arquivo = $env:ComSpec; Argumentos = '/d /s /c ""' + $caminho + '" ' + $aspas + '"' }
  }
  return @{ Arquivo = $caminho; Argumentos = $aspas }
}

function New-InfoDoProcesso {
  param([string[]] $Argumentos, [string] $Conta, [string] $Trabalho)
  $lancamento = Get-Lancamento -Argumentos $Argumentos
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $lancamento.Arquivo
  $info.Arguments = $lancamento.Argumentos
  $info.WorkingDirectory = $Trabalho
  $info.UseShellExecute = $false
  foreach ($nome in $HERDADAS_REMOVIDAS) { $info.EnvironmentVariables.Remove($nome) }
  $info.EnvironmentVariables['CLAUDE_CONFIG_DIR'] = $Conta
  return $info
}

# Roda o programa sem conversa e devolve o código de saída, a saída e o erro.
function Invoke-ClaudeSemConversa {
  param([string[]] $Argumentos, [string] $Conta, [string] $Trabalho)
  $info = New-InfoDoProcesso -Argumentos $Argumentos -Conta $Conta -Trabalho $Trabalho
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
    $codigo = '(prazo esgotado; o programa foi encerrado)'
  }
  return @{ Codigo = $codigo; Saida = $lendoSaida.Result; Erro = $lendoErro.Result }
}

# Lê o JSON de `--output-format json`. Fora do formato, $null.
function Read-SaidaJson {
  param([string] $Saida)
  try { return ($Saida.Trim() | ConvertFrom-Json) } catch { return $null }
}

function Get-Campo {
  param($Objeto, [string] $Nome)
  if ($null -eq $Objeto) { return $null }
  $propriedade = $Objeto.PSObject.Properties[$Nome]
  if ($null -eq $propriedade) { return $null }
  return $propriedade.Value
}

function Get-Tamanho {
  param([string] $Arquivo)
  if (-not (Test-Path -LiteralPath $Arquivo)) { return 0 }
  return (Get-Item -LiteralPath $Arquivo).Length
}

function Invoke-Prova {
  $origem = if ($ContaOrigem) { $ContaOrigem } else { Get-ContaOrigemPadrao }
  if (-not (Test-Path -LiteralPath $origem -PathType Container)) { throw "A pasta de origem nao existe: $origem" }
  if (-not (Test-Path -LiteralPath $ContaDestino -PathType Container)) { throw "A pasta de destino nao existe: $ContaDestino" }
  if (Test-MesmaPasta $origem $ContaDestino) { throw 'A origem e o destino sao a mesma pasta: escolha a pasta de outra conta.' }

  Write-Host "Origem:  $origem"
  Write-Host "Destino: $ContaDestino"
  Write-Host 'A primeira rodada gasta uma chamada minima da conta de origem.'
  $seguir = Read-Host 'Seguir? (s/n)'
  if ($seguir -notmatch '^[sS]') { Write-Host 'Nada foi executado.'; return }

  # Pasta de trabalho curta e igual nas duas rodadas: a pasta do projeto em `projects\` sai deste caminho.
  $trabalho = Join-Path $env:TEMP ('pr-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  New-Item -ItemType Directory -Path $trabalho | Out-Null
  $criados = @()
  $versao = ''
  try { $versao = (& claude --version 2>$null | Select-Object -First 1) } catch { $versao = '(nao lida)' }

  $primeira = Invoke-ClaudeSemConversa -Argumentos @('-p', $PERGUNTA_ORIGEM, '--output-format', 'json') -Conta $origem -Trabalho $trabalho
  $json = Read-SaidaJson $primeira.Saida
  $sessionId = [string](Get-Campo $json 'session_id')
  if (-not (Test-IdDeSessao $sessionId)) {
    Write-Host ''
    Write-Host '===== Relatorio ====='
    Write-Host "Versao do claude: $versao"
    Write-Host "A primeira rodada nao devolveu um session_id (codigo $($primeira.Codigo))."
    ($primeira.Erro.Trim() -split "`r?`n" | Select-Object -First 20) | ForEach-Object { Write-Host "  $_" }
    Write-Host '====================='
    return
  }

  $transcript = Find-Transcript -Conta $origem -SessionId $sessionId
  if ($null -eq $transcript) {
    Write-Host "O transcript da sessao $sessionId nao foi encontrado em $origem\projects."
    return
  }
  $criados = @(Copy-Transcript -Transcript $transcript -SessionId $sessionId -Destino $ContaDestino)
  $copia = $criados[0]
  $tamanhoAntes = Get-Tamanho $copia

  $segunda = $null
  if ($Interativo) {
    Write-Host ''
    Write-Host "Abrindo claude --resume $sessionId na conta de destino. Anote se a conversa anterior aparece, se o"
    Write-Host 'programa pergunta algo antes (confianca na pasta, aceitar a conversa) e se ele lembra a palavra quando'
    Write-Host "voce pergunta: '$PERGUNTA_DESTINO'. Depois feche o programa."
    Write-Host ''
    $info = New-InfoDoProcesso -Argumentos @('--resume', $sessionId) -Conta $ContaDestino -Trabalho $trabalho
    $processo = [System.Diagnostics.Process]::Start($info)
    $processo.WaitForExit()
    $segunda = @{ Codigo = $processo.ExitCode; Saida = ''; Erro = '' }
  } else {
    $segunda = Invoke-ClaudeSemConversa -Argumentos @('-p', '--resume', $sessionId, $PERGUNTA_DESTINO, '--output-format', 'json') -Conta $ContaDestino -Trabalho $trabalho
  }
  $jsonSegunda = Read-SaidaJson $segunda.Saida
  $resposta = [string](Get-Campo $jsonSegunda 'result')
  $sessaoSegunda = [string](Get-Campo $jsonSegunda 'session_id')
  $tamanhoDepois = Get-Tamanho $copia

  # O que importa fica no fim, perto da pergunta.
  Write-Host ''
  Write-Host '===== Relatorio ====='
  Write-Host "Versao do claude: $versao"
  Write-Host "Sessao: $sessionId"
  Write-Host "Primeira rodada (origem): codigo $($primeira.Codigo)"
  Write-Host "Transcript copiado para: $copia"
  if (-not $Interativo) {
    Write-Host "Segunda rodada (destino, --resume): codigo $($segunda.Codigo)"
    Write-Host ("session_id da segunda: {0}" -f $(if ($sessaoSegunda) { $sessaoSegunda } else { '(nenhum)' }))
    Write-Host ("A resposta tem a palavra '{0}': {1}" -f $PALAVRA, ($resposta -match $PALAVRA))
    if ($segunda.Erro.Trim()) {
      Write-Host 'Saida de erro (primeiras 20 linhas):'
      ($segunda.Erro.Trim() -split "`r?`n" | Select-Object -First 20) | ForEach-Object { Write-Host "  $_" }
    }
  } else {
    Write-Host "Programa interativo: codigo $($segunda.Codigo)"
  }
  Write-Host ("O transcript no destino cresceu: {0} ({1} -> {2} bytes)" -f ($tamanhoDepois -gt $tamanhoAntes), $tamanhoAntes, $tamanhoDepois)
  Write-Host '====================='
  Write-Host ''

  $limpar = Read-Host 'Apagar a pasta de trabalho e as copias feitas no destino? (s/n)'
  if ($limpar -match '^[sS]') {
    foreach ($caminho in $criados) { Remove-Item -LiteralPath $caminho -Recurse -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $trabalho -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'Apagado.'
  } else {
    Write-Host "A pasta de trabalho ficou em $trabalho, e a copia em $copia."
  }
}

# Carregado com ". .\prova-retomada-entre-contas.ps1" (nos testes), só define as funções.
if ($MyInvocation.InvocationName -ne '.') { Invoke-Prova }
