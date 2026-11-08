# Cabeçalho do terminal, medidor de contexto e foco do teclado: design

Origem: o documento de correções de UI/UX (`Project_Hub_Correcoes_UI_UX.md`), filtrado em conversa. Só entram as mudanças abaixo. Os mockups aprovados estavam no companheiro visual (`.superpowers/brainstorm/73-1794107877/content/`, `cabecalho-b-v3.html` e a terceira seção de `cabecalho-terminal.html`).

## Intenção

Hoje o painel de um terminal diz pouco no cabeçalho: um ícone do programa, a pílula de tokens, uma luz de estado e os botões. O nome da tarefa, o worktree e a dica de atalho ficam num rodapé pequeno, repetido em todos os painéis, e o estado só existe como cor (o texto vai na dica do mouse). A pessoa que acompanha vários agentes ao mesmo tempo precisa bater o olho e saber, por painel: o que ele faz, em que estado está, quanto gastou e quanto da conversa ainda cabe. Também precisa saber sem dúvida qual terminal está com o teclado.

## Objetivos

1. Cabeçalho de duas linhas com título da tarefa, estado em texto, modelo, worktree, a pílula de tokens de hoje e uma barra de contexto nova. O rodapé do painel sai.
2. Foco do teclado evidente em cada painel e dito na barra de status da janela.
3. Pequenas correções de legibilidade e área de clique (lista no fim).

## Não objetivos e antiobjetivos

- Não mexer nas barras laterais, no dashboard do Início, no fundo animado (topográfico) nem nas animações de tela. A pessoa gosta e quer manter.
- Não adotar a paleta do documento de origem. As cores seguem os papéis que o app já documenta em `styles/tokens.css`: lima = executando e ação principal, violeta = marca e aguarda decisão, vermelho = falha, amarelo = progresso, ciano = terminal e Git. Estado nunca só por cor: sempre forma ou texto também (`state-mark.ts`).
- Não mudar a pílula de tokens: mesmo desenho (raio, contagem abreviada, palavra "tokens"), mesma rampa de cor por nível, mesma contagem animada, mesma dica com o detalhe. Só muda de lugar.
- Antiobjetivo: um zero no lugar de um dado que não existe. Sem dado, a peça não aparece (regra que o app já segue).
- Não criar modo foco novo: as "Abas" (um painel por vez) já cobrem.

## Restrições

