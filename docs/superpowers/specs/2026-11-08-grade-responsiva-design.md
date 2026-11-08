# Grade responsiva dos terminais: design

Origem: seção 3.3 de `Project_Hub_Correcoes_UI_UX.md` ("Grade responsiva com largura mínima e modo foco"). Escolha da pessoa, em 2026-11-08: **fichas "Ocultos" + modo Abas automático**, só na tela. O passe de design do mesmo dia levou as fichas para a barra que já existe, com o nome "Fora da grade".

## Problema

Com muitos terminais, ou com o painel direito aberto, cada terminal fica estreito demais: a interface do Claude Code quebra e os textos truncam. Hoje a única saída é a pessoa ligar o modo Abas à mão (decisão "um painel por vez", em `brain/decisoes/`).

## Objetivo

Em qualquer largura de janela a partir de 1024 px, nenhum terminal mostrado fica mais estreito que 340 px nem mais baixo que 260 px. O que não cabe não some: vira uma ficha "Fora da grade", na barra do workspace, que traz o terminal de volta. Abaixo de um limite de largura, entra sozinho o modo Abas que já existe.

## Não objetivos

- Seletor de layout manual (Grade / 2 colunas / Foco) e a lembrança por projeto: ficam para a etapa de navegação (seção 3.4).
- Explorador como painel sobreposto abaixo de 900 px: o explorador é o painel direito, outra parte da tela.
- Mexer no layout guardado, no banco ou nos contratos. A arrumação e os ajustes de divisória salvos continuam como estão.
- Mexer nas barras laterais, no dashboard do Início, no fundo animado e nas animações de tela.

## Regras

Medida: a largura e a altura de `.workspace__area` (a área da grade, já descontados os painéis laterais), por `ResizeObserver`. Vão entre painéis: 8 px (o das divisórias).

| Largura da área | Colunas máximas | Observação |
|---|---|---|
| 1100 px ou mais | 3 | |
| de 720 a 1099 px | 2 | |
| menos de 720 px | modo Abas | um painel, os demais como abas |

- Colunas que cabem: `min(máximo da faixa, piso((largura + 8) / (340 + 8)))`. Linhas que cabem: `max(1, piso((altura + 8) / (260 + 8)))`. **Capacidade** = colunas × linhas.
- Com `n` painéis e `n <= capacidade`, cabe tudo: se a árvore guardada já respeita colunas e linhas, vale a árvore guardada (com os ajustes de divisória da pessoa); senão, arruma-se pela regra abaixo.
- Com `n > capacidade`: mostram-se `capacidade` painéis e os outros viram fichas. O **painel ativo sempre fica entre os mostrados**; os demais mostrados são os primeiros da lista, na ordem do layout. Trazer uma ficha ativa esse painel, e ele toma o lugar do último mostrado que não é o ativo (o que sai vira ficha).
- **Arrumação limitada** (`arrangeLeavesCapped`, função pura nova ao lado de `arrangeLeaves`, sem zod): lista de folhas e número máximo de colunas → árvore. Igual ao `arrangeLeaves` quando o número de colunas dele (1 com 1 painel, 2 com 2, 2 com 3 usando "um + dois", `ceil(sqrt(n))` com 4 ou mais) não passa do máximo; senão, usa o máximo de colunas, preenchendo de cima para baixo. A árvore derivada nasce com ratios padrão e **não é guardada**.
- Divisórias da árvore derivada: arrastar vale só enquanto a árvore derivada vive; o `onRatio` não grava (os ids de divisão não existem no layout guardado). Ao voltar a caber tudo, volta a árvore guardada.
- Mínimos nas divisórias: cada painel da árvore (guardada ou derivada) tem `minSize` de 340 px na largura e 260 px na altura, no lugar dos 15% de hoje, para a pessoa não arrastar um terminal para menos que isso.
- Modo Abas automático: com a área abaixo de 720 px o modo vale sozinho. Nada fica desabilitado: o botão "Grade" da faixa de abas dá lugar a um aviso discreto, "Janela estreita" (ícone e texto em `--muted`, dica "Volta para a grade quando a janela passar de 720 px"), e o botão "Abas" da barra fica apertado. Ao crescer a janela, volta o que a pessoa tinha (grade, ou abas se ela ligou à mão). O `soloOn` da pessoa não é alterado pelo automático.
- No modo Abas (manual ou automático) a faixa de abas ganha o esmaecimento e o menu "⌄" das abas que rolam (`TabsOverflow`, hoje só na barra de workspaces e em `FileTabs`). O botão do menu fica amarelo (`--warn`) e com `◐` quando uma aba fora de vista aguarda você.

