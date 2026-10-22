# Agente real e terminais interativos: desenho

Status: rascunho para revisão. Data: 2026-10-21.
Fontes: a conversa de 2026-10-21, o planejamento (seções 13.5, 13.6, 14.3, 15.3, 15.6, 15.7 e 25, passo 8), a ADR 0005, a decisão `brain/decisoes/decisao-agente-cli-claude.md` e a reserva de ideias `brain/tarefas/reserva-reaproveitamento.md`.

## Intenção

Hoje o Project Hub roda só um agente simulado, e a aba Terminal da missão é só de leitura. O objetivo é que cada missão rode o Claude Code de verdade, num terminal próprio que a pessoa usa direto: digita, responde ao agente e vê os pedidos de permissão ali mesmo. A tela também precisa mostrar vários terminais de uma vez, com uma lista lateral de agentes e shells e a área da direita dividida em colunas ou linhas.

Por que agora: é o passo 8 do planejamento (primeiro agente real) e a última peça que falta na Fase 1 do MVP, depois do orquestrador, da interface e do diff.

## Metas

1. Uma missão aprovada abre o Claude Code interativo na pasta do worktree dela, num terminal do app.
2. A pessoa digita no terminal e o texto chega ao agente.
3. A lista lateral mostra cada agente e cada shell, com o estado.
4. A área de terminais divide em colunas e linhas, com vários terminais visíveis ao mesmo tempo.
5. Um shell comum por projeto, separado de qualquer sessão de agente.
6. O estado da missão (rodando, aguardando você, concluída, falhou) acompanha o que acontece no terminal.
7. Cancelar encerra o agente e os processos que ele criou.
8. Os agentes continuam rodando quando o app é fechado. Ao reabrir, o app reconecta a eles e mostra o que aconteceu enquanto estava fechado.

## Não metas (fora desta etapa)

- GPT, Gemini e outros provedores.
- Vários agentes cooperando, DAG, papéis (Fase 2 do planejamento).
- Chave de API, que é o caminho para distribuir (fica para a distribuição).
- Mudanças nas abas Diff, Testes, Logs e Artefatos.
- Pausa e retomada do agente (ver "Capacidades" abaixo).
- Retomada de conversa anterior (`--resume`).
- Gravar a saída bruta do terminal em disco.
- Reformulação das bibliotecas de interface: plano próprio, depois desta etapa.

## Antimetas (nunca fazer)

- Ler, copiar ou guardar credenciais do Claude Code (`~/.claude`, tokens, login). O login é feito pela pessoa, dentro do terminal.
- Modificar o binário do Claude Code ou remover qualquer método de autenticação dele.
- Usar o Agent SDK com login de assinatura.
- Gravar hooks ou a confiança de pasta na configuração da pessoa. Os hooks entram só pela opção `--settings`, numa execução.
- Usar `--bare`. Ele ignora a assinatura e os hooks.
- Encerrar um processo cujo PID o app não criou.
- Aprovar ou negar em nome da pessoa sem uma ação dela.
- Enviar o conteúdo do terminal pela rede.
- Aceitar caminho, comando ou variável de ambiente vindos do renderer. O renderer manda só `id` e bytes de digitação.

## Premissas verificadas

- Claude Code 2.1.306 instalado localmente. A ajuda do CLI lista `--settings` (configurações extras para uma execução) e `--bare` (que pula hooks e assinatura).
- A aba Terminal atual é [TerminalPanel.tsx](apps/desktop/src/renderer/components/workspace/TerminalPanel.tsx), somente leitura, e só mostra eventos da missão.
- Contrato do agente em [types.ts](packages/agent-sdk/src/types.ts): `AgentAdapter.start` devolve uma `AgentSession`, com `events()`, `send`, `approve`, `pause`, `resume` e `stop`.
- Não há dependência de terminal instalada hoje.

Verificado em 2026-10-21, em teste de fumaça (fora do repositório):
- Os hooks `SessionStart` e `Stop`, passados por `--settings`, disparam no modo de impressão do CLI. Cada evento traz `session_id`, `transcript_path` e `cwd`, em JSON pela entrada padrão do hook.
- `node-pty` 1.1.0 instalado em `apps/desktop`. Traz binários prontos para `win32-x64`. Carregou no runtime do Electron 44.9.0 (ABI 149), abriu um PowerShell num PTY, recebeu entrada e devolveu a saída. O script de compilação fica recusado em `pnpm-workspace.yaml`, como o do esbuild.
- Um processo filho desligado, iniciado com Electron como Node, continuou gravando depois que o app Electron saiu. A janela medida foi curta (poucos segundos). Ela será medida de novo, com mais tempo, na etapa do processo de terminais.
- Numa pasta nova, o Claude Code interativo mostra o diálogo "Yes, I trust this folder" antes de qualquer hook. A opção padrão é "No, exit".

