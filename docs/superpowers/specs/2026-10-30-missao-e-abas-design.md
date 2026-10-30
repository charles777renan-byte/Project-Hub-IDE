# Refinamento da tela da missão, das abas, dos menus, dos avisos e das confirmações

Data: 2026-10-30. Estado: rascunho, aguardando aprovação da pessoa. Não commitado.

Base: o relatório de levantamento de 2026-10-30 (`brain/tarefas/levantamento-ui-2026-10-30.md`), com as capturas atuais e as respostas da pessoa às perguntas de decisão.

## 1. Intenção e porquê

O app parece uma coleção de páginas. A mesma informação aparece em várias camadas (situação no chip e na Atividade; tarefas no quadro e na tabela; arquivos alterados no corpo e na aba Diff), a mesma ação aparece em vários botões, há abas dentro de abas e há mais de um caminho para a mesma coisa. A pessoa quer um app com tom profissional e refinado.

Esta rodada cuida de duas partes: a tela da missão, que é a queixa principal, e a camada de abas, menus, avisos e confirmações. O Início e a lateral ficam para uma rodada seguinte (ver seção 9).

O critério de sucesso é simples: cada informação e cada ação tem um lugar só na tela, e a pessoa acha a ação que precisa sem procurar em dois ou três lugares.

## 2. Objetivos

- A tela da missão tem um cabeçalho de uma linha, uma decisão fixa no topo quando há algo pendente e uma lista de etapas.
- O painel inferior da missão tem três abas, em um nível só.
- Existe um só componente de menu no renderer.
- Os avisos ficam no canto inferior esquerdo, com no máximo dois visíveis ao mesmo tempo.
- Ações destrutivas pedem confirmação num diálogo modal.
- A janela estreita de terminais troca para abas sozinha, sem botão.
- Os estados da missão têm um vocabulário único nas telas tocadas (seção 5).

## 3. Não-objetivos

- Início, lateral e paleta de comandos. Ficam para a rodada seguinte.
- Tokens visuais do app inteiro (cor, tipografia, caixa-alta fora das telas tocadas).
- Mudanças no processo principal, no contrato IPC, no banco de dados e no planejador `claude -p`.
- Mudança do que cada ação faz. Só muda onde ela aparece e como é pedida.

## 4. Antimetas (o que não pode acontecer)

- Uma ação que a pessoa precisa para avançar (Aprovar plano, Retomar, Aprovar conclusão, Iniciar missão) não vai para o menu "⋯".
- Informação de estado some para ganhar espaço. Falha, cota e situação continuam visíveis.
- Um teste E2E é removido para passar. A asserção vai para o lugar novo, como na Tarefa 9 da interface estilo IDE.
- O foco não é roubado de quem digita no terminal. Essa regra vale hoje para o bloco de decisão e continua valendo.

## 5. Restrições

- Só o renderer muda, em `apps/desktop/src/renderer`. O processo principal e o contrato não mudam.
- A CSP bloqueia o modo modal do Radix, porque ele injeta `<style>`. O menu usa `DropdownMenu` com `modal={false}`, como já está em `decisao-bibliotecas-de-interface`. O diálogo de confirmação usa `<dialog>` nativo, como a paleta de comandos.
- Gate antes de integrar cada entrega: `pnpm lint`, `pnpm typecheck`, `pnpm test`, e o E2E que toca a tela (`e2e/missions.ts`, `orquestrar.spec.ts`, `vertical-slice.spec.ts`, `interface-ide.spec.ts`, `painel-por-vez.spec.ts`, `ordem-das-abas.spec.ts`, `shell.spec.ts`). As guardas `renderer-styles.test.ts` e `contrast.test.ts` listam os arquivos de estilo e precisam ser atualizadas se um CSS novo for criado.
- Contraste: borda de campo e de botão em 3:1, e fundo de texto no token `--fill`, como está hoje.
- Cada entrega atualiza as notas de `brain/` que ela toca e registra uma decisão nova em `brain/decisoes/`. O commit só sai quando a pessoa pedir, e sem atribuição ao Claude.

## 6. Decisões tomadas (com a resposta da pessoa)