## "Fora da grade" na barra do workspace

Revisto em 2026-11-08 (passe de design; mockup em `docs/superpowers/specs/mockups/grade-responsiva.html`). **Não há faixa nova**: a grade não perde altura, como a pessoa pediu ao rejeitar o cabeçalho de duas linhas.

- Os terminais fora da grade moram na barra do workspace (`.workspace__toolbar`), à direita, depois de "Abrir terminal" e "Abas": um grupo `role="group"` com `aria-label="Terminais fora da grade"`, o rótulo "Fora da grade" em `--muted` e a contagem numa pílula `--fill`.
- **Mesma linguagem das abas** (`PaneTabs`): cada ficha é um botão de 24 px de altura com o ícone do programa (14 px), o nome numerado quando repete ("Claude Code 5") e a marca de estado só com a forma (`●`, `◐`, `✕`, glifos de `MARKS`), com o rótulo na dica ("Aguardando · traz para a grade") e no leitor de tela. Repouso transparente e texto `--muted`; ao passar o mouse, fundo `--line` e texto `--text`; foco com o anel de 2 px `--focus`.
- **Quem precisa de você vem primeiro**: fichas de sessão aguardando e com falha ficam à esquerda e tingidas com o tom do selo (`color-mix` de `--warn` ou `--danger` a 12% sobre `--surface`, texto no tom). As outras seguem a ordem do layout.
- **Excesso**: o que não cabe na barra vai para "+N ⌄" (o menu de `MenuAcoes`, como nas abas que rolam), com o título "Mais N fora da grade". Aguardando e falha nunca entram no menu.
- **Trazer de volta**: clicar dá o teclado ao terminal; ele entra na grade com a entrada dos painéis (`pane-in`, em `motion.css`) e o anel lima. O terminal que sai vira ficha com um brilho curto do fundo (cerca de 400 ms, `--ease`), para o olho ver para onde ele foi. Com `prefers-reduced-motion`, sem entrada nem brilho.
- **Teclado**: as fichas entram na ordem do Tab depois de "Abas"; "+N ⌄" é a última parada do grupo.

## Peças

- `layout-fit.ts` (renderer, puro): `gridFit(width, height)` → `{ mode: 'grid', columns, rows } | { mode: 'solo' }`; `pickVisible(leaves, activeId, capacity)` → `{ shown, hidden }`.
- `arrangeLeavesCapped` em `packages/contracts/src/layout-arrange.ts` (puro, sem zod; testado ao lado do `arrangeLeaves`).
- `useAreaSize(ref)` (renderer): largura e altura da área, com `ResizeObserver`; chama o ajuste do terminal já existente (o `TerminalView` observa o próprio contêiner), então não há ajuste novo.
- `OffGridDock.tsx` (renderer): o grupo "Fora da grade" dentro de `WorkspaceToolbar`, com o "+N ⌄" de `MenuAcoes`.
- `WorkspacePage.tsx`: liga tudo (a área medida, `soloEffective = soloOn || faixa === 'solo'`, a árvore mostrada, as fichas). `PaneTree.tsx`: `minSize` em px.

## Casos de borda a cobrir nos testes

- 1 painel, ou nenhum: sem fichas, sem arrumação nova.
- Capacidade 1 (área estreita e baixa) com vários painéis: um mostrado, o resto em fichas; sem ficha vazia.
- O painel ativo oculto ao redimensionar a janela: ele passa a ser mostrado (o último mostrado não ativo vira ficha).
- Fechar um painel mostrado com fichas: a primeira ficha entra no lugar, sem pedir nada.
- Abrir um painel novo com a grade cheia: ele fica ativo, então entra mostrado e o último não ativo vira ficha. O limite de 12 painéis não muda.
- Janela redimensionada em rajada: o resultado só muda quando muda a faixa de colunas, as linhas ou o conjunto mostrado (nada de remontar a árvore a cada pixel).
- Terminal que vira ficha e volta: a sessão do processo continua; a tela refaz-se do buffer, como ao abrir ou fechar painel hoje.
- `prefers-reduced-motion`: sem a entrada do painel nem o brilho da ficha.
- Barra estreita (a área de 720 a ~900 px): o rótulo "Fora da grade" encolhe para só a contagem antes de as fichas irem para o "+N ⌄".
- Uma sessão fora da grade passa a aguardar: a ficha muda de tom e vai para a esquerda, sem animação de reordenar.

## O que fica a cargo de quem implementa

A medida exata de quantas fichas cabem na barra antes do "+N ⌄", e a detecção de "cabe tudo na árvore guardada" (largura mínima real de cada folha a partir dos ratios e da medida da área).
