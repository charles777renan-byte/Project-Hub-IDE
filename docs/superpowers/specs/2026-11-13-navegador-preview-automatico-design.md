# Navegador interno, fase 2: preview automático

Data: 2026-11-13. Continua `docs/superpowers/specs/2026-11-12-navegador-interno-design.md` (fase 1, já na `main`) e a ADR 0012.

Marcas usadas no texto: **(pessoa)** é o que a pessoa pediu ou decidiu; **(escolha do desenho)** é decisão deste documento, que ela pode trocar.

## Intenção

**(pessoa)** Abrir a aba Navegador num projeto e ver o preview sem configurar nada. O app descobre o que mostrar, sobe o servidor de desenvolvimento quando for o caso, abre a página, e a página acompanha o código.

**(pessoa)** Antes de subir o servidor de um projeto pela primeira vez, o app pergunta uma vez. Daí em diante é automático naquele projeto.

## Objetivos

- Projeto com servidor de desenvolvimento: um clique na primeira vez; nas seguintes, abrir a aba basta.
- Projeto só com HTML: o preview abre sem pergunta, e recarrega quando um arquivo muda.
- O servidor roda num terminal do próprio projeto, à vista, onde a pessoa lê o log e para quando quiser.
- O app nunca roda um comando que a pessoa não viu.

## Fora do escopo

- Preview de worktree de missão. O preview é o da pasta do projeto.
- Monorepo com vários apps: só o `package.json` da raiz do projeto é lido. Quem tem o app numa subpasta usa "Só abrir um endereço" (abaixo) e sobe o servidor por conta própria.
- Projetos sem `package.json` e sem `index.html` na raiz (Python, Go, PHP e outros): também "Só abrir um endereço".
- Campo livre para digitar um comando qualquer. Para isso existe o terminal.
- Botão de parar o servidor dentro do navegador. O servidor para no terminal dele.
- O campo `trusted` do projeto. Ele nasce `false`, nada no app o muda, e não há tela para ele; fica como está. A permissão desta fase é própria do preview.

## O que tornaria isto um fracasso, mesmo funcionando

- Rodar um comando do repositório sem a pessoa ter visto o texto dele.
- Seguir rodando sozinho depois que o comando mudou no repositório (um `git pull` trocou o script `dev`).
- O servidor de site estático entregar arquivo de fora da pasta do projeto, a pasta `.git` ou um arquivo de segredo (`.env`).
- O renderer conseguir escolher o texto do comando.
- Abrir a aba e subir um segundo servidor porque o primeiro já estava de pé e o app não percebeu.
- O painel do servidor roubar o foco ou reorganizar a tela de quem só queria ver a página.

## Restrições do projeto que valem aqui

- Tudo o que valia na fase 1: a janela do app não muda; as páginas ficam em `WebContentsView` sem preload; políticas em `security.ts`; canais novos em `packages/contracts`, versionados (`:v1`), com zod no processo principal e `registerTrustedHandler`.
- Conteúdo de repositório é não confiável: nome de script, texto de script e nomes de arquivo são dados, nunca comando montado sem validação.
- O renderer manda ids e nomes; caminhos e comandos saem do processo principal.
- O processo de terminais continua vivo quando o app fecha. Um servidor de pé pode ser mais velho que a execução atual do app.
- Cada terminal aceita uma assinatura de saída por vez (a do painel na tela); uma assinatura nova substitui a anterior.

## Abordagens

Para rodar o servidor e descobrir o endereço dele, três caminhos foram considerados.

1. **Painel de terminal do projeto, com uma segunda leitura da saída (escolhida).** O servidor sobe num painel PowerShell do workspace do projeto. O cliente dos terminais no app (`terminal-host-port.ts`) passa a repartir a saída de um terminal entre o painel e ouvintes extras, sem mudar o protocolo do processo de terminais. O preview ouve a saída, acha o endereço anunciado e confere se a porta responde. Custa mexer num ponto central (a porta dos terminais), com teste próprio. Em troca, a pessoa vê o log, para o servidor como qualquer terminal, e o endereço é o que o servidor de fato escolheu.
2. **Processo filho escondido do app.** Ler a saída seria trivial. A pessoa não veria o log, o servidor morreria com o app, e haveria um segundo jeito de rodar processos fora do processo de terminais. Contraria o que ela pediu na fase 1 (servidor à vista).
3. **Painel de terminal, endereço por tentativa de portas conhecidas.** Sem mexer nos terminais: o app testaria 5173, 3000, 8080 e outras. Erra quando a porta padrão está ocupada e o servidor pula para a seguinte, e pode abrir o servidor de outro projeto. Fica só como rede de segurança dentro do caminho 1, restrita ao último endereço conhecido do próprio projeto.

