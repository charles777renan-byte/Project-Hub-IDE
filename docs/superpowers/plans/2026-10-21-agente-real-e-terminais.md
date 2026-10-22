# Agente real e terminais interativos: plano de implementação

> Desenho aprovado em `docs/superpowers/specs/2026-10-21-agente-real-e-terminais-design.md`, com a mudança de 2026-10-21: os agentes continuam rodando quando o app fecha. Este plano segue a ordem de entrega do desenho.

**Objetivo:** cada missão roda o Claude Code interativo num terminal do app. A página Terminais mostra uma lista lateral com agentes e shells, e a área da direita divide os terminais. Os agentes sobrevivem ao fechamento do app.

**Gate de cada tarefa:** `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm test:integration`, pela raiz, com código 0. O E2E roda na Tarefa 8 e no fim. Commit só quando a pessoa pedir.

## Já verificado (2026-10-21)

- Hooks `SessionStart` e `Stop` disparam por `--settings`, no modo de impressão e no interativo dentro de PTY.
- `node-pty` 1.1.0 carrega no Electron 44.9.0 (ABI 149). Abriu um PowerShell, recebeu entrada e devolveu saída. O script de compilação está recusado em `pnpm-workspace.yaml` (`node-pty: false`), e os binários vêm prontos para `win32-x64`.
- Um processo filho iniciado com Electron como Node sobreviveu ao `app.quit()`. A janela foi de poucos segundos. Medir de novo na Tarefa 1.
- Pasta nova mostra o diálogo "Yes, I trust this folder", com "No, exit" como padrão. O app não responde por esse diálogo.

## Pendente de verificação

- Formato de `Notification` e de `PreToolUse`: dizem quando o agente pede permissão (Tarefa 5).
- Se o prompt inicial passado como argumento posicional funciona no modo interativo (Tarefa 5).

---

### Tarefa 1: processo de terminais que sobrevive ao app

**Arquivos:** `apps/desktop/src/terminal-host/main.ts`, `protocol.ts`, `server.ts`, `lifecycle.ts`; `apps/desktop/src/main/terminal-host-client.ts`; testes em `apps/desktop/test/terminal-host/`.

- O app inicia o processo com `process.execPath`, `ELECTRON_RUN_AS_NODE=1`, `detached: true`, `stdio: 'ignore'`, `windowsHide: true`, e chama `unref()`.
- Named pipe `\\.\pipe\project-hub-terminal-<usuário>`. Protocolo JSON por linha. Token num arquivo na pasta de dados do app, com acesso só do usuário.
- Handshake com versão do protocolo e token. Versão diferente ou token errado fecha a conexão.
- Encerra sozinho após 30 min sem sessões. Comando `shutdown` aceito só quando não há sessões.

**Testes:**
- Unitário: framing JSON por linha; token errado é recusado; versão diferente é recusada.
- Integração: o host sobe; o cliente conecta, desconecta e reconecta; o host continua vivo depois que o cliente sai.
- Medição: o host continua vivo por pelo menos 5 min depois que o processo que o criou sai.

### Tarefa 2: gerenciador de PTY dentro do processo de terminais

**Arquivos:** `apps/desktop/src/terminal-host/pty-manager.ts`, `ring-buffer.ts`, `env.ts`.

- `open({ id, cwd, command, args, env })`, `write`, `resize`, `kill`, e aviso de saída. Usa `node-pty`.
- `kill` no Windows: `taskkill /PID <pid> /T /F`, com argumentos em array e tempo limite de 5 s. Só para PIDs de PTYs abertos por este processo.
- Buffer em memória de 1 MB por terminal, cortado do início.
- Ambiente: lista fechada de variáveis (`PATH`, pastas do usuário, `TEMP`, `LANG`, `TERM`). O resto fica de fora.

**Testes:**
- Unitário: buffer corta do início e respeita o limite; `env` não passa variáveis fora da lista.
- Integração: PowerShell interativo recebe entrada e devolve saída; `kill` derruba também um processo filho criado pelo shell.

### Tarefa 3: registro de eventos de hook

**Arquivos:** `apps/desktop/src/terminal-host/hook-receiver.ts`, `hook-log.ts`.

- Servidor HTTP em `127.0.0.1`, porta livre, token por execução, corpo com limite de 1 MB.
- Cada evento vira uma linha JSONL por execução, com `seq` crescente.
- Leitura por cursor: `readAfter(execução, seq)`.

**Testes:**
- Token errado recebe 401; corpo acima do limite recebe 413.
- Leitura a partir de um cursor devolve só o que falta, em ordem.
- O arquivo sobrevive a reinício do host, e a sequência continua de onde parou.

### Tarefa 4: porta `TerminalPort` e cliente

**Arquivos:** `packages/application/src/ports.ts` (porta), `apps/desktop/src/main/terminal-host-client.ts` (implementação), `apps/desktop/src/main/composition.ts`.

