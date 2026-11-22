# Contas do Codex por chave de API: desenho

Data: 2026-11-22. Estado: aprovado em 2026-11-22. A pessoa escolheu seguir sem a prova com a chave de verdade e pediu a execução ("coordene essas duas sessões para que elas façam suas determinadas atividades"), pela sessão coordenadora, e aprovou o desenho diretamente ("Aprovo").

Complementa `2026-11-21-contas-por-chave-de-api-design.md` (o PR 80, já na `main`). Tudo o que aquele desenho diz do cofre, da senha, da entrada pela área de transferência, dos estados, dos avisos de cobrança e do que o app não controla vale também aqui. Este documento diz só o que muda para o Codex.

## Intenção

A pessoa quer usar o Codex com a chave de API da OpenAI que já tem, como uma conta normal do app, ao lado das contas de assinatura, do mesmo jeito que já faz com o Claude Code. A segurança é a prioridade dela ("máxima segurança possível").

## O que mudou desde a prova de 2026-11-21

A prova anterior mostrou que o Codex interativo ignora `OPENAI_API_KEY` e pede login. A investigação de 2026-11-22, com o Codex 0.169.0 e **só com chave falsa** (o serviço responde 401, sem cobrança), achou o motivo e a saída:

- Quem exige login é o **provedor embutido** do Codex (`openai`). Um provedor próprio, com `env_key`, não exige: o Codex lê a chave da variável indicada.
- Com esse provedor, o Codex **interativo** abriu direto na tela principal, sem tela de login, e enviou a chave ("Incorrect API key provided"). O `codex exec` também.
- O provedor pode ir por opções `-c` na linha do programa, sem gravar nada no `config.toml`. Valores sem aspas, chaves nem `<` funcionam, então passam até por um `codex.cmd`.
- O `-c` **vence o `config.toml`**: com um `config.toml` adulterado que apontava o mesmo provedor para outro endereço, a chave foi para `https://api.openai.com/v1` mesmo.
- Nenhum `auth.json` foi criado, e a chave inteira, os 20 últimos e os 8 últimos caracteres não apareceram em nenhum arquivo da pasta da conta. Com chave errada, o Codex grava a mensagem de erro do serviço na sessão, que traz os 4 últimos caracteres já mascarados (`sk-proj-****…00ZZ`), o mesmo trecho que o app já mostra.
- O Codex tem uma política de ambiente para os comandos que o agente roda (`shell_environment_policy`), com um filtro padrão que tira variáveis cujo nome tem `KEY`, `SECRET` ou `TOKEN`.

**A pessoa decidiu seguir sem a prova com a chave de verdade.** Três pontos ficam sem confirmação (ver "O que não foi confirmado").

## Metas

1. Criar uma conta do Codex do tipo **API**, com a chave da OpenAI da pessoa.
2. Usar a conta como as outras do Codex: escolher ao abrir um painel, retomar uma sessão dela na aba Sessões, definir como padrão, renomear, remover.
3. Colar, trocar e remover a chave, como no Claude Code.

## Fora do escopo

- Missões com o Codex. O agente e o planejador das missões são só o Claude Code hoje; a conta API do Codex vale onde as contas do Codex valem, que são os painéis.
- Escolher o modelo da conta. O Codex usa o modelo padrão dele.
- Outros provedores do Codex (Azure, endereços próprios) e as funções do Codex que dependem do login no ChatGPT.
- Um programa auxiliar que entregue a chave ao Codex por comando (`auth.command` do provedor). Tiraria a chave do ambiente do processo, mas exige um canal novo com o app; o filtro do Codex já tira a chave dos comandos do agente. Fica como reforço possível depois, como o `apiKeyHelper` do Claude Code.

## Compromissos de segurança

Os do desenho de 11-21 continuam, agora para os dois programas:

- a chave e a senha nunca chegam ao renderer;
- a chave nunca fica em texto puro no disco: nada de `codex login --with-api-key` nem de `auth.json`;
- a chave vai só para o ambiente do Codex daquela conta, por `launchEnv`;
- o `OPENAI_API_KEY` da máquina nunca é herdado (a lista de variáveis permitidas dos terminais não o inclui);
- nenhuma chamada cobrada para testar a chave;
- os erros nunca levam a chave nem o texto da área de transferência;
- testes e E2E usam só chaves falsas.

## Caminhos considerados

1. **Provedor próprio passado por `-c` a cada abertura, com a chave em `OPENAI_API_KEY`.** Nada gravado na pasta da conta; o app impõe o endereço da OpenAI em toda abertura, e um `config.toml` alterado pelo agente não desvia a chave. **Escolhido** (recomendação aceita pela pessoa em 2026-11-22).
2. **Provedor gravado no `config.toml` da conta.** Mesmo efeito para o Codex, mas o arquivo fica na pasta de trabalho do programa: o agente pode editá-lo e apontar a chave para outro endereço.
3. **`codex login --with-api-key`.** Grava a chave em texto puro no `auth.json`. Descartado.

## Como funciona

### A forma da chave da OpenAI

`api-key-shape.ts` passa a conferir a forma por programa:

- OpenAI: começa com `sk-` e não com `sk-ant-`; recusa `sk-admin-` (chave de administração). Aceita as chaves de projeto (`sk-proj-`), de conta de serviço (`sk-svcacct-`) e as antigas (`sk-` puro).
- O resto é igual ao do Claude Code: só letras, números, `-` e `_`, de 20 a 512 caracteres.
- Recusa: "A área de transferência não tem uma chave de API da OpenAI." Chave da Anthropic numa conta do Codex (e o contrário) é recusada pela forma.
- `API_KEY_PROVIDERS` passa a ser `['claude', 'codex']`, e `API_KEY_VARIABLE.codex` é `OPENAI_API_KEY`. A recusa "só existe para o Claude Code" deixa de existir.