**(escolha do desenho)** Caminho 1. A pessoa entregou o "como" ("faça bem feito"); a escolha é deste documento.

## O que a pessoa vê

### Primeira vez num projeto com servidor

Aba Navegador, aba de página vazia. No lugar de "Digite uma URL para começar" aparece o cartão do preview:

```
┌──────────────────────────────────────────────┐
│  Preview deste projeto                       │
│                                              │
│  O app pode subir o servidor de              │
│  desenvolvimento e abrir a página aqui.      │
│                                              │
│  Comando    pnpm run dev                     │
│  O que roda vite                             │
│  Onde       num terminal deste projeto       │
│                                              │
│  [ Usar este comando ]   Agora não           │
│  Outro script ▾     Só abrir um endereço     │
└──────────────────────────────────────────────┘
```

- "Comando" é o que será executado. "O que roda" é o texto do script no `package.json`, cortado em 200 caracteres com reticências.
- "Outro script" lista os outros scripts válidos do `package.json`; escolher um troca as duas linhas do cartão.
- "Só abrir um endereço" troca o cartão por um campo de endereço local (`localhost:3000`, por exemplo); o app guarda o endereço e nunca sobe nada nesse projeto.
- "Agora não" fecha o cartão nesta aba de página. Ele volta na próxima aba vazia. Nada é gravado.
- O campo de endereço da barra continua funcionando com o cartão à vista.

### Depois de "Usar este comando"

1. Um painel de terminal novo aparece no workspace do projeto, com o título "Preview · <nome do projeto>", já rodando o comando. O foco do teclado não sai de onde estava.
2. O cartão vira o estado de espera: "Subindo o servidor…", com o comando e um "Ver terminal" que leva o foco ao painel.
3. Quando o servidor anuncia o endereço e a porta responde, a aba de página navega para ele. O cartão some.
4. Se em 60 segundos nenhum endereço apareceu: "O servidor não anunciou um endereço", com "Ver terminal", "Tentar de novo" e o campo "Só abrir um endereço". O terminal fica como está.
5. Se o processo terminou antes de anunciar: "O comando terminou sem subir o servidor", com "Ver terminal" e "Tentar de novo".

### Vezes seguintes

Abrir a aba Navegador com a aba de página vazia já dispara o mesmo fluxo, sem cartão de pergunta:

- o servidor já está de pé (o último endereço conhecido responde): a página abre direto;
- não está: o painel sobe e a página abre quando o endereço chegar.

Uma aba de página que já tem endereço nunca dispara nada sozinha: ela carrega o que tinha.

### Quando o comando mudou

Se o comando aprovado não é mais o que o `package.json` diz (script removido, texto do script diferente, gerenciador diferente), o automático para e o cartão volta com o título "O comando do preview mudou", mostrando o comando de antes e o de agora. A pessoa aprova de novo ou não.

### Site estático

Projeto sem script de servidor e com `index.html` na raiz: a aba de página vazia abre o site direto, sem cartão e sem pergunta, porque nenhum código do repositório roda no computador (o JavaScript da página roda dentro da página isolada, como o de qualquer site). Salvar um arquivo do projeto recarrega as abas de página que mostram o site.

### Nada para mostrar

Sem `package.json` com script de servidor e sem `index.html`: a área vazia continua como na fase 1, com uma linha a mais, "Só abrir um endereço", que leva ao mesmo campo do cartão.

### Página que não carregou

No estado de erro da fase 1 ("Tentar de novo"), quando o endereço que falhou é o do preview do projeto e o preview está aprovado, aparece também "Subir o servidor". É o caso de reabrir o app no dia seguinte com a aba restaurada apontando para um servidor que não está mais de pé.

