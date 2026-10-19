# ADR 0007: Decisões de fundação

- Status: aceita
- Data: 2026-10-19
- Origem: plano "Fundação e primeiro fluxo simulado", Tarefa 1

## Contexto

O planejamento deixa em aberto ferramentas, versões e alguns valores da primeira etapa. Este ADR registra o que o plano escolheu, para que as tarefas seguintes não precisem decidir de novo.

## 1. Versões fixadas

Conferidas em 2026-10-19 no registro do npm, no índice oficial de versões do Node.js e no índice de headers do Electron.

| Item     | Versão  | Onde está fixada                                            |
| -------- | ------- | ----------------------------------------------------------- |
| Electron | 44.9.0  | instalado com versão exata na Tarefa 3                      |
| Node.js  | 24.22.0 | `.nvmrc`; `engines.node` do `package.json` pede `>=24.22.0` |
| pnpm     | 12.14.0 | `packageManager` do `package.json`                          |

- **Electron 44.9.0** é a versão estável mais recente (tag `latest` do npm, publicada em 2026-10-17). Ela embute o Node 24.22.0 e o Chromium 152.
- **Node.js 24.22.0** é LTS (Krypton) e é a versão que o Electron 44.9.0 embute. O processo principal e os testes rodam, assim, na mesma linha do Node.
- **pnpm 12.14.0** foi instalado com `npm install -g pnpm@12.14.0`, porque o Node instalado na máquina (26.7.0) não inclui o Corepack e `corepack enable` não existe.
- **Node 26.7.0**, a versão instalada na máquina de desenvolvimento, não é LTS: é da linha Current (`lts: false` no índice oficial). Os comandos de verificação da Tarefa 1 rodaram nele. Antes da Tarefa 5, que traz um módulo nativo, a máquina deve passar a usar o Node 24.22.0 do `.nvmrc`, por exemplo com nvm-windows ou fnm.

Ferramentas de qualidade, fixadas no `package.json` da raiz:

| Ferramenta        | Versão  | Observação                                                                                                                                                                                      |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript        | 6.0.3   | Última da linha 6. O `typescript-eslint` declara `typescript >=4.8.4 <6.1.0`, então o TypeScript 7.0.2 (`latest`) fica de fora por enquanto.                                                    |
| ESLint            | 10.13.0 | Com `@eslint/js` 10.0.1, `eslint-config-prettier` 10.1.8 e `globals` 17.13.0.                                                                                                                   |
| typescript-eslint | 8.71.2  | A 8.72.0 saiu no dia da instalação, abaixo do prazo mínimo de um dia que o pnpm 12 aplica por padrão (`minimumReleaseAge` de 1440 minutos). Em vez de abrir uma exceção, o plano fixa a 8.71.2. |
| Prettier          | 3.9.10  |                                                                                                                                                                                                 |
| Vitest            | 5.0.5   |                                                                                                                                                                                                 |
| `@types/node`     | 24.19.2 | Mesma linha do Node fixado.                                                                                                                                                                     |

Dependências novas entram com versão exata (`saveExact: true` em `pnpm-workspace.yaml`), e o `pnpm-lock.yaml` é versionado. `failIfNoMatch: true` faz um `--filter` que não encontra pacote terminar com erro, em vez de código 0 sem rodar nada.

## 2. Git por invocação direta com execa, sem simple-git

- **Contexto:** O aplicativo usa poucas operações de Git: ler o estado do repositório e criar e remover worktrees.
- **Decisão:** Chamar o executável `git` direto, com `execa`, sem `simple-git`. Os argumentos vão em array e nunca por shell. O tempo limite padrão é de 15 segundos (`timeoutMs` de 15000), e executável ausente vira o erro `GIT_NOT_AVAILABLE`.
- **Consequência:** Os comandos permitidos ficam explícitos no código (RF-GIT-007) e nenhuma camada intermediária expõe comandos de escrita. Caminhos com espaço e acento passam como argumentos, sem escape de shell.

## 3. Drizzle ORM com better-sqlite3