| # | Assunto | Decisão | Entrega |
|---|---|---|---|
| D1 | "Precisa de você" | A mesma missão aparece na faixa da lateral e na banda do Início, com textos diferentes: a lateral mostra título e estado curto; a banda mostra a ação (ex.: Aprovar plano). | Rodada seguinte |
| D2 | Terminal da missão | Sai do painel inferior. A visão Terminais do projeto é o lugar único. A missão tem um botão para abri-la. | A |
| D3 | "Sua decisão" | Fixo no topo da missão quando há decisão pendente. Some quando não há. | A |
| D4 | Painel inferior | Três abas: Atividade, Alterações, Testes. | A |
| D5 | Plano | Uma lista de etapas. | A |
| D6 | Modo Abas da terminal | Sem botão. Em janela estreita, o layout vira abas sozinho. O maximizar fica. | B |
| D7 | Fundo do Início | Fica só no topo, com opacidade menor. | Rodada seguinte |
| D8 | Confirmação de destrutivo | Diálogo modal. | B |
| D9 | Avisos | Canto inferior esquerdo, no máximo dois visíveis. | B |
| D10 | Lima | Fica só na ação principal de cada região. Uma ação principal por região. | A e B, nas telas tocadas |
| D11 | Filtro do Início | Um controle segmentado: Todas · Executando · Aguarda você · Falharam, com a contagem dentro. Os contadores da barra viram atalhos para ele. | Rodada seguinte |
| D12 | Vocabulário de status | Um conjunto, com o mesmo chip e a mesma cor em todas as telas: Rascunho, Planejando, Aguarda aprovação, Em execução, Pausada, Concluída, Falhou. | A (telas da missão) e B (cabeçalho do projeto) |
| D13 | Escopo | Tela da missão e abas, menus, avisos e confirmações. Início, lateral e tokens globais ficam para depois. | — |
| D14 | Entregas | Uma entrega por parte, em duas entregas: A, depois B. Cada uma com a sua decisão em `brain/decisoes`. | — |
| D15 | Notas defasadas | Atualizar em cada entrega as notas que ela toca. | A e B |

## 7. Parte A: tela da missão

### A1. Cabeçalho de uma linha
- Título, chip de situação e "⋯" para o resto (Pausar, Cancelar, Excluir).
- A ação principal que muda com o estado (Aprovar plano, Retomar, Aprovar conclusão) fica só no bloco "Sua decisão" (A2). Não aparece também no cabeçalho, para não repetir o botão.
- A linha "Situação: ..." sai da aba Atividade. Ela é gerada por `conversationEvents` em `mission-text.ts`. O chip é a única ocorrência. (O comentário em `ConversationPanel.tsx`, linhas 6 a 8, só descreve a aba.)
- Ao rolar, o cabeçalho continua visível (ver A2, por causa do espaço).

### A2. "Sua decisão" fixo no topo
- O bloco `components/mission/DecisionBlock.tsx` sai do fim da página e fica fixo logo abaixo do cabeçalho, só quando há decisão pendente.
- Quando não há decisão, o bloco não aparece.
- Altura: o bloco tem altura máxima de 40% da janela, com rolagem interna. O título e o botão principal ficam sempre visíveis. (Decisão minha: o bloco alto, como a aprovação do plano ou a resposta ao agente, não pode tomar a tela de 900 px.)
- A regra de foco fica como está: a região `status` do bloco é montada o tempo todo e anuncia a decisão nova, e o foco só vai ao bloco com a aba Atividade ativa.
- A reabertura de uma missão com decisão pendente deve mostrar o bloco já à vista, como hoje (`e2e/capturas.spec.ts`, captura 5c).

### A3. Lista de etapas
- Depois do planejamento, a lista substitui o quadro de três cartões e a tabela (`components/OrchestratorBoard.tsx`, `components/PlanPanel.tsx`, `components/PlanStepRow.tsx`).
- Cada linha: status (com o vocabulário da D12), título, programa, e um menu "⋯" com Ver descrição, Remover e as ações que o estado permitir.
- Renomear por duplo clique no título. Reordenar por alça.
- O agente aparece uma vez, no cabeçalho do plano. Não aparece em cada linha ou cartão.
- Sem o botão Renomear e o botão Remover repetidos em cada linha.
- Remover tarefa usa a confirmação da Parte B (D8).
- **Decisão minha, a confirmar:** durante o planejamento, o quadro continua aparecendo, como hoje, porque mostra o que o agente está fazendo. A pessoa não respondeu sobre isso.

