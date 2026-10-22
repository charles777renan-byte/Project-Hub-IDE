# Bibliotecas para a interface: plano de adoção em ordem

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adotar, em ordem de prioridade, um conjunto pequeno de bibliotecas que substitui componentes escritos à mão (abas, menus, ícones, avisos, paleta de comandos, formulários) sem mudar nenhuma regra de negócio, nenhum canal de IPC e nenhum texto de interface já aprovado.

**Architecture:** Cada biblioteca entra numa tarefa própria, instalada só em `apps/desktop`, com um teste que fixa o comportamento antes da troca. As bibliotecas de comportamento (Radix, cmdk, react-hook-form) substituem só a camada de comportamento; a aparência continua vindo dos tokens de `apps/desktop/src/renderer/styles/tokens.css`. Nada é trocado de uma vez: cada tarefa termina com o gate verde e os testes de tela que ela toca passando.

**Tech Stack:** React 18 e TypeScript (já existentes), Radix UI (tabs, dropdown menu, tooltip), lucide-react, sonner, cmdk, date-fns, react-hook-form, @hookform/resolvers, zod (já usado em `@project-hub/contracts`), Vitest e Testing Library (já existentes), Playwright (já existente).

**Spec:** Não há spec formal separado. A fonte das decisões é a conversa de 2026-10-21 (lista de bibliotecas aprovada pelo usuário) e o protótipo aprovado da tela da missão em `scratchpad/design-missao/project/Main.dc.html`. O plano da reformulação da tela é `docs/superpowers/plans/2026-10-20-interface-workspace.md`.

## Global Constraints

- Começar só depois que `ui/missao-abas` estiver mesclada em `feat/interface-fase-b`. A reformulação mexe em `Tabs.tsx`, `MissionSummary.tsx` e `DecisionBanner.tsx`, que as tarefas 2 a 4 também tocam.
- Bibliotecas permitidas neste plano: `@radix-ui/react-tabs`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `lucide-react`, `sonner`, `cmdk`, `date-fns`, `react-hook-form`, `@hookform/resolvers`, `zod` (já presente em `packages/contracts`), `@axe-core/playwright`. Qualquer outra biblioteca exige aprovação do usuário antes.
- Instalação só com `pnpm --filter @project-hub/desktop add <pacote>` (e `add -D` para testes). Sem CDN, sem `<script>` externo.
- Aparência só com tokens de `apps/desktop/src/renderer/styles/tokens.css`. Sem Tailwind, sem shadcn, sem CSS de outra biblioteca de componentes.
- Nenhuma regra de negócio, nenhum canal de IPC e nenhum argumento de chamada muda. O teste E2E continua passando (19 de 19 no estado atual).
- Textos de interface e comentários em português, no tom dos arquivos vizinhos. Sem menção a outros projetos ou repositórios. Sem atribuição ao Claude em commits, PRs ou código.
- Licença de cada biblioteca instalada: MIT ou Apache-2.0. Conferir em `node_modules/<pacote>/package.json` antes de commitar.
- Antes de cada commit: `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm test:integration`, todos com código 0, pela raiz.
- Um commit por tarefa. Mensagens de commit no formato `feat(renderer): ...` ou `chore(renderer): ...`.

## Review Focus

1. **Foco nas abas:** depois de trocar de aba com o mouse ou com as setas, o foco fica na aba ativa, e a tecla Tab sai da barra de abas para o conteúdo da aba. Teste: Tarefa 2, `Tabs.test.tsx`.
2. **Copiar caminho sem permissão:** se `navigator.clipboard.writeText` recusar, o botão mostra "Não foi possível copiar o caminho." num `role="status"`, e nada é marcado como copiado. Teste: Tarefa 5, `MissionSummary.test.tsx`.
3. **Paleta com texto digitado:** Ctrl+K com texto já digitado no campo de resposta da Conversa abre a paleta; ao fechar com Escape, o texto digitado continua no campo e o foco volta para ele. Teste: Tarefa 7, `PaletaComandos.test.tsx`.
4. **Horário de evento antigo:** um evento de 40 horas atrás mostra data e hora (`19/10 14:02`), não "há 40 h". Teste: Tarefa 6, `mission-text.test.ts`.
5. **Formulário de missão:** título vazio não envia, mostra a mensagem atual sem perder os outros campos preenchidos, e o foco vai para o primeiro campo inválido. Teste: Tarefa 8, `MissionForm.test.tsx`.

