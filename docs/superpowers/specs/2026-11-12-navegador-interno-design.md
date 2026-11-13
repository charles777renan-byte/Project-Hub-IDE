# Navegador interno por projeto: design

Pedido da pessoa em 2026-11-12: um navegador dentro do app, fluido, integrado e separado para cada projeto, para ver e analisar o que está sendo construído (sites, páginas HTML, apps web) sem sair do Project Hub.

Este documento cobre as três fases do trabalho. A fase 1 está detalhada para planejar e implementar. As fases 2 e 3 estão descritas no nível de intenção e de limites, e cada uma ganha um desenho próprio antes do seu plano.

Marcação usada abaixo: **(pessoa)** é o que ela disse ou escolheu na conversa; **(escolha do desenho)** é uma decisão tomada ao escrever, que ela ainda pode trocar.

## Por quê

Hoje, para ver o resultado do que um agente fez num projeto web, a pessoa sai do app e abre outro navegador. Ela perde o contexto do projeto, mistura as abas de vários projetos na mesma janela e os agentes não conseguem conferir o próprio trabalho na tela.

O que ela quer, nas palavras dela: "ver e analisar previews de sites/websites", "100% integrado aos projetos, tipo um live preview", "tudo automático", e que "os agentes possam ver e utilizar os navegadores".

## Objetivos

- **(pessoa)** O navegador fica na quinta aba do painel direito, ao lado de Arquivos, Sessões, Código-fonte e Checks. Os terminais continuam à vista.
- **(pessoa)** Cada projeto tem o seu navegador: abas, endereço, histórico e logins próprios. Trocar de projeto troca o navegador junto.
- **(pessoa)** Abre tanto o que roda na máquina (servidor de desenvolvimento, arquivos HTML) quanto qualquer site da internet (documentação, referência, o site publicado).
- **(pessoa)** Ao abrir o navegador num projeto, o app descobre sozinho o que mostrar, sobe o servidor de desenvolvimento se for o caso e atualiza a página quando o código muda (fase 2).
- **(pessoa)** Os agentes dos terminais conseguem ver e usar o navegador do projeto em que estão (fase 3).
- **(pessoa)** A experiência é fluida: redimensionar o painel, trocar de aba e trocar de projeto não travam nem piscam.

## Fora do escopo (das três fases)

- Favoritos, extensões, sincronização de conta, gerenciador de senhas e preenchimento automático.
- Importar cookies ou logins de outro navegador.
- Navegador fora do painel direito (janela solta, painel na grade de terminais, visão própria do projeto). A pessoa viu as três posições em esboço e escolheu o painel direito.
- Preview de worktree de missão. O preview é o da pasta do projeto. Fica como evolução depois da fase 2.

## O que tornaria isto um fracasso, mesmo funcionando

- Uma página aberta no navegador alcançar os dados do app, os comandos internos (IPC) ou os arquivos de outro projeto.
- Um login feito no navegador de um projeto aparecer no de outro.
- Enfraquecer a janela do app para encaixar o navegador: relaxar a CSP, ligar `webviewTag`, aceitar navegação na janela principal ou mexer nas `webPreferences` dela.
- O navegador roubar os atalhos do app ou prender o foco do teclado sem saída.
- Travar ou piscar ao arrastar a divisória do painel.

## Restrições do projeto que valem aqui

- A janela do app é fechada de propósito (ADR 0001 e 0007): não navega, recusa `http:`, nega permissões, e todo canal IPC confere o remetente. Nada disso muda.
- Toda política de rede, navegação e permissão mora em `apps/desktop/src/main/security.ts`, que é o único lugar que registra listeners de `webRequest` (um por evento por sessão).
- Segurança e validação ficam no processo principal; o renderer só apresenta. Contratos novos entram em `packages/contracts`, com schema e canal versionado (`:v1`).
- CSP do renderer: `img-src 'self' data:`, sem estilo inline.
- O banco SQLite é a fonte local de verdade (ADR 0002).
- Windows primeiro. Electron 44.9.0.

---

## Fase 1: o navegador em si

No fim desta fase a pessoa abre a aba Navegador num projeto, digita um endereço (um site ou `localhost:3000`) e navega, com abas, e cada projeto guarda as suas.

