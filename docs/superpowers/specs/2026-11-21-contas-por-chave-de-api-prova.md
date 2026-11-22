# Contas por chave de API: resultado da prova na máquina

Data: 2026-11-21. Tarefa 1 do plano `docs/superpowers/plans/2026-11-21-contas-por-chave-de-api.md`.

## Como foi feita

- Script `scripts/prova-chave-api.ps1`, com **chaves falsas** no formato certo (a pessoa pediu o teste com chave falsa antes de usar a dela). O serviço recusa a chave falsa (401), sem cobrança. Isso basta para saber se o programa **lê** a variável: com a variável lida, o erro é "chave inválida"; sem ela, o erro é "falta autenticação" ou aparece a tela de login.
- Versões: Claude Code 2.1.330 (`claude.exe` nativo) e Codex 0.169.0 (`codex.exe` nativo).
- Pasta de conta vazia em cada rodada, com a chave só no ambiente do programa.

## Claude Code

- **Sem conversa (`claude -p`, como o agente e o planejador da missão rodam):** com `ANTHROPIC_API_KEY` e `CLAUDE_CONFIG_DIR` vazia, o programa usa a chave direto, sem pergunta e sem login ("Invalid API key" do serviço). Nenhum trecho da chave ficou nos arquivos da pasta.
- **No terminal (como o painel abre):** numa pasta de conta vazia aparece primeiro a apresentação do programa (tema), depois a confiança na pasta, e então:
  "Detected a custom API key in your environment · ANTHROPIC_API_KEY: sk-ant-...<20 últimos> · Do you want to use this API key? Yes / **No (recommended)**".
  A resposta padrão é **Não**. A tela mostra os 20 últimos caracteres da chave.
- **Parada do plano:** o programa pergunta se aceita a chave. Pelo desenho, o app para e leva as saídas à pessoa.
- A confirmar com a chave de verdade: o que o programa grava depois de "Sim" (esperado: os 20 últimos caracteres em `.claude.json`, na pasta da conta) e depois de uma conversa que dá certo.

## Codex

- **Sem conversa (`codex exec`):** com `OPENAI_API_KEY`, o programa **não envia** a chave ("401 Missing bearer or basic authentication"). Com `CODEX_API_KEY`, envia ("Incorrect API key provided").
- **No terminal (como o painel abre):** com `OPENAI_API_KEY` ou com `CODEX_API_KEY`, aparece a tela de login ("Sign in with ChatGPT / Device Code / Sign in another way"). O programa interativo não usa a chave do ambiente.
- **Parada do plano:** o Codex não usa a chave sem `codex login`. A alternativa (`codex login --with-api-key`) grava a chave em texto puro na pasta da conta. Pelo desenho, o app para e pergunta.

## Achado fora do plano: caminho longo da conta do Codex

- O Codex 0.169 interativo abre um servidor de fundo com um socket dentro de `CODEX_HOME` (`app-server-control\app-server-control.sock`). O Windows limita esse caminho a 108 caracteres. Com a pasta de prova longa, o programa não abriu ("path must be shorter than SUN_LEN").
- A pasta de uma conta extra do Codex no app é `C:\Users\charl\AppData\Roaming\@project-hub\desktop\accounts\codex\<uuid>\`: o caminho do socket dá 146 caracteres. **Toda conta extra do Codex criada nas partes 1A e 1B deve falhar ao abrir o Codex no painel.** A Principal (`~\.codex`) não é afetada. Os E2E usam um Codex falso e não pegam isso.
- Conferido num terminal de verdade, com uma pasta de 136 caracteres: sem opção, o Codex novo e `codex resume <id>` falham com esse erro; com `--no-daemon` antes do subcomando, os dois abrem a tela de entrar. `--disable daemon_auto_start` também resolve, mas o próprio Codex indica `--no-daemon` no erro. `codex login status` e `codex logout` não usam o servidor de fundo. **Corrigido no ramo da parte 1B (PR 79):** o app abre o Codex das contas extras com `--no-daemon`.

## Aprovação da chave gravada pelo app (Claude Code 2.1.330, chave falsa)

- Pasta de conta nova com `.claude.json` contendo `hasCompletedOnboarding`, `theme`, a confiança na pasta de trabalho e `customApiKeyResponses: { "approved": ["<20 últimos caracteres>"], "rejected": [] }`: o Claude Code interativo abriu direto na tela principal ("API Usage Billing"), sem perguntar pela chave.
- A mesma pasta sem `customApiKeyResponses`: apareceu "Detected a custom API key in your environment … Do you want to use this API key?", com "No (recommended)" marcado.
- O programa manteve a aprovação no arquivo e não gravou a chave inteira.
- Com a chave falsa, o programa avisou que as configurações gerenciadas remotas falharam (401). Nenhuma pergunta foi enviada, nada foi cobrado.

## 2026-11-22: Codex com provedor próprio (chave falsa)

Codex 0.169.0, `CODEX_HOME` vazio e curto, chave falsa no formato `sk-proj-` (o serviço responde 401, sem cobrança). O Codex interativo foi aberto num pseudo-terminal (`node-pty`) para ler a tela.

- **Sem provedor** (como em 2026-11-21): tela de login ("Sign in with ChatGPT / Device Code / Sign in another way").
- **Com um provedor próprio** (`model_provider` apontando para um provedor com `base_url = "https://api.openai.com/v1"`, `env_key = "OPENAI_API_KEY"`, `wire_api = "responses"`), no `config.toml` ou por `-c`: o interativo abre direto na tela principal, sem login, e ao mandar uma mensagem o serviço responde "Incorrect API key provided" (a chave foi enviada). O `codex exec` também.
- **`-c` vence o `config.toml`:** com um `config.toml` que apontava o mesmo provedor para `http://127.0.0.1:9/v1`, a chamada foi para `https://api.openai.com/v1/responses`.
- **Valores sem aspas** (`-c model_providers.x.base_url=https://api.openai.com/v1`) funcionam, então passam por um `codex.cmd`.
- **Disco:** nenhum `auth.json`. A chave inteira, os 20 e os 8 últimos caracteres não aparecem em nenhum arquivo da pasta. Com chave errada, a sessão e o banco de histórico guardam a mensagem de erro do serviço, que traz os 4 últimos caracteres já mascarados.
- **Filtro do ambiente dos comandos do agente:** o binário tem `shell_environment_policy` com o filtro padrão `*KEY*`, `*SECRET*`, `*TOKEN*`. Não foi possível ver o filtro em ação sem uma chave válida.

A pessoa decidiu seguir sem a prova com a chave de verdade. Ficam sem confirmação: uma resposta com chave válida, o modelo padrão (`gpt-6.1-sol`) com chave de API e o filtro em ação. A prova está pronta em `scripts/prova-chave-api.ps1 -Programa codex -Provedor` (mais `-Ambiente` ou `-Interativo`).
