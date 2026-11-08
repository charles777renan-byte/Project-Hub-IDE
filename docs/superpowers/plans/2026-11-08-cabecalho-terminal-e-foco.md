# Cabeçalho do terminal, contexto e foco: plano de implementação

> **Para agentes:** SUB-HABILIDADE OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendada) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam caixas `- [ ]`.

**Objetivo:** cabeçalho de duas linhas nos painéis de terminal (título, estado em texto, modelo, worktree, pílula de tokens de hoje e barra de contexto), foco do teclado evidente e dito na barra de status, e os ajustes pequenos de legibilidade.

**Arquitetura:** o contexto ocupado e o modelo saem da última resposta do transcript principal do Claude (`transcript-usage.ts`), passam pelo serviço de uso dos terminais e chegam ao renderer em dois campos opcionais novos do `TerminalSummary`. O renderer troca o cabeçalho e o rodapé do `PaneView` pelo cabeçalho de duas linhas, move "fechar" para o menu ⋯ (`MenuAcoes`) e guarda o painel com o teclado num store pequeno que a `StatusBar` lê.

**Tecnologias:** TypeScript, Electron, React, Radix DropdownMenu (via `MenuAcoes`), Zod (`packages/contracts`), Vitest (`pnpm exec vitest run <caminho>`; testes do renderer com `--project=renderer`), Playwright + Electron para E2E.

**Design:** `docs/superpowers/specs/2026-11-08-cabecalho-terminal-e-foco-design.md` (o plano argumenta a partir dele; leia os dois).

## Restrições globais

- UI e textos em português do Brasil. Estado nunca só por cor: forma ou texto também (`state-mark.ts`). Rótulos do selo são os de `MARKS`: `Ativo` e `Aguardando`; nenhum estado novo.
- A pílula de tokens (`PaneUsage`, `terminal-usage.ts`, regras `.pane__usage-value` em `app.css`) **não muda**: mesmo desenho, mesma rampa, mesma contagem animada, mesma dica; só vai para a linha 2. Sem `usage`, ela não aparece (nunca um zero). `contrast.test.ts` confere textos exatos dessas regras (`.pane__usage-value { color: var(--cyan);` e os níveis): não reformate o CSS delas.
- Barra de contexto: cinza até 80%, violeta (`--brand`) a partir de 80% (constante `CONTEXT_HIGH_FROM`), porcentagem sempre visível, sem vermelho; teto de 100% na exibição; sem dado, não aparece.
- Fora de escopo, não tocar: barras laterais, dashboard do Início, fundo animado, animações de tela; o terminal de missão não ganha modelo nem barra (a linha 2 dele mostra o nome do programa); o lançador e a sessão terminada mantêm o cabeçalho de uma linha de hoje.
- Contraste: pares novos (texto no cabeçalho tingido, `--brand` e `--text` sobre `--surface`) entram em `apps/desktop/test/renderer/contrast.test.ts`.
- O transcript só entrega números e o id do modelo; o texto da resposta não é copiado.
- Nomes acessíveis atuais ficam: `Maximizar painel`, `Voltar à grade`, `Painel <programa>`; o texto do estado continua legível para leitor de tela.
- CSP do app: nada de `<style>` inline nem Radix em modo modal (`MenuAcoes` já usa `modal={false}`).
- **Sem commits neste plano.** A regra do projeto é só commitar quando a pessoa pedir, e sem atribuição ao Claude. Ao fim de cada tarefa, rode os testes dela e siga; o commit fica para o pedido da pessoa.
- A árvore de trabalho já tem mudanças não commitadas de outra tarefa (arquivos no painel direito: `FilesTab`, `RightPanel`, `WorkspacePage`, `WorkspaceToolbar`, `open-files`, CSS e testes). Não reverta nem reformate nada disso; `WorkspacePage.tsx` e `workspace.css` são tocados por este plano, então edite só os trechos citados.
- Ao terminar: `graphify update .`, atualizar `brain/` (nota de arquitetura do renderer, nota de decisão e diário `AAAA-MM-DD-sessao.md`), gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`) e `pnpm dev` aberto na raiz do worktree, conferido na janela.

## Foco da revisão

Entradas que o design implica e que nenhuma tarefa testaria por conta própria. Cada linha tem o teste que a prende, na tarefa dona.

1. Resposta do transcript sem `usage` válido, ou com tudo zero: a barra não aparece, nunca "0%" (Tarefa 2 e Tarefa 5).
2. `/compact` derruba o contexto e `/clear` abre outra sessão: vale a resposta mais recente entre os transcripts principais, e o subagente nunca conta (Tarefa 2).
3. Modelo que a tabela não conhece, ou uso acima da janela: janela padrão de 200 mil e porcentagem limitada a 100 (Tarefa 1).
4. Foco passando de um painel a outro, ou saindo para a barra lateral: a barra de status nunca mostra o painel errado, e desmontar o painel limpa (Tarefa 7).
5. Fechar sessão de agente avulsa viva pergunta antes; "Voltar" não fecha; shell comum fecha sem perguntar; missão nunca pergunta (Tarefa 6).

---

### Tarefa 1: janela de contexto no domínio

**Arquivos:**
- Criar: `packages/domain/src/context-window.ts`
- Modificar: `packages/domain/src/index.ts` (exportar o arquivo novo)
- Testar: `packages/domain/test/context-window.test.ts`

**Interfaces:**
- Consome: nada.
- Produz: `export const DEFAULT_CONTEXT_WINDOW = 200_000`; `export function contextWindowOf(model: string): number`; `export function contextTokensOf(usage: Pick<MessageUsage, 'inputTokens' | 'cacheReadInputTokens' | 'cacheWrite5mInputTokens' | 'cacheWrite1hInputTokens'>): number` (entrada nova + cache lido + cache escrito de 5 min e de 1 h; a saída não entra).

- [ ] **Passo 1: escrever os testes que falham** em `context-window.test.ts`: `contextWindowOf('claude-sonnet-5-5')` é número inteiro positivo; modelo desconhecido (`'modelo-x'`) e string vazia devolvem `DEFAULT_CONTEXT_WINDOW`; id com sufixo de data (`claude-sonnet-4-5-20250929`) resolve como o id sem data (mesma regra de `priceKey` em `usage.ts`); `contextTokensOf({ inputTokens: 10, cacheReadInputTokens: 100, cacheWrite5mInputTokens: 5, cacheWrite1hInputTokens: 1 })` é `116`.
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run packages/domain/test/context-window.test.ts`. Esperado: FALHA, módulo inexistente.
- [ ] **Passo 3: implementar** `context-window.ts`. A tabela é `CONTEXT_WINDOWS: Readonly<Record<string, number>>`, por id sem sufixo de data e com a mesma ordem de famílias de `MODEL_PRICES`; reuse a remoção do sufixo de data (exporte `priceKey` de `usage.ts` ou repita a regex numa função própria, a que for menor). O padrão é 200 mil. Antes de preencher valores diferentes de 200 mil, confira o tamanho de janela de cada modelo na documentação oficial de modelos da Anthropic e anote no comentário do arquivo a data da conferência; o que não puder ser conferido fica fora da tabela. Comentário do arquivo: o transcript não diz se a sessão é de 1 milhão, então a porcentagem pode ficar acima do real nessas sessões (limitação aceita no design).
- [ ] **Passo 4: rodar e ver passar.** Mesmo comando. Esperado: PASSA. Rodar também `pnpm exec vitest run packages/domain` para garantir que nada mais quebrou.

