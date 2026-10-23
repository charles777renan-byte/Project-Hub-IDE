# Workspace multiagente: desenho

Data: 2026-10-22. Origem: pedido do usuário de 2026-10-22, com a imagem de referência de um ambiente de painéis encaixados (agentes e shell lado a lado). Este documento cobre as quatro fases do pedido e detalha só a fase 1. O plano da fase 1 está em `docs/superpowers/plans/2026-10-22-workspace-fase-1.md`.

## Intenção

Hoje o Project Hub é um conjunto de páginas (Início, Projetos, Missão) com um cabeçalho de 50px e uma barra lateral de 230px. Os terminais interativos já existem (processo de terminais que sobrevive ao app, xterm, agente Claude Code real), mas aparecem numa página separada, de no máximo quatro painéis. O usuário quer que o centro do produto seja um **ambiente de desenvolvimento multiagente**: várias sessões de agente e shells reais, lado a lado, em painéis encaixados que ele redimensiona e reorganiza, trocando de projeto sem parar nenhum processo.

O sucesso é abrir um projeto e ver uma tela próxima da referência em proporção, densidade e uso: barra de abas no topo, barra lateral compacta, e uma área de terminais reais que ocupa quase toda a janela. O usuário digita direto nos programas reais, sem campo de texto falso por cima.

## Metas

- Uma casca nova: barra superior de 36px com abas de workspaces, barra lateral redimensionável e recolhível, área principal de painéis.
- Um **workspace por projeto**, com um layout em árvore de divisões (linha ou coluna), painéis redimensionáveis por arraste, salvo no banco e restaurado ao reabrir o app.
- Layout padrão: coluna esquerda de 52% (um painel), coluna direita de 48% dividida ao meio (dois painéis). Os painéis vêm com Claude Code, Codex e PowerShell como programa preferido.
- Cada painel mostra um terminal real (xterm + PTY no processo de terminais) com cores ANSI, seleção, copiar e colar, Unicode e rolagem. Trocar de aba, de página ou de posição nunca reinicia o processo.
- A barra lateral mostra dados reais: projetos, sessões abertas e missões em andamento, com indicadores de estado que vêm do sistema.
- Provedores de agente (Claude Code, Codex, Gemini CLI) por um registro independente da interface, com detecção do executável e mensagem clara quando não estiver instalado.

## Não metas

- Orquestrar tarefas entre agentes. O layout e os terminais não dependem do orquestrador.
- Interpretar a saída do terminal. O app não extrai modelo, consumo ou aprovações do texto que o programa imprime.
- Empacotar e distribuir o app (Passo 10 do planejamento).
- Outros sistemas operacionais além do Windows 11, que continua sendo o alvo.

## Antimetas

O resultado falha, mesmo que "pareça" certo, se:

- uma saída de Claude Code, Codex ou outro programa for desenhada à mão pela interface;
- mover, dividir ou fechar um painel reiniciar ou matar o processo (fechar a aba de um workspace também não pode matar);
- um processo encerrado aparecer como ativo, ou uma sessão que o app não achou mais aparecer como "recuperada";
- um indicador mostrar um número que o sistema não mediu;
- o fundo topográfico aparecer atrás de um terminal;
- o renderer ganhar uma forma de rodar um comando qualquer.

## Restrições

- Electron 44, React 19, TypeScript estrito, xterm 6.0.0, node-pty no processo de terminais. HashRouter. Sem Node no renderer, `contextIsolation` ligado, sandbox ligado.
- CSP estrita: `style-src 'self'`. O CSS vai em arquivos ligados por `<link>` no `index.html`, nunca importado por módulo. Biblioteca que injete `<style>` não entra.
- Todo IPC passa por schema do `@project-hub/contracts`, com checagem do remetente. O renderer manda ids (projeto, painel), nunca caminho nem comando.
- Paleta oficial no chrome novo: `#080614` (fundo), `#2a2656` (separação e superfícies), `#3a3570` (seleção, borda ativa), `#b7adcf` (texto), mais variações de opacidade. As cores de destaque do `tokens.css` continuam existindo para as páginas antigas, mas o chrome novo não as usa.
- Banco SQLite com migração do Drizzle. Textos de interface em português.
- `react-resizable-panels` é a biblioteca de painéis (o usuário a sugeriu). Qualquer outra dependência nova precisa de aprovação.

## A tela

```
┌───────────────────────────────────────────────────────────────┐ 36px  barra superior: marca, abas, "+", contadores | botões do Windows
├──────────┬────────────────────────────────────────────────────┤
│ barra    │  ┌───────────────────────┬──────────────────────┐  │
│ lateral  │  │ painel (Claude Code)  │ painel (Codex)       │  │
│ ~22%     │  │                       ├──────────────────────┤  │
│ recolhí- │  │                       │ painel (PowerShell)  │  │
│ vel      │  └───────────────────────┴──────────────────────┘  │
└──────────┴────────────────────────────────────────────────────┘
```

