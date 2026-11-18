# Avisos do sistema: desenho

Data: 2026-11-17. Lacuna do MVP: RF-OBS-008 a RF-OBS-011 (planejamento, seções 10.12 e 11).

## Intenção

A pessoa usa o Project Hub no dia a dia, com missões e terminais de agentes rodando enquanto ela faz outra coisa. Hoje o app só mostra o que espera por ela dentro da janela: a faixa "Precisa de você", o contador "aguarda você" da barra de status e a marca nas abas. Com a janela atrás de outra ou minimizada, ela não fica sabendo de nada e volta a vigiar a tela. Esse é o problema que a [[decisao-avisos-no-mvp]] queria resolver: "a espera sem informação".

O objetivo é avisar pelo Windows quando algo trava esperando a pessoa e, com um clique, levá-la ao lugar certo.

## Metas

- Notificação do Windows, com a janela sem foco, quando:
  - uma missão pede aprovação (`waiting_approval`);
  - uma missão faz uma pergunta (`waiting_input`);
  - uma missão falha (`failed`);
  - um terminal do Claude passa a "Aguardando" (pede permissão ou faz uma pergunta, pelos hooks; [[decisao-aguardando-no-terminal-avulso]]).
- O clique na notificação traz a janela para a frente e abre a missão (rota `missionPath`) ou o painel do terminal (o mesmo pedido do "Ver terminal", `requestShowTerminal`).
- Com a janela sem foco, o ícone da barra de tarefas pisca (`flashFrame`) até a janela ganhar o foco.
- Silêncio por projeto: uma caixa nas configurações do projeto desliga a notificação e o piscar desse projeto.

## Fora do escopo

- Aviso de "o Claude terminou a resposta" (`Stop`). Opção C da conversa, que a pessoa não escolheu.
- Plano pronto para aprovar (`planned`) e missão em revisão (`review`) não geram notificação do Windows. Continuam na faixa "Precisa de você". O planejamento diz que a conclusão é "aviso discreto dentro do app, sem notificação do sistema".
- Aviso dentro do app com a janela em primeiro plano: a faixa "Precisa de você" já cobre esse caso, e o planejamento pede para não interromper.
- Codex e Antigravity: não informam espera ([[decisao-aguardando-no-terminal-avulso]]), então não avisam.
- "Falhou" no terminal avulso (processo que sai com erro): segue pendente em separado.
- macOS e Linux: o código usa a API do Electron, que é multiplataforma, mas só o Windows é conferido.
- Central de avisos, histórico de notificações, som próprio e preferências por tipo de aviso.

## O que não pode acontecer

- A notificação mostrar saída de comando, trecho de código, variável de ambiente, conteúdo de arquivo ou o texto da pergunta do agente (RF-OBS-009). Ela tem só o nome da missão ou do terminal, o projeto e o motivo numa frase fixa.
- Avisar duas vezes a mesma espera, ou avisar de novo tudo o que já estava esperando quando o app abre.
- Avisar com a janela em primeiro plano.
- O renderer mandar texto para a notificação. Ele manda só identificadores.

## Restrições

- **Regra única do "precisa de você".** A regra está em `apps/desktop/src/renderer/attention.ts` (`attentionEntries`) e é usada pela faixa, pelo contador e pelas abas. A notificação parte dela, sem uma segunda cópia. A falha não entra nessa regra (`needsAttention` não inclui `failed`). O vigia a acrescenta à parte, pela visão geral das missões.
- **Contratos fixos no processo principal** ([[decisao-ui-livre-contratos-fixos]]): o canal novo entra em `CHANNELS`, tem schema Zod na entrada e na resposta e passa pelo preload com método explícito.
- **Timers estrangulados em segundo plano.** A janela usa `backgroundThrottling` padrão (`true`; só os testes o desligam, em `main/index.ts`). Com a janela escondida ou coberta (o Chromium no Windows detecta a oclusão), os timers do renderer são retardados e, depois de uns 5 min, alinhados a um por minuto. O `useTerminals` relê a lista a cada 2 s por `setInterval`, então o "Aguardando" de um terminal pode chegar com até um minuto de atraso. As missões não sofrem com isso: chegam por evento IPC (`missions:event:v1`), que acorda o renderer.
- **Windows e o AppUserModelId.** O app não chama `app.setAppUserModelId`. Sem isso, a notificação do Windows não aparece ou aparece sem nome, sem ícone e sem clique confiável. Em desenvolvimento o id é `process.execPath`, como manda a documentação do Electron. O instalador, quando existir, fixa um id próprio.
- **Assistente de foco do Windows.** Com "Não incomodar" ligado, o Windows segura a notificação. Isso não é erro do app. O piscar da barra de tarefas continua.