---

### Tarefa 2: o leitor de transcript guarda a última resposta principal

**Arquivos:**
- Modificar: `packages/agent-adapters/src/claude-code/transcript-usage.ts`
- Testar: `packages/agent-adapters/test/claude-code/transcript-usage.test.ts`

**Interfaces:**
- Consome: `MessageUsage` e `contextTokensOf` (Tarefa 1, de `@project-hub/domain`).
- Produz: `readUsageLine(line)` passa a devolver também `at?: number` (milissegundos de `record.timestamp`, quando for um ISO válido; ausente quando não for); `TranscriptUsageTracker` ganha `latestContext(): { model: string; usedTokens: number } | undefined`.

- [ ] **Passo 1: escrever os testes que falham** (no estilo dos testes existentes do arquivo, que montam transcripts em disco): (a) após `poll()`, `latestContext()` devolve modelo e `usedTokens` da resposta principal mais recente por `timestamp`; (b) duas sessões principais (`addSession` duas vezes, como num `/clear`): vale a de `timestamp` maior, mesmo se o arquivo dela foi lido antes; (c) resposta de subagente (`<sessão>/subagents/agent-*.jsonl`) mais nova que a principal **não** muda `latestContext()`; (d) a mesma resposta em várias linhas (streaming) conta uma vez, com o maior valor de cada campo; (e) resposta sem `usage` válido não cria contexto (`latestContext()` fica `undefined` se for a única); (f) resposta com tudo zero (sintética) não cria contexto; (g) sem `timestamp`, vale a ordem de leitura; (h) `readUsageLine` devolve `at` para `"timestamp":"2026-11-08T10:00:00.000Z"`.
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run packages/agent-adapters/test/claude-code/transcript-usage.test.ts`. Esperado: FALHA nos testes novos; os antigos seguem passando.
- [ ] **Passo 3: implementar.** Em `readUsageLine`, ler `record['timestamp']` (string, `Date.parse` finito) e devolver `at` só quando válido. Em `readNew(file)`, passar se o arquivo é principal ou de subagente (`poll` já sabe: `session.path` é principal, `subagentFiles(...)` são subagentes). Para linhas principais, manter um único `latest: { id; at: number | undefined; seq: number; usage: MessageUsage } | undefined`: uma linha vira o mais recente se o `at` dela for maior que o do atual, ou se um dos dois não tiver `at` e ela foi lida depois (ordem de leitura, `seq` crescente), ou se for o mesmo `id` (então funde com `mergeUsage`, que já pega o maior de cada campo). Ignorar linha cujo `contextTokensOf` seja 0. `latestContext()` devolve `{ model, usedTokens: contextTokensOf(usage) }` ou `undefined`.
- [ ] **Passo 4: rodar e ver passar.** Mesmo comando. Esperado: PASSA (testes novos e antigos).

---

### Tarefa 3: contrato e serviço de uso levam modelo e contexto até o `TerminalSummary`

**Arquivos:**
- Modificar: `packages/contracts/src/terminal.ts`, `apps/desktop/src/main/terminal-usage.ts`, `apps/desktop/src/main/terminals.ts`
- Testar: `apps/desktop/test/terminal-usage.test.ts`, `apps/desktop/test/terminals.test.ts`, o teste do contrato de terminal (o arquivo que hoje valida `terminalSummarySchema`; ache com `grep -rl terminalSummarySchema packages/contracts apps/desktop/test`)

**Interfaces:**
- Consome: `TranscriptUsageTracker.latestContext()` (Tarefa 2), `contextWindowOf` (Tarefa 1), a fábrica `createTracker` de `TerminalUsageDeps`.
- Produz: em `terminalSummarySchema`, `model: z.string().optional()` e `context: z.object({ usedTokens: tokenCount, windowTokens: tokenCount }).optional()` (mesmo `tokenCount` de `mission.ts`; exporte-o de lá ou declare igual, o que for menor); em `TerminalUsageService`, `contextOf(terminalId: string): { model: string; usedTokens: number; windowTokens: number } | undefined`, que devolve o último valor lido, sem ler de novo.

- [ ] **Passo 1: escrever os testes que falham.** Contrato: o schema aceita `model` e `context` e continua aceitando o resumo sem eles. Serviço: depois de `usageOf('t1')` com transcript, `contextOf('t1')` traz `model`, `usedTokens` e `windowTokens === contextWindowOf(model)`; antes da leitura e para terminal desconhecido, `undefined`; depois de `forget`, `undefined`; uma leitura que falha mantém o último valor. `terminals.test.ts`: um terminal avulso Claude com uso aparece em `list()` com `model` e `context`; um avulso de outro programa e um terminal de missão aparecem sem os dois campos.
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run apps/desktop/test/terminal-usage.test.ts apps/desktop/test/terminals.test.ts` e o teste do contrato. Esperado: FALHA nos novos.
- [ ] **Passo 3: implementar.** Contrato: os dois campos opcionais, com comentário no estilo dos vizinhos (só o Claude informa; sem dado não vem; não é zero). Serviço: em `Entry`, guardar `context`; em `refresh`, depois de `poll()`, ler `entry.tracker.latestContext()` (mesmo quando `poll()` devolveu `undefined`: o contexto muda com a soma igual) e guardar com `windowTokens` calculado; `contextOf` devolve `entries.get(id)?.context`. Em `terminals.ts`, no ramo de sessão avulsa (junto de `usageOfClaude`), depois de `await usageOfClaude(record.id)`, chamar `usage.contextOf(record.id)` e espalhar `model` e `context` no resumo só quando existirem. O ramo de missão não muda.
- [ ] **Passo 4: rodar e ver passar.** Os mesmos comandos. Esperado: PASSA. Rodar `pnpm typecheck` (os tipos do contrato chegam ao renderer e a fixtures de teste).

