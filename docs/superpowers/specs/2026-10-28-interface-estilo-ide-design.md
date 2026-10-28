# Interface estilo IDE, com o Início como painel de abertura

Data: 2026-10-28. Estado: rascunho para leitura. Substitui o rascunho `2026-10-28-tela-da-missao-prototipo-design.md`, que vira a seção "Missão" deste documento.

## Intenção

A pessoa sente que o app "parece um site": navega de página em página (Início, Projetos, Projeto com 5 abas, Missão com 6 abas), repete a mesma informação em vários lugares e tem texto e decoração demais para uma ferramenta. Ela quer uma **interface de IDE**: um espaço de trabalho fixo, denso, em que cada ação mora num lugar só. A tela inicial é um **painel de dados dentro dessa IDE**, não uma página à parte.

O que existe por baixo já funciona (projetos, missões, orquestrador, terminais, worktrees, diff). O trabalho é **só de estrutura da interface**: nenhum canal, contrato, banco, orquestrador ou processo principal muda.

## Repetições encontradas (o que esta mudança elimina)

| O quê | Onde aparece hoje | Onde fica depois |
|---|---|---|
| Executando / Aguarda você / Falharam | barra superior, Início, Visão geral do projeto | barra de status |
| Nova missão | cartão do Início, botão do projeto, "+" da lateral, estado vazio que manda usar o botão | um botão na aba do projeto e um item na paleta (Ctrl+K) |
| Dados do repositório (tipo, branch, pasta) | rótulo do topo, chip, aba Repositório, cartão da Visão geral | barra de status (branch) e a aba Configurações do projeto (pasta, abrir, copiar) |
| Lista de projetos | lateral, página Projetos, Projetos recentes do Início | só a lateral |
| "Comece sua primeira missão" | Visão geral e aba Missões | só a lista de missões vazia, com o botão ali |
| Título "Missões" | nome da aba e título logo abaixo | só a aba |
| Início e Projetos | links na lateral e páginas | Início é uma aba fixa; Projetos deixa de existir |

## A janela (fixa em todas as telas)

1. **Barra de título (36 px)**: a marca, as **abas** (a primeira é **Início**, fixa e sem fechar; depois os projetos abertos, como hoje) e o "+" para abrir projeto. Os contadores saem dela.
2. **Lateral (explorador)**: busca (Ctrl+K), "Precisa de você" e a árvore de **projetos → missões e sessões** (a lista que já existe), com "Adicionar projeto" no cabeçalho da lateral. Os links Início e Projetos saem.
3. **Centro**: o conteúdo da aba ativa.
4. **Barra de status (24 px, embaixo)**: projeto e branch da aba ativa, contadores Executando · Aguarda você · Falharam (cada um leva à lista filtrada no Início), CPU e RAM e "Parar todos". É o único lugar desses dados.

Fundo topográfico: só nos estados vazios e no topo do Início. Atrás de conteúdo denso (listas, tabelas, formulários, terminais), nunca.

## Início (aba fixa, painel de abertura)

Um painel denso, de leitura rápida, de cima para baixo:
- Saudação curta com a data, em uma linha. "Alterar nome" sai daqui e vai para a paleta (Ctrl+K, "Alterar meu nome").
- **Precisa de você**: a lista do que espera decisão (plano para aprovar, aprovação, pergunta, revisão), cada linha com o botão que leva direto ao ponto.
- **Missões** de todos os projetos, no formato do protótipo: título, estado, "4/5 tarefas", barra de progresso colorida pelo estado e um filtro por estado (o mesmo dos contadores da barra de status).
- **Atividade** compacta: o mapa de 90 dias em uma faixa baixa e a sequência. Sem eventos, uma linha só, sem o mapa vazio ocupando meia tela.
- **Uso dos agentes**, como hoje, mais compacto.
- "Projetos recentes" e o cartão "Nova missão — Começar" saem.

## Projeto (aba de cada projeto aberto)

A página de detalhe do projeto e o workspace do projeto viram **uma aba só**:
- Cabeçalho de uma linha: nome do projeto, botão **Nova missão** e o menu "Mais ações" (arquivar, remover da lista).
- Logo abaixo, uma barra de visões do projeto: **Terminais** (o workspace de painéis atual, que abre por padrão), **Missões** (lista com progresso, igual à do Início filtrada pelo projeto), **Worktrees** e **Configurações** (pasta com abrir e copiar, branch, grupo, apelido). "Visão geral" e "Repositório" deixam de existir: os contadores foram para a barra de status e os dados do repositório para Configurações.
- **Nova missão** abre um formulário compacto no próprio centro da aba: título, objetivo e critérios, com no máximo uma linha de dica por campo, e Cancelar e Criar no fim. Ao criar, a missão abre.

