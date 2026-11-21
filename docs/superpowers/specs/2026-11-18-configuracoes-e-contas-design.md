# Configurações e contas: desenho

Data: 2026-11-18, revisado em 2026-11-21 depois da leitura de construtor. Estado: aprovado pela pessoa em 2026-11-21.

## Intenção

O app não tem um lugar para os ajustes que valem para tudo. As preferências estão espalhadas (a confirmação ao fechar, o modo da barra lateral) e o login de cada programa de IA é feito fora do app, numa conta só por programa.

A pessoa tem mais de uma assinatura e quer conectar as contas **dentro do app**, usar duas ao mesmo tempo e trocar entre elas. Quer o mesmo para o GitHub, com a conta certa em cada projeto. Pediu que isso seja feito "mantendo a máxima segurança possível".

## Metas

1. Uma área **Configurações**, aberta por uma engrenagem no pé da barra lateral, com as seções **Contas** e **Geral**.
2. Várias contas do **Claude Code** e do **Codex**, cada uma com nome próprio. Dá para abrir um painel ou iniciar uma missão em qualquer uma, e ter duas em uso ao mesmo tempo.
3. Conectar, conferir e desconectar uma conta sem sair do app, pelo login oficial de cada programa.
4. Várias contas do **GitHub**, com a conta escolhida em cada projeto.
5. A conta que já existe na máquina segue funcionando como hoje, sem a pessoa precisar fazer nada.

## Fora do escopo

- Várias contas do Antigravity, do OpenCode e do Freebuff. A tela mostra só se estão instalados.
- Copiar ajustes, histórico ou servidores MCP da conta Principal para uma conta nova. A conta nova começa vazia no programa.
- Trocar a conta de um painel ou de uma missão que já está rodando. A conta é escolhida na abertura.
- Login por chave de API ou por token colado.
- Limites por execução (RF-AGT-005) e as outras categorias de Configurações da especificação (aparência, caminhos, retenção, diagnósticos). Entram depois, como seções novas.
- A melhoria da barra lateral, além da engrenagem. É a próxima frente.
- Autor dos commits (`user.name` e `user.email`). A conta do GitHub decide a credencial, e não a autoria.

## O que não pode acontecer

- Uma senha ou um token passar pelo app, de qualquer forma.
- Um código de autorização ou de uso único ser gravado: no banco, em log, na auditoria, num aviso ou no histórico de um terminal. Ele só existe na memória, enquanto o login está aberto.
- Uma sessão rodar numa conta diferente da que a pessoa escolheu. Se a conta não existe mais, a abertura falha com mensagem clara. Ela nunca cai na Principal em silêncio.
- A conta Principal (a pasta do programa na máquina) ser movida, copiada ou apagada.
- O app apagar uma pasta fora da área de contas dele.
- A tela informar um caminho de pasta, um comando ou uma variável de ambiente ao processo principal.
- A configuração global do Git mudar por causa do app.
- O `gh` da máquina terminar numa conta diferente da que estava. A única mexida permitida é o reparo de "GitHub: o cofre do Windows e o reparo".

## Restrições

- Electron com CSP estrita: sem estilo inline. Nenhum campo, seleção ou barra com a aparência padrão do navegador.
- Interface em português do Brasil. Estado comunicado por forma e rótulo, e não só por cor.
- Canais de IPC com schema Zod estrito e sufixo `:v1`, como os atuais.
- Os terminais recebem só as variáveis de `TERMINAL_ENV_ALLOWLIST` (`apps/desktop/src/terminal-host/env.ts`), mais as extras que o processo principal passa.
- Só existe tema escuro. A tela usa os tokens de `renderer/styles/tokens.css`. Lima só em ação principal, estado ativo e foco.

## O que foi conferido na máquina (2026-11-18)