---

### Tarefa 4: peças puras do renderer (contexto e foco)

**Arquivos:**
- Criar: `apps/desktop/src/renderer/terminal-context.ts`, `apps/desktop/src/renderer/terminal-focus.ts`
- Testar: `apps/desktop/test/renderer/terminal-context.test.ts`, `apps/desktop/test/renderer/terminal-focus.test.ts`

**Interfaces:**
- Consome: `TerminalSummary` (Tarefa 3).
- Produz, em `terminal-context.ts`: `export const CONTEXT_HIGH_FROM = 80`; `export function contextPercent(context: { usedTokens: number; windowTokens: number }): number` (inteiro de 0 a 100, truncado, com teto 100; janela 0 devolve 0); `export function contextLevel(percent: number): 'normal' | 'high'`; `export function contextDetailText(context): string` (ex.: `"Contexto: 76.000 de 200.000 tokens (38%)"`, para dica e leitor de tela); `export function modelLabel(model: string): string | undefined` (família com inicial maiúscula para `claude-(opus|sonnet|haiku|fable|mythos)...`, como `Opus`; qualquer outro id devolve `undefined`, e quem chama cai no nome do programa). Em `terminal-focus.ts`, no padrão de `open-files.ts` (`useSyncExternalStore`): `export type TerminalFocus = { key: string; title: string }`; `setTerminalFocus(focus: TerminalFocus): void`; `clearTerminalFocus(key: string): void` (só limpa se o foco atual for dessa chave); `useTerminalFocus(): TerminalFocus | null`; `resetTerminalFocusForTests(): void`.