- No modo interativo, dentro de um PTY, os hooks `SessionStart` e `Stop` também disparam quando o CLI roda com `--settings`. O teste fechou a sessão à força, porque o `/exit` não foi processado a tempo. O encerramento limpo fica para o smoke final.

**Ainda a confirmar:** o formato de `Notification` e de `PreToolUse`, que dizem quando o agente pede permissão. Eles entram na Tarefa 5 do plano.

## Arquitetura proposta

**Processo principal** (`apps/desktop/src/main/terminals/`): não é dono dos terminais. Fala com o processo de terminais (abaixo) e repassa ao renderer, por IPC, o que ele devolve.

**Processo de terminais** (`apps/desktop/src/terminal-host/`): processo separado, iniciado pelo app, que continua vivo quando o app fecha. É dono de todos os PTYs: cria, escreve, redimensiona, lê e encerra cada um. Guarda um buffer em memória por terminal, de 1 MB, cortado do início. Também hospeda o receptor de hooks, para continuar recebendo os eventos com o app fechado.

Por que um processo separado: se o app fecha e ninguém lê a saída de um PTY, o buffer do pipe enche e o agente trava. O processo de terminais precisa continuar lendo sozinho.

- Roda o executável do Electron com `ELECTRON_RUN_AS_NODE=1`. Assim usa o mesmo ABI do `node-pty` que o app, sem exigir um Node instalado.
- Conversa com o app por um named pipe do Windows, com protocolo JSON por linha. O nome do pipe inclui o usuário. Um token de sessão fica num arquivo que só o usuário lê.
- Tem uma versão de protocolo, verificada no handshake. Se o app for atualizado e a versão mudar, o app não derruba um processo com sessões vivas: mostra o aviso e usa o processo antigo até as sessões acabarem.
- Encerra sozinho depois de 30 minutos sem nenhuma sessão e sem app conectado, ou quando a pessoa usa "Encerrar processo de terminais" na página Terminais.

**Porta `TerminalPort`** (em `packages/application/src/ports.ts`): `open({ id, cwd, command, args, env })`, `write`, `resize`, `kill` e um aviso de saída. Os casos de uso não importam `node-pty`. A implementação é um cliente do processo de terminais.

**Adaptador do Claude Code** (`packages/agent-adapters/src/claude-code/`): implementa `AgentAdapter`.
- `probe` roda `claude --version`.
- `start` gera o arquivo de configurações da execução (com os hooks), abre o terminal pela porta e devolve uma `AgentSession` cujos eventos vêm dos hooks.

**Receptor de hooks** (dentro do processo de terminais): servidor HTTP em `127.0.0.1`, em porta livre, com token aleatório por execução e corpo com limite de 1 MB. Recebe o JSON de cada hook e grava o evento num registro por execução, em disco, para o app ler quando estiver aberto. Só grava eventos de hook, nunca a saída bruta do terminal.

**Renderer:** uma página nova, "Terminais", com lista lateral e área dividida. O terminal usa xterm.js. Shell e agente usam o mesmo componente.

**Contratos** (`packages/contracts`): canais IPC novos, com zod nos dois sentidos e schema de resposta, como os canais atuais (R28, R65).

### Como o app sabe o que o agente está fazendo

Esse é o ponto central. O Claude Code interativo não emite eventos estruturados. O app recebe o estado por hooks que o próprio CLI dispara: início de sessão, pedido de permissão, espera por entrada e fim. Cada hook roda um comando que envia o JSON ao receptor local.

Se um hook não chegar, a missão não avança sozinha. O orquestrador trata a falta de evento como estado desconhecido, e a pessoa vê o terminal. Nada é inventado a partir da saída de texto.

### Capacidades declaradas (seção 14.3)

| Capacidade | Valor | Motivo |
|---|---|---|
| `interactiveInput` | `true` | O terminal aceita digitação. |
| `streaming` | `false` | O texto aparece no terminal, não como eventos. |
| `tools` | `true` | Os hooks de ferramenta registram o uso (a confirmar). |
| `approvals` | `false` | Na primeira etapa, a permissão é respondida no terminal. Ver pergunta 1. |
| `pauseResume` | `false` | A UI esconde Pausar para este adaptador (R186). |
| `usageReporting` | `false` | O CLI não expõe uso pelos hooks nesta etapa. |
| `persistentContext` | `false` | Sem `--resume` nesta etapa. |
| `localExecution` | `true` | Roda na máquina da pessoa. |