- O teste de contraste `test/renderer/contrast.test.ts` mede os pares de cor; os novos (barra de contexto, tinta do cabeçalho focado, selo de estado) entram nele.
- `test/renderer/pane-styles.test.ts` fixa hoje cabeça de 28 px e rodapé de 22 px: passa a descrever o cabeçalho novo e o rodapé deixa de existir.
- Os nomes acessíveis atuais se mantêm (`Maximizar painel`, `Fechar painel`, o texto do estado para leitor de tela).
- Convenções do projeto: UI em português, sem atribuição ao Claude em commits e PRs, `brain/` atualizado, gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`) e o app aberto e conferido ao final.

## O desenho, como a pessoa decidiu

### Cabeçalho de duas linhas (opção B)

- **Linha 1:** ícone do programa, título da tarefa, selo de estado em texto, depois maximizar e o menu ⋯. O selo usa as marcas de `state-mark.ts` como estão (forma, cor e rótulo de `MARKS`: "Ativo" e "Aguardando" para sessão viva); não há estados novos. A pulsação do ponto do estado ativo continua. O cabeçalho de duas linhas é só da sessão viva: o lançador e a sessão terminada ("A sessão terminou.") mantêm o cabeçalho de uma linha de hoje. Os mockups mostraram "Executando", "Falhou" e "Ocioso" como ilustração; valem os rótulos que o app já tem.
- **Linha 2:** modelo, worktree, a pílula de tokens e, à direita, a barra de contexto com o rótulo "contexto" e a porcentagem.
- **Rodapé do painel:** sai. A dica "Ctrl+Shift+Tab sai do terminal" deixa de se repetir; ela continua só no `title` do terminal (`TerminalView`) e na barra de status (abaixo).
- A linha 2 trunca da esquerda para a direita: a worktree cede primeiro, depois o modelo; a pílula e a barra nunca somem por falta de espaço.

### Barra de contexto

- Mede quanto da janela do modelo está ocupado agora (sobe e desce). É diferente dos tokens gastos (soma que só sobe).
- Cinza até 80%; violeta de 80% em diante; a porcentagem aparece sempre, a cor nunca é a única pista. Vermelho fica de fora de propósito: a pílula já usa a rampa quente, e a mesma cor não pode dizer duas coisas lado a lado.
- Sem dado (provedor que não informa, modelo desconhecido, leitura ainda sem número), a barra não aparece.

### Foco do teclado

- Painel com o teclado: anel lima de 2 px (já existe) mais cabeçalho levemente tingido de lima (7% sobre `--surface`).
- Painel ativo sem o teclado: contorno cinza de 1 px (como hoje). Os demais: contorno discreto.
- A barra de status da janela passa a mostrar, no workspace, "Foco: título · Ctrl+Shift+Tab sai do terminal". A dica de atalho aparece só aí.

### Ajustes pequenos

Contadores com valor 0 em cinza neutro; área de clique mínima de 24×24 px nos botões do cabeçalho. O construtor localiza onde cada um vive hoje. (O ponto vazio para sessão sem processo já existe: é a marca "Desconectado".)

Última tarefa do plano, separável e descartável: esmaecer a borda das abas que rolam na horizontal e oferecer uma lista "⌄" das que estão fora de vista, na faixa de abas do projeto e na faixa de arquivos do painel direito (alvo: palpite meu). A lista é um menu novo, com teclado e leitor de tela, e custa mais que o resto dos ajustes; se apertar, sai sem afetar o resto.

## Chamadas que eu fiz (a pessoa pode rever)

- **Dados que o resumo do terminal não tem.** `TerminalSummary` traz `title`, `worktreeName` e `usage`, mas não o modelo, nem a branch, nem o contexto. Decisão: a linha 2 mostra `worktreeName` (o que o rodapé mostra hoje) e não inventa uma branch; o modelo e o contexto vêm do transcript do Claude (abaixo). Sem o modelo, mostra o nome do programa (Claude, Codex…).
- **Título.** Usa `terminal.title`; sem ele, o nome do programa.
- **Menu ⋯ preserva as regras de hoje.** Terminal avulso: "Encerrar terminal…" (hoje o X fecha o painel e finaliza o processo, sem perguntar; passa a pedir confirmação só quando o estado é "trabalhando"). Terminal de missão: "Tirar do painel" e "Fechar painel (a missão continua)". "Reiniciar" não entra no menu: sessão terminada já tem "Iniciar de novo". O lançador (painel sem sessão) e a sessão terminada mantêm o cabeçalho de uma linha de hoje.
- **Missões ficam para depois (decisão da pessoa).** O modelo e a barra de contexto entram só nos terminais avulsos do Claude, nesta entrega. O terminal de missão ganha o cabeçalho novo (título, estado, worktree, pílula de tokens como hoje), mas a linha 2 mostra o nome do programa no lugar do modelo e não tem a barra, porque o uso de missão vem do orquestrador (`execution.usage`, evento `usage.updated` do adaptador), que teria de carregar os campos novos. A segunda fase estende o uso do domínio, o evento, o DTO e a gravação da execução, e liga a mesma barra.
- **X e confirmação.** O X sai do cabeçalho de sessão viva: tudo o que fecha ou tira do painel fica no menu ⋯, e os testes ganham o passo de abrir o menu. O item do terminal avulso se chama "Fechar painel e encerrar…" (o nome acessível "Fechar painel" continua dentro dele); o da missão, "Fechar painel (a missão continua)". A confirmação nova vale para sessão de agente viva (`kind === 'agent'`, estado `running` ou `waiting`), porque fechar mata o processo; shell comum fecha sem perguntar, como hoje.
- **Nome do projeto.** Sai junto com o rodapé; fica no `title` (dica do mouse) do título do cabeçalho. A janela já mostra o projeto da rota na barra de status.
- **O que é "foco" na barra de status.** É o painel ativo do workspace com o teclado dentro dele (`focus` dentro do `<section class="pane">`). Mostra "Foco: título · dica" só nesse caso; com o foco na barra lateral, no editor do painel direito, num campo de texto, num lançador sem sessão ou fora do workspace, a parte "Foco" some. Vale igual no modo "Abas".
- **Leitura do contexto.** Vale a resposta mais recente (pelo momento da linha no transcript) entre os transcripts principais da execução: depois de `/clear` ou de uma sessão nova, conta a nova; depois de `/compact` o valor cai, e isso é o esperado. Linha sem `input_tokens` e `output_tokens` válidos é ignorada, como hoje. Mudar o contrato de `poll`, que hoje só devolve quando a soma muda, é parte do trabalho: o contexto muda mesmo com a soma igual.
- **Janela de contexto.** Tabela por família de modelo, num arquivo só, com 200 mil como padrão e teto de 100% na exibição. O transcript não diz se a sessão é de 1 milhão; por isso a porcentagem pode ficar acima do real nessas sessões. Limitação aceita, anotada no código.
- **Limiar violeta em 80%.** Valor meu; fica numa constante.

## Dados novos (para o construtor)

- Contexto ocupado = `input + cache lido + cache escrito (5 min + 1 h)` da última resposta do transcript **principal** da sessão (os arquivos dos subagentes têm janela própria e ficam de fora). Fonte: `packages/agent-adapters/src/claude-code/transcript-usage.ts`, que já lê essas linhas (`readUsageLine`) e hoje só soma por `message.id`. Falta guardar a última resposta principal e o modelo.
- Chegar ao renderer pelo `TerminalSummary` (contrato em `packages/contracts/src/terminal.ts`): campos opcionais novos para modelo e contexto, ausentes quando não há dado. O texto da resposta continua sem ser copiado, só números e o id do modelo.
- Só o Claude informa; Codex, Antigravity e shell não têm os campos.

## O que fica para o construtor

- Como a barra de status sabe qual terminal tem o foco: hoje o painel ativo é estado do workspace. Sugestão: um pequeno store como `open-files.ts`, escrito pelo workspace e lido pela barra de status.
- Estrutura e nomes das classes CSS do cabeçalho, ordem de truncamento exata, textos do menu e da confirmação.
- Testes, incluindo contraste, `pane-styles` e a E2E que abre o app com dados descartáveis (`launchApp`).
- Atualizar `brain/` (arquitetura do renderer e uma nota de decisão) e o diário da sessão.