- [ ] **Passo 1: escrever os testes que falham.** Contexto: `contextPercent({usedTokens: 76_000, windowTokens: 200_000})` é `38`; `usedTokens > windowTokens` dá `100`; `windowTokens: 0` dá `0`; `contextLevel(79)` é `'normal'` e `contextLevel(80)` é `'high'`; `modelLabel('claude-opus-5-5')` é `'Opus'`, `modelLabel('claude-sonnet-4-5-20250929')` é `'Sonnet'`, `modelLabel('modelo-x')` é `undefined`; `contextDetailText` traz os três números. Foco: `setTerminalFocus` publica; `clearTerminalFocus('a')` com o foco atual de `'b'` não limpa; com o de `'a'` limpa; o hook reage às mudanças (render com `renderHook` e `act`).
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/terminal-context.test.ts apps/desktop/test/renderer/terminal-focus.test.ts`. Esperado: FALHA, módulos inexistentes.
- [ ] **Passo 3: implementar** os dois arquivos com as assinaturas acima. Números em `contextDetailText` com `Intl.NumberFormat('pt-BR')`.
- [ ] **Passo 4: rodar e ver passar.** Mesmo comando. Esperado: PASSA.

---

### Tarefa 5: cabeçalho de duas linhas e barra de contexto no `PaneView`

**Arquivos:**
- Criar: `apps/desktop/src/renderer/workspace/PaneContext.tsx`
- Modificar: `apps/desktop/src/renderer/workspace/PaneView.tsx`, `apps/desktop/src/renderer/styles/workspace.css`, `apps/desktop/src/renderer/styles/app.css` (só o que for da barra e do selo novos)
- Testar: `apps/desktop/test/renderer/PaneView.test.tsx`, `apps/desktop/test/renderer/pane-styles.test.ts`, `apps/desktop/test/renderer/contrast.test.ts`, `apps/desktop/test/renderer/PaneContext.test.tsx` (novo)

**Interfaces:**
- Consome: `contextPercent`, `contextLevel`, `contextDetailText`, `modelLabel` (Tarefa 4); `terminal.model`, `terminal.context`, `terminal.title`, `terminal.worktreeName`, `terminal.usage`, `PaneUsage` (sem mudanças); `MARKS`, `markOfTerminal`.
- Produz: `PaneContext({ context }: { context: TerminalSummary['context'] })`, que não desenha nada com `context === undefined`; senão `<span class="pane__context" title={detalhe}>` com o rótulo `contexto`, a barra (`.pane__context-bar > .pane__context-fill`, largura em `style` pela CSSOM) e `<b>N%</b>`, `data-level="normal|high"`, mais o texto de `contextDetailText` só para leitor de tela (padrão de `.pane__usage-sr`).

- [ ] **Passo 1: escrever os testes que falham.** `PaneContext.test.tsx`: sem `context`, nada no DOM; com 38%, mostra `38%`, `data-level="normal"`, largura 38%; com 84%, `data-level="high"`; com uso maior que a janela, `100%`; o texto para leitor de tela traz o detalhe. `PaneView.test.tsx` (sessão viva, terminal avulso): o título (`terminal.title`) e o selo com o rótulo visível `Ativo` (e `Aguardando` para `state: 'waiting'`); linha 2 com o modelo (`Opus`) e a worktree; sem `model`, o nome do programa; terminal de missão: nome do programa e sem barra de contexto; **não existe mais** `.pane__foot` nem o texto `Ctrl+Shift+Tab sai do terminal` dentro do painel; o `title` do bloco de título traz `terminal.projectName`; o lançador e a sessão terminada seguem com o cabeçalho de uma linha (os testes atuais deles continuam passando). `pane-styles.test.ts`: o cabeçalho da sessão viva deixa de ser fixo em 28 px e o rodapé deixa de existir (reescreva o caso "a cabeça tem 28px e o rodapé 22px" para o lançador/terminado de 28 px e para o cabeçalho novo sem altura fixa, `flex: none`); a linha 2 usa `white-space: nowrap`, a worktree tem `min-width: 0` e `text-overflow: ellipsis`, e a pílula e a barra têm `flex: none`. `contrast.test.ts`: `--text` e `--brand` sobre `--surface` e `--text`/`--muted` sobre o fundo tingido do foco (a tinta é da Tarefa 7; deixe o par já medido aqui com o mesmo `color-mix`).
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/PaneContext.test.tsx apps/desktop/test/renderer/PaneView.test.tsx apps/desktop/test/renderer/pane-styles.test.ts apps/desktop/test/renderer/contrast.test.ts`. Esperado: FALHA nos novos.
- [ ] **Passo 3: implementar `PaneContext`** e, em `PaneView.tsx`, o ramo da sessão viva: linha 1 (`ProviderIcon`, título com `title={terminal.projectName}`, selo visível `● Ativo`/`◐ Aguardando` com a forma e o rótulo de `MARKS`, depois `maximize` e as ações) e linha 2 (modelo ou nome do programa, `terminal.worktreeName`, `PaneUsage` inalterado, `PaneContext` à direita). Retire o `<div className="pane__foot">` e o import de `EXIT_HINT` do `PaneView` (a constante continua em `exit-hint.ts` para o `TerminalView` e para a barra de status). O selo passa a ter texto visível: remova o `state-mark__sr` duplicado dele e mantenha a dica (`title`) com a origem recuperada. Os botões continuam como hoje nesta tarefa (o menu vem na Tarefa 6). CSS: classes novas `.pane__head--live` (altura automática, duas linhas), `.pane__line1`, `.pane__line2`, `.pane__context*`, truncando da esquerda para a direita (worktree cede primeiro, depois o modelo); a barra é `--line` de fundo e `--muted` de preenchimento, `--brand` em `data-level='high'`. Não mexa nas regras `.pane__usage*`.
- [ ] **Passo 4: rodar e ver passar.** Mesmo comando, mais `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/WorkspacePage.test.tsx`. Esperado: PASSA.

