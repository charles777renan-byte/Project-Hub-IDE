# Navegador interno, fase 3: agentes usando o navegador

Pedido da pessoa em 2026-11-14: "vamos para a fase 3". As fases 1 (o navegador em si) e 2 (preview automático) estão na `main`. Esta fase faz o que o desenho geral, em `2026-11-12-navegador-interno-design.md`, deixou como intenção: os agentes dos terminais veem e usam o navegador do projeto em que estão, para conferir o próprio trabalho.

Marcação usada abaixo: **(pessoa)** é o que ela disse ou escolheu na conversa; **(escolha do desenho)** é uma decisão tomada ao escrever, que ela ainda pode trocar.

## Por quê

Hoje o agente escreve a página e não a vê. Quem confere é a pessoa, que olha o preview e volta ao terminal para descrever o que está errado. Com o navegador ao alcance do agente, ele abre a página que acabou de mudar, lê o que apareceu, vê os erros do console e corrige antes de dizer que terminou.

## Objetivos

- **(pessoa)** O agente de um terminal vê e usa um navegador do projeto em que está.
- **(pessoa)** O agente navega em qualquer endereço desde o início, local ou da internet. Não há chave por projeto para liberar a internet.
- **(pessoa)** O agente tem uma sessão separada da pessoa, uma por projeto: abas e cookies próprios. Ele chega deslogado em todo site e não alcança os logins dela.
- **(pessoa)** A pessoa vê as abas do agente na aba Navegador, marcadas como do agente.
- **(pessoa)** O agente usa o navegador em segundo plano, sempre: as páginas dele continuam vivas com a pessoa em outro projeto, com o painel direito fechado ou com a janela minimizada.
- **(pessoa)** Há um limite de abas do agente por projeto, e elas fecham quando o terminal termina.
- **(pessoa)** O agente alcança o navegador por um servidor de ferramentas (MCP) dentro do processo principal do app, em `127.0.0.1`. Cada terminal de agente recebe o endereço e um token só dele, preso ao projeto daquele terminal.

## Fora do escopo desta fase

- Agentes de missão (`claude -p`). Recebem o recurso depois dos terminais avulsos, num trabalho próprio. O planejador continua com `--strict-mcp-config`.
- O agente ver ou controlar as abas da pessoa.
- Antigravity, OpenCode e Freebuff (ver "Ligação com cada programa").
- O agente subir o servidor de desenvolvimento pelo navegador. Ele já pode rodar o comando no próprio terminal, e o preview da fase 2 continua sendo da pessoa.
- Uma ponte por terminal (um programa pequeno que fala com o app por entrada e saída padrão). Só entra se um programa aceitar apenas esse formato.
- Baixar arquivos, enviar arquivos e imprimir pelo navegador do agente.

## O que tornaria isto um fracasso, mesmo funcionando

- O agente de um projeto alcançar o navegador de outro projeto, ou os cookies e logins da pessoa.
- Uma página aberta no navegador, da pessoa ou do agente, conseguir chamar o servidor de ferramentas.
- As páginas do agente aparecerem por cima da interface, roubarem o foco do teclado ou piscarem na tela enquanto a pessoa trabalha.
- A captura de tela voltar vazia quando a página não está à vista. Foi o caso em quase todos os arranjos testados (ver "Onde as páginas do agente vivem").
- Abas do agente sobrarem abertas depois que o terminal fechou.
- O terminal do Claude Code deixar de abrir porque o navegador falhou. O terminal vale mais que o navegador, como já vale para o gasto de tokens.

## Restrições do projeto que valem aqui

- Nenhum canal de IPC leva texto de comando. O comando do terminal é montado só no processo principal.
- O app nunca escreve num terminal aberto.
- O app não escreve arquivo de configuração no repositório da pessoa nem na configuração global de um programa dela.
- Segredo não vai na linha de comando, que outros processos leem. Vai no ambiente do terminal.
- Servidor local só em `127.0.0.1`.
- O que vem de uma página é dado não confiável, inclusive para o agente.
- Nenhum `input`, `select` ou barra com a aparência padrão do navegador na interface do app.
- As regras de segurança das sessões do navegador da fase 1 (seção "Regras de segurança das sessões do navegador" do desenho geral) valem para a sessão do agente.

## Abordagens

Três maneiras de o agente alcançar o navegador foram postas à pessoa.