| Programa | Pasta da conta | Login | Estado | Sair |
|---|---|---|---|---|
| Claude Code 2.1.323 | `CLAUDE_CONFIG_DIR` | `claude auth login` | `claude auth status --json` (`loggedIn`, `email`, `orgName`) | `claude auth logout` |
| Codex 0.169.0 | `CODEX_HOME` | `codex login` | `codex login status` (só "Logged in using ChatGPT") | `codex logout` |
| GitHub CLI 2.92.0 | `GH_CONFIG_DIR` | `gh auth login --web` | `gh auth status`, `gh api user` | `gh auth logout` |

- Com a variável apontando para uma pasta vazia, os três informam "sem login". A pasta isola a conta.
- O Claude Code informa o e-mail da conta pelo comando de estado. O app não precisa abrir nenhum arquivo dele.
- O **Codex não informa qual conta está conectada**. O e-mail só existe dentro do arquivo de credencial, que o app não abre. A conta do Codex aparece só com o nome que a pessoa deu.
- **O GitHub CLI guarda no cofre do Windows uma única entrada "ativa" por servidor** (`gh:github.com:`), para a máquina toda. Duas pastas `GH_CONFIG_DIR` usando o cofre disputam essa entrada.
- **Todo login do `gh` apaga essa entrada ativa**, mesmo com `--insecure-storage` e em outra pasta (`activateUser`, em `internal/config/config.go` da versão 2.92.0, lido no código-fonte). O `gh auth logout` também apaga. A entrada por usuário (`gh:github.com:<usuario>`) fica. Sem tratamento, conectar uma conta extra deixaria o `gh` da pessoa sem login fora do app. Ver "GitHub: o cofre do Windows e o reparo".
- Não foi conferido: o texto exato que cada comando de login imprime (o endereço, o pedido de código). Rodar o login abre o navegador da pessoa. Fica como primeira tarefa do plano.

## Caminhos considerados

**A. Uma pasta de dados por conta (escolhido).** Cada conta extra tem uma pasta própria, e o app abre o programa com a variável apontando para ela. É o mecanismo oficial dos três programas e o código já respeita essas variáveis nos leitores de uso, de atividade e de limites. As contas rodam juntas sem conflito. O custo: a conta nova começa sem os ajustes e o histórico da Principal.

**B. Trocar o arquivo de credencial na pasta única.** O app guardaria uma cópia da credencial de cada conta e trocaria na hora de usar. Mantém ajustes e histórico juntos, mas o app passa a guardar e mover tokens, e só uma conta funciona por vez. Vai contra a segurança e contra o uso de duas contas ao mesmo tempo.

**C. Perfis do sistema ou contêineres.** Isola tudo, mas é pesado, lento para abrir e estranho ao resto do app.

A pessoa escolheu A.

## Como funciona

### Navegação

- **Engrenagem** no pé da barra lateral, à direita de "Arquivados", e no pé do trilho quando a lateral está recolhida. Dica: "Configurações", atalho `Ctrl+,`.
- Abre a rota `/settings` (com `/settings/contas` e `/settings/geral`). Enquanto aberta, aparece na barra de cima como uma aba "Configurações" com a engrenagem, que fecha como as abas de projeto.
- A paleta de comandos ganha "Abrir Configurações".
- A página tem uma navegação à esquerda (Contas, Geral) e o conteúdo à direita.

### Seção Geral

Reúne o que já existe, sem mudar onde é guardado:

- **Ao fechar**: a confirmação de `close-confirm.ts`.
- **Barra lateral**: Lista ou Grade, a mesma preferência do alternador da lateral.
- **Pasta de dados**: o caminho, com "Abrir pasta". O processo principal abre a pasta que ele mesmo conhece. A tela não manda caminho.
- **Versão** do app.

### Seção Contas

Um grupo por programa: Claude Code, Codex, GitHub e "Outros programas".

Cada conta é uma linha com o nome, a identidade que o programa informa (e-mail no Claude Code, `@usuario` no GitHub, nada no Codex), o uso da assinatura (as barras que já existem, por conta), o estado e um menu de ações.