## Missão (dentro da aba do projeto)

Abrir uma missão (da lateral, do Início ou da lista do projeto) mostra a missão no centro da aba do projeto, no formato do protótipo que a pessoa aprovou:
1. Cabeçalho: "MISSÃO · {PROJETO}", título, objetivo em linha menor, o selo do estado e "Mais ações" (pausar, cancelar, excluir).
2. **Quadro do orquestrador**: orquestrador → papéis em duas colunas (nome, programa colorido à direita, uma linha de descrição do papel, estado) → "Integração e entrega" tracejado, com "aguardando tarefas" ou o estado. Descrições: Frontend "Interface e componentes", Backend "APIs e lógica do sistema", Banco de dados "Modelagem e consultas", Documentação "README e guias de uso", QA "Testes e verificação", Geral "Tarefas gerais".
3. **Tabela TAREFA / AGENTE / STATUS**, com a edição antes de iniciar que já existe.
4. **ARQUIVOS ALTERADOS**: os arquivos do worktree (caminho, linhas a mais e a menos) ou "Nenhuma alteração pendente.".
5. **SUA DECISÃO**: um bloco só, com o que espera a pessoa naquele estado (Orquestrar, Aprovar plano e Planejar de novo, Iniciar missão, Retomar, os cartões de aprovação e pergunta do agente, Aprovar conclusão e Pedir ajustes, Tentar de novo, resumo da conclusão). É o único lugar da ação principal.
6. **Painel inferior redimensionável**, como numa IDE: Conversa, Diff, Testes, Terminal e Logs. A aba Plano e a faixa "Objetivo → Plano → …" deixam de existir.

## Fora de escopo

- Qualquer mudança em `packages/` ou no processo principal (`apps/desktop/src/main`, preload): canais, contratos, banco, orquestrador e planejador ficam como estão. A interface usa só o que `window.projectHub` já oferece.
- Tema claro, tela de Agentes, execução em paralelo, Codex e Gemini.
- Abas de missão na barra de título (exigiria guardar abas de missão no banco).

## O que seria um fracasso

- Perder qualquer ação que existe hoje: adicionar, arquivar, restaurar e remover projeto; grupo e apelido; abrir pasta e copiar caminho; criar, planejar, editar o plano, aprovar, iniciar, pausar, retomar, cancelar, excluir, responder, pedir ajustes e tentar de novo; terminais (abrir, fechar, dividir, maximizar, abas); worktrees (listar, remover); paleta; "Parar todos".
- Deixar de avisar uma decisão pendente (o aviso para leitor de tela da faixa "Precisa de você" continua).
- Rolagem horizontal em janela estreita, ou partes que só funcionam com mouse.
- Planejamento rodando sem o clique em Orquestrar.

## Restrições

- CSP: sem `<style>` nem atributo `style`; CSS em arquivo, ligado por `<link>`. Só tokens de cor do projeto, passando nos guardas de contraste.
- Textos em português, sem jargão, e curtos: no máximo uma linha de ajuda por campo ou seção.
- Mover e reaproveitar componentes que já existem (Sidebar, TopBar, workspace de painéis, PlanPanel, OrchestratorBoard, cartões de decisão, painéis das abas). Reescrever só a disposição.
- Testes do renderer e E2E acompanham a nova estrutura; nenhum teste é apagado sem que o comportamento continue coberto em outro.
- O renderer não importa `@project-hub/application`.

## Minhas escolhas, para você conferir

1. As abas da barra de título continuam sendo de projetos, com o Início como primeira aba fixa. Missões abrem dentro da aba do projeto, sem aba própria, porque abas de missão exigiriam mudar o banco.
2. A página Projetos sai. Adicionar projeto fica no cabeçalho da lateral, e os projetos arquivados ganham um item no fim da lateral ("Arquivados") com Restaurar.
3. Dentro da aba do projeto ficam quatro visões (Terminais, Missões, Worktrees, Configurações), com Terminais como padrão.
4. A missão abre no centro da aba do projeto, no lugar das visões, com um "voltar" para elas e o painel inferior próprio.
5. Os contadores da barra de status levam ao Início com a lista de missões filtrada por aquele estado.
6. Trabalho feito numa branch nova, a partir da `feat/orquestrador-fatia-2`, que ainda não foi mesclada.

## O que fica para quem construir

As rotas exatas e como cada rota antiga redireciona para a nova, nomes de componentes e arquivos de estilo, como "Arquivos alterados" reaproveita a leitura do Diff, o foco do teclado ao trocar de visão, a altura padrão do painel inferior e onde ela fica guardada, e a ordem de corte das tarefas.