- **Contexto:** O ADR 0002 escolhe SQLite, e falta escolher o driver e o ORM.
- **Decisão:** `better-sqlite3` como driver e Drizzle ORM para tipar o schema e as consultas. As migrações SQL saem do `drizzle-kit` (`pnpm db:generate`) e são aplicadas por `pnpm db:migrate`, com as regras do ADR 0002.
- **Consequência:** `better-sqlite3` é um módulo nativo, o que traz o custo descrito no item 7.

## 4. PowerShell como shell padrão no Windows

- **Contexto:** O aplicativo pode precisar abrir um shell no Windows, para comandos de missão e, mais tarde, para um terminal integrado.
- **Decisão:** O shell padrão no Windows é o PowerShell, configurável pelo usuário (seção 12.5; seção 27, pergunta 6).
- **Consequência:** O código de Git desta etapa não usa shell (item 2), então a escolha ainda não aparece no código. Quando aparecer, a configuração do usuário vale mais que o padrão.

## 5. Raiz de worktrees

- **Contexto:** Os worktrees ficam fora de `userData` (seção 18.1), em local previsível e configurável.
- **Decisão:** A raiz padrão é `<home>/ProjectHub/worktrees`, em que `<home>` é a pasta do usuário (no Windows, `C:\Users\<usuário>\ProjectHub\worktrees`). A variável `APP_WORKTREES_ROOT`, descrita em `.env.example`, sobrescreve o padrão. Vazia, vale o padrão.
- **Consequência:** O caminho é resolvido só no processo principal. A raiz fica fora de `Documentos`, que no Windows costuma estar sincronizada com o OneDrive, então milhares de arquivos de worktree não sobem para a nuvem.

## 6. Valores de CSP (Tarefa 3)

- **Contexto:** O planejamento manda definir uma CSP (seção 24.4), mas não fixa os valores dela.
- **Decisão:** A política é a seguinte, e cada diretiva tem um motivo.

  ```text
  default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
  ```

  - `default-src 'self'`: tudo vem só da origem do aplicativo, salvo o que as outras diretivas liberam.
  - `script-src 'self'`: sem script inline, sem `eval` e sem script remoto.
  - `style-src 'self'`: sem estilo inline; os estilos vêm de arquivos do aplicativo.
  - `img-src 'self' data:`: imagens do aplicativo e URIs `data:`.
  - `object-src 'none'`: sem plugins, `<object>` nem `<embed>`.
  - `base-uri 'none'`: impede que um `<base>` injetado desvie as URLs relativas.
  - `frame-ancestors 'none'`: a página não pode ser embutida em frames.

- **Consequência:** Qualquer afrouxamento precisa de uma entrada em "Registros posteriores", com o motivo. O servidor de desenvolvimento do Vite pode pedir diretivas a mais; se pedir, o afrouxamento vale só em desenvolvimento.

## 7. Rebuild do better-sqlite3 para o runtime do Electron

- **Contexto:** O `better-sqlite3` é um módulo nativo (C++). Cada binário vale para uma ABI (`NODE_MODULE_VERSION`): o Node 24.22.0 usa a 137 e o Electron 44.9.0 usa a 149. O mesmo arquivo `.node` não carrega nos dois.
- **Decisão:** O aplicativo roda com o `better-sqlite3` reconstruído para o runtime do Electron, por exemplo com `@electron/rebuild`. Os testes de integração com SQLite rodam no Node do Vitest e usam o binário do Node. O fluxo exato (quando reconstruir e como manter os dois binários) é definido na criação do pacote `database` e registrado aqui.
- **Consequência:** O rebuild exige ferramentas de compilação nativa (seção 24.1). No Windows: Visual Studio Build Tools com a carga de trabalho "Desenvolvimento para desktop com C++" e Python 3, para o node-gyp. No macOS: Xcode Command Line Tools. No Linux: compilador, Python e as bibliotecas necessárias ao Electron. Quando não existe binário pré-compilado para o Electron em uso, a instalação compila a partir do código-fonte, e sem essas ferramentas ela falha.

## 8. Convenções de teste e de build

