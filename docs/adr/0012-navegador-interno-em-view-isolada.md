# ADR 0012: Navegador interno em view isolada, com sessão por projeto

- Status: proposta; implementada na fase 1, no ramo `feat/navegador-interno`. Passa a aceita com a integração do ramo.
- Data: 2026-11-12
- Origem: aba Navegador do painel direito, em `docs/superpowers/specs/2026-11-12-navegador-interno-design.md`
- Complementa: ADR 0001 (isolamento do Electron) e ADR 0007 (decisões de fundação). Esta decisão abre uma exceção controlada à janela fechada: páginas de fora passam a rodar dentro do aplicativo, sem que a janela do app deixe de ser fechada.

## Contexto

A janela do aplicativo é fechada de propósito. Ela só carrega os arquivos do próprio app, tem uma CSP estrita (`default-src 'self'`, sem estilo nem script escritos em texto), nega toda permissão, só navega para a própria origem e fala com o processo principal por canais IPC que conferem o remetente e a entrada.

O navegador interno precisa do contrário: abrir qualquer site, inclusive o servidor local do projeto, com cookies, logins e JavaScript de terceiros. Pôr isso dentro da janela do app (num `<iframe>`, ou afrouxando a CSP) desfaria as garantias dos ADRs 0001 e 0007.

## Decisão

1. **Cada aba do navegador é uma `WebContentsView` do processo principal**, presa à janela por cima do HTML. A página não é um elemento do DOM do app. O renderer reserva uma área, mede o retângulo dela e o informa; o processo principal confere o retângulo (precisa caber na área de conteúdo da janela, já com o zoom aplicado) e posiciona a view. Fora disso, a página some.
2. **Sessão própria por projeto**: `persist:navegador-<id do projeto>`. Cookies, armazenamento, cache e logins de um projeto não chegam a outro, e ficam guardados entre aberturas. O id é conferido (`^[A-Za-z0-9_-]+$`) antes de virar nome de partição.
3. **A página não tem preload nem canal com o app.** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`. Nenhum canal `browser:*` aceita uma página como remetente: todos passam por `registerTrustedHandler`, e a origem de uma página nunca é a do app.
4. **As políticas das páginas ficam em `security.ts`**, junto das da janela do app, e são outras:
   - a sessão cancela todo pedido `file:` (página, quadro ou recurso), nega toda permissão (câmera, microfone, localização, notificações e as demais) e troca o agente de usuário pelo do Chromium embutido, sem os trechos do Electron e do app;
   - o quadro principal só navega e só é redirecionado para `http:`, `https:` e `about:blank`; `mailto:` vai para a confirmação nativa que já existia; o resto é barrado em silêncio;
   - janela nova nunca abre: com endereço `http:` ou `https:` vira uma aba, e fora disso é ignorada;
   - a CSP do app não vale para as páginas (ela é da janela do app, não dos sites);
   - download não tem tratamento próprio: o Electron mostra o "Salvar como" do sistema.
5. **O renderer não escolhe o que carrega.** Ele manda ids, o texto digitado na barra e um retângulo. Quem interpreta o texto (endereço, `localhost`, busca), decide o que é permitido e guarda as abas é o processo principal. O estado das abas volta por evento, validado no preload.
6. **Estado no banco**: a lista de abas de cada projeto (endereço, título, ordem e a ativa) fica na tabela `browser_tabs`. Carregando, voltar, avançar e erro vivem só em memória. Uma aba restaurada só ganha página (e processo) quando é mostrada.
7. **Limites**: 8 abas por projeto; um projeto visível por vez; as páginas de um projeto fechado são destruídas (a lista fica); remover o projeto ou limpar os dados de navegação fecha as páginas antes de apagar a sessão.
8. **Teclado**: com o foco dentro de uma página, as teclas não passam pelo app. Um conjunto pequeno é interceptado antes da página (`before-input-event`): Ctrl+Alt+B, Ctrl+L, F6, Ctrl+T, Ctrl+W, Ctrl+R, F5, Alt+seta esquerda e Alt+seta direita. F6 e Ctrl+Alt+B garantem que a pessoa nunca fica presa na página.
9. **"Abrir no navegador do sistema"** segue a regra dos links externos do app: só `https:`, depois da confirmação nativa.

## O que não muda na janela do app

A CSP, a negação de permissões, a restrição de navegação, a restrição de pedidos `file:` e a checagem de remetente dos canais continuam as mesmas. `webviewTag` continua desligado. Nenhuma origem nova entra em `img-src`, `connect-src` ou `frame-src`: a imagem parada da página chega como `data:image/png`, que `img-src` já aceitava.

## Alternativas descartadas

- **`<webview>`**: exigiria ligar `webviewTag` na janela do app, que o ADR 0001 mantém desligado, e põe a página como elemento do DOM do renderer.
- **`<iframe>` na janela do app**: exigiria abrir `frame-src` para qualquer origem na CSP do app, e muitos sites recusam ser emoldurados.
- **Uma `BrowserWindow` separada**: não fica integrada ao painel do projeto, que é o pedido.
- **Uma sessão só para todos os projetos**: um login feito num projeto valeria nos outros.

## Consequências

- **A view fica por cima do HTML.** Nada do app consegue ser desenhado na frente da página. Por isso, enquanto um menu ou diálogo do app está aberto (o menu de mais ações do navegador, a paleta de comandos, uma confirmação), a página dá lugar a uma imagem parada dela e volta quando a sobreposição fecha. O mesmo acontece durante o arraste de uma divisória. A área é medida a cada quadro enquanto há página à vista, porque ela muda de lugar sem mudar de tamanho. As dicas dos botões da barra do navegador abrem para cima.
- **Permissões negadas**: sites que pedem câmera, microfone ou localização não funcionam por inteiro aqui. Liberar por site é uma decisão futura, com tela própria.
- **Login que recusa navegador embutido**: alguns provedores bloqueiam o login fora de um navegador conhecido. O agente de usuário sem o trecho do Electron reduz o problema, mas não o elimina; o caminho é "Abrir no navegador do sistema".
- **Memória**: cada aba mostrada é um processo do Chromium. O limite de 8 abas e a criação tardia das páginas contêm o custo; a medição com vários projetos abertos fica pendente.
- **Testes**: o Playwright enxerga a página da view como mais uma página do contexto. "Nenhuma janela nova" se confere por `BrowserWindow.getAllWindows()`, e não pela lista de páginas.

## Experimento antes da implementação

Um teste temporário criou uma `WebContentsView` pelo processo principal, sem código de produto (Electron 44.9.0):

- O Playwright enxerga a página da view (ver "Testes", acima).
- Capturar a imagem da página levou 14 ms na mediana e 304 ms no pior caso (a primeira captura). Por isso a página não espera a imagem indefinidamente para sair de cima de uma sobreposição: sai quando a imagem chega, ou em 60 ms, o que vier primeiro.
- Arrastar a divisória do painel por cima da view não pôde ser medido na janela de teste (ela não recebe o mouse do sistema). Na janela real, a página seguia o arraste com atraso e ficava torta por cima do app. Por isso, enquanto uma divisória é arrastada, a página também dá lugar à imagem parada, e volta no retângulo novo quando a pessoa solta.