---

### Task 1: Medir acessibilidade com axe-core (sem mudança de interface)

**Files:**
- Modify: `apps/desktop/package.json` (devDependency `@axe-core/playwright`)
- Create: `apps/desktop/e2e/acessibilidade.spec.ts`

**Interfaces:**
- Consumes: os fixtures `launchApp`, `gitRepo` e `gitEnv` de `apps/desktop/e2e/fixtures.ts`.
- Produces: um relatório com as violações encontradas por tela, em `docs/superpowers/plans/2026-10-21-acessibilidade-achados.md`. Esse relatório é a entrada para as correções que o usuário aprovar depois.

- [ ] **Step 1: Instalar a biblioteca de teste**

Run: `pnpm --filter @project-hub/desktop add -D @axe-core/playwright`
Expected: a linha `@axe-core/playwright` aparece em `apps/desktop/package.json`, em `devDependencies`.

- [ ] **Step 2: Escrever o teste de medição**

Criar `apps/desktop/e2e/acessibilidade.spec.ts`. Para cada tela, o teste roda `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()` e grava o resultado em JSON, sem falhar o teste. As telas são: Projetos, detalhe de projeto, missão planejada, missão aguardando decisão e missão concluída. Usar o mesmo fluxo de criação de projeto e missão que `vertical-slice.spec.ts` usa (funções `addGitProject`, `openProject` e `createMission`).

- [ ] **Step 3: Rodar a medição**

Run: `cd apps/desktop && pnpm exec playwright test e2e/acessibilidade.spec.ts`
Expected: o teste passa e grava `acessibilidade-achados.json` na pasta de saída do Playwright.

- [ ] **Step 4: Escrever o relatório de achados**

Criar `docs/superpowers/plans/2026-10-21-acessibilidade-achados.md` com uma tabela: tela, regra violada (id do axe), impacto, elemento e sugestão. Agrupar por regra. Não corrigir nada nesta tarefa.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/e2e/acessibilidade.spec.ts docs/superpowers/plans/2026-10-21-acessibilidade-achados.md
git commit -m "test(e2e): mede acessibilidade das telas principais com axe-core"
```

---

### Task 2: Abas com Radix Tabs (foco e roving tabindex corretos)

**Files:**
- Modify: `apps/desktop/src/renderer/components/Tabs.tsx`
- Modify: `apps/desktop/test/renderer/Tabs.test.tsx`
- Modify (se o id do painel mudar): `apps/desktop/src/renderer/components/workspace/DiffPanel.tsx` (o `aria-controls="tab-panel"` que sobra hoje)

**Interfaces:**
- Consumes: a API atual de `Tabs` (props `items`, `active`, `onChange`, `label`), que não muda.
- Produces: o mesmo componente `Tabs`, implementado com `@radix-ui/react-tabs`, com a mesma aparência.

- [ ] **Step 1: Instalar**

Run: `pnpm --filter @project-hub/desktop add @radix-ui/react-tabs`

- [ ] **Step 2: Escrever os testes que falham**

Em `apps/desktop/test/renderer/Tabs.test.tsx`, adicionar:

```tsx
it('deixa só a aba ativa na ordem de tabulação', () => {
  render(<Tabs label="Abas" items={ITEMS} active="b" onChange={() => {}} />);
  expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('tabindex', '-1');
});