1. **Servidor de ferramentas no app.** O processo principal abre um servidor MCP em `127.0.0.1`. Cada terminal de agente recebe o endereço e um token próprio. Custa um servidor HTTP a mais no processo principal e depende de o programa aceitar servidor por endereço. Em troca, o navegador e as ferramentas ficam no mesmo processo, sem intermediário.
2. **Ponte por terminal.** O app entrega a cada terminal um programa pequeno, que o agente abre como servidor de ferramentas por entrada e saída padrão, e que repassa as chamadas ao app. Serve a qualquer programa, mas é um processo a mais por terminal, um arquivo executável a manter e um segundo protocolo entre a ponte e o app.
3. **Comando de linha.** Um comando `hub-browser` no caminho do terminal, que o agente chama pelo shell. Não depende de MCP, mas o agente precisa ser ensinado a usá-lo, a captura de tela vira arquivo em disco e cada chamada sobe um processo.

**(pessoa)** Escolhida a primeira: "Servidor no app". Começa pelo Claude Code. A ponte da segunda só é acrescentada para um programa que aceite apenas aquele formato.

## Desenho

### Visão geral

```
terminal do agente ──HTTP em 127.0.0.1, com token──▶ servidor de ferramentas (processo principal)
                                                        │ token → terminal → projeto
                                                        ▼
                                              navegador do agente daquele projeto
                                              (sessão própria, abas próprias)
                                                        │
                        ┌───────────────────────────────┴──────────────────────────────┐
                        ▼                                                              ▼
          janela de apoio, fora do monitor                              aba Navegador do painel direito
          (onde as páginas vivem em segundo plano)                      (quando a pessoa escolhe a aba do agente)
```

### Servidor de ferramentas

- Vive no processo principal, ao lado do serviço do navegador, e sobe junto com o app, numa porta livre de `127.0.0.1`.
- Fala MCP por HTTP (o transporte "Streamable HTTP"), sem estado de sessão no servidor: cada chamada traz o token. **(escolha do desenho)** Usa a biblioteca oficial do protocolo, em vez de uma implementação própria. É uma dependência nova do app.
- Aceita uma chamada só quando: o cabeçalho `Authorization: Bearer <token>` traz um token vivo; o cabeçalho `Host` é `127.0.0.1:<porta>`; e não há cabeçalho `Origin`. As duas últimas barram uma página de navegador que tente chamar o servidor. Chamada recusada responde 401 ou 403 sem dizer o motivo.
- O token tem 32 bytes aleatórios, é gerado no processo principal quando o terminal abre e morre quando o terminal termina. A comparação é em tempo constante. O registro guarda `token → { terminal, projeto }`, e é só dele que sai o projeto de uma chamada: nenhuma ferramenta recebe identificador de projeto.
- O servidor não registra em log o token, o texto digitado nem o conteúdo das páginas.

### Ferramentas

Os nomes abaixo são os que o agente vê. Toda ferramenta que age numa aba recebe o identificador da aba, e só aceita aba daquele terminal.

| Ferramenta | O que faz |
| --- | --- |
| `browser_tabs` | Lista as abas deste terminal (identificador, endereço, título, se está carregando) e informa o endereço do preview do projeto, quando a fase 2 conhece um. |
| `browser_open` | Abre uma aba num endereço. Falha com mensagem clara quando o limite de abas foi atingido. |
| `browser_close` | Fecha uma aba deste terminal. |
| `browser_navigate` | Vai a um endereço, volta, avança ou recarrega. Espera a página carregar, com um tempo máximo, e devolve o endereço final e o título. |
| `browser_read_text` | Devolve o texto visível da página. |
| `browser_snapshot` | Devolve a estrutura da página como árvore de acessibilidade, com uma referência por elemento que dá para clicar ou preencher. |
| `browser_screenshot` | Devolve a imagem da área visível da página. |
| `browser_console` | Devolve as mensagens recentes do console e os erros de script. |
| `browser_network_errors` | Devolve as requisições recentes que falharam ou responderam com status 400 ou maior. |
| `browser_click` | Clica num elemento, por referência do `browser_snapshot` ou por coordenada. |
| `browser_type` | Digita texto no elemento em foco ou numa referência. |
| `browser_press_key` | Aperta uma tecla (Enter, Tab, Escape, setas). **(escolha do desenho)** Não estava na lista do desenho geral; sem ela o agente não envia um formulário que só responde ao Enter. |
| `browser_scroll` | Rola a página ou um elemento. |

Regras comuns:

