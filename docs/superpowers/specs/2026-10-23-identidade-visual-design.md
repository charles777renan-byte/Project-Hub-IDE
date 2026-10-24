# Identidade visual do Project Hub: desenho

Data: 2026-10-23. Estado: aguardando aprovação.

## Intenção e por quê

A interface funciona, mas parece crua: texto solto fora do sistema de estilo (por exemplo "Nada em andamento." e o aviso do Codex saem no tamanho padrão do navegador), painéis vazios com um bloco de texto no meio, abas e menus simples, nenhum traço que diga "este é o Project Hub". Quem usa orquestradores de agentes de IA espera uma ferramenta com cara própria. O pedido é dar ao app uma identidade visual única e um acabamento de produto, sem mudar nenhuma regra de negócio.

## Decisões da pessoa (palavra dela)

- **Direção B1**, escolhida em mockups lado a lado: **painéis em cartões arredondados** sobre fundo escuro com um **brilho violeta suave**, **abas em pílula**, **selos de estado** em pílula e menus flutuantes com acabamento de produto. **Lima (#c8ff2e) é a cor de destaque.**
- A paleta de base continua sendo a oficial: `#080614` (fundo), `#2a2656`, `#3a3570`, `#b7adcf`.
- **Ordem:** primeiro a **base da identidade completa**, depois as telas uma a uma (workspace primeiro, depois Início, Projetos e missão). O dashboard de gráficos (uso dos agentes, heatmap, tempo de foco) é um projeto à parte, para quando houver dados reais para alimentá-lo.
- As bibliotecas de interface entram como ferramenta desta base. A lista aprovada em 21/10 está em `docs/superpowers/plans/2026-10-21-bibliotecas-interface.md`.

## O que a base inclui (escopo da camada 1)

Chamada aqui de "base" tudo que as telas compartilham. Escopo, nesta ordem de dependência:

1. **Tokens** em `apps/desktop/src/renderer/styles/tokens.css`: cores semânticas (fundo, superfície elevada, linha, texto, texto fraco, destaque lima, perigo, atenção), raios (cartão 12px, controle 8px, pílula 999px), sombras e o brilho de fundo, escala tipográfica (tamanhos e pesos para título, rótulo, corpo, dado), escala de espaçamento e de movimento (duração e curva). Texto cru passa a herdar tamanho e cor do sistema: nada fica no padrão do navegador.
2. **Componentes de uso geral**, cada um com estados (normal, foco, hover, desabilitado):
   - botão (principal em lima, secundário, perigo), campo de texto e área de texto;
   - cartão/painel com cabeçalho e rodapé;
   - selo de estado em pílula (mantém forma e texto: ● ativo, ◐ aguardando, ✓ concluído, ✕ erro, ○ desconectado; a cor é reforço, nunca a única pista);
   - abas em pílula, menu flutuante, dica (tooltip), aviso (toast), estado vazio com ícone e chamada para ação;
   - ícones (lucide-react) no lugar dos símbolos de texto onde fizer sentido.
3. **A casca que as telas compartilham:** barra superior, barra lateral e o cartão do painel do workspace (`PaneView`), reescritos com o novo sistema. É onde a pessoa vê o resultado já na base, sem esperar o redesenho de cada tela.

## O que fica de fora

- Redesenho do conteúdo de cada tela (Início, Projetos, missão): é a camada 2, em plano próprio.
- Dashboard de gráficos e qualquer dado novo (uso de cota dos provedores, tempo de foco).
- Mudanças em regras de negócio, canais de IPC, contratos, banco, processo de terminais e layout dos painéis.
- Paleta de comandos (cmdk), horário relativo (date-fns) e formulário com react-hook-form: são comportamento, não identidade, e seguem no plano de bibliotecas para depois da camada 2.
- Tema claro: só existe o escuro.

## Anti-metas (falharia mesmo funcionando)

- Parecer uma biblioteca genérica de componentes (a identidade tem de ser reconhecível: cartões, pílulas, lima e brilho violeta).
- Lima por toda parte: ele é destaque, só para a ação principal, o estado ativo e o foco.
- Perder acessibilidade para ganhar estilo: contraste, foco visível, navegação por teclado e estado por forma mais texto continuam valendo.
- Lentidão ou tremor: nada de efeito que pese na digitação do terminal.

## Restrições

- **CSP estrita do renderer:** `style-src 'self'`. Sem `<style>` nem estilo inline escrito em texto; estilos via CSSOM (o que o React faz em `style={{…}}`) passam. Toda biblioteca nova tem de provar que não injeta `<style>` em tempo de execução. O `sonner` injeta (risco conhecido): ou o CSS dele entra vendorizado e ligado por `<link>`, ou o aviso é próprio. Radix `ScrollArea` também injeta e não será usado. Nada de CDN ou script externo.
- **Contraste:** o teste `apps/desktop/test/renderer/contrast.test.ts` lê `tokens.css` e confere pares de cor (WCAG 2.2 AA, mínimo 4,5:1 para texto). Os tokens novos têm de entrar nele; não se afrouxa o teste.
- **Licença** das bibliotecas: MIT ou Apache-2.0. Só `pnpm --filter @project-hub/desktop add …`.
- **Nada quebra:** textos de interface aprovados, testes e E2E existentes (25 hoje) seguem passando; testes de CSS que fixam valores antigos são atualizados junto, com o motivo.
- Gate antes de cada commit: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, build e E2E. Um commit por tarefa, sem atribuição ao Claude.
- Textos e comentários em português. Sem citar outros projetos como origem de ideias.

## Chamadas do desenho (minhas, não da pessoa; ela pode trocar)

- A identidade vale para todas as telas, não só o workspace.
- "Base" inclui a casca (barra superior, barra lateral, cartão do painel) para o resultado ser visível sem a camada 2.
- Cores de estado fora do lima: vermelho (`#ff2d6f`) para falha e parar, âmbar (`#ffd23f`) para aguardando e atenção; o violeta (`#b583ff`) fica como cor de marca em detalhes. As demais cores do tema multicolorido antigo (ciano, magenta, azul, laranja) saem da casca e permanecem nas telas antigas até a camada 2.
- Biblioteca de comportamento: Radix (`tabs`, `dropdown-menu`, `tooltip`), `lucide-react` e um aviso (toast) cuja forma depende da prova da CSP. Estilo só com tokens e CSS próprio, sem Tailwind nem shadcn.
- Movimento: transições curtas em CSS (120–200 ms); sem biblioteca de animação nesta camada.
- Brilho violeta: um gradiente radial fixo no fundo da casca, sem imagem e sem canvas; o fundo topográfico antigo continua só nas páginas que o têm.

## Respostas a dúvidas do construtor (chamadas minhas)

- **Substituir, não criar ao lado.** `Tabs`, `Panel`, `StatusChip`, `StateMark` e `ConfirmButton` são reescritos no lugar e passam a valer em todas as telas. As telas da camada 2 mudam de aparência junto, sem redesenho de conteúdo; os testes de DOM e de CSS que fixam valores antigos são atualizados no mesmo commit. Não existem duas famílias de componentes.
- **Raios e tokens globais.** `--radius` sobe de 2px para 8px (controles) e o cartão fica em 12px (`--radius-panel` vira o token de cartão). `--panel` e `--panel-2` passam a ser a superfície elevada (`#0e0b24`), em vez de iguais ao fundo. Os testes `*-styles.test.ts` são reescritos com o motivo.
- **Papel do lima.** Lima = botão principal, indicador de item ativo (barra de 3px na barra lateral), estado "ativo/executando" e anel de foco. A aba ativa é uma pílula de gradiente `#3a3570`→`#2a2656` (como no mockup), sem lima. O item ativo da navegação perde o magenta. As abas por tipo (terminal, diff…) perdem a cor própria na casca e ficam uniformes.
- **Comparação por captura de tela.** Manual: tiro as capturas antes e depois do workspace, Início e missão e apresento lado a lado. Sem infraestrutura de linha de base no E2E.
- **Aviso (toast).** O componente nasce com consumidores reais: o erro de copiar caminho e o erro de gravação do layout do workspace (hoje um `role="alert"` solto). Se a CSP barrar o `sonner`, o aviso é próprio, com a mesma API.
- **Estado vazio.** Ícone e texto são obrigatórios. A chamada para ação só entra onde já existe fluxo ("Nova missão" em "Nada em andamento."; "Iniciar …" nos painéis, que já é o botão atual). Sem fluxo novo.
- **Menu "+" da barra superior.** Já tem setas, Home/End e Esc e os textos aprovados; a tarefa é reestilo (e a troca para Radix `dropdown-menu` só se os testes atuais continuarem passando sem relaxar nenhum).
- **Terminal.** O xterm fica num fundo opaco `#080614` dentro do cartão; o brilho violeta aparece só atrás e ao redor dos cartões, nunca sob o texto do terminal. O contraste continua conferido sobre fundo opaco.

## O que fica para quem constrói

Nomes exatos de tokens e de componentes, a estrutura de arquivos de CSS (hoje `app.css` tem cerca de 1.400 linhas e `workspace.css` 800), a ordem das tarefas, os testes de cada componente e a decisão do aviso (toast) depois de testar a CSP. Deve entregar a base em tarefas pequenas, com o app utilizável a cada commit.

## Critérios de aceite

1. Os tokens novos existem, o teste de contraste os cobre e passa.
2. Nenhum texto da casca fica no tamanho padrão do navegador; "Nada em andamento." e as mensagens de painel vazio usam o estado vazio do sistema.
3. A barra superior mostra abas em pílula e o menu "+" abre um menu flutuante com setas, Home/End e Esc.
4. A barra lateral e os painéis do workspace são cartões de 12px com brilho de fundo; o botão principal e o estado ativo usam lima; o foco por teclado é visível em todos os controles.
5. Estados continuam por forma e texto; nenhum depende só de cor.
6. Sem violação de CSP em nenhuma tela (E2E de CSP passando) e sem estilo inline em texto.
7. Gate completo e E2E verdes; comparação por captura de tela do workspace antes e depois.