it('as setas partem da aba focada, não da ativa', async () => {
  const user = userEvent.setup();
  render(<Tabs label="Abas" items={ITEMS} active="a" onChange={() => {}} />);
  screen.getByRole('tab', { name: 'A' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
});

it('o painel da aba ativa é o que a aba aponta por aria-controls', () => {
  render(<Tabs label="Abas" items={ITEMS} active="a" onChange={() => {}} />);
  const tab = screen.getByRole('tab', { name: 'A' });
  expect(document.getElementById(tab.getAttribute('aria-controls') ?? '')).not.toBeNull();
});
```

`ITEMS` deve ser o array de `items` que o arquivo já usa.

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/Tabs.test.tsx`
Expected: FAIL nas três asserções novas (a implementação atual deixa todas as abas com `tabindex="0"` e não aponta para um painel real).

- [ ] **Step 4: Reimplementar com Radix**

Trocar a lógica de teclado e de foco por `Tabs.Root`, `Tabs.List` e `Tabs.Trigger` do `@radix-ui/react-tabs`, mantendo as classes CSS atuais do arquivo. O `onChange` continua sendo chamado com o id da aba.

- [ ] **Step 5: Rodar os testes das telas que usam abas**

Run: `pnpm vitest run apps/desktop/test/renderer/Tabs.test.tsx apps/desktop/test/renderer/MissionPage.test.tsx apps/desktop/test/renderer/DiffPanel.test.tsx apps/desktop/test/renderer/ProjectDetailPage.test.tsx`
Expected: PASS em todos.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/Tabs.tsx apps/desktop/test/renderer/Tabs.test.tsx apps/desktop/package.json pnpm-lock.yaml
git commit -m "fix(renderer): abas com Radix, foco e ordem de tabulação corretos"
```

---

### Task 3: Menu de ações secundárias e dicas com Radix (DropdownMenu e Tooltip)

**Files:**
- Create: `apps/desktop/src/renderer/components/MenuAcoes.tsx`
- Create: `apps/desktop/test/renderer/MenuAcoes.test.tsx`
- Modify: `apps/desktop/src/renderer/components/workspace/MissionSummary.tsx` (Pausar, Cancelar e Excluir passam para dentro do menu)
- Modify (se clicar nos botões antigos): `apps/desktop/e2e/*.spec.ts` que buscam "Cancelar missão", "Pausar" ou "Excluir missão" direto na tela

**Interfaces:**
- Consumes: as ações de `MissionSummary` como hoje (mesmos callbacks, mesmas condições de exibição vindas de `primaryActionOf` e do estado da missão).
- Produces:

```ts
export type AcaoMenu = { rotulo: string; onSelecionar: () => void; perigosa?: boolean; desabilitada?: boolean };
export function MenuAcoes(props: { rotulo: string; acoes: AcaoMenu[] }): JSX.Element;
```

- [ ] **Step 1: Instalar**

Run: `pnpm --filter @project-hub/desktop add @radix-ui/react-dropdown-menu @radix-ui/react-tooltip`

- [ ] **Step 2: Escrever os testes que falham**

Criar `apps/desktop/test/renderer/MenuAcoes.test.tsx`:

```tsx
it('abre com o clique e mostra as ações', async () => {
  const user = userEvent.setup();
  render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]} />);
  await user.click(screen.getByRole('button', { name: 'Mais ações' }));
  expect(screen.getByRole('menuitem', { name: 'Pausar' })).toBeVisible();
});

it('chama onSelecionar da ação escolhida', async () => {
  const user = userEvent.setup();
  const pausar = vi.fn();
  render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: pausar }]} />);
  await user.click(screen.getByRole('button', { name: 'Mais ações' }));
  await user.click(screen.getByRole('menuitem', { name: 'Pausar' }));
  expect(pausar).toHaveBeenCalledOnce();
});

it('Escape fecha o menu e devolve o foco ao botão', async () => {
  const user = userEvent.setup();
  render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Pausar', onSelecionar: vi.fn() }]} />);
  const gatilho = screen.getByRole('button', { name: 'Mais ações' });
  await user.click(gatilho);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menuitem', { name: 'Pausar' })).toBeNull();
  expect(gatilho).toHaveFocus();
});

it('ação perigosa recebe a classe de perigo', async () => {
  const user = userEvent.setup();
  render(<MenuAcoes rotulo="Mais ações" acoes={[{ rotulo: 'Excluir missão', onSelecionar: vi.fn(), perigosa: true }]} />);
  await user.click(screen.getByRole('button', { name: 'Mais ações' }));
  expect(screen.getByRole('menuitem', { name: 'Excluir missão' })).toHaveClass('menu-acoes__item--perigo');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/MenuAcoes.test.tsx`
Expected: FAIL com "Cannot find module" ou erro de componente inexistente.

- [ ] **Step 4: Implementar `MenuAcoes.tsx`**

Componente de uma função, com `DropdownMenu.Root`, `DropdownMenu.Trigger` (botão com o `rotulo`) e `DropdownMenu.Content` com um `DropdownMenu.Item` por ação. Classes: `menu-acoes`, `menu-acoes__item`, e `menu-acoes__item--perigo` quando `perigosa`. Estilo em `app.css` com os tokens (`--red` para o perigo, `--line` para a borda).

- [ ] **Step 5: Ligar no `MissionSummary.tsx`**

Pausar, Cancelar e Excluir saem dos botões soltos e viram itens de `MenuAcoes` com o rótulo "Mais ações". Mesmas condições de exibição e mesmos callbacks. Excluir é `perigosa: true`.

- [ ] **Step 6: Rodar os testes de missão**

Run: `pnpm vitest run apps/desktop/test/renderer/MenuAcoes.test.tsx apps/desktop/test/renderer/MissionPage.test.tsx apps/desktop/test/renderer/MissionConclusion.test.tsx`
Expected: PASS. Onde o teste antigo buscava o botão solto "Pausar" ou "Cancelar missão", ele passa a abrir o menu antes, com o mesmo resultado.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/components/MenuAcoes.tsx apps/desktop/test/renderer/MenuAcoes.test.tsx apps/desktop/src/renderer/components/workspace/MissionSummary.tsx apps/desktop/src/renderer/styles/app.css apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(renderer): ações secundárias da missão em menu acessível"
```

---

### Task 4: Ícones com lucide-react nos estados e ações

**Files:**
- Modify: `apps/desktop/src/renderer/components/StatusChip.tsx` (ou o componente que hoje mostra o chip de status da missão; conferir o nome real no momento da execução)
- Modify: `apps/desktop/src/renderer/components/workspace/MissionSummary.tsx` (ícone no botão Copiar caminho)
- Create: `apps/desktop/test/renderer/StatusChip.test.tsx`

**Interfaces:**
- Consumes: `statusTone` e `statusLabel` de `mission-text.ts`, sem mudança.
- Produces: o chip de status mostra um ícone decorativo ao lado do texto. O texto continua sendo a fonte de verdade para leitores de tela.

- [ ] **Step 1: Instalar**

Run: `pnpm --filter @project-hub/desktop add lucide-react`

- [ ] **Step 2: Escrever o teste que falha**

Criar `apps/desktop/test/renderer/StatusChip.test.tsx`:

```tsx
it('mostra o texto do estado e um ícone que o leitor de tela ignora', () => {
  render(<StatusChip status="waiting_approval" />);
  expect(screen.getByText('Aguarda sua aprovação')).toBeVisible();
  const icone = screen.getByText('Aguarda sua aprovação').parentElement?.querySelector('svg');
  expect(icone).not.toBeNull();
  expect(icone).toHaveAttribute('aria-hidden', 'true');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/StatusChip.test.tsx`
Expected: FAIL (o chip ainda não tem SVG).

- [ ] **Step 4: Implementar**

Dentro do chip, renderizar o ícone do estado (um mapa de `status` para ícone de lucide, por exemplo `Clock` para planejada e aguardando início, `ShieldQuestion` para aguardando aprovação, `LoaderCircle` para em execução, `CheckCircle2` para concluída, `CircleAlert` para falhou) com `aria-hidden="true"`. No botão Copiar caminho, adicionar o ícone `Copy`, também com `aria-hidden="true"`.

- [ ] **Step 5: Rodar os testes de tela**

Run: `pnpm vitest run apps/desktop/test/renderer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/StatusChip.tsx apps/desktop/src/renderer/components/workspace/MissionSummary.tsx apps/desktop/test/renderer/StatusChip.test.tsx apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(renderer): ícones de estado com lucide-react"
```

---

### Task 5: Avisos com sonner (e o caminho copiado com erro tratado)

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` (montar o `<Toaster />` uma vez)
- Modify: `apps/desktop/src/renderer/components/workspace/MissionSummary.tsx` (botão Copiar caminho usa `toast`)
- Create: `apps/desktop/test/renderer/MissionSummary.test.tsx` (se ainda não existir; se existir, adicionar o caso)

**Interfaces:**
- Consumes: `toast` de `sonner`.
- Produces: `toast.success('Caminho copiado.')` quando a cópia dá certo; quando recusa, `role="status"` com "Não foi possível copiar o caminho.". Erros de ação continuam em `role="alert"` (não viram toast).

- [ ] **Step 1: Instalar**

Run: `pnpm --filter @project-hub/desktop add sonner`

- [ ] **Step 2: Escrever os testes que falham**

Em `apps/desktop/test/renderer/MissionSummary.test.tsx`:

```tsx
it('copia o caminho e avisa com toast de sucesso', async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  renderResumo({ worktreePath: 'C:\\worktrees\\teste\\dd86e06b-teste' });
  await user.click(screen.getByRole('button', { name: 'Copiar caminho' }));
  expect(writeText).toHaveBeenCalledWith('C:\\worktrees\\teste\\dd86e06b-teste');
  expect(await screen.findByText('Caminho copiado.')).toBeVisible();
});

it('se a cópia for recusada, avisa e não marca como copiado', async () => {
  const user = userEvent.setup();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('negado')) } });
  renderResumo({ worktreePath: 'C:\\worktrees\\teste\\dd86e06b-teste' });
  await user.click(screen.getByRole('button', { name: 'Copiar caminho' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível copiar o caminho.');
  expect(screen.queryByText('Caminho copiado.')).toBeNull();
});
```

`renderResumo` é o helper de render do `MissionSummary` que o arquivo de teste usa (criar um, se não houver).

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/MissionSummary.test.tsx`
Expected: FAIL no texto do toast.

- [ ] **Step 4: Implementar**

Montar `<Toaster />` (de `sonner`) uma vez em `App.tsx`. No botão de copiar, chamar `toast.success('Caminho copiado.')` no sucesso e atualizar um `role="status"` com a mensagem de erro no fracasso.

- [ ] **Step 5: Rodar os testes de tela**

Run: `pnpm vitest run apps/desktop/test/renderer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/workspace/MissionSummary.tsx apps/desktop/test/renderer/MissionSummary.test.tsx apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(renderer): avisos de ação com sonner, cópia do caminho tratada"
```

---

### Task 6: Horário relativo na linha do tempo com date-fns

**Files:**
- Modify: `apps/desktop/src/renderer/mission-text.ts` (função `formatTime`, na linha 446)
- Modify: `apps/desktop/test/renderer/mission-text.test.ts`

**Interfaces:**
- Consumes: `formatTime(iso: string): string` (assinatura igual).
- Produces: a mesma assinatura, com estas regras, nesta ordem: menos de 1 minuto, `agora`; menos de 1 hora, `há N min`; no mesmo dia, `HH:mm`; qualquer outra data, `dd/MM HH:mm`. Usa `date-fns` com o locale `ptBR`.

- [ ] **Step 1: Instalar**

Run: `pnpm --filter @project-hub/desktop add date-fns`

- [ ] **Step 2: Escrever os testes que falham**

Em `apps/desktop/test/renderer/mission-text.test.ts`, com `vi.useFakeTimers()` e `vi.setSystemTime(new Date('2026-10-21T15:00:00'))`:

```ts
it('mostra agora para eventos de menos de um minuto', () => {
  expect(formatTime('2026-10-21T14:59:40')).toBe('agora');
});

it('mostra há N min para eventos de menos de uma hora', () => {
  expect(formatTime('2026-10-21T14:55:00')).toBe('há 5 min');
});

it('mostra só o horário no mesmo dia', () => {
  expect(formatTime('2026-10-21T09:10:00')).toBe('09:10');
});

it('mostra data e hora para evento antigo, sem horas relativas', () => {
  expect(formatTime('2026-10-19T14:02:00')).toBe('19/10 14:02');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/mission-text.test.ts`
Expected: FAIL nos casos novos (a função atual devolve só `HH:mm`).

- [ ] **Step 4: Implementar `formatTime`**

Usar `differenceInMinutes`, `isSameDay`, `format` e `ptBR` de `date-fns` e `date-fns/locale`. Manter o nome e a assinatura. Os testes antigos de `formatTime` que esperam `HH:mm` para datas de outros dias precisam ser atualizados para o novo formato, e isso precisa ser dito no commit.

- [ ] **Step 5: Rodar os testes de texto e de tela**

Run: `pnpm vitest run apps/desktop/test/renderer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/mission-text.ts apps/desktop/test/renderer/mission-text.test.ts apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(renderer): horário relativo na linha do tempo com date-fns"
```

---

### Task 7: Paleta de comandos com cmdk (Ctrl+K)

**Files:**
- Create: `apps/desktop/src/renderer/components/PaletaComandos.tsx`
- Create: `apps/desktop/test/renderer/PaletaComandos.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (montar a paleta e ligar Ctrl+K)

**Interfaces:**
- Consumes: a lista de projetos e de missões que o `Sidebar` já lê (`use-sidebar-data.ts`), e `primaryActionOf` de `mission-text.ts`.
- Produces:

```ts
export type ItemComando = { id: string; rotulo: string; grupo: 'Projetos' | 'Missões' | 'Ações'; executar: () => void };
export function PaletaComandos(props: { aberta: boolean; aoFechar: () => void; itens: ItemComando[] }): JSX.Element;
```

- [ ] **Step 1: Instalar**

Run: `pnpm --filter @project-hub/desktop add cmdk`

- [ ] **Step 2: Escrever os testes que falham**

Criar `apps/desktop/test/renderer/PaletaComandos.test.tsx`:

```tsx
it('filtra os itens pelo que a pessoa digita', async () => {
  const user = userEvent.setup();
  render(<PaletaComandos aberta itens={ITENS} aoFechar={() => {}} />);
  await user.type(screen.getByRole('combobox'), 'teste');
  expect(screen.getByRole('option', { name: 'TESTE' })).toBeVisible();
  expect(screen.queryByRole('option', { name: 'Nova missão' })).toBeNull();
});

it('Enter executa o item selecionado e fecha', async () => {
  const user = userEvent.setup();
  const executar = vi.fn();
  const aoFechar = vi.fn();
  render(<PaletaComandos aberta itens={[{ id: 'p1', rotulo: 'TESTE', grupo: 'Projetos', executar }]} aoFechar={aoFechar} />);
  await user.type(screen.getByRole('combobox'), 'TESTE{Enter}');
  expect(executar).toHaveBeenCalledOnce();
  expect(aoFechar).toHaveBeenCalledOnce();
});

it('Escape fecha sem executar nada', async () => {
  const user = userEvent.setup();
  const executar = vi.fn();
  const aoFechar = vi.fn();
  render(<PaletaComandos aberta itens={[{ id: 'p1', rotulo: 'TESTE', grupo: 'Projetos', executar }]} aoFechar={aoFechar} />);
  await user.keyboard('{Escape}');
  expect(executar).not.toHaveBeenCalled();
  expect(aoFechar).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run apps/desktop/test/renderer/PaletaComandos.test.tsx`
Expected: FAIL (componente inexistente).

- [ ] **Step 4: Implementar `PaletaComandos.tsx`**

Usar `Command` do `cmdk` dentro de um diálogo simples (o `<dialog>` nativo ou o `@radix-ui/react-dialog` já presente, conforme o que o projeto já usa em `ConfirmButton` e outros diálogos). Agrupar por `grupo`.

- [ ] **Step 5: Ligar Ctrl+K em `App.tsx`**

Um único listener de `keydown` no `App`, que abre a paleta com Ctrl+K e não faz nada se `event.defaultPrevented`. Não há teste de regressão em campo de texto ainda; ele entra no Step 6.

- [ ] **Step 6: Teste de foco com texto digitado**

Adicionar em `apps/desktop/test/renderer/MissionPage.test.tsx` um caso: digitar "rascunho" no campo `#mission-answer`, apertar Ctrl+K, apertar Escape, e checar que o campo ainda tem "rascunho" e que `document.activeElement` é o campo. Esse é o item 3 da Review Focus.

- [ ] **Step 7: Rodar os testes**

Run: `pnpm vitest run apps/desktop/test/renderer`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/components/PaletaComandos.tsx apps/desktop/test/renderer/PaletaComandos.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/test/renderer/MissionPage.test.tsx apps/desktop/package.json pnpm-lock.yaml
git commit -m "feat(renderer): paleta de comandos com Ctrl+K"
```

---

### Task 8: Formulário de missão com react-hook-form e zod

**Files:**
- Modify: `apps/desktop/src/renderer/components/MissionForm.tsx`
- Modify: `apps/desktop/test/renderer/MissionForm.test.tsx`

**Interfaces:**
- Consumes: o schema de criação de missão que já existe em `packages/contracts` (conferir o nome exato no momento da execução); as mensagens de validação atuais, que não mudam.
- Produces: o mesmo `MissionForm`, com a validação feita pelo `react-hook-form` via `zodResolver`.

- [ ] **Step 1: Instalar**

Run: `pnpm --filter @project-hub/desktop add react-hook-form @hookform/resolvers`

- [ ] **Step 2: Escrever os testes que devem continuar passando e um que é novo**

Acrescentar em `apps/desktop/test/renderer/MissionForm.test.tsx`:

```tsx
it('título vazio não envia e mantém os outros campos preenchidos', async () => {
  const user = userEvent.setup();
  const criar = vi.fn();
  render(<MissionForm aoCriar={criar} />);
  await user.type(screen.getByLabelText('Objetivo'), 'Gravar o arquivo');
  await user.click(screen.getByRole('button', { name: 'Criar missão' }));
  expect(criar).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Objetivo')).toHaveValue('Gravar o arquivo');
});

it('o foco vai para o primeiro campo inválido', async () => {
  const user = userEvent.setup();
  render(<MissionForm aoCriar={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'Criar missão' }));
  expect(screen.getByLabelText('Título')).toHaveFocus();
});
```

Ajustar `aoCriar` ao nome real da prop do formulário no arquivo.

- [ ] **Step 3: Rodar a suíte atual**

Run: `pnpm vitest run apps/desktop/test/renderer/MissionForm.test.tsx`
Expected: os testes antigos passam antes da troca; o caso do foco pode falhar, e é o que a troca precisa resolver.

- [ ] **Step 4: Reimplementar com `useForm` e `zodResolver`**

Manter os mesmos rótulos, os mesmos textos de erro e o mesmo botão "Criar missão". Usar `shouldFocusError: true` (padrão do react-hook-form) para mandar o foco ao primeiro campo inválido.

- [ ] **Step 5: Rodar os testes de tela**

Run: `pnpm vitest run apps/desktop/test/renderer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/MissionForm.tsx apps/desktop/test/renderer/MissionForm.test.tsx apps/desktop/package.json pnpm-lock.yaml
git commit -m "refactor(renderer): formulário de missão com react-hook-form e zod"
```

---

## Depois destas oito tarefas (sem tarefa agora, com gatilho)

- **@tanstack/react-virtual:** só quando a lista de logs ou a conversa passar de cerca de 500 itens em uso real medido. Antes disso, é complexidade sem ganho.
- **shiki:** só quando o diff de um arquivo passar de cerca de 1000 linhas ou o usuário pedir destaque de sintaxe.
- **motion:** só se o usuário pedir uma transição específica, e sempre respeitando a preferência do sistema por reduzir movimento.

## Fechamento

- [ ] Rodar o E2E completo (`pnpm --filter @project-hub/desktop test:e2e`) depois da Tarefa 8: 19 de 19 testes passando, ou o número atual se o conjunto tiver crescido.
- [ ] Rodar o gate da raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`.
- [ ] Atualizar `brain/arquitetura/renderer.md` com as bibliotecas adotadas e o motivo de cada uma.