### Como a página entra na janela (escolha do desenho)

Cada aba do navegador é uma `WebContentsView` criada e controlada pelo processo principal, presa à janela do app e posicionada por cima de uma área reservada no painel direito. O renderer não hospeda a página: ele só desenha a barra (abas, endereço, botões) e informa ao processo principal o retângulo onde a página deve aparecer.

Motivo: é a forma que isola de verdade. A página roda em outro processo, com outra sessão, sem preload e sem caminho para o IPC do app. A alternativa (`<webview>` dentro do renderer) exigiria ligar `webviewTag` na janela principal, o que enfraquece justamente a fronteira que os ADRs protegem.

Custo conhecido: a `WebContentsView` é desenhada por cima do HTML do app. Qualquer menu, diálogo, paleta ou dica do app que passe sobre a área do navegador ficaria escondido atrás dela. O desenho trata isso assim:

- Enquanto um elemento sobreposto do app está aberto (menu, diálogo, paleta de comandos), a view é escondida e o lugar dela mostra uma imagem parada da página (captura feita pelo processo principal e entregue como `data:`, que a CSP já aceita em `img`).
- As dicas dos botões da barra do navegador abrem para cima ou para o lado, nunca para dentro da área da página.
- A view só fica visível quando tudo isto é verdade: painel direito aberto, aba Navegador escolhida, projeto ativo com uma aba de navegador ativa, nenhuma sobreposição aberta.

### Primeiro, um experimento curto

Antes das tarefas de implementação, a primeira tarefa do plano é um experimento descartável na janela real, como foi feito com o editor. Ele responde três perguntas das quais o resto depende:

1. **Arrastar a divisória.** Com a view visível, arrastar a divisória do painel por cima da área da página continua entregando o movimento do mouse ao app? Se não, a view é trocada pela imagem parada enquanto durar o arrasto.
2. **Teste de ponta a ponta.** O Playwright enxerga a página da `WebContentsView` (para ler título, cookie e conteúdo)? Se não, os testes conferem a página pelo processo principal (`electronApp.evaluate`), e a lista de testes abaixo continua valendo.
3. **Imagem parada.** A captura chega rápido o bastante para a troca não piscar ao abrir um menu? Se não, a captura passa a ser feita antes (ao tirar o foco da página, por exemplo).

O resultado do experimento entra no ADR e pode ajustar os detalhes desta seção, não os objetivos.

### Fluidez

- O retângulo que o renderer mede está em pixels de CSS; o processo principal o converte levando em conta o zoom da janela do app, para a página não ficar deslocada.
- O renderer observa a área reservada (`ResizeObserver`, mais o redimensionar da janela e o arrastar das divisórias) e envia o retângulo novo no máximo uma vez por quadro. O processo principal aplica com `setBounds`.
- Trocar de aba do navegador ou de projeto só troca qual view está visível. As views não são recriadas.
- Trocar de aba do painel direito (para Arquivos, por exemplo) esconde a view; a página continua viva.

### Sessão por projeto

- Cada projeto usa uma sessão própria e persistente do Electron (`persist:navegador-<id do projeto>`). Cookies, armazenamento local, cache e logins ficam nela e não são vistos por outro projeto nem pela janela do app.
- **(escolha do desenho)** A sessão persiste entre aberturas do app: fechar e reabrir mantém os logins, como num navegador comum.
- O menu do navegador tem "Limpar dados de navegação deste projeto", com confirmação, que apaga cookies, armazenamento e cache daquela sessão.
- Remover um projeto do app apaga a sessão dele. Arquivar não apaga.

### Regras de segurança das sessões do navegador

Uma função nova em `security.ts` configura cada sessão de navegador. Ela não reaproveita a CSP nem o filtro de arquivos da janela do app, e a janela do app não muda.