---

### Tarefa 6: menu ⋯ e confirmação ao fechar

**Arquivos:**
- Modificar: `apps/desktop/src/renderer/components/MenuAcoes.tsx`, `apps/desktop/src/renderer/workspace/PaneView.tsx`, `apps/desktop/src/renderer/styles/app.css` ou `workspace.css` (o gatilho em ícone), os specs E2E que clicam em `Fechar painel` (`apps/desktop/e2e/workspace.spec.ts`, `painel-por-vez.spec.ts`, `transicoes.spec.ts`, `interface-ide.spec.ts`, `identidade.spec.ts`, `capturas.spec.ts`, `painel-direito.spec.ts`) e o módulo de apoio compartilhado dos E2E
- Testar: `apps/desktop/test/renderer/PaneView.test.tsx`, `apps/desktop/test/renderer/WorkspacePage.test.tsx`, um teste do `MenuAcoes` (o existente, se houver; senão `apps/desktop/test/renderer/MenuAcoes.test.tsx`)

**Interfaces:**
- Consome: `ConfirmInline` (`components/ConfirmButton.tsx`, com `focusBack`), `MenuAcoes`, `terminal.kind`, `terminal.provider`, `terminal.state`, `terminal.missionId`, `props.onClose`, `props.onDetach`.
- Produz: `MenuAcoes` ganha `icone?: ReactNode`; quando presente, o gatilho mostra o ícone e usa `rotulo` só como nome acessível (`aria-label`). Em `PaneView`, a função `needsCloseConfirmation(terminal): boolean` (módulo local, exportada para teste): verdadeira só para `terminal.kind === 'shell' && terminal.provider !== 'shell' && terminal.state === 'running'`.