- **Barra superior.** Marca e nome à esquerda, abas dos workspaces abertos (ícone, nome do projeto, botão de fechar) com rolagem horizontal, botão "+" que oferece os projetos sem workspace aberto e "Adicionar projeto…", e os contadores "N executando / N aguarda você" à direita, antes dos 140px reservados aos botões nativos do Windows. A barra arrasta a janela; abas e botões ficam fora da área de arrastar.
- **Barra lateral.** Largura inicial ~22% (mínimo 200px, máximo 40%), recolhível. Fundo levemente diferente do resto. Do topo: navegação (Início, Projetos), a seção **Workspaces** (projetos, cada um expansível para mostrar as sessões abertas dele) e a seção **Em andamento** (missões rodando ou aguardando você, de todos os projetos). Nomes longos cortados com `title`. Cada seção rola sozinha. Clicar numa sessão aberta, ou numa missão que tem terminal de agente, mostra esse terminal no **painel ativo** do workspace do projeto (o último em que o usuário clicou; no começo, o primeiro). Se algum painel já mostra a sessão, só leva o foco para ele. A sessão que sai de um painel continua viva e continua na lista da barra lateral. Missão sem terminal de agente abre a página da missão.
- **Área principal.** Árvore de painéis. Divisória de 1px, com área de arraste de 5px. Sem sombra e sem cartão: os painéis dividem a borda. Cada painel tem cabeçalho de 28px (nome da sessão, estado, ações), o terminal, e um rodapé de 22px (programa, projeto, pasta do worktree da missão quando houver, origem da sessão).
- O fundo topográfico só aparece nas páginas sem terminal (Início, Projetos, vazios e carregamento). A rota do workspace não o monta.
- Terminal: fonte JetBrains Mono 13px, rolagem de 5000 linhas, cores ANSI do tema atual.

## Conceitos

- **Workspace**: o espaço de um projeto. Tem um layout, uma posição entre as abas e um "aberto/fechado". Um por projeto. Fechar a aba só marca como fechado.
- **Painel (folha)**: um retângulo do layout, com um **programa preferido** (`claude`, `codex`, `gemini` ou `shell`) e, opcionalmente, o id de uma sessão de terminal.
- **Divisão**: nó do layout com `direction` (`row` põe o primeiro filho à esquerda, `column` em cima), exatamente dois filhos (`first` e `second`) e `ratio`, a fração do espaço que o `first` ocupa (0,1 a 0,9; o arraste na interface fica entre 0,15 e 0,85). O layout é uma árvore binária: dividir um painel troca a folha por uma divisão com a folha e um painel novo; fechar um painel promove o irmão. Três colunas lado a lado são duas divisões aninhadas.
- **Sessão de terminal**: um processo no processo de terminais. Pode ser um shell ou um CLI de agente abertos pelo usuário (gravados no banco, sem hooks e sem ligação com tarefas nesta fase), ou o terminal de uma missão (vem da execução do orquestrador).
- **Provedor**: `claude`, `codex`, `gemini`, `shell`. Cada um sabe o rótulo, achar o executável e montar o comando. O comando nunca vem do renderer.

### Estados

Indicadores usam forma, rótulo e, quando útil, animação; nunca só cor: ativo `●`, aguardando `◐`, concluído `✓`, erro `✕`, desconectado `○`.

Para um painel com sessão:

| Situação | Origem mostrada | Quando |
|---|---|---|
| Painel restaurado | (sem sessão) "Iniciar <programa>" | o layout veio do banco e a sessão antiga não existe mais |
| Sessão recuperada | "recuperada" | o processo estava vivo no processo de terminais quando o app abriu |
| Processo novo | "nova" | iniciado nesta execução do app |
| Encerrada | "encerrado" + "Iniciar de novo" | o processo saiu; a última saída continua visível se o processo de terminais ainda a guarda (a conferir na implementação) |

## Decisões do usuário

- Estilo e proporções da imagem de referência: 52% / 48%, coluna direita dividida ao meio, sem cartões.
- Terminais modulares: dividir na vertical e na horizontal e escolher o tamanho (a divisão vem na fase 2; o redimensionamento, na fase 1).
- Interface com o programa real, entrada dentro do terminal, nunca um campo separado.
- Agentes continuam rodando quando o app fecha (decisão do processo de terminais, no desenho do agente real).
- Paleta oficial de quatro cores; o fundo topográfico fora dos terminais.
- `react-resizable-panels` para o layout.

## Decisões minhas (o usuário pode rever)