### Terminal e processo

- Windows primeiro (`brain/decisoes/decisao-windows-primeiro.md`). O PTY usa ConPTY, por meio do `node-pty`.
- Encerrar a árvore de processos no Windows: `taskkill /PID <pid> /T /F`, com argumentos em array e tempo limite de 5 s. O PID é o do PTY que o app abriu. Sem essa prova, não encerra (ver a reserva).
- Ambiente: lista fechada de variáveis (`PATH`, pastas do usuário, `TEMP`, `LANG`, `TERM` e as que o CLI precisar). Todo o resto fica de fora. Se o login do CLI quebrar com essa lista, o ajuste é feito na lista, não com o ambiente inteiro.
- Diretório: o agente roda no caminho do worktree, lido do banco pelo `id` da missão. O shell comum roda na raiz do projeto, também pelo `id`.
- Shell padrão no Windows: `powershell.exe`. Fora do Windows, o shell do usuário.
- Concorrência: no máximo 2 missões com agente vivo, configurável (planejamento, 15.6). Terminal manual não conta. Missão esperando aprovação ocupa a vaga, porque o processo continua vivo.

### Persistência e reconexão

- Os eventos da missão continuam no banco, como hoje.
- O registro de eventos de hook de cada execução fica em disco, na pasta de dados do app. Cada linha tem um número de sequência. O banco guarda o último número aplicado, então um evento nunca é aplicado duas vezes.
- A saída bruta do terminal fica só em memória, no processo de terminais, no buffer de 1 MB. Ela pode trazer segredos, então não vai para o disco.
- Ao abrir o app, a recuperação consulta o processo de terminais. Se a sessão da missão está viva, a execução é reanexada e os eventos que faltam são aplicados em ordem. Se a sessão não existe mais, a execução vira `failed` com `interrupted_by_restart`, como hoje.
- Reinício do computador encerra tudo. Nesse caso, a recuperação marca as execuções como `failed`.
- Quando o app está fechado, a missão no banco fica como estava até a reabertura. A página Terminais mostra os agentes que continuam vivos.

### Segurança

- Um canal IPC por operação, com `id` do terminal, validação zod e conferência do remetente (R31, R65).
- O texto do terminal entra no xterm como dado, nunca como HTML.
- A auditoria registra abrir, fechar e encerrar terminal, sem o conteúdo.
- Os hooks só aceitam chamada com o token da execução, vinda só de `127.0.0.1`.

### Interface

- Página "Terminais" como rota de topo, ao lado de Projetos.
- Lista lateral com cada agente e cada shell, mostrando o estado. O estado usa forma e texto, não só cor: rodando, aguardando você, concluída, falhou, parado.
- Área dividida: botão para dividir (à direita ou abaixo), fechar um painel e abrir um novo shell.
- A aba Terminal da missão mostra o terminal da missão, interativo, no lugar do texto de leitura.

## Testes

- **Unitários:** lista de variáveis de ambiente, leitura dos hooks, geração do arquivo de configurações, limite do buffer e validação dos canais.
- **Integração:** um CLI falso (um script Node que imprime um prompt, dispara hooks e espera entrada) rodando num PTY real. Não exige login do Claude.
- **Smoke manual:** uma vez, com o `claude` real, antes de fechar a etapa. O resultado é registrado no diário.
- **E2E:** abrir um shell, dividir a área, digitar `echo` e ver a saída. O E2E de missão continua com o agente simulado, para não depender de login.

## Dependências

Pedido de aprovação, porque a regra do plano de interface exige aprovação para qualquer biblioteca fora da lista:

- `@xterm/xterm` (renderer), licença MIT.
- `node-pty` (processo principal), licença MIT. É módulo nativo: precisa de binário pronto ou de compilação para o Electron. É o risco técnico maior no Windows. O primeiro teste da etapa é carregar o módulo no Electron.

## Riscos