- [ ] **Passo 1: escrever os testes que falham.** `MenuAcoes`: com `icone`, o botão tem o nome `rotulo` e não mostra o texto. `PaneView` sessão viva: não existe botão `Fechar painel` solto no cabeçalho; existe o botão `Mais ações do painel`; o `Maximizar painel` continua solto. Terminal avulso de agente (`kind: 'shell'`, `provider: 'claude'`, `state: 'running'`): o menu tem `Fechar painel e encerrar…`; escolher mostra a pergunta (`ConfirmInline`, com "Voltar" focado); "Voltar" some a pergunta e **não** chama `onClose`; confirmar chama `onClose` uma vez. Avulso `provider: 'shell'`: o menu tem `Fechar painel` e escolher chama `onClose` direto, sem pergunta. Terminal de missão (`missionId` definido): o menu tem `Tirar do painel` (chama `onDetach`) e `Fechar painel (a missão continua)` (chama `onClose` direto). `needsCloseConfirmation` como tabela de casos. Os testes de `WorkspacePage` e os E2E que clicavam no X passam a abrir o menu antes e, para agente avulso vivo, confirmar.
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/PaneView.test.tsx apps/desktop/test/renderer/WorkspacePage.test.tsx apps/desktop/test/renderer/MenuAcoes.test.tsx`. Esperado: FALHA nos novos e nos que clicavam no X.
- [ ] **Passo 3: implementar** `icone` em `MenuAcoes` (sem mudar quem usa texto) e, em `PaneView`, o menu da sessão viva com os itens da Tarefa descritos acima; o estado `asking` vive no `PaneView`, e a pergunta aparece numa faixa abaixo do cabeçalho (`.pane__confirm`) com o texto "Encerrar o <programa> e fechar o painel? O processo para." (ajuste a redação se ficar longa) e o botão `Fechar e encerrar`. O lançador e a sessão terminada mantêm o `CloseButton` de hoje. Remova o botão `Tirar do painel` solto do cabeçalho da missão (agora é item do menu) e o `CloseButton` da sessão viva; mantenha o componente para o lançador e a sessão terminada. Botões do cabeçalho com área mínima de 24×24 px (inclui o gatilho do menu e o maximizar).
- [ ] **Passo 4: atualizar os E2E.** Crie (ou reuse, se já houver) um helper `fecharPainel(page, nomeDoPainel)` no módulo de apoio dos E2E, que abre o menu do painel, escolhe o item certo e, para agente avulso vivo, confirma; troque os cliques diretos em `Fechar painel` pelos helper. Rode: `cd apps/desktop && pnpm exec electron-vite build && pnpm exec playwright test workspace painel-por-vez transicoes interface-ide`. Esperado: PASSA.
- [ ] **Passo 5: rodar e ver passar** os testes unitários do Passo 2. Esperado: PASSA.

---

### Tarefa 7: foco do teclado (anel, tinta e barra de status)

**Arquivos:**
- Modificar: `apps/desktop/src/renderer/workspace/PaneView.tsx`, `apps/desktop/src/renderer/components/StatusBar.tsx`, `apps/desktop/src/renderer/styles/workspace.css`, `apps/desktop/src/renderer/styles/app.css` (`.statusbar__focus`)
- Testar: `apps/desktop/test/renderer/PaneView.test.tsx`, `apps/desktop/test/renderer/StatusBar.test.tsx`, `apps/desktop/test/renderer/pane-styles.test.ts`, `apps/desktop/test/renderer/contrast.test.ts`

**Interfaces:**
- Consome: `setTerminalFocus`, `clearTerminalFocus`, `useTerminalFocus` (Tarefa 4), `EXIT_HINT` (`components/terminals/exit-hint.ts`), `useMatch(ROUTE_PATHS.workspace)` já usado na `StatusBar`.
- Produz: a `StatusBar` mostra `Foco: <título> · <EXIT_HINT>` (`<p class="statusbar__focus">`) só na rota do workspace e só com `useTerminalFocus() !== null`.

- [ ] **Passo 1: escrever os testes que falham.** `PaneView`: focar um elemento dentro do painel de sessão viva chama `setTerminalFocus({ key: leaf.id, title: terminal.title })`; tirar o foco para fora do painel limpa (`clearTerminalFocus(leaf.id)`); mover o foco de dentro para outro elemento do mesmo painel não limpa; desmontar o painel com foco limpa; o lançador e a sessão terminada nunca definem foco. `StatusBar`: com foco definido e na rota do workspace, mostra `Foco: Claude · Meu Projeto · Ctrl+Shift+Tab sai do terminal`; sem foco, não mostra a parte `Foco`; fora da rota do workspace, não mostra mesmo com foco; trocar de painel troca o título. `pane-styles`: `.pane:focus-within` mantém o anel de 2 px de `--focus`; `.pane:focus-within .pane__head--live` ganha fundo `color-mix(in srgb, var(--lime) 7%, var(--surface))`; `.pane[data-active='true']` segue com 1 px `--muted` (regras de hoje, só confirmadas). `contrast`: o par da tinta (já criado na Tarefa 5) agora corresponde à regra real.
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/PaneView.test.tsx apps/desktop/test/renderer/StatusBar.test.tsx apps/desktop/test/renderer/pane-styles.test.ts apps/desktop/test/renderer/contrast.test.ts`. Esperado: FALHA nos novos.
- [ ] **Passo 3: implementar.** Em `PaneView`, só no ramo da sessão viva, `onFocus` (já existe para ativar) também chama `setTerminalFocus`, e `onBlur` chama `clearTerminalFocus(leaf.id)` quando `event.relatedTarget` não está dentro do `<section>`; um `useEffect` de desmontagem limpa. O foco é a posse real do teclado no painel (o `focusin` do xterm sobe como `onFocus` no React), diferente de `data-active`. `StatusBar` lê o store. CSS: a regra da tinta e `.statusbar__focus` (trunca com reticências como `.statusbar__project`; some em janela estreita junto do uso do computador, se faltar espaço).
- [ ] **Passo 4: rodar e ver passar.** Mesmo comando. Esperado: PASSA.