### O lançamento

`accountLaunchArgs` (em `account-paths.ts`) passa a receber o tipo da conta. Para uma conta extra do Codex, continua `--no-daemon`; para uma conta **API** do Codex, acrescenta:

```
-c model_provider=openai-chave-api
-c model_providers.openai-chave-api.name=OpenAI
-c model_providers.openai-chave-api.base_url=https://api.openai.com/v1
-c model_providers.openai-chave-api.env_key=OPENAI_API_KEY
-c model_providers.openai-chave-api.wire_api=responses
-c model_providers.openai-chave-api.requires_openai_auth=false
-c shell_environment_policy.ignore_default_excludes=false
```

- As opções vêm antes dos extras da retomada, como as de hoje: `codex resume <id>` de uma conta API também usa o provedor.
- A última opção força o filtro padrão, que tira `OPENAI_API_KEY` do ambiente dos comandos do agente, mesmo que o `config.toml` da conta o desligue.
- A linha do programa não leva a chave; ela segue só no ambiente, por `launchEnv`, como no Claude Code.

### A aprovação da chave

A gravação da aprovação no `.claude.json` é só do Claude Code. O Codex não pergunta pela chave, e o app não grava nada na pasta da conta do Codex: ao colar, trocar ou remover a chave de uma conta do Codex, a aprovação não é chamada.

### A tela

- `API_PROGRAMS`, em `AccountsSection.tsx`, passa a ter `claude` e `codex`: "Adicionar conta" do Codex pergunta o tipo, como no Claude Code.
- Os textos que dizem "da Anthropic" passam a dizer o serviço do programa da conta.
- O aviso de cobrança dizia "Missões longas podem custar caro", e o Codex não roda missões: passa a "Sessões e missões longas podem custar caro.", nos dois programas.
- Selo "API", estados, "Cobrança por uso · chave terminada em …", avisos de cobrança, confirmações e a conta fora da leitura de limites já são genéricos por programa.

### Ponto de integração: a troca automática de conta

A troca automática (plano em `feat/troca-automatica-de-conta`, outra sessão) terá a opção "Incluir contas de chave de API" só no Claude Code. Com esta entrega, a opção pode valer também para o Codex: a conta API do Codex usa o mesmo `usableOf`, `waitsForVault` e `kindOf` do Claude Code. Quem juntar as duas entregas decide se estende a opção.

## O que não foi confirmado (a pessoa seguiu sem a prova com a chave de verdade)

1. **A conversa com uma chave válida.** Com chave falsa, o serviço recebeu a chave e a recusou; não se viu uma resposta.
2. **O modelo padrão com chave de API.** O Codex 0.169 usa `gpt-6.1-sol` por padrão. Se a chave da pessoa não tiver acesso a ele, o painel mostra o erro do serviço, e a escolha do modelo vira um ajuste a fazer.
3. **O filtro nos comandos do agente.** Se o filtro não valer, o agente e os comandos dele enxergam a chave, como já acontece no Claude Code (risco descrito no desenho de 11-21).

O script `scripts/prova-chave-api.ps1` ganhou `-Provedor` (o provedor por `-c`) e `-Ambiente` (o agente diz se enxerga a variável): a pessoa pode rodar a prova quando quiser.

## Testes

- Forma: chaves da OpenAI (`sk-proj-`, `sk-svcacct-`, `sk-` antiga) aceitas; `sk-admin-` recusada como administração; chave da Anthropic recusada no Codex, e a da OpenAI no Claude Code; a mensagem nunca repete o texto.
- Lançamento: conta API do Codex recebe `--no-daemon` e as opções do provedor antes da retomada; conta de assinatura do Codex e a Principal não recebem o provedor; nenhuma opção contém a chave; `launchEnv` da conta API do Codex traz `OPENAI_API_KEY` e `CODEX_HOME`; `envOf` nunca traz a chave.
- Aprovação: colar e remover a chave de uma conta do Codex não grava `.claude.json` nem outro arquivo na pasta da conta.
- Serviço: criar conta API do Codex funciona; os comandos de conta (estado, entrar, sair) continuam recusando conta API.
- Contratos e disco: os testes de "a chave nunca sai" e "a chave nunca no disco" passam a cobrir também uma chave falsa da OpenAI.
- Tela: "Adicionar conta" do Codex oferece "Chave de API"; o texto da recusa diz "da OpenAI".
- Ponta a ponta, com um Codex falso (gancho de teste novo, `APP_PANEL_CODEX_SCRIPT`) e chave falsa: criar a conta API do Codex, colar a chave, abrir um painel e conferir que o programa falso recebeu `OPENAI_API_KEY` (só os 4 últimos na tela) e as opções do provedor; remover a chave.

## Decisões do construtor (a pessoa pode rever)

- **Nome do provedor `openai-chave-api`**, que aparece no `/status` do Codex.
- **A variável é `OPENAI_API_KEY`**, a de sempre, e não um nome próprio do app. Um nome próprio não protegeria mais: o filtro do Codex trabalha pelo trecho `KEY` do nome.
- **O filtro dos comandos do agente é forçado por `-c`**, mesmo sendo o padrão do Codex.
- **Sem gravar o provedor no `config.toml`**: tudo vai pela linha do programa a cada abertura.
- **A conta API do Codex não grava nada na pasta da conta** ao colar ou remover a chave.