- **Preferências da view.** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, sem preload.
- **IPC.** Nenhum. `registerTrustedHandler` já recusa remetente de outra origem; um teste confirma que a página não tem `window` do preload e que uma chamada forjada recebe `PERMISSION_DENIED`.
- **Protocolos.** Só `http:` e `https:` carregam, mais `about:blank`. `file:`, `data:` como documento, `javascript:`, `chrome:` e `devtools:` são recusados, digitados ou por redirecionamento. Arquivos HTML locais entram pela fase 2, servidos por HTTP local, não por `file:`.
- **Outros protocolos** (`mailto:` e semelhantes) seguem a regra que já existe: diálogo nativo de confirmação, e só os permitidos hoje.
- **Janelas novas.** `window.open` e `target="_blank"` nunca criam janela. Viram uma aba nova no mesmo projeto, respeitando o limite de abas; acima do limite, são ignorados.
- **Permissões.** **(escolha do desenho)** Todas negadas na fase 1 (câmera, microfone, localização, notificações, área de transferência por script). Uma página que peça recebe "negado" sem pergunta.
- **Downloads.** **(escolha do desenho)** Sempre com o diálogo nativo "Salvar como". Nada é salvo em silêncio e nada é aberto depois de baixar.
- **Certificado inválido.** Recusado, com a tela de erro do navegador. Sem botão de "continuar assim mesmo" na fase 1.
- **Autenticação HTTP básica.** Sem suporte na fase 1; a página mostra o 401.
- **Identificação.** **(escolha do desenho)** O agente de usuário é o do Chromium embutido, sem os trechos "Electron" e do nome do app, para os sites não tratarem o navegador como desconhecido.

Limitação conhecida, para dizer à pessoa: alguns provedores de login (o do Google é o caso comum) recusam navegadores embutidos. O navegador não tenta contornar isso.

### Estado e serviço

Um serviço de navegador no processo principal é o dono do estado:

- Por projeto: lista ordenada de abas e a aba ativa.
- Por aba: id, endereço, título, carregando ou não, pode voltar, pode avançar, erro de carregamento (se houver).
- O renderer recebe só esses dados. Nunca recebe o id do `WebContents` nem referência à view.

Persistência **(escolha do desenho)**: a lista de abas de cada projeto (endereço, título, ordem, qual é a ativa) vai para o banco, numa tabela nova ligada ao projeto, apagada junto com ele. O histórico de voltar e avançar de cada aba não é guardado: ao reabrir o app, cada aba volta no último endereço.

Vida das páginas **(escolha do desenho)**:

- Uma aba restaurada do banco só carrega a página quando é mostrada pela primeira vez.
- Depois de carregada, a página fica viva enquanto o app estiver aberto, mesmo com o projeto fora da tela (o estado de um servidor de desenvolvimento em recarga a quente importa).
- Fechar a aba do projeto na barra superior encerra as páginas dele e libera a memória. A lista de abas fica no banco e volta quando o projeto é reaberto.
- Limite de 8 abas por projeto.
- Abas de um projeto que não está na tela ficam sem som.
- Medir o uso de memória com vários projetos abertos é pendência da fase 1; se pesar, a regra de descartar abas paradas entra depois.

### Barra de endereço

O texto digitado é interpretado pelo processo principal, não pelo renderer:

- Com `http://` ou `https://`: usado como está, depois de normalizado pelo parser de URL.
- `localhost`, `127.0.0.1`, `[::1]` e nomes terminados em `.localhost`, com ou sem porta e caminho: recebem `http://`.
- Texto com formato de domínio (tem ponto, sem espaços): recebe `https://`.
- Qualquer outra coisa: vira busca. **(escolha do desenho)** O buscador padrão é o Google, sem tela de escolha na fase 1.
- Protocolo fora da lista permitida: nada carrega e a barra mostra "Este tipo de endereço não abre aqui".

### Canais (em `packages/contracts`, arquivo novo `browser.ts`)

Todos com schema de entrada e de resposta, registrados por `registerTrustedHandler`:

- Ler o estado do navegador de um projeto.
- Abrir aba, fechar aba, escolher aba, reordenar não entra na fase 1.
- Navegar (id da aba e o texto digitado), voltar, avançar, recarregar, parar.
- Informar o retângulo visível (id do projeto e retângulo, ou "escondido"). O processo principal valida que os números são finitos e que o retângulo cabe na área de conteúdo da janela; fora disso, esconde.
- Pedir a imagem parada da aba ativa.
- Abrir as ferramentas de desenvolvedor da aba (janela separada).
- Abrir o endereço atual no navegador do sistema (passa pelo diálogo de confirmação que já existe, com a mesma lista de protocolos).
- Limpar os dados de navegação do projeto.
- Um aviso do processo principal para o renderer quando o estado muda (título, endereço, carregando, abas), no padrão que os avisos de arquivos e de missão já usam.