---

### Tarefa 8: ajustes pequenos

**Arquivos:**
- Modificar: `apps/desktop/src/renderer/components/OverviewCounters.tsx`, `apps/desktop/src/renderer/styles/app.css` (e `workspace.css` onde estiverem os botões do cabeçalho)
- Testar: `apps/desktop/test/renderer/OverviewCounters.test.tsx` (o existente; ache com `grep -rl OverviewCounters apps/desktop/test`), `apps/desktop/test/renderer/pane-styles.test.ts`

**Interfaces:**
- Consome: `useOverview`, `useAttention` (inalterados).
- Produz: cada selo dos contadores ganha `data-zero="true"` quando o número conhecido é 0 (nunca no traço de "ainda não lido"), e a CSS pinta esses selos em cinza neutro (`--muted` sobre `--surface`, sem brilho).

- [ ] **Passo 1: escrever os testes que falham.** Com `running: 0`, o selo "0 executando" tem `data-zero="true"`; com `running: 2`, não tem; com `loaded: false`, o traço não tem; idem para "aguarda você" (`attention.known`) e "falharam". `pane-styles`: `.pane__maximize`, `.pane__close` e o gatilho do menu têm `min-width` e `min-height` de 24 px (ou `width`/`height` de 24 px).
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/OverviewCounters.test.tsx apps/desktop/test/renderer/pane-styles.test.ts`. Esperado: FALHA nos novos.
- [ ] **Passo 3: implementar** o atributo e as regras `.overview-counter[data-zero='true']` (cinza neutro; o par vai para `contrast.test.ts`). Não mude os selos com número maior que zero.
- [ ] **Passo 4: rodar e ver passar.** Mesmo comando, mais `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/contrast.test.ts`. Esperado: PASSA.

---

### Tarefa 9 (separável; pode sair sem afetar o resto): abas que rolam, com esmaecimento e lista "⌄"

**Arquivos:**
- Criar: `apps/desktop/src/renderer/components/TabsOverflow.tsx`
- Modificar: a faixa de abas do projeto (ache o componente que renderiza as abas do workspace com `overflow-x: auto`, `workspace.css:108` ou `:1754`) e `apps/desktop/src/renderer/components/project/FileTabs.tsx`; CSS correspondente
- Testar: `apps/desktop/test/renderer/TabsOverflow.test.tsx`

**Interfaces:**
- Consome: `MenuAcoes` (com `icone`, da Tarefa 6).
- Produz: `useTabsOverflow(ref: RefObject<HTMLElement>): { start: boolean; end: boolean; hidden: string[] }`, em que `start`/`end` dizem se há conteúdo escondido de cada lado (borda esmaecida por `data-fade-start`/`data-fade-end` na CSS) e `hidden` lista os ids das abas fora de vista; `TabsOverflow({ items, onSelect })`, o menu "⌄" com as abas escondidas, que seleciona e rola a escolhida para a vista.

- [ ] **Passo 1: escrever os testes que falham** com `IntersectionObserver` simulado (o jsdom não mede layout; siga o padrão de `codemirror-jsdom.ts` para o que for preciso simular): sem abas escondidas, o "⌄" não existe e não há atributos de esmaecimento; com abas escondidas, o botão `Abas fora de vista` existe, lista só as escondidas, e escolher uma chama `onSelect(id)` e rola `scrollIntoView` nela; as bordas esmaecem só do lado que tem conteúdo escondido.
- [ ] **Passo 2: rodar e ver falhar.** `pnpm exec vitest run --project=renderer apps/desktop/test/renderer/TabsOverflow.test.tsx`. Esperado: FALHA, módulo inexistente.
- [ ] **Passo 3: implementar** o hook com `IntersectionObserver` observando cada aba contra a faixa, e ligar nas duas faixas. Se o custo passar do razoável, pare aqui e deixe a tarefa fora: nada das anteriores depende dela.
- [ ] **Passo 4: rodar e ver passar.** Mesmo comando, mais os testes de `FileTabs` e do workspace. Esperado: PASSA.

---

### Tarefa 10: verificação final, registros e app aberto

**Arquivos:**
- Modificar: `brain/arquitetura/` (nota do renderer), `brain/decisoes/` (nota nova a partir de `brain/templates/decisao.md`), `brain/diario/2026-11-08-sessao.md` (a partir de `brain/templates/sessao.md`), `docs/superpowers/specs/2026-11-08-cabecalho-terminal-e-foco-design.md` (só se alguma chamada mudar durante a execução)
- Testar: gate e E2E

- [ ] **Passo 1: gate da raiz.** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`. Esperado: tudo com saída 0. Falha vira correção na tarefa dona, não um teste desligado.
- [ ] **Passo 2: E2E dos specs tocados** (`workspace`, `painel-por-vez`, `transicoes`, `interface-ide`, `identidade`, `capturas`, `painel-direito`): `cd apps/desktop && pnpm exec electron-vite build && pnpm exec playwright test <nomes>`. Esperado: tudo passa. Se o ambiente permitir, rode o E2E completo e registre o resultado; se não rodar, diga que não rodou.
- [ ] **Passo 3: `graphify update .`** na raiz do worktree.
- [ ] **Passo 4: registrar no `brain/`.** Nota de arquitetura do renderer (cabeçalho de duas linhas, store de foco, `MenuAcoes` com ícone), nota de decisão (barra de contexto neutra para não repetir a rampa da pílula; missões na segunda fase; confirmação só onde fechar mata um agente) e o diário da sessão, com `[[links]]` entre elas.
- [ ] **Passo 5: app aberto e conferido.** `pnpm dev` na raiz do worktree (pare antes qualquer `pnpm dev` de outro ramo; ele abre com os dados reais, então não grave nem apague nada nele; para exercitar o fechamento, use dados descartáveis pelo `launchApp` dos E2E). Confira na janela: cabeçalho de duas linhas num terminal avulso do Claude e num de missão, a barra de contexto, o anel e a tinta no painel com o teclado e a linha "Foco: …" na barra de status, o menu ⋯ e a confirmação. No relatório final, diga ramo e pasta onde o app roda e como pará-lo, e o que não deu para conferir.