- Estados: **Conectada**, **Sem login**, **Conectando**. Cada um com marca de forma própria e rótulo.
- A conta **padrão** de cada programa leva a etiqueta "Padrão". É a que vem marcada ao abrir um painel ou uma missão.
- "Adicionar conta" pede só um nome (1 a 40 caracteres, único no programa).
- Menu de uma conta extra: Renomear, Definir como padrão, Desconectar, Remover conta.
- "Outros programas" mostra Instalado ou Não instalado, com o que `providers.resolve` já sabe.

### O modelo de dados

- Tabela nova `accounts`: `id` (UUID gerado pelo app), `provider` (`claude-code`, `codex`, `github`), `name`, `created_at`, `removed_at`.
- A **Principal não tem linha nem pasta**. Em todo lugar, conta nula significa Principal: o programa roda com o ambiente de hoje. Assim, nada do que já existe precisa de migração de dados.
- A conta padrão de cada programa fica em `app_settings` (`accounts.default.<provider>`). Sem a chave, a padrão é a Principal.
- O banco guarda só id, programa e nome. **E-mail e usuário não são gravados**: são lidos do programa quando a tela precisa e ficam só na memória.
- Pasta de cada conta extra: `<pasta de dados do app>/accounts/<provider>/<id>/`.

### De id para ambiente: um lugar só

Uma função no processo principal recebe `(provider, accountId | null)` e devolve as variáveis extras:

- `claude-code`: `CLAUDE_CONFIG_DIR`
- `codex`: `CODEX_HOME`
- `github`: `GH_CONFIG_DIR`
- conta nula: nenhuma variável (o comportamento de hoje)

É o único ponto em que um id vira caminho. Conta desconhecida ou removida devolve erro. Todo o resto do app chama essa função: a abertura de painel, o agente de missão, o planejador, os leitores de uso, de atividade e de limites, o `gh` e o `git`.

### Onde a conta é usada

- **Painel**: o menu "Novo painel" abre a lista de contas quando o programa tem mais de uma, com a padrão marcada. `openSession` recebe o `accountId`, grava em `terminal_sessions.account_id` e devolve o nome da conta no resumo do terminal. O título do painel e a barra lateral mostram "Claude Code · Trabalho". A retomada de uma sessão usa a conta com que ela foi aberta, e o layout guardado leva a conta junto.
- **Missão**: o bloco "Sua decisão" ganha "Conta do Claude Code", com o uso de cada conta ao lado. A missão guarda a conta, e o planejador e o agente rodam nela.
- **Aba Sessões e atividade dos agentes**: os leitores de sessões (`createClaudeSessionReader`, `createCodexSessionReader`), o índice do histórico e `agent-activity.ts` leem hoje uma pasta por programa. Passam a ler a Principal e a pasta de cada conta extra, e cada sessão sai marcada com a conta em que foi achada. Retomar por essa aba abre o programa **na conta em que a sessão foi achada**, inclusive sessões que o app não abriu.
- **Uso**: o gasto de cada terminal é lido da pasta da conta dele.
- **Limites**: lidos por conta. A leitura do Claude Code é uma chamada de verdade ao programa e gasta da assinatura. Por isso, só a conta padrão e as contas com sessão viva se atualizam sozinhas. As outras são lidas quando a seção Contas está aberta ou quando a pessoa pede, e a linha mostra a idade da leitura. O indicador da barra de estado mostra a conta padrão; o aviso de cota do planejador usa a conta da missão.
- **Conta removida**: uma sessão antiga dela mostra "A conta foi removida" e não retoma.

### Login

O login é o do próprio programa, no navegador padrão do sistema. O app não mostra a página de login dentro dele.