- Os endereços passam pela mesma validação da barra de endereço da pessoa (`browser/address.ts`). O que a barra recusa, a ferramenta recusa.
- Texto, estrutura, console e rede têm tamanho máximo na resposta. O que passa é cortado, e a resposta diz que cortou.
- Console e rede guardam só as entradas mais recentes de cada aba, e zeram a cada navegação para outro documento.
- Erro de ferramenta volta como erro do protocolo, com mensagem em português que o agente consiga usar ("Limite de 4 abas do agente neste projeto. Feche uma com browser_close.").
- A descrição de cada ferramenta, que o agente lê, avisa que o conteúdo da página é dado e não instrução.

### Sessão do agente

- Uma sessão por projeto, separada da sessão da pessoa (`persist:navegador-<id>`), sem preload e com as mesmas regras de segurança.
- **(escolha do desenho)** A sessão do agente fica só em memória: fechar o app apaga cookies e armazenamento. O agente entra de novo no app em teste a cada execução, e nada dele fica guardado em disco.
- "Limpar dados de navegação deste projeto" limpa também a sessão do agente daquele projeto.
- Downloads são recusados. Hoje `configureBrowserSession` deixa o Electron abrir o "Salvar como"; a sessão do agente ganha um `will-download` que cancela.
- **(escolha do desenho)** Nada que uma página do agente peça abre diálogo para a pessoa. `mailto:` e links externos (que na sessão da pessoa abrem uma confirmação nativa), `alert`, `confirm`, `prompt` e o pedido de login HTTP são descartados em silêncio, e o descarte aparece no `browser_console` daquela aba.

### Abas do agente

- Cada aba pertence ao terminal que a abriu. Um terminal só lista e controla as suas. **(escolha do desenho)** Dois agentes no mesmo projeto dividem a sessão (cookies), mas não mexem nas abas um do outro.
- **(escolha do desenho)** Limite de 4 abas do agente por projeto, somando os terminais.
- Quando o terminal termina, por qualquer caminho (a pessoa fechou, "Parar todos", o projeto foi fechado, o processo morreu), o token é revogado e as abas dele são destruídas. O fim chega por `TerminalPort.listen` (`onExit`) e por `closeSession`.
- **(pessoa)** Reiniciar o app tira o navegador dos agentes que já estavam abertos. Os terminais vivem num processo próprio e sobrevivem ao app, mas o servidor de ferramentas, os tokens e as abas do agente vivem no processo principal e só em memória. O terminal recuperado segue funcionando, sem o navegador: as chamadas do agente falham, e a tela avisa, no cabeçalho do terminal recuperado e no cartão "Agentes e o navegador", que um terminal novo devolve o recurso. O token nunca vai para o disco e a porta não é fixa. A alternativa, manter o navegador com porta fixa e tokens gravados, foi posta a ela e recusada.
- Ao fechar, o app destrói as abas do agente, a janela de apoio e os arquivos de servidores que gravou.
- As abas do agente não são guardadas no banco. Reabrir o app não as traz de volta.
- **(escolha do desenho)** A página do agente tem 1280 por 800 enquanto vive em segundo plano.

### Onde as páginas do agente vivem

O serviço do navegador de hoje mostra um projeto por vez e só cria a página da aba visível. A página do agente precisa existir e ser desenhada sem estar na tela. Um experimento descartável, feito no Electron do projeto (44.9, Windows 11) e fora do código do app, mediu o que funciona:

| Arranjo | Captura | Clique e leitura |
| --- | --- | --- |
| View solta, sem janela | falha | funciona |
| View em janela escondida | falha | funciona |
| View invisível (`setVisible(false)`) na janela principal | falha | funciona |
| View de 1 por 1 na janela principal, com tamanho emulado | funciona só com a janela principal à vista | funciona |
| View em uma **janela de apoio fora do monitor** | **funciona com a janela principal à vista, minimizada ou escondida** | **funciona** |

"Captura" aqui é a do protocolo de depuração do Chromium (`Page.captureScreenshot`, por `webContents.debugger`). A captura nativa (`capturePage()`) falhou também na janela de apoio.

Daí o desenho:

- O app mantém uma janela de apoio: sem moldura, sem foco, fora da barra de tarefas, posicionada fora de qualquer monitor e mostrada sem ativar. Ela é criada na primeira aba de agente e destruída quando não resta nenhuma.
- Toda página de agente vive nessa janela enquanto não está sendo olhada pela pessoa.
- Quando a pessoa escolhe a aba do agente na aba Navegador, a view é movida para a janela principal, na área do painel. Quando ela escolhe outra aba, troca de projeto ou fecha o painel, a view volta para a janela de apoio. O experimento confirmou a ida e a volta, com captura e clique funcionando nos dois lados.
- Enquanto a pessoa olha, a página tem o tamanho do painel, e a captura sai nesse tamanho. O clique por referência recalcula a posição na hora, então não depende do tamanho.
- O depurador fica ligado à página do agente enquanto ela existe. É por ele que saem a captura, o console, a rede e a estrutura.
- O clique, a digitação e a rolagem entram por `sendInputEvent`, que funcionou em todos os arranjos.
- A captura do agente é um caminho novo, pelo depurador. O `capture()` de hoje (`browser-views.ts`), que usa `capturePage()` para a imagem parada da pessoa, continua como está.
- A coleção de abas do agente fica fora do estado de projeto que `browser.suspendProject` derruba ao fechar a área de trabalho. Quem a encerra é o fim do terminal.
- **(escolha do desenho)** Esta fase vale para o Windows, que é a plataforma medida e a primeira do projeto ("Windows primeiro" na especificação). No macOS e no Linux o recurso fica desligado, com isso dito no cartão "Agentes e o navegador", até o mesmo experimento ser repetido em cada um: no macOS a janela pode ser puxada de volta para a tela, e no Wayland o app não escolhe a posição da janela.

O primeiro passo do plano repete esse experimento dentro do app de verdade, antes de construir o resto: abrir a janela de apoio, conferir que ela não aparece na tela, na barra de tarefas nem na troca de janelas (Alt+Tab), e que a captura funciona com a janela principal minimizada. Se a janela de apoio aparecer para a pessoa em algum desses lugares, o trabalho para e volta para ela, porque os outros arranjos medidos não capturam.

### Ligação com cada programa

O que foi conferido na documentação de cada um, em 2026-11-14:

| Programa | Aceita servidor por endereço, com token | Como entraria | Nesta fase |
| --- | --- | --- | --- |
| Claude Code | sim | arquivo passado por `--mcp-config`, gravado na pasta de configuração do app; o token vem de uma variável de ambiente | **sim** |
| Codex | sim (`url` e `bearer_token_env_var`) | opções de configuração na linha de comando do próprio Codex, só com o endereço e o nome da variável; o token vai no ambiente | **sim, se o teste confirmar** |
| Antigravity | sim (`serverUrl` e `headers`) | só por arquivo na configuração global dele ou em `.agents/` dentro do repositório, com o token escrito no arquivo | não |
| OpenCode, Freebuff | não conferido | — | não |

- **Claude Code.** O painel já abre com `--settings` e variáveis de ambiente (`withUsageHooks` em `terminals.ts`). O servidor entra pelo mesmo caminho: um arquivo de servidores gravado na mesma pasta do `--settings`, e `PROJECT_HUB_BROWSER_URL` e `PROJECT_HUB_BROWSER_TOKEN` no ambiente. O arquivo cita a variável do token, e não o valor. Quem implementa confirma, com um teste, que o Claude Code expande a variável nesse arquivo. Se não expandir, o token vai no arquivo, que fica na pasta de dados do app e é apagado quando o terminal termina. Os servidores do próprio projeto (`.mcp.json`) continuam valendo: o do app é somado, não substitui.
- **(escolha do desenho)** O arquivo de `--settings` do painel passa a permitir as ferramentas deste servidor, para o Claude Code não pedir confirmação a cada chamada. Sem isso, "em segundo plano, sempre" viraria uma pergunta por clique.
- **Codex.** **(escolha do desenho)** Entra nesta fase pelo mesmo servidor, se o teste de quem implementa confirmar que as opções de linha de comando funcionam na versão instalada. Se não confirmar, fica de fora, com isso dito na tela, e sem atrasar o Claude Code.
- **Antigravity.** **(escolha do desenho)** Fica de fora: o único caminho escreve o token num arquivo do repositório da pessoa ou da configuração global dela, e as duas coisas contrariam as restrições acima.
- Qualquer falha ao ligar o navegador abre o terminal como hoje, sem o recurso, e registra um aviso.
- Terminal de shell não recebe token.

### Tela