---

## Autorrevisão

- **Cobertura do design:** cabeçalho de duas linhas e rodapé fora (Tarefa 5); selo com os rótulos de `MARKS` (5); pílula inalterada (5, restrições globais); barra de contexto, limiares e dados (1 a 5); menu ⋯, confirmação, "Tirar do painel" e nome do projeto na dica (5 e 6); foco, tinta e barra de status (7); contadores zerados e área de clique (8); abas "⌄" como tarefa descartável (9); missões fora (restrições globais e Tarefa 3, ramo de missão sem mudança); registros e app aberto (10).
- **Chamada minha, contra o texto do design:** o design diz que a confirmação vale para `kind === 'agent'`. No código, `kind: 'agent'` é o terminal de **missão** (fechar só tira do painel, a missão continua) e o avulso, mesmo do Claude, é `kind: 'shell'` com `provider` igual ao programa. A confirmação vale para onde fechar mata um agente: avulso (`kind: 'shell'`), `provider !== 'shell'`, `state === 'running'`. Custo se estiver errado: uma pergunta a mais ou a menos ao fechar.
- **Estado "Aguardando" no avulso:** o avulso só tem `running` e `exited` hoje; "Aguardando" só aparece em terminal de missão. O selo cobre os dois sem mudar o contrato.
- **Tipos consistentes:** `contextOf` devolve `{ model, usedTokens, windowTokens }`; o `TerminalSummary` guarda `model` e `context: { usedTokens, windowTokens }` (o serviço espalha os campos ao montar o resumo, Tarefa 3); `PaneContext` e `contextPercent` consomem `{ usedTokens, windowTokens }` (Tarefas 4 e 5).
- **Proporção:** o plano descreve decisões e testes; os corpos de função ficam com quem implementa.