### Tela

- A barra do painel direito ganha o quinto ícone, "Navegador" (globo), depois de Checks. `RIGHT_TABS` e `TAB_INFO` crescem; a aba escolhida continua lembrada no `localStorage`.
- Dentro da aba, de cima para baixo:
  1. Faixa de abas do navegador: uma por página, com título e botão de fechar, e o botão "Nova aba". Rola na horizontal quando não cabe. Estado de carregando visível na aba.
  2. Linha de navegação: voltar, avançar, recarregar (vira parar enquanto carrega), campo de endereço com o texto de ajuda "Digite uma URL", botão **Expandir** e o menu "Mais ações" (Abrir no navegador do sistema, Inspecionar, Limpar dados de navegação deste projeto).
  3. A área da página.
- **Expandir** **(escolha do desenho)**: o painel direito passa a ocupar toda a largura do corpo da janela, escondendo o centro; o mesmo botão volta ao tamanho anterior. Os terminais continuam montados, só escondidos, como já acontece ao trocar de visão.
- Aba nova sem endereço: área vazia com "Digite uma URL para começar". A fase 2 acrescenta aqui o cartão do servidor de desenvolvimento.
- Falha de carregamento (sem conexão, servidor recusou, endereço não existe): a view some e o renderer mostra o estado de erro do app, com o motivo em palavras simples e "Tentar de novo". Não há página de erro em HTML carregada na view.
- Sem projeto (no Início): "Abra um projeto para usar o navegador".
- Projeto sem nenhuma aba de navegador: abre com uma aba nova vazia.
- Largura: o painel tem mínimo de 260 px. A barra de navegação não quebra nesse tamanho; o campo de endereço encolhe e os botões ficam.

### Teclado e foco

Com o foco dentro da página, as teclas vão para ela. O processo principal intercepta um conjunto pequeno antes da página (`before-input-event`) e o devolve ao app:

- Ctrl+Alt+B: recolhe ou abre o painel direito (o atalho que já existe).
- Ctrl+L: foca o campo de endereço.
- Ctrl+T e Ctrl+W: nova aba e fechar aba do navegador.
- Ctrl+R e F5: recarregar. Alt+Seta esquerda e Alt+Seta direita: voltar e avançar.
- F6: tira o foco da página e devolve à barra do navegador, para quem navega só por teclado ter saída.

Quando a view é escondida com o foco dentro dela (troca de aba do painel, menu aberto), o foco volta para o app, no elemento que provocou a troca.

Esses atalhos só valem com o foco na página ou na barra do navegador; não mudam nada dentro dos terminais.

Acessibilidade: abas do navegador num `tablist` (Radix, como as outras), nomes acessíveis em todos os botões, foco visível, e o estado (carregando, erro) dito em texto, nunca só por cor.

### Testes

- Unidade: interpretação do texto da barra de endereço (cada regra acima, mais os casos recusados); as funções de política da sessão (protocolos, permissões, janelas novas); o serviço de navegador com views falsas (abrir, fechar, escolher, limite de 8, restauração preguiçosa, apagar com o projeto); o repositório da tabela nova; os componentes da aba (faixa de abas, barra, estados vazio e de erro).
- Ponta a ponta (janela real, com `launchApp` e dados descartáveis, e um servidor HTTP local criado pelo próprio teste, sem depender da internet):
  - abrir a aba Navegador, navegar para o servidor local, ver título e endereço na barra;
  - voltar, avançar, recarregar, nova aba, fechar aba;
  - dois projetos: um cookie gravado no navegador de um não existe no do outro;
  - a página não tem acesso ao preload nem ao IPC do app;
  - `file:` e `javascript:` não carregam;
  - `window.open` vira aba, não janela;
  - fechar e reabrir o app restaura as abas e o login (cookie) do projeto;
  - trocar para a aba Arquivos esconde a página; abrir um menu do app sobre a área mostra a imagem parada;
  - Ctrl+Alt+B e F6 funcionam com o foco na página;
  - nenhuma violação de CSP na janela do app.

### Registros