### Menu do navegador

O menu "⋯" ganha "Preview do projeto…". Ele abre o cartão na aba de página atual, se ela estiver vazia, ou numa aba de página nova. O cartão, nesse caso, mostra o que está aprovado e traz "Esquecer este preview", que apaga a aprovação e o endereço guardados do projeto. Num projeto estático, o cartão diz "Site estático: o app serve os arquivos desta pasta", com "Abrir o site" e, se o `package.json` tiver scripts válidos, "Outro script", para quem prefere subir um servidor.

## Como funciona

### Descoberta

Feita no processo principal, a cada vez que o estado do preview é pedido (o arquivo é pequeno; sem cache entre pedidos, para a mudança do comando ser vista na hora).

- Lê `package.json` na raiz do projeto, pelo serviço de arquivos (`resolveInProject`), com limite de 1 MiB. JSON inválido ou ausente conta como "sem servidor".
- **Scripts válidos:** nome que casa com `^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$` e texto que é uma string não vazia. Os outros não são oferecidos.
- **Script sugerido (escolha do desenho):** o primeiro que existir entre `dev`, `start`, `serve`. Se nenhum existir, não há sugestão automática, mas "Outro script" continua oferecendo os válidos, e o projeto cai em "site estático" ou "nada para mostrar" até a pessoa escolher um.
- **Gerenciador (escolha do desenho):** o campo `packageManager` do `package.json`, se começar com `pnpm@`, `yarn@`, `bun@` ou `npm@`; senão o lockfile na raiz (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb` ou `bun.lock`, `package-lock.json`, nessa ordem); senão `npm`.
- **Comando:** sempre `<gerenciador> run <script>`. O renderer manda só o nome do script; o processo principal relê o `package.json`, confere que o script existe e é válido, e monta o comando.
- **Site estático:** não há script sugerido nem aprovado, e existe `index.html` na raiz.

### Aprovação

- Gravada por projeto, no banco: o gerenciador, o nome do script e o texto do script no momento da aprovação.
- Vale enquanto os três forem iguais aos lidos agora. Qualquer diferença é "o comando mudou".
- "Só abrir um endereço" grava o endereço no lugar do comando; passa pela mesma interpretação da barra de endereço da fase 1 (`address.ts`) e só aceita endereço local (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`).
- Remover o projeto apaga a linha, no mesmo ponto em que as abas do navegador são esquecidas (`onRemoved`, em `index.ts`), e fecha o servidor estático dele.

### Subir o servidor

- O painel é uma sessão do provedor `shell` (PowerShell no Windows), aberta pelo serviço de workspaces, na pasta do projeto, com o comando como argumento de partida: `powershell.exe -NoLogo -NoExit -Command "<gerenciador> run <script>"`. **(escolha do desenho)** `-NoExit` deixa o shell aberto depois de um Ctrl+C, para a pessoa rodar de novo à mão. Fora do Windows, o equivalente do shell do sistema; o Windows vem primeiro, como no resto do app.
- `OpenSessionOptions` ganha o comando de partida e o título. O comando de partida só é aceito para o provedor `shell` e só vem do serviço de preview; nenhum canal do renderer o carrega.
- O painel entra pelo mesmo caminho de "abrir terminal" (divide o maior painel), mas sem mover o foco. Se o workspace já está no limite de painéis, nada sobe e o cartão diz "Feche um painel de terminal para subir o servidor".
- O id do terminal fica guardado com o preview do projeto. Antes de subir, o serviço confere: se esse terminal ainda está vivo e o último endereço responde, não sobe outro. Se o terminal está vivo e o endereço não responde (a pessoa parou o servidor com Ctrl+C e o shell ficou aberto, por exemplo), também não sobe outro sozinho: o cartão mostra "O terminal do preview está aberto, mas o servidor não responde", com "Ver terminal" e "Fechar esse terminal e subir de novo". O segundo encerra aquela sessão e abre um painel novo com o comando aprovado. **(escolha do desenho)** O app nunca digita num shell que já está aberto: não sabe o que há nele.
- "Parar todos", fechar o painel e fechar o projeto valem como para qualquer terminal. O preview não tem regra própria de encerramento.