- **Nome dos testes:** `*.test.ts` e `*.test.tsx` são unitários. Testes com recursos reais (Git ou SQLite) usam `*.integration.test.ts`. `pnpm test` roda tudo menos os de integração, e `pnpm test:integration` roda só eles. Os testes de ponta a ponta do Playwright usam `*.spec.ts`.
- **Build provisório:** até a Tarefa 12, `pnpm build` só confere os tipos (`pnpm typecheck`). A Tarefa 12 troca esse script pelo build real dos bundles.
- **Pacotes:** `packages/<pasta>` e `apps/<pasta>` têm o nome `@project-hub/<pasta>`. Os pacotes de `packages/` não importam Electron (seção 8.3), e uma regra do ESLint confere isso.

## Registros posteriores

Decisões tomadas durante a execução do plano que não estavam previstas acima entram aqui, com data e motivo.

### 2026-10-19, Tarefa 3: build e desenvolvimento do desktop com electron-vite

- **Decisão:** `electron-vite` 6.0.0 com `vite` 8.3.4, em `devDependencies` de `apps/desktop`, com versão exata. `pnpm dev` roda `electron-vite dev`: o Vite serve o renderer com HMR, e o processo principal e o preload são compilados para `apps/desktop/out/`. O build de produção é `electron-vite build`, com saída em `out/main`, `out/preload` e `out/renderer`.
- **Motivo:** é a ferramenta usual para Electron com Vite. Um só comando cuida dos três alvos, e os alvos de compilação vêm da versão do Electron (Node 24 e Chromium 152 na 44). A saída em `out/` já está no `.gitignore`. O `vite` 8.3.4 é a versão que o Vitest 5.0.5 já trazia no lockfile, então não entra uma segunda cópia.
- **Pacotes do workspace:** `@project-hub/contracts` e os próximos `@project-hub/*` ficam em `devDependencies` de `apps/desktop`. O electron-vite só deixa fora do bundle o que está em `dependencies`, então o código TypeScript desses pacotes entra no bundle do processo principal e do preload. Um módulo que precise ficar fora do bundle, como um módulo nativo, vai para `dependencies`.
- **Formato:** o processo principal sai como ES module (`out/main/index.js`), porque o pacote tem `"type": "module"`. O preload sai em CommonJS (`out/preload/index.cjs`), porque preload com sandbox não carrega ES modules.

### 2026-10-19, Tarefa 3: download do binário do Electron

- **Contexto:** desde a versão 42, o pacote `electron` não tem script de instalação. O binário (cerca de 160 MB no Windows) é baixado na primeira chamada a `require('electron')` ou pelo comando `install-electron` do pacote. O electron-vite 6.0.0 não dispara esse download: sem o binário, falha com "Electron uninstall".
- **Decisão:** o script `dev` de `apps/desktop` roda `install-electron` antes do `electron-vite dev`. Com o binário presente, o comando só confere a versão e sai. O download passa pelo cache do `@electron/get` e confere o SHA-256 com o `checksums.json` do pacote. O `pnpm-workspace.yaml` não lista o `electron` em `allowBuilds`: não há script a liberar, e uma liberação antecipada aprovaria sem revisão um script que uma versão futura traga.
- **Consequência:** `pnpm install` não baixa o Electron, e o primeiro `pnpm dev` baixa. A chave `allowBuilds` nasce quando um pacote precisar dela, como o `better-sqlite3`.

### 2026-10-19, Tarefa 3: CSP no cabeçalho também em `file://`

- **Contexto:** a CSP do item 6 vai em `<meta>` no `index.html`, sem `frame-ancestors`, que o navegador ignora em `<meta>`. A política completa vai como cabeçalho de resposta, por `session.webRequest.onHeadersReceived`. Faltava saber se o cabeçalho alcança o documento carregado de `file://`, que é como o aplicativo roda fora do desenvolvimento.
- **Verificação no Electron 44.9.0:** `onHeadersReceived` é chamado para o documento de `file://`, e a política do cabeçalho é aplicada. Num teste à parte, um script inline rodou sem o cabeçalho e foi bloqueado com ele, e uma página `file://` dentro de um iframe foi bloqueada por `frame-ancestors 'none'` vindo do cabeçalho. No aplicativo, o `fetch` do próprio `index.html` volta com o cabeçalho completo, tanto em `http://localhost:5173` quanto em `file://`.
- **Consequência:** `frame-ancestors 'none'` vale em desenvolvimento e em produção, sem protocolo próprio.