### A4. Painel inferior com três abas
- Atividade: a conversa com o agente, com um filtro "Técnico" que mostra os Logs (`workspace/LogsPanel.tsx` vira esse filtro, não uma aba).
- Alterações: junta a aba Diff (`workspace/DiffPanel.tsx`) e a seção central "Arquivos alterados" (`components/mission/ChangedFiles.tsx`). A seção central sai do corpo da página. Os caminhos aparecem uma vez.
- Testes: continua como está.
- A aba Terminal sai (D2). A divisória com o mouse e as setas continua.
- As contagens das abas (`missionTabCounts` em `mission-text.ts`) são recalculadas para as três abas.

### A5. Terminal da missão
- Um botão "Abrir terminal" na missão leva à visão Terminais do projeto, com a sessão da missão em foco.
- **Pergunta aberta para o construtor:** hoje a sessão do agente da missão tem painel próprio na visão Terminais? Se não tiver, a entrega precisa decidir como o botão encontra a sessão certa.

### A6. Vocabulário e ação principal
- Um rótulo por estado, nas telas da missão (D12). O mapeamento dos estados atuais (`mission-text.ts`, linhas 33 a 42 e 380 a 385) para o conjunto da D12 é entregue na Parte A, com uma tabela no PR.
- **Ponto a confirmar:** `planned` ("Aguarda aprovação do plano") e `waiting_approval` ("Aguarda sua aprovação") usam a mesma palavra no conjunto da D12. Eles são estados diferentes. O PR precisa mostrar como os dois ficam distinguíveis, ou a pessoa precisa escolher.
- Cada estado tem uma ação principal, e só uma. O lima fica nela (D10).

### A7. Janela estreita
- Em janela de cerca de 900 px, o nome do projeto e as visões não quebram em linhas separadas, e o quadro (se ainda aparecer) não quebra em duas colunas sem necessidade.

### Critérios de aceite da Parte A
- Captura antes e depois das telas 5, 5b, 5c e 6 de `e2e/capturas.spec.ts`, com a diferença descrita no PR.
- A situação aparece uma vez por tela (cabeçalho).
- A tabela de etapas não repete o agente em cada linha.
- Os arquivos alterados aparecem uma vez por tela.
- O E2E que toca a missão passa, com as asserções movidas para o lugar novo quando um controle mudou de lugar.
- O gate da raiz passa.
- Notas atualizadas: `brain/arquitetura/renderer.md` (seção da missão), `brain/decisoes/` (uma decisão nova para a Parte A), `brain/bugs/` se algum achado virar bug.

## 8. Parte B: abas, menus, avisos e confirmações

### B1. Terminais: modo Abas
- Sai o botão "Abas" de `workspace/WorkspaceToolbar.tsx` (linhas 156 a 169) e o modo manual. A dica do botão, que cita Ctrl+Alt+setas, sai junto. No modo automático, o atalho Ctrl+Alt+setas continua valendo, porque o modo não é gravado (decisão de 2026-10-26).
- Em janela estreita, abaixo de uma largura a medir (proposta: 900 px), a área mostra abas (`workspace/PaneTabs.tsx`) sozinha.
- O maximizar de `workspace/PaneView.tsx` continua.
- Esta mudança substitui a decisão `decisao-um-painel-por-vez` no que ela diz sobre o botão. A nova decisão precisa citar a antiga.

### B2. Um só componente de menu
- Hoje há três implementações: `TopBar.tsx` (menu +), `WorkspaceToolbar.tsx` (menu Abrir terminal) e `components/MenuAcoes.tsx` (Radix, usado em Mais ações).
- Um só componente, baseado em `DropdownMenu` com `modal={false}`, para os três.
- Preservar: teclado (setas, Home, End, Esc), foco de volta ao gatilho, clique fora.

### B3. Avisos (toasts)
- Vão para o canto inferior esquerdo, com no máximo dois visíveis. Um terceiro aviso entra em fila, sem ser descartado, e aparece quando um dos visíveis sai. Falha continua visível até a pessoa fechar, ou até sair da fila por tempo (decisão minha, pelo antimeta da seção 4).
- Hoje ficam no canto inferior direito, sobre a barra de status (`app.css`, linhas 1714 a 1719 e 1727 a 1740).
- `role` e `aria-live` continuam como estão.