- **Nada inicia sozinho.** Os painéis do layout padrão aparecem com "Iniciar Claude Code", "Iniciar Codex" e "Iniciar PowerShell". Abrir um projeto não gasta cota de agente nem cria processo sem o usuário pedir.
- **Início e Projetos continuam** como páginas, na barra lateral. "Automations" e "Search" ficam de fora na fase 1: não existem no produto e seriam links mortos. A busca chega com a paleta de comandos do plano de bibliotecas.
- **Um workspace por projeto**; a aba é o projeto. Sessões como abas dentro de um painel ficam para a fase 2.
- **A página Terminais é substituída** pelo workspace e removida no fim da fase 1. O `TerminalView` e o `MissionTerminal` continuam.
- **Largura da barra lateral** vai em `localStorage` (preferência da janela). O layout dos painéis vai no banco.
- **Barra superior de 36px**, e `TITLE_BAR_OVERLAY.height` passa para 35.
- **Reiniciar e encerrar** entram na fase 1: "Iniciar de novo" num painel encerrado, e "Encerrar" (com confirmação, se rodando) nas sessões abertas pelo usuário. Sessão de missão não se encerra por aqui: cancela-se a missão.
- **Detecção de provedor** na fase 1 só confere se o executável existe no `PATH` (`.exe`, `.cmd`, `.bat`). Testar o funcionamento (`--version`) e a autenticação fica para a fase 4.
- **Atalho de copiar**: `Ctrl+C` copia quando há seleção e, sem seleção, vai para o programa; `Ctrl+Shift+C` sempre copia; `Ctrl+V` cola.
- **Restaurar a aba ativa**: ao abrir o app na rota inicial, se há workspace aberto, vai para o de uso mais recente. Só uma vez por abertura da janela.

## Persistência e restauração

- `workspaces`: `id`, `project_id` (único), `layout` (JSON), `is_open`, `position`, `last_active_at`, datas.
- `terminal_sessions`: `id`, `project_id`, `provider`, `title`, `created_at`, `closed_at`. Substitui o mapa de shells em memória, que perdia os shells quando o app reiniciava.
- O layout é validado por schema ao ler e ao gravar (no máximo 12 painéis, profundidade 6, ids únicos, `ratio` entre 0,1 e 0,9). Layout corrompido volta ao padrão, sem apagar nada.
- Ao abrir um workspace, o app tira do layout os ids de terminal que não existem mais. Ao gravar, recusa id de terminal que não seja do projeto.
- Os tamanhos gravados são os últimos soltos pelo usuário (arraste terminado), com atraso de 400ms.

## Segurança

- Canais novos: `workspaces:*` e `providers:list`. Todos com schema, checagem de remetente e limites.
- O renderer pede "iniciar a sessão do painel X do workspace Y". O processo principal acha o provedor do painel, monta o comando e o ambiente (`buildTerminalEnv`, com lista de variáveis permitidas) e abre o terminal. O canal `terminals:open-shell` e o `terminals:close` saem.
- Terminal de missão não pode ser encerrado por aqui.

## Fases

1. **Casca e painéis** (este plano): barra superior com abas, barra lateral, árvore de painéis com o layout padrão, sessões reais por provedor, estados, layout salvo e restaurado.
2. **Operações de layout**: dividir, mover, abas dentro do painel, maximizar e restaurar, ajuste do tamanho da fonte. Os terminais passam para uma camada própria, posicionada sobre o espaço de cada painel, para mover ou dividir um painel não recriar o xterm nem perder o scrollback. Controle de fluxo entre o PTY e o renderer: o processo de terminais pausa a leitura do PTY enquanto o renderer não confirma que processou os lotes enviados.
3. **Barra lateral completa**: tarefas por estado, fixar, histórico e indicadores.
4. **Mais agentes**: o processo de terminais guarda a tela de cada sessão em um emulador sem interface (xterm headless com serialização), e a reconexão recebe esse retrato em vez do replay de bytes; verificação de funcionamento e de autenticação, eventos estruturados quando o provedor oferecer, branch atual e consumo quando forem informados oficialmente.

## Fica pendente depois da fase 1 (e como será dito na tela)

- Não há adaptador estruturado de Codex nem de Gemini: eles abrem como CLI interativo comum, sem eventos para as tarefas.
- A branch atual de uma sessão avulsa não aparece (só a pasta do worktree da missão).
- Modelo, modo de execução e consumo não aparecem: nenhum provedor os entrega por um canal oficial ainda.
- Mover painéis, dividir e maximizar (fase 2).

## Critérios de aceite da fase 1

1. Ao abrir um projeto, a tela mostra barra superior, barra lateral e três painéis nas proporções 52/48 e 50/50, sem cartões e com divisórias de 1px.
2. Cada painel inicia seu programa com um clique. Claude Code e PowerShell abrem terminais reais; Codex abre se estiver instalado e, se não, mostra "Codex não foi encontrado no PATH".
3. Digitar, selecionar, copiar e colar funcionam. Redimensionar um painel reajusta o terminal.
4. Trocar de aba, ir para o Início e voltar, ou fechar a aba, não interrompe o processo; ao voltar, a tela do terminal está lá.
5. Fechar e reabrir o app restaura abas, aba ativa e tamanhos. Sessões vivas voltam "recuperadas"; as que morreram voltam como painel vazio.
6. Nenhuma violação de CSP no console, o fundo topográfico não aparece no workspace, e o gate completo (lint, tipos, testes, integração, build, E2E) passa.