### Achar o endereço

- **Segunda leitura da saída.** `terminal-host-port.ts` passa a manter uma assinatura no processo de terminais por terminal e a repartir a saída entre o assinante principal (o painel) e ouvintes extras ("escutas"). Trocar o assinante principal não derruba as escutas; uma escuta sem assinante principal mantém a assinatura sozinha; `onRestart` chega a todos. O protocolo do processo de terminais não muda.
- O preview liga a escuta antes de o comando rodar e a desliga quando acha o endereço, quando o terminal termina ou no limite de 60 segundos.
- **Leitura:** a saída é limpa de sequências ANSI e acumulada em até 64 KiB. O serviço procura `http://` ou `https://` seguido de `localhost`, `127.0.0.1`, `[::1]` ou `0.0.0.0` com porta. `0.0.0.0` vira `localhost`. Endereço de rede (`192.168…`) é ignorado. Vale o primeiro que casar.
- **Conferência:** antes de navegar, uma conexão TCP na porta, com até 10 tentativas espaçadas de 300 ms. Sem resposta, o serviço continua lendo a saída até o limite.
- O endereço achado fica guardado como o último conhecido do projeto. É ele que responde "o servidor já está de pé?" nas vezes seguintes (uma conexão TCP, 500 ms de limite).

### Site estático

Um servidor HTTP do próprio app, no processo principal, um por projeto, criado no primeiro uso e fechado quando o projeto é removido ou o app encerra.

- Só escuta em `127.0.0.1`. Tenta primeiro a porta que usou da última vez nesse projeto (guardada no banco), para as abas restauradas continuarem valendo; ocupada, usa uma porta livre.
- Só `GET` e `HEAD`. Outros métodos: 405.
- O cabeçalho `Host` precisa ser `127.0.0.1:<porta>` ou `localhost:<porta>`; senão, 403 (protege de um site de fora que resolva um nome para `127.0.0.1`).
- Todo caminho passa por `resolveInProject`, que já barra `..`, `.git`, unidade, link que sai da raiz. Além disso, qualquer segmento que começa com `.` devolve 404 (`.env`, `.vscode`).
- Pasta: serve o `index.html` dela, ou 404. Não lista pasta.
- Tipo de conteúdo por extensão, numa tabela fixa (HTML, CSS, JS, JSON, SVG, imagens, fontes, áudio, vídeo, `wasm`, texto); o resto vai como `application/octet-stream`. `X-Content-Type-Options: nosniff` e `Cache-Control: no-store` em tudo. Nenhum cabeçalho de CORS.
- Arquivo entregue em fluxo, sem limite de tamanho; nada é gravado.
- **Recarga:** o serviço ouve o observador de pasta que já existe (`project-watcher.ts`, que agrupa mudanças e ignora `node_modules`, `dist`, `out` e `.git`). A cada aviso, recarrega as abas de página do projeto cujo endereço é do servidor estático dele. O observador só fica ligado enquanto houver uma aba assim.

Limitação a dizer à pessoa: outro programa rodando no computador consegue pedir arquivos a essa porta. São arquivos que qualquer programa local já lê no disco.

### Estado e canais

Um serviço de preview no processo principal, vizinho do serviço do navegador, dono do estado por projeto. O renderer só apresenta.

Estado que o renderer recebe (por projeto):

- o que foi descoberto: `servidor` (gerenciador, scripts válidos com nome e texto cortado, sugerido), `estático` ou `nada`;
- a aprovação: `nenhuma`, `aprovada` (comando ou endereço), `mudou` (com o comando de antes);
- a situação: `parado`, `subindo`, `de pé` (com o endereço), `sem endereço`, `terminou`, `terminal aberto sem resposta`, `sem espaço para o painel`;
- o id do terminal, quando há um, para "Ver terminal".

Canais de pedido (nomes finais com o plano): ler o estado; aprovar um script (projeto e nome do script); gravar "só um endereço" (projeto e texto); iniciar (projeto e aba de página, que é quem navega quando o endereço chegar); esquecer. Um evento avisa a mudança de estado. Nenhum canal carrega texto de comando.