- A porta tem `open`, `write`, `resize`, `kill`, `isAlive` e `onExit`. A aplicação não importa `node-pty`.

**Testes:** unitário com fake; integração do cliente com o host real.

### Tarefa 5: adaptador do Claude Code

**Arquivos:** `packages/agent-adapters/src/claude-code/adapter.ts`, `settings.ts`, `args.ts`, `probe.ts`; `packages/agent-adapters/test/claude-code/`.

- `probe`: `cmd.exe /c claude --version`.
- `start`: gera o `settings.json` da execução, com os hooks `SessionStart`, `Stop` e o de permissão (a confirmar). Cada hook aponta para o receptor, com o token da execução. Abre o terminal pela porta com `--settings <arquivo>` e o prompt inicial.
- `events()`: lê o registro de hooks por cursor.
- Capacidades conforme o desenho.
- Caminhos com espaço e acento no comando do hook: testar com a pasta real do projeto.

**Testes:**
- Unitário: o arquivo de configurações gerado tem os caminhos escapados; as capacidades batem com o desenho.
- Integração com um CLI falso: um script Node que imprime um prompt, dispara os hooks e espera entrada. Não exige login.

### Tarefa 6: orquestrador: reconexão e limite de concorrência

**Arquivos:** `packages/application/src/missions/startup-recovery.ts`, `orchestrator.ts`, novo `concurrency.ts`.

- `recoverInterruptedExecutions` passa a consultar o terminal. Sessão viva: reanexa e aplica os eventos a partir do cursor salvo no banco. Sessão morta: `failed` com `interrupted_by_restart`.
- Limite de 2 execuções vivas, configurável. Início acima do limite fica na fila.
- O cursor de eventos é gravado junto com a aplicação, então nenhum evento é aplicado duas vezes.

**Testes:**
- Reanexação aplica só os eventos novos, sem duplicar.
- Sessão morta vira `failed`.
- Terceiro início com dois vivos fica na fila.
- Atualizar `startup-recovery.test.ts`, que hoje espera sempre `failed`. Registrar a mudança na nota de decisão.

### Tarefa 7: canais IPC e xterm.js

**Arquivos:** `packages/contracts` (canais `terminals:*`), `apps/desktop/src/main/ipc/terminals.ts`, `apps/desktop/src/preload/api.ts`, `apps/desktop/src/renderer/components/terminal/TerminalView.tsx`.

- Instalar `@xterm/xterm` com `pnpm --filter @project-hub/desktop add --save-exact @xterm/xterm`.
- Validação zod nos dois sentidos e conferência do remetente, como os canais atuais (R28, R31).
- O renderer manda só `id` e bytes de digitação. Nunca caminho, comando ou variável.

**Testes:** schemas dos canais; `TerminalView` com a saída simulada; remetente indevido recusado.

### Tarefa 8: página Terminais

**Arquivos:** `apps/desktop/src/renderer/pages/TerminalsPage.tsx`, `components/terminals/TerminalList.tsx`, `SplitArea.tsx`; rota em `App.tsx`; item na barra lateral.

- Lista lateral agrupada por projeto. Cada item mostra o estado com texto e forma: rodando, aguardando você, concluída, falhou, parado.
- Área dividida: dividir à direita ou abaixo, fechar um painel, abrir um shell novo. Fechar um painel não encerra o outro.
- Shell comum abre na raiz do projeto. Terminal de missão abre no worktree.
- "Encerrar processo de terminais" fica nesta página, com confirmação.

**Testes:** componentes da lista e da divisão; E2E: abrir um shell, dividir a área, digitar `echo` e ver a saída.

### Tarefa 9: aba Terminal da missão interativa

**Arquivos:** `apps/desktop/src/renderer/pages/MissionPage.tsx`, `components/workspace/TerminalPanel.tsx`.

- A aba Terminal mostra o terminal da missão, interativo, no lugar do texto de leitura.
- Pausar fica escondido para o adaptador do Claude Code (capacidade `pauseResume: false`, R186).
- Dica "confira o terminal" se não houver `SessionStart` em 15 s.

**Testes:** a aba mostra o terminal; a dica aparece pelo tempo certo; Pausar não aparece para esse adaptador.

### Tarefa 10: smoke, documentação e gate final

- Smoke com `claude` real numa missão de teste, em repositório de teste, nunca no repositório do projeto. Medir memória do processo de terminais e confirmar que a sessão sobrevive ao fechamento do app por mais de 5 min.
- Registrar a arquitetura em `brain/arquitetura/` (terminal, agentes), e a decisão em `brain/decisoes/decisao-processo-de-terminais.md`.
- ADR nova em `docs/adr/`. Conferir o próximo número na `main` antes de criar.
- Gate completo, com E2E. Só depois, a pessoa decide o commit.

---

**Depois deste plano:** o plano das bibliotecas da interface (`docs/superpowers/plans/2026-10-21-bibliotecas-interface.md`). Antes, confirmar a pré-condição dele: `ui/missao-abas` ainda não está na `main`.