1. A pessoa clica em **Conectar**. O processo principal inicia o comando de login do programa (tabela acima), num terminal do app, com a variável da conta. O comando e os argumentos são fixos no processo principal.
2. O programa abre o navegador. A tela mostra o passo "Entre pelo navegador", com o servidor de destino, "Abrir de novo" e "Copiar endereço". No GitHub, mostra o código de uso único e `github.com/login/device`.
3. O comando termina. O app roda o comando de estado da conta. **O estado vem desse comando, nunca do texto do login.**
4. A tela mostra o passo "Confira a conta conectada", com a identidade que o programa informa. "Concluir" encerra. "Não é esta conta" roda o comando oficial de saída e recomeça.

Regras:

- O processo principal lê a saída do login só para achar **um endereço** e, no GitHub, **o código de uso único**. O endereço só vira botão se for `https` e o servidor estiver na lista do programa (a confirmar no plano: `claude.ai` e `claude.com`; `auth.openai.com`; `github.com`). Fora da lista, os botões não aparecem e a pessoa segue pelo terminal do programa.
- A saída do login não vai para o banco, para log nem para a auditoria. O endereço e o código ficam na memória só enquanto o login está aberto.
- O terminal do login não é uma sessão de painel: não tem linha em `terminal_sessions`, não é restaurado e o histórico dele é descartado quando o login termina.
- Esse terminal fica atrás de "Ver o terminal do programa". Se o programa pedir um código para colar, a pessoa cola ali. O código passa pela memória do app a caminho do programa e não é gravado. É de uso único e só serve para o programa que pediu o login.
- Aviso fixo no passo do navegador: se o navegador já está em outra conta, copiar o endereço e abrir numa janela anônima.
- O login expira em 10 minutos. "Cancelar" e o prazo matam a árvore do processo.
- Um login por vez.
- Se a identidade for igual à de outra conta do mesmo programa, o passo de conferência avisa ("É a mesma conta de Principal"). Vale para o Claude Code e o GitHub. No Codex, o passo diz "Conectada pelo ChatGPT. O Codex não informa qual conta."
- Falha de login mostra uma frase fixa do app. Nenhum texto do programa vai para aviso ou auditoria.

### Desconectar e remover

- **Desconectar** fica bloqueado enquanto houver sessão viva dessa conta, e a tela lista quais são.
  - Claude Code e Codex: roda o comando oficial de saída, com a variável da conta.
  - Conta extra do GitHub: o app apaga o arquivo de login da pasta da conta (`hosts.yml`), sem abri-lo. Não roda `gh auth logout`, que mexeria no cofre.
- **Remover conta** pede confirmação, dizendo o que se perde (o histórico e os ajustes daquela conta no programa). Exige as sessões fechadas, desconecta e só então apaga a pasta. A linha fica com `removed_at`. Se era a padrão, a padrão volta para a Principal.
- Se o comando de saída falhar durante a remoção (sem rede, programa quebrado), o app diz isso e pergunta se remove mesmo assim. Remover apaga a pasta, com o login guardado nela.
- Desconectar e remover tiram o login **deste computador**. Não cancelam o acesso no serviço. A confirmação diz isso com uma frase fixa e, no GitHub, indica onde revogar (Settings, Applications).
- Antes de apagar, o processo principal confere que o caminho resolvido é filho direto de `accounts/<provider>/`, que o nome é um UUID e que não é link nem junção. Se algo não bater, não apaga e informa o erro.
- A **Principal** não tem Renomear nem Remover. Tem Conectar, quando está sem login, e Desconectar, com uma confirmação a mais: sair dela também desconecta o programa fora do app.

### GitHub: conta por projeto

