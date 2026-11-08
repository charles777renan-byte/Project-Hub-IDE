# Fechar todos os terminais e "não perguntar de novo": design

Pedido da pessoa em 2026-11-08, depois de ver a grade responsiva: fechar todos os terminais de uma vez e poder parar de confirmar cada fechamento. Escolhas dela: "Fechar todos" no menu **Mais ações** do projeto; caixa **"Não perguntar de novo"** na pergunta, guardada, com o desfazer em **Configurações**; o "fechar todos" **sempre pergunta**; tudo no ramo `feat/grade-responsiva`, no mesmo PR.

## 1. "Não perguntar de novo" ao fechar um terminal

- Hoje a pergunta "Encerrar o <programa> e fechar o painel? O processo para." aparece só onde fechar mata um agente (`needsCloseConfirmation`: terminal avulso, programa que não é o shell, sessão rodando). Isso não muda.
- A pergunta (`.pane__confirm`) ganha uma caixa **"Não perguntar de novo"**, desmarcada, entre a pergunta e os botões. Marcada e confirmada com "Fechar e encerrar", a escolha fica guardada; "Voltar" não guarda nada, mesmo com a caixa marcada.
- Com a escolha guardada, o item do menu ⋯ passa a "Fechar painel e encerrar" (sem reticências) e fecha direto, sem pergunta.
- A escolha vale para o app inteiro (todos os projetos) e sobrevive a fechar o app: `localStorage`, como as outras preferências de tela (`App.tsx`, `Sidebar.tsx`, `right-panel-state.ts`), com leitura protegida (sem `localStorage` ou valor estranho = perguntar). Um store pequeno com `useSyncExternalStore` (como `terminal-focus.ts`) para todos os painéis e as Configurações verem a mudança na hora.
- **Desfazer**: em Configurações do projeto, uma seção "Terminais" com a caixa **"Perguntar antes de fechar um terminal com agente rodando"** e a linha "Vale para todos os projetos." Marcada = pergunta (padrão).
- A pergunta deve caber no painel estreito: o texto quebra linha, nunca corta com reticências (a captura de 2026-11-08 mostrou "fechar o paine…"), e o menu ⋯ fecha antes de a pergunta aparecer.

## 2. "Fechar todos os terminais"

- Item **"Fechar todos os terminais…"** no menu Mais ações do cabeçalho do projeto (`ProjectHeader`), perigoso (vermelho), depois dos itens que já existem. Desabilitado com a dica "Nenhum terminal aberto" quando o workspace do projeto não tem painel.
- Escolher o item leva à visão Terminais (se não estiver nela) e mostra **uma** pergunta no workspace, numa faixa como a `.pane__confirm`, acima da grade: "Fechar os N painéis? M sessões serão encerradas; as missões continuam." (sem missões, sem a segunda metade; frases no singular quando for 1). Botões "Fechar todos" (perigoso) e "Voltar" (focado ao abrir). Esc equivale a Voltar.
- **Sempre pergunta**, mesmo com "não perguntar de novo" guardado.
- Confirmado: todos os painéis saem da tela na hora (sem a animação de saída de cada um), as sessões avulsas são encerradas e os terminais de missão só saem do painel, como no fechar de um painel. O processo principal recebe os pedidos de fechar um a um, na fila que já existe; um que falhe volta como hoje (o painel reaparece com o erro). Depois, o foco vai para "Abrir terminal".
- A comunicação cabeçalho → workspace segue o padrão de `requestResumeSession` em `workspaces-events.ts` (evento com o id do projeto). O workspace publica num store pequeno quantos painéis o projeto tem, para o cabeçalho saber se habilita o item.

## Fora do escopo

- Fechar todos de todos os projetos.
- Desfazer depois de fechar (o pedido era não precisar confirmar, não recuperar).
- Mudar quando a pergunta individual aparece (shell e terminal de missão continuam fechando sem perguntar).

## Testes

- Unidade: o store da preferência (padrão, guardar, ler valor estranho, sem `localStorage`); `PaneView` com e sem a preferência (pergunta, caixa, "Voltar" não guarda, item sem reticências); Configurações (caixa reflete e muda a preferência); `ProjectHeader` (item, desabilitado sem painéis, dispara o pedido); `WorkspacePage` (pergunta com N e M, textos no singular, Voltar, Esc, confirmar fecha todos e chama o fechar de cada um, missão só sai, sempre pergunta mesmo com a preferência).
- E2E: abrir 3 shells, "Fechar todos os terminais…", confirmar, workspace vazio; e a caixa "Não perguntar de novo" num terminal de agente (com o programa falso dos E2E, se houver) ou, sem ele, pela preferência em Configurações.