### B4. Confirmação de destrutivos
- Um diálogo modal nativo (`<dialog>`, como a paleta de comandos) para: Excluir missão, Arquivar projeto, Remover projeto, Remover worktree, Remover tarefa e Parar todos. Hoje esses botões usam `ConfirmButton` ou `ConfirmInline`, ambos em `components/ConfirmButton.tsx`. `ConfirmInline` é usado em `ProjectHeader.tsx` (duas vezes) e em `MissionSummary.tsx`.
- O foco inicial vai para o botão seguro (Voltar ou Cancelar), como já está para Parar todos desde a decisão de 29/10.
- O texto do diálogo diz o efeito, por exemplo "Cancelar 2 missões em execução?". O botão que confirma fica vermelho só dentro do diálogo.
- Consequência: o gatilho dessas ações fica neutro. Vermelho aparece só na confirmação.
- `components/ConfirmButton.tsx` deixa de ser o padrão e fica só para o que não for destrutivo, ou é substituído. A escolha é do construtor, desde que a lista de telas acima passe.

### B5. Cabeçalho do projeto: ação principal
- "Nova missão" aparece como lima no cabeçalho do projeto. O formulário dentro dela tem "Criar e orquestrar" também em lima. Só uma ação fica em lima por região.
- **Decisão minha, a confirmar:** a regra D10 se aplica ao cabeçalho do projeto e ao formulário "Nova missão", que fazem parte da camada de abas. A pessoa não respondeu sobre isso.

### B6. Visões do projeto (formato)
- **Não decidido.** A pessoa não respondeu sobre o formato das visões (pílula ou linha sublinhada). Antes de iniciar a Parte B, a pessoa precisa responder. Se não responder, a Parte B mantém o formato atual.

### Critérios de aceite da Parte B
- Captura antes e depois da visão Terminais (2), da janela estreita de terminais e do diálogo de confirmação de Parar todos.
- Um só componente de menu no renderer (`grep` do `DropdownMenu` e do menu manual, sem resto).
- Os avisos não cobrem a barra de status em nenhuma captura.
- O E2E de terminais (`painel-por-vez.spec.ts`, `ordem-das-abas.spec.ts`, `shell.spec.ts`) passa, com as asserções movidas para o lugar novo.
- O gate da raiz passa.
- Notas atualizadas: `brain/arquitetura/renderer.md` (seções de abas e de menus), `brain/decisoes/` (uma decisão nova para a Parte B, que cite as antigas que ela substitui).

## 9. Fora deste plano (guardado para a rodada seguinte)

Estas respostas já estão registradas e entram na próxima rodada:

- **D1:** a mesma missão nos dois lugares, com textos diferentes.
- **D7:** fundo do Início só no topo, com opacidade menor.
- **D11:** filtro segmentado único no Início, com os contadores da barra como atalhos.
- A lateral: "Precisa de você" vira contador na linha do projeto e em "Espaços" só se a D1 mudar. Hoje a D1 é "nos dois lugares", então a faixa com o botão Ir continua, com o texto ajustado.

## 10. O que é do construtor (não precisa de pergunta)

- Largura exata do modo automático de abas (B1), medida no app.
- Como a sessão da missão é localizada na visão Terminais (A5).
- Implementação do diálogo `<dialog>` (B4), seguindo o padrão da paleta.
- Ordem interna das tarefas do PR, desde que cada entrega passe no gate.

## 11. Respostas da rodada de revisão (2026-10-30)

1. **Estados da missão (A6):** 11 rótulos, um por estado do domínio. Os quatro que a D12 deixava de fora entram: "Plano aprovado, aguardando início", "Aguarda sua resposta", "Aguarda sua revisão" e "Cancelada". A cor segue a família: espera da pessoa em âmbar, execução em lima, falha em vermelho, rascunho e pausa em neutro. "Planejando" deixa de ser estado e vira só o indicador transitório.
2. **Etapas (A3):** Pendente, Em execução, Bloqueada, Concluída, Falhou, Ignorada.
3. **Aprovação (A6):** duas palavras, "Aguarda aprovação do plano" e "Aguarda sua aprovação", como hoje.
4. **Lima (B5):** só o formulário "Nova missão" aberto tem a ação primária em lima ("Criar e orquestrar"). O botão "Nova missão" do cabeçalho fica neutro.
5. **Quadro (A3):** fica durante o planejamento. Depois, vira a lista de etapas.
6. **Início e Missões do projeto (escopo):** mantêm os rótulos atuais nesta rodada. Entram no conjunto na rodada seguinte, junto com o filtro do Início.
7. **Visões do projeto (B6):** sem resposta. Enquanto não houver, a Parte B mantém o formato atual.

Decisões minhas, sem pergunta: altura máxima do bloco "Sua decisão" (40% da janela, com rolagem interna); fila de avisos sem descarte; atalho Ctrl+Alt+setas mantido no modo automático de abas.