- ADR novo (0012): conteúdo remoto em `WebContentsView` isolada, com sessão por projeto, e por que a janela do app não muda.
- Notas no `brain/`: decisão do navegador interno, arquitetura do serviço, e atualização de `seguranca-janela` e `renderer`.

### Deixado para quem implementar

- Nomes de arquivos, de canais e da tabela; a forma do store no renderer.
- Como detectar "há sobreposição aberta" (um store pequeno que os componentes de menu, diálogo e paleta alimentam, ou outro mecanismo equivalente).
- O texto exato das mensagens de erro, seguindo o tom das que já existem.
- A divisão em tarefas do plano.

---

## Fase 2: preview automático

Intenção **(pessoa)**: abrir o navegador num projeto e ver o preview sem configurar nada. O app descobre o servidor de desenvolvimento, sobe, abre a página, e a página acompanha o código.

Linhas do desenho, a detalhar no desenho próprio da fase:

- **Descoberta.** Ler os scripts do `package.json` (e o gerenciador pelo lockfile) para achar o comando de desenvolvimento. Projeto sem servidor mas com HTML na raiz é tratado como site estático.
- **Onde o servidor roda.** Num painel de terminal do próprio projeto, visível, para a pessoa ver o log e parar quando quiser. "Parar todos" e fechar o projeto encerram como qualquer terminal.
- **Qual endereço abrir.** O app lê a saída do servidor para achar o endereço que ele anuncia e confere se a porta responde. Se a porta já está respondendo antes de subir, só abre.
- **Site estático.** Um servidor HTTP interno do app, só em `127.0.0.1`, numa porta livre, somente leitura e preso à pasta do projeto (com a mesma validação de caminho do serviço de arquivos). Quando um arquivo do projeto muda, o app recarrega as abas que mostram esse endereço, usando o observador de pasta que já existe.
- **Atualização ao vivo.** Com servidor de desenvolvimento, é a recarga a quente dele. No site estático, é a recarga feita pelo app.
- **Onde a escolha fica guardada.** No banco, por projeto. O app não escreve arquivo de configuração dentro do repositório da pessoa.
- **Confiança.** Subir um servidor é rodar código do repositório. **(escolha do desenho, a confirmar com a pessoa)** Só em projeto marcado como confiável, e com um "Usar este comando" na primeira vez em cada projeto; daí em diante é automático. A alternativa, nunca perguntar, fica registrada para ela decidir.

## Fase 3: agentes usando o navegador

Intenção **(pessoa)**: os agentes dos terminais veem e usam o navegador do projeto em que estão, para conferir o próprio trabalho.

Linhas do desenho, a detalhar no desenho próprio da fase:

- **Como o agente alcança.** Um servidor de ferramentas local (MCP), oferecido pelo app em `127.0.0.1`, com um token por terminal e preso ao projeto daquele terminal. O agente só enxerga o navegador do próprio projeto.
- **O que ele pode fazer.** Listar e abrir abas, navegar, ler o texto e a estrutura da página, tirar captura, ler mensagens do console e erros de rede, clicar, digitar e rolar.
- **Ligação com cada programa.** O painel do Claude Code já abre com um arquivo de configuração e variáveis de ambiente; o servidor de ferramentas entra pelo mesmo caminho. Para os outros programas (Codex, Antigravity, OpenCode, Freebuff), o desenho da fase confere o que cada um aceita; quem não aceitar fica sem o recurso, com isso dito na tela.
- **Risco central.** O agente passa a controlar um navegador onde a pessoa pode estar logada, e uma página pode trazer texto escrito para manipular o agente. O desenho da fase decide, com a pessoa: se o agente navega só em endereços locais por padrão, com uma chave por projeto para liberar a internet; se ele usa a mesma sessão da pessoa ou uma separada; e como a tela mostra que um agente está no controle.
- **Missões.** Os agentes de missão (`claude -p`) recebem o mesmo recurso depois dos terminais avulsos.

## Ordem

1. Fase 1, um PR.
2. Fase 2, com desenho próprio, um PR.
3. Fase 3, com desenho próprio, um PR.

Cada fase funciona sozinha: depois da 1 a pessoa já navega; depois da 2 o preview é automático; depois da 3 os agentes participam.