## Caminhos considerados

1. **Tudo no processo principal.** Ele acompanha as missões e consulta os terminais sozinho. Funciona com a tela travada, mas duplica a regra de `attention.ts` e cria uma segunda consulta dos terminais.
2. **Tudo no renderer**, com a `Notification` do navegador. É o caminho mais curto, mas o texto nasce no renderer, e o clique e o foco da janela ficam frágeis.
3. **Misto (escolhido pela pessoa).** O renderer, com a regra que já existe, percebe o que é novo e manda só o identificador. O processo principal monta o texto, confere o foco e o silêncio, mostra a notificação, pisca a barra e trata o clique. A regra fica única, e o conteúdo fica sob o controle do processo principal.

## Como funciona

### Renderer: o vigia

Um módulo novo (por exemplo `renderer/attention-alerts.ts`, montado uma vez no `App`) acompanha `useAttention()` e `useOverview()`:

- Guarda as chaves já vistas. Na primeira leitura confiável (`known: true`), só registra o que já existe, sem avisar.
- A cada mudança, calcula o que surgiu:
  - uma entrada de sessão (`kind: 'session'`) com terminal em `waiting`;
  - uma entrada de missão em `waiting_approval` ou `waiting_input` (não `planned` nem `review`);
  - uma missão que passou a `failed` (pela visão geral).
- Para cada item novo, chama `window.projectHub.alerts.notify({ kind, id })`, em que `kind` é `'mission'` ou `'terminal'`. Não envia texto.
- **A identidade da espera é a missão, quando há missão.** O terminal de um agente de missão fica `waiting` justamente quando a missão está em `waiting_input` ou `waiting_approval` (`main/terminals.ts`), e `attentionEntries` troca a entrada da missão pela entrada da sessão (`covered`). Por isso o vigia não usa a chave da entrada (`m-…` ou `t-…`). Uma entrada de sessão cujo terminal tem `missionId` vira `{ kind: 'mission', id: missionId }`, e só o terminal avulso (sem `missionId`) vira `{ kind: 'terminal', id }`. Assim a mesma espera não avisa duas vezes quando a missão aparece primeiro, pela visão geral, e o terminal chega na leitura seguinte. O texto e o clique da missão valem também nesse caso.
- Quando uma espera acaba e outra começa (a missão pediu, foi aprovada e pediu de novo), avisa outra vez: cada espera nova é um aviso. O vigia é quem separa uma espera da outra: a identidade sai do conjunto de esperas quando o item deixa de esperar e, ao voltar, é nova.

### Renderer: a leitura dos terminais em segundo plano

Para o "Aguardando" do terminal não atrasar com a janela escondida, o processo principal empurra um sinal. Enquanto a janela está sem foco, ele relê a lista de terminais a cada 2 s, com a mesma função do canal `terminals:list`, e compara o estado de cada um com a leitura anterior. Quando algum muda, manda `terminals:changed` (só o sinal, sem dados). O `useTerminals` ouve esse sinal e relê na hora. O IPC acorda o renderer mesmo estrangulado.

Com a janela em foco, o timer do processo principal para, e vale a consulta de 2 s que já existe.

### Processo principal: o serviço de avisos

Um módulo novo (por exemplo `main/alerts.ts`), ligado em `composition.ts`:

- **Entrada** `alerts:notify:v1`, com schema `{ kind: 'mission' | 'terminal', id: string }`.
- **Busca os dados por conta própria**: a missão no repositório (título, projeto, estado atual) ou o terminal na lista (título, projeto, estado atual). Se o item não existe, ou se o estado atual não é mais um dos que avisam, ignora, porque o renderer pode estar uma leitura atrasado.
- **Confere o projeto**: se está silenciado, ignora.
- **Confere o foco**: se a janela principal está em foco (`isFocused()`) e não está minimizada, ignora.
- **Mostra** um `Notification` do Electron. O título é o nome da missão ou do terminal, e o corpo é o projeto e o motivo, com frases fixas:
  - "Pede a sua aprovação";
  - "Fez uma pergunta";
  - "Falhou";
  - "Aguarda você" (terminal).
- **Pisca** a barra de tarefas (`flashFrame(true)`) e para de piscar no `focus` da janela.
- **Não filtra repetição por tempo.** Separar uma espera da outra é papel do vigia. Uma janela de tempo no processo principal calaria um segundo pedido legítimo logo depois de uma aprovação. Para não acumular, um aviso novo de um item substitui a notificação anterior desse item (`close()` na antiga). Esperar o evento de fechamento não serve: no Windows a notificação vai para a Central de Ações sem aviso confiável.
- **Clique**: `show()`, `restore()` se minimizada, `focus()`, e envia ao renderer `alerts:open:v1` com `{ kind, projectId, id }`. O renderer navega para `missionPath(projectId, id)` ou chama `requestShowTerminal(projectId, id)`.
- Na partida do app, chama `app.setAppUserModelId`, com `process.execPath` em desenvolvimento.

### Silêncio por projeto

- Coluna nova `notifications_muted` (booleano, padrão `0`) em `projects`, por migração do Drizzle. O app aplica as migrações ao abrir o banco.
- Canal `projects:set-muted:v1` (`{ projectId, muted }`) e campo `muted` no `ProjectSummary`.
- Em `ProjectSettings.tsx`, uma caixa "Silenciar avisos deste projeto", no estilo das linhas que já existem. Ela tem o visual do app, não o padrão do navegador (memória: "Sem campos com estilo padrão").
- O silêncio desliga só a notificação e o piscar. A faixa "Precisa de você" e o contador continuam, porque mostram estado, não interrompem.

## Testes

- Unitários do vigia: a primeira leitura não avisa, um item novo avisa uma vez, um item que sai e volta avisa de novo, `planned` e `review` não avisam, e a falha avisa. A missão que aparece primeiro como entrada de missão e depois como sessão com `missionId` avisa uma vez só, como missão.
- Unitários do serviço: o texto vem só dos campos permitidos, o serviço ignora com foco, com projeto silenciado, com item inexistente, com estado que já mudou, o aviso repetido substitui o anterior, e o clique envia `alerts:open:v1`. O `Notification` e o `BrowserWindow` entram por injeção.
- Contrato: os schemas novos e a resposta no `responseSchemas`.
- Banco: a migração e o repositório gravam e leem o silêncio.
- E2E com dados descartáveis (`launchApp`): missão simulada pedindo aprovação com a janela sem foco gera a chamada de notificação (substituída por um registro de teste com `PROJECT_HUB_ENV=test`), o silêncio a impede, e o `alerts:open` leva à missão.
- Conferência na janela real, com `pnpm dev`: a notificação aparece no Windows, o clique abre a missão e o terminal, e a barra pisca.

## Decisões do construtor (a pessoa pode rever)

- Frases dos motivos e o texto da caixa de silêncio.
- A espera de uma missão é identificada pela missão, mesmo quando chega pelo terminal do agente.
- Sem filtro de repetição por tempo; o aviso novo de um item substitui o anterior.
- Timer de 2 s no processo principal só com a janela sem foco.
- O silêncio não esconde a faixa "Precisa de você".
- Nomes dos módulos e canais, e onde o vigia é montado.

## Notas relacionadas

- [[decisao-avisos-no-mvp]]
- [[decisao-aguardando-no-terminal-avulso]]
- `apps/desktop/src/renderer/attention.ts`
- `apps/desktop/src/main/mission-events.ts`