### 2026-10-19, Tarefa 3: pedidos `file:` limitados à pasta do renderer

- **Contexto:** numa página `file://`, o Chromium trata como `'self'` qualquer URL `file:`. Conferido no aplicativo, com a CSP do item 6: a página carregou como script um arquivo de fora da pasta do aplicativo (`C:\Windows\System32\drivers\etc\hosts`) e leu `C:\Windows\win.ini` por `fetch`. Um repositório clonado é conteúdo não confiável (seção 17.1), e um script dele passaria por `script-src 'self'`.
- **Decisão:** `restrictFileRequests`, em `apps/desktop/src/main/security.ts`, cancela por `session.webRequest.onBeforeRequest` todo pedido `file:` fora de `out/renderer`. Não há protocolo próprio nesta etapa, para não ampliar a superfície.
- **Consequência:** conferido de novo em `file://`: o `index.html` carrega e o `ping` responde, e o script de fora e o `fetch` do `win.ini` falham. Um protocolo próprio (por exemplo `app://`) resolve a mesma questão por completo e pode substituir o filtro quando o empacotamento for decidido.

### 2026-10-19, Tarefa 3: navegação, janelas novas e permissões

- **Navegação:** `will-navigate` só deixa seguir para a mesma origem do aplicativo, que em desenvolvimento é a do servidor do Vite. Em `file://` a origem é opaca, e nenhuma navegação de documento passa. Por isso o roteamento do renderer troca só o hash ou fica em memória, o que não dispara `will-navigate`.
- **Janelas novas:** `setWindowOpenHandler` nega todas. Um destino `https:` ou `mailto:`, e só esses, pode abrir no programa padrão do sistema, com a URL normalizada, depois da confirmação descrita abaixo.
- **Confirmação antes de abrir fora (seção 17.2):** antes de todo `shell.openExternal`, vindo de navegação ou de janela nova, o processo principal mostra `dialog.showMessageBox` com o endereço normalizado e os botões Abrir e Cancelar. Cancelar é o padrão e também a resposta do Esc. O endereço só abre depois de Abrir; se o diálogo falhar, não abre. O diálogo é nativo, então o renderer não consegue forjar a resposta. Sem essa etapa, a navegação externa seria um canal de saída de dados que a CSP não cobre. Os demais protocolos, `http:` incluído, continuam recusados antes da pergunta, como manda `isAllowedExternalUrl`.
- **Permissões e sandbox:** a sessão nega todo pedido e toda consulta de permissão (câmera, microfone, localização, notificações e outras). `app.enableSandbox()` liga o sandbox em todo renderer, além do `sandbox: true` da janela.

### 2026-10-19, Tarefa 3: um listener por evento do `webRequest`

- **Contexto:** o Electron guarda um só listener por evento de `session.webRequest` em cada sessão. Conferido no Electron 44.9.0: com dois registros de `onHeadersReceived` e dois de `onBeforeRequest` na mesma sessão, só o último de cada um rodou. Um registro novo apaga o anterior sem aviso, e nenhum teste falharia.
- **Decisão:** os listeners de `webRequest` da sessão são registrados só pelas funções de `apps/desktop/src/main/security.ts`: `applyContentSecurityPolicy` para `onHeadersReceived` e `restrictFileRequests` para `onBeforeRequest`. Nada registra listener direto em `session.defaultSession`. Quem precisar de outro comportamento num desses eventos estende a função que já o ocupa, e um evento novo ganha sua função no mesmo arquivo.
- **Consequência:** a CSP no cabeçalho e o filtro de arquivos não somem por um registro feito em outra parte do código.