- **Faixa de abas.** As abas do agente do projeto aparecem depois das abas da pessoa, com um ícone de agente e o texto "Agente" antes do título. A dica da aba diz de qual terminal ela é.
- **(escolha do desenho)** A pessoa pode olhar, interagir com a página e fechar qualquer aba do agente. Fechar uma aba que o agente está usando devolve erro na próxima chamada dele.
- **Barra de endereço numa aba do agente.** Mostra o endereço e aceita navegação da pessoa, como numa aba dela. Uma linha de aviso (`role="status"`) abaixo da barra diz "Aba de um agente. A sessão dela é separada da sua."
- **Aba Navegador do painel direito.** **(escolha do desenho)** Ganha um ponto de atividade enquanto houver aba de agente no projeto aberto, para a pessoa saber que há um agente no navegador sem abrir o painel.
- **Programas sem o recurso.** **(escolha do desenho)** O menu "Mais ações" do navegador ganha o item "Agentes e o navegador", que abre um cartão curto com quais programas alcançam o navegador e quais não. É onde fica "dito na tela" o que o desenho geral pediu.
- "Nova aba" e os atalhos de aba continuam criando abas da pessoa. A pessoa não cria aba de agente.
- O visual segue o refinamento de 2026-11-14: só tokens em `browser.css`, lima só para foco e ação primária, nenhum campo com aparência padrão.

### Estado e canais

- O estado das abas do agente entra no mesmo estado do navegador que o renderer já recebe, com um campo que diz de quem é a aba (`person` ou `agent`) e, para a do agente, o nome do terminal. Os canais ficam em `packages/contracts/browser.ts`, validados com zod.
- Os canais novos levam só identificadores e escolhas de tela (selecionar aba, fechar aba). Nenhum leva endereço do servidor de ferramentas, token nem texto de comando. O renderer nunca vê o token.
- O serviço do navegador ganha uma segunda coleção de abas por projeto, a do agente, que não depende de o projeto estar na tela. As abas da pessoa continuam como estão.

### Riscos e como ficam

| Risco | Como fica |
| --- | --- |
| Página com texto escrito para manipular o agente | Sessão separada, sem os logins da pessoa. Descrição das ferramentas avisa que página é dado. O agente continua com os mesmos poderes de terminal que já tinha; o navegador não lhe dá nenhum novo sobre a máquina. |
| Página chamando o servidor de ferramentas | Token obrigatório, conferência de `Host`, recusa de `Origin`. |
| Outro processo da máquina chamando o servidor | Token obrigatório, que só existe no ambiente do terminal. É o mesmo nível de proteção do receptor de hooks. |
| Agente de um projeto no navegador de outro | O projeto sai do token, nunca de um parâmetro. |
| Janela de apoio visível para a pessoa | Conferido no primeiro passo do plano, com parada se aparecer. |
| Páginas do agente gastando memória | Limite de 4 por projeto e destruição ao fim do terminal. |

### Testes

- **Unidade.** Registro de tokens (criar, resolver, revogar, comparação). Cada ferramenta, com páginas falsas: limite de abas, aba de outro terminal recusada, endereço inválido recusado, corte de tamanho. Montagem do comando e do ambiente de cada programa, conferindo que o token nunca aparece nos argumentos.
- **Integração.** O servidor HTTP de verdade: sem token, token revogado, `Host` errado, `Origin` presente, dois tokens de projetos diferentes que não se enxergam.
- **Ponta a ponta.** Com o agente falso dos E2E (`e2e/fixtures/fake-claude-agent.mjs`), estendido para chamar o servidor a partir do ambiente que recebeu: abrir uma aba num site local de teste, ler o texto, clicar, capturar, e conferir que a captura não está vazia com o painel direito fechado e com outro projeto na tela. Conferir a aba marcada "Agente" na faixa, que fechar o terminal some com a aba e que os cookies da pessoa não aparecem na sessão do agente.
- **No app.** Depois do desenvolvimento, `pnpm dev` e um Claude Code de verdade usando o navegador num projeto de teste.

### Registros

- ADR 0014, sobre o servidor de ferramentas no processo principal e a janela de apoio.
- Nota de arquitetura do navegador em `brain/arquitetura/navegador.md` e o diário da sessão.

## Deixado para quem implementar

- Como extrair a estrutura da página e gerar as referências (árvore de acessibilidade pelo depurador ou um script injetado), desde que a referência sirva para clicar e digitar.
- Tamanhos máximos das respostas, quantas entradas de console e de rede guardar, e o tempo máximo de espera de uma navegação.
- Formato e compressão da captura.
- Nomes dos módulos novos em `apps/desktop/src/main/browser/` e a divisão entre eles.
- O ícone da aba do agente e o texto exato do cartão "Agentes e o navegador".
- A coordenada exata da janela de apoio e o que fazer quando a disposição dos monitores muda.