O disparo automático é do renderer: ao mostrar uma aba de página vazia, ele lê o estado e, se a aprovação vale (ou o projeto é estático), pede "iniciar". O processo principal confere tudo de novo antes de agir.

### Banco

Uma tabela nova, uma linha por projeto: tipo (`script`, `endereço` ou `estático`), gerenciador, nome e texto do script aprovados, endereço fixo, último endereço conhecido, id do terminal do servidor, porta do servidor estático, datas. Migração nos moldes da de `browser_tabs`.

### O que muda em código que já existe

- `terminal-host-port.ts`: as escutas (acima).
- `terminals.ts` e `workspaces.ts`: comando de partida e título para a sessão `shell`; painel novo sem mover o foco.
- `browser-service.ts`: recarregar as abas de um projeto por origem; navegar uma aba para um endereço vindo do preview (hoje a navegação recebe texto da barra).
- Renderer: cartão do preview na área vazia do `BrowserViewport`, ação extra no estado de erro, item novo no menu, e o workspace mostrando o painel que o processo principal criou.

## Erros e bordas

- `package.json` muda enquanto o cartão está à vista: "Usar este comando" manda o nome do script; o processo principal relê e, se o texto não for mais o mostrado, recusa e devolve o estado novo. O renderer manda junto o texto que mostrou, só para essa comparação.
- Dois pedidos de iniciar seguidos para o mesmo projeto: o segundo encontra `subindo` e só troca a aba de página que vai navegar.
- A aba de página que ia navegar foi fechada antes de o endereço chegar: o endereço fica guardado e nada navega.
- App fechado com o servidor de pé: ao reabrir, o terminal é reencontrado como já acontece hoje, e o último endereço responde; o preview conta como `de pé`.
- Servidor que anuncia `https://localhost` com certificado próprio: a fase 1 recusa certificado inválido. A página cai no estado de erro; fica como limitação conhecida.
- Projeto sem workspace aberto: não acontece pela interface (a aba Navegador vive no workspace); se o pedido chegar assim, é recusado.

## Testes

- Unidade: descoberta (scripts, gerenciador, nomes inválidos, JSON quebrado); comparação da aprovação; leitor de endereço (ANSI, `0.0.0.0`, endereço de rede ignorado, saída partida no meio do endereço); máquina de situações do serviço com terminal e relógio falsos; canais (remetente, validação, nenhum texto de comando aceito).
- Integração: servidor estático de verdade em `127.0.0.1` (travessia de caminho, `.git`, arquivo com ponto, `Host` errado, método errado, tipos de conteúdo, pasta sem `index.html`); escutas da porta de terminais com o processo de terminais em-processo; repositório da tabela nova.
- Ponta a ponta, com dados descartáveis: projeto estático abre sozinho e recarrega ao gravar um arquivo; projeto com script `dev` (um servidor mínimo em Node, sem instalar nada) mostra o cartão, sobe o painel sem roubar o foco, abre a página, não pergunta na segunda vez e volta a perguntar quando o script muda.

## Fica com quem constrói

- Nomes finais de canais, tipos e arquivos, seguindo os da fase 1.
- A forma exata da tabela e da migração.
- Como o workspace do renderer fica sabendo do painel criado pelo processo principal. Hoje não existe evento de mudança de workspace; o plano cria um.
- O texto final das mensagens, no tom das que já existem.
- O equivalente do comando de partida fora do Windows.

## Escolhas deste documento, para a pessoa conferir

1. A aprovação vale para o comando exato; se o script mudar no repositório, o app pergunta de novo.
2. Site estático abre sem pergunta.
3. Sem botão de parar no navegador; o servidor para no terminal.
4. O shell do painel fica aberto depois que o servidor para (`-NoExit`).
5. Só o `package.json` da raiz; monorepo e outras linguagens usam "Só abrir um endereço".
6. Scripts sugeridos, em ordem: `dev`, `start`, `serve`.
7. Arquivos que começam com ponto nunca são servidos pelo site estático.
8. Aba de página que já tem endereço nunca sobe servidor sozinha; quem falhou ganha o botão "Subir o servidor".
9. Espera de 60 segundos pelo endereço.
