# ADR 0013: Preview automático do navegador, com aprovação por comando exato

- Status: proposta; implementada na fase 2, no ramo `feat/navegador-preview`. Passa a aceita com a integração do ramo.
- Data: 2026-11-14
- Origem: preview automático da aba Navegador, em `docs/superpowers/specs/2026-11-13-navegador-preview-automatico-design.md`
- Complementa: ADR 0012 (navegador interno em view isolada), ADR 0001 (isolamento do Electron) e ADR 0007 (decisões de fundação). Esta decisão abre uma segunda exceção controlada: o app passa a rodar um comando que vem do repositório, depois de a pessoa ver o texto dele.

## Contexto

Na fase 1, a aba Navegador abria vazia e a pessoa digitava o endereço. Para ver o próprio projeto, ela ainda precisava subir o servidor num terminal, achar a porta e colar o endereço. A fase 2 faz isso sozinha: uma aba de página vazia abre o projeto.

O risco está no "sozinha". O comando que sobe o servidor é o script `dev` (ou outro) do `package.json`, e o `package.json` é conteúdo de repositório: um `git pull` pode trocá-lo. O app não pode rodar texto que a pessoa não viu, e o renderer não pode ser quem escolhe o texto que roda.

## Decisão

1. **A permissão é por comando exato.** A pessoa aprova uma vez o trio gerenciador de pacotes, nome do script e texto do script, mostrados no cartão. A aprovação fica na tabela `project_previews`. Em toda leitura, o processo principal relê o `package.json` da raiz (até 1 MiB) e compara: se qualquer parte do trio mudou, a aprovação vale como "mudou", nada sobe, e o cartão mostra o comando de antes e o de agora. O campo `trusted` do projeto não participa.
2. **O comando nasce só no processo principal.** Uma função (`commandFor`) monta `<gerenciador> run <script>`, com o gerenciador vindo de uma lista fixa (npm, pnpm, yarn, bun) e o nome do script conferido por expressão regular. Nenhum canal IPC leva texto de comando: o renderer manda ids, o nome de um script, o texto que a tela mostrou (só para a comparação) e o texto de um endereço.
3. **O servidor sobe num painel `shell` do workspace do projeto**, criado pelo processo principal com o comando de partida nos argumentos do shell (`-NoExit -Command` no PowerShell). O app nunca escreve num terminal que já está aberto. A pessoa vê o log, e o servidor para como qualquer terminal. O painel novo não recebe o foco.
4. **O endereço é o que o servidor anunciou.** O cliente dos terminais no app (`TerminalPort.listen`) reparte a saída de um terminal entre o painel e ouvintes extras, sem mudar o protocolo do processo de terminais. O preview lê a saída, tira dela os endereços locais (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`) e só navega depois de uma conexão TCP à porta dar certo. Espera até 60 segundos, conferindo a cada 300 ms.
5. **Antes de subir, o app confere se já está de pé.** O último endereço do projeto é sondado (500 ms). Respondeu: a aba abre nele e nenhum painel novo é criado. A resposta só vale se a porta não for do preview vivo de outro projeto: dois projetos costumam anunciar a mesma porta padrão em dias diferentes, e sem essa conferência a aba de um abriria o servidor do outro. Um endereço fixo é escolha da pessoa e não passa por ela. Não respondeu, mas o terminal do preview continua aberto: o cartão explica e oferece fechar aquele terminal e subir de novo; nada é digitado nele.
6. **Site estático tem servidor próprio do app.** Projeto sem servidor de desenvolvimento e com `index.html` na raiz é servido por um servidor HTTP do processo principal, um por projeto, só em `127.0.0.1`. Só `GET` e `HEAD`; o cabeçalho `Host` precisa ser o do próprio servidor; todo caminho passa por `resolveInProject`; qualquer segmento que começa com `.` devolve 404 (`.env`, `.git`); pasta não é listada; `nosniff` e `no-store` em tudo; nenhum cabeçalho de CORS. O observador de pasta que já existia recarrega as abas do site quando um arquivo muda. Site estático não pede aprovação: nada do repositório é executado.
7. **Endereço fixo.** "Só abrir um endereço" guarda um endereço local e não sobe nada. Serve para monorepo, outras linguagens e servidor que a pessoa prefere subir por conta própria.
8. **Dados do banco são tratados como não confiáveis.** Uma linha de `project_previews` que não passa na validação vale como "sem aprovação". Um último endereço que não é local nunca é sondado, devolvido nem aberto.
9. **"Esquecer este preview"** apaga a aprovação e o endereço guardado. Remover o projeto faz o mesmo e fecha o servidor estático dele.

## O que não muda

A janela do app, a CSP, a checagem de remetente dos canais e as políticas das páginas (ADR 0012) continuam as mesmas. A página do preview é uma aba como as outras: sem preload, sem canal com o app, na sessão do projeto. O protocolo do processo de terminais não muda.

## Alternativas descartadas

- **Processo filho escondido do app.** Ler a saída seria trivial, mas a pessoa não veria o log, o servidor morreria com o app, e haveria um segundo jeito de rodar processos fora do processo de terminais.
- **Painel de terminal com endereço por tentativa de portas conhecidas** (5173, 3000, 8080 e outras). Erra quando a porta padrão está ocupada e o servidor pula para a seguinte, e pode abrir o servidor de outro projeto. Sobrou só a sonda do último endereço do próprio projeto, no item 5.
- **Usar o campo `trusted` do projeto como permissão.** Uma permissão por projeto continuaria valendo depois de o comando mudar.
- **Campo livre para digitar um comando no cartão.** Para isso existe o terminal.

## Consequências

- O cliente dos terminais passou a ter ouvintes ao lado da assinatura do painel. É um ponto central, com teste próprio.
- O workspace ganhou um caminho em que o processo principal cria um painel e avisa o renderer (`workspaces:changed`). Uma mudança de layout local ainda não gravada é descartada quando esse aviso chega.
- Uma tabela nova (`project_previews`), cinco canais de pedido (`preview:*:v1`), todos com zod e `registerTrustedHandler`, e dois de aviso do processo principal para o renderer (`preview:changed:v1` e `workspaces:changed:v1`), validados no preload.
- Depois de uma subida que não deu certo, a aba vazia não tenta de novo sozinha: a pessoa decide pelo cartão. Sem isso, cada aba nova abriria mais um terminal.

## Limites conhecidos

- **Monorepo:** só o `package.json` da raiz é lido. App em subpasta usa o endereço fixo.
- **Outras linguagens** (Python, Go, PHP e outras): sem `package.json` e sem `index.html` na raiz, não há preview automático; vale o endereço fixo.
- **`https` local com certificado próprio:** o navegador recusa certificado inválido (ADR 0012), e a página cai no estado de erro.
- **Porta do site estático:** outro programa rodando no computador consegue pedir arquivos a ela. São arquivos que qualquer programa local já lê no disco, e os ocultos continuam de fora.
- **O comando roda como rodaria no terminal da pessoa.** Se o shell dela não acha o gerenciador de pacotes, ou barra o script dele, o erro aparece no painel e o cartão avisa que nenhum endereço chegou.
- **Painel encerrado fica na tela:** "Fechar esse terminal e subir de novo" encerra a sessão, e o painel fica com a saída para a pessoa ler e fechar.
- **Preview de worktree de missão** não existe: o preview é o da pasta do projeto.