- **`node-pty` no Electron e no Windows.** Mitigação: carregar o módulo e abrir um PTY antes de qualquer outra parte.
- **Formato dos hooks.** Pode mudar entre versões do CLI. Mitigação: registrar a versão mínima testada e ter um teste de contrato com o formato real.
- **Login dentro do terminal.** Se o CLI pedir login, a pessoa faz ali. Se o login não funcionar com o ambiente limitado, a lista de variáveis é corrigida.
- **Pasta nova.** Cada worktree é uma pasta nova, e o CLI pergunta a confiança no terminal. A pessoa responde ali, e o app não grava confiança nem responde pelo diálogo. A opção padrão do diálogo é sair, então o terminal mostra a tela como ela está. O diálogo vem antes do primeiro hook: se não houver `SessionStart` em 15 s, a missão mostra a dica "confira o terminal, o Claude Code pode estar pedindo confirmação da pasta".
- **Agente parado sem hook** segura uma vaga de concorrência até a pessoa agir ou cancelar.
- **Processo que sobrevive ao Electron no Windows.** O processo de terminais precisa continuar vivo depois que o app fecha. Mitigação: iniciá-lo desligado do app (`detached`, sem janela, sem vínculo de saída), e testar o fechamento cedo.
- **Eventos com o app fechado.** Os eventos ficam no registro em disco, com número de sequência. Mitigação: aplicação idempotente, com teste de reconexão.
- **Memória extra.** O processo de terminais é mais um runtime do Electron, na casa de dezenas de MB. Aceito, e medido no smoke.
- **Comando do hook no Windows.** O comando que o hook executa precisa aguentar caminho com acento e espaço (a reserva já registra esse ponto). Mitigação: um lançador próprio, testado com a pasta do projeto real.

## Critérios de aceite (observáveis)

1. Iniciar uma missão aprovada abre o Claude Code no worktree, visível na página Terminais.
2. Digitar no terminal chega ao agente.
3. Um pedido de permissão aparece no terminal, e a missão mostra "aguardando você" pelo hook.
4. Dividir a área deixa dois terminais visíveis, e fechar um não encerra o outro.
5. Um shell comum abre na raiz do projeto e não compartilha sessão com nenhuma missão.
6. Cancelar encerra o agente e não deixa processo filho (no Windows, conferido na lista de processos).
7. Fechar o app não encerra os agentes. Ao reabrir, o app reconecta a eles, aplica os eventos que ocorreram enquanto estava fechado e mostra a saída recente. Uma missão cujo agente já morreu vira `failed`.
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` e `pnpm test:e2e` com código 0.

## Ordem de entrega (sugerida; o plano detalhado vem depois)

1. Smoke do CLI: os hooks chegam por `--settings` numa execução interativa.
2. `node-pty` carregando no Electron (depende da aprovação).
2b. Processo de terminais: sobrevive ao fechamento do app, reconexão por pipe, handshake de versão.
3. Gerenciador de PTY dentro do processo de terminais, com testes.
4. Canais IPC e xterm.js: um shell funcionando na página Terminais.
5. Lista lateral e divisão da área.
6. Adaptador do Claude Code e receptor de hooks, com o CLI falso.
7. Ligar a missão ao terminal. Pausar e aprovar ficam desligados conforme as capacidades.
8. Smoke com o `claude` real, e E2E.

## Decisões tomadas por mim (revisar)

- Página "Terminais" como rota de topo.
- Lista lateral única, agrupada por projeto.
- Shell comum na raiz do projeto; terminal de missão no worktree.
- Shell padrão no Windows: `powershell.exe`.
- Buffer de 1 MB em memória, sem disco.
- Limite de 2 missões com agente vivo, configurável.
- Pausar, uso e retomada desligados nesta etapa.

## Decisões da aprovação (2026-10-21)

Aprovado. Os pontos 1, 3 e 4 seguem os padrões descritos abaixo. O ponto 2 mudou: os agentes continuam rodando ao fechar o app.

## Perguntas respondidas

1. **Quem decide as aprovações?** Padrão: a pessoa responde no terminal, e o app só mostra o estado. A alternativa é o app segurar cada pedido de permissão (hook `PreToolUse`) e decidir pela tela, como as políticas da ADR 0006 pedem. É mais trabalho e mais risco de travar o agente.
2. **Fechar o app encerra os agentes?** Decidido: não. Os agentes continuam rodando, o que exige o processo de terminais descrito acima.
3. **Aprovar as duas dependências** (`@xterm/xterm` e `node-pty`).
4. **Pausar o agente some para a missão do Claude Code?** Hoje a missão simulada pausa e retoma. Com o CLI interativo, pausar exige suspender o processo, que no Windows não é simples. Padrão: pausar fica desligado para este agente, e o botão some. A alternativa é adiar a etapa até existir um jeito seguro de pausar.