- Cada projeto tem "Conta do GitHub" nas Configurações do projeto (`projects.github_account_id`). **Nulo é a Principal**, como no resto do app.
- A conta padrão do GitHub só decide com qual conta um **projeto novo** começa: o valor é copiado na criação. Trocar a padrão não muda os projetos que já existem, e os de hoje seguem na Principal.
- A conta do projeto vale para:
  - o `gh` que o app chama (PRs e checks): `ghEnvironment` recebe `GH_CONFIG_DIR`;
  - o `push`, o `pull` e o `fetch` que o app faz: o comando recebe, só para aquela chamada, a credencial de `https://github.com` apontando para `gh auth git-credential`, pelas variáveis `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_n` e `GIT_CONFIG_VALUE_n`, mais o `GH_CONFIG_DIR`;
  - **todos os terminais abertos no projeto** (painéis de agente, shell e agente de missão), que recebem as mesmas variáveis.
- A chamada primeiro **esvazia a lista de ajudantes de credencial** de `https://github.com` e só então põe o do `gh`. Com conta extra, um push sem token válido falha com erro de autenticação. Nunca cai no gerenciador de credenciais da máquina.
- Quando a conta do projeto é a Principal, nada disso é passado: vale a credencial do Git da máquina, como hoje.
- A configuração global do Git não muda. O app não roda `gh auth setup-git`.
- Repositório com remoto SSH: a conta vale para PRs e checks, e não para o push. A tela do projeto diz isso.
- Remover uma conta do GitHub devolve os projetos dela para a Principal. A confirmação diz quantos são.

### GitHub: onde fica o token (decidido pela pessoa em 2026-11-18)

Por causa da entrada única no cofre do Windows, havia dois caminhos para as contas **extras** do GitHub:

- **(a) Token na pasta da conta (escolhido).** O login das contas extras usa `gh auth login --web --insecure-storage`: o `gh` grava o token num arquivo dentro da pasta da conta. O app não abre esse arquivo. Isola de verdade e não mexe no `gh` da máquina. É como o Claude Code e o Codex já guardam o login deles no Windows. O custo, que a pessoa aceitou: o token fica em arquivo, protegido só pela permissão do perfil do Windows, e entra em cópia de segurança se a pasta de dados do app entrar.
- **(b) Tudo no `gh` da máquina e no cofre (descartado).** As contas seriam adicionadas ao `gh` da pessoa. A cada comando, o app pediria o token ao `gh` e o repassaria por variável de ambiente. O token ficaria no cofre, mas passaria pela memória do app, e adicionar uma conta trocaria a conta ativa do `gh` da máquina.

A Principal do GitHub continua no cofre, como hoje.

### GitHub: o cofre do Windows e o reparo

Proposta do construtor, confirmada pela pessoa em 2026-11-21, ao aprovar este desenho.

O login de uma conta extra apaga a entrada ativa do `gh` no cofre. O app repara logo em seguida, pelo comando oficial:

1. Antes do login de uma conta extra, o app pergunta ao `gh` da máquina qual usuário está ativo e anota só o nome dele em `app_settings` (`accounts.github.repair`). Nome de usuário não é segredo.
2. O login roda na pasta da conta, com `--insecure-storage`.
3. Quando o processo do login termina (sucesso, falha, cancelamento ou prazo), o app roda `gh auth switch --hostname github.com --user <o que estava>` na configuração da máquina e confere, pelo comando de estado, que ela voltou para a mesma conta. Só então apaga a anotação.
4. Ao abrir o app e ao abrir a seção Contas, se a anotação ainda existe, o app repete o reparo.
5. Se a Principal não tinha login no `gh`, não há o que reparar.
6. Se o reparo falhar, a tela mostra um aviso fixo com o comando para a pessoa rodar.

O `gh` da pessoa pode ficar sem login por um instante, entre o fim do login e o reparo.

A entrega do GitHub começa por uma prova disso na máquina da pessoa, com uma segunda conta de verdade. **Se a prova falhar, o GitHub fica com uma conta só**: a do `gh` da máquina, com o estado e o Conectar em Configurações, sem conta por projeto.

## Entregas

1. **Configurações e contas dos programas de IA**: a engrenagem, a aba, a rota, as seções Geral e Contas, a tabela, a função de ambiente, o login guiado, a conta nos painéis, nas missões e na aba Sessões, e uso e limites por conta. Claude Code e Codex.
2. **GitHub**: a prova do reparo do cofre, o grupo GitHub em Contas, o login por código e a conta por projeto.

Cada entrega tem o plano dela e deixa o app funcionando. A entrega 1 não depende de nada do GitHub.

## Testes

- Função de ambiente: conta nula não devolve variável; conta extra devolve a pasta certa; conta removida ou desconhecida devolve erro.
- Apagar pasta: recusa caminho fora da área de contas, nome que não é UUID e link ou junção.
- Login: máquina de estados com um programa falso (sucesso, falha, cancelamento, prazo, "Não é esta conta"); endereço fora da lista não vira botão; nada da saída chega à auditoria.
- Contratos: os canais recusam caminho, comando e campo a mais.
- Banco: migração, nome único por programa, `removed_at`, conta padrão.
- Terminais e missão: a sessão leva a variável da conta escolhida; a retomada usa a mesma conta; conta removida não retoma.
- Leitores: uso e limites leem a pasta da conta do terminal.
- Tela: estados das linhas, menu de ações, bloqueio do Desconectar com sessão viva, seleção de conta no "Novo painel" e em "Sua decisão".
- GitHub: `ghEnvironment` e o `git` de escrita recebem as variáveis só com conta extra; com a Principal, o ambiente é o de hoje. Com conta extra e sem token, o push falha e não usa o gerenciador da máquina.
- Reparo do cofre: roda depois de todo fim de login (sucesso, falha, cancelamento, prazo); a anotação sobrevive a um fechamento do app e o reparo se repete na abertura; sem login na Principal, não roda.
- Aba Sessões: lista as sessões de todas as contas, marcadas, e retoma na conta em que a sessão foi achada.
- Limites: conta sem sessão viva e que não é a padrão não é lida sozinha.
- Ponta a ponta, com dados descartáveis e programas falsos: adicionar conta, conectar, abrir painel nas duas contas, remover.

## Decisões do construtor (a pessoa pode rever)

- A Principal não tem linha no banco; conta nula significa Principal, em painéis, missões e projetos.
- E-mail e usuário não são gravados, só lidos do programa.
- A Principal pode ser desconectada pelo app, com confirmação extra, mas não renomeada nem removida.
- Um login por vez, com prazo de 10 minutos.
- A conta igual a outra já conectada é avisada, e não bloqueada.
- Um código que o programa peça para colar passa pelo terminal do login, dentro do app, sem ser gravado. A alternativa (uma janela de console fora do app) tiraria o passo a passo e o "Ver o terminal do programa".
- A aba "Configurações" só existe enquanto a página está aberta.
- As preferências da seção Geral continuam guardadas onde estão hoje.
- A aba Sessões lista as sessões de todas as contas e retoma na conta em que achou cada uma.
- Só a conta padrão e as contas em uso atualizam o uso da assinatura sozinhas, para não gastar a cota das outras.
- A conta padrão do GitHub vale só para projeto novo; trocar a padrão não muda projeto existente.
- A conta extra do GitHub vale em todos os terminais abertos no projeto.
- Com conta extra do GitHub, o push nunca cai na credencial da máquina.
- Se a saída falhar na remoção, o app pergunta antes de apagar a pasta.
- O reparo do cofre do `gh` (confirmado pela pessoa em 2026-11-21).
- Duas entregas, com um plano cada.

## A confirmar na primeira tarefa do plano

- O texto que cada comando de login imprime: a linha do endereço, o pedido de código e o código do GitHub.
- Os servidores da lista de cada programa.
- Se `claude auth login` e `codex login` exigem terminal de verdade ou aceitam rodar sem ele.

## Referências

- Mockup aprovado: `.superpowers/mockups/configuracoes.html` (local, fora do git).
- Registro do produto: `apps/desktop/PRODUCT.md`.
- Especificação: `planejamento-project-hub.md`, seção 10.10.
