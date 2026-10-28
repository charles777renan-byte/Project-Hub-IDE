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
- **Nota (Tarefa 7):** o `execa` desta decisão foi substituído pelo `execFile` do Node. O motivo e o que continua valendo estão em "Registros posteriores", na entrada "2026-10-19, Tarefa 7: `execFile` do Node no lugar do `execa`".

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

- **Consequência:** Qualquer afrouxamento precisa de uma entrada em "Registros posteriores", com o motivo. O servidor de desenvolvimento do Vite pode pedir diretivas a mais; se pedir, o afrouxamento vale só em desenvolvimento. Na Tarefa 4 ele não pediu nenhuma: o CSS do renderer é ligado por `<link>` (ver "Registros posteriores").

## 7. Rebuild do better-sqlite3 para o runtime do Electron

- **Contexto:** O `better-sqlite3` é um módulo nativo (C++). Cada binário vale para uma ABI (`NODE_MODULE_VERSION`): o Node 24.22.0 usa a 137 e o Electron 44.9.0 usa a 149. O mesmo arquivo `.node` não carrega nos dois.
- **Decisão:** O aplicativo roda com o `better-sqlite3` reconstruído para o runtime do Electron, por exemplo com `@electron/rebuild`. Os testes de integração com SQLite rodam no Node do Vitest e usam o binário do Node. O fluxo exato (quando reconstruir e como manter os dois binários) é definido na criação do pacote `database` e registrado aqui.
- **Consequência:** O rebuild exige ferramentas de compilação nativa (seção 24.1). No Windows: Visual Studio Build Tools com a carga de trabalho "Desenvolvimento para desktop com C++" e Python 3, para o node-gyp. No macOS: Xcode Command Line Tools. No Linux: compilador, Python e as bibliotecas necessárias ao Electron. Quando não existe binário pré-compilado para o Electron em uso, a instalação compila a partir do código-fonte, e sem essas ferramentas ela falha.

## 8. Convenções de teste e de build

- **Nome dos testes:** `*.test.ts` e `*.test.tsx` são unitários. Os do renderer ficam em `apps/desktop/test/renderer/` e rodam em jsdom (ver "Registros posteriores"). Testes com recursos reais (Git ou SQLite) usam `*.integration.test.ts`. `pnpm test` roda tudo menos os de integração, e `pnpm test:integration` roda só eles. Os testes de ponta a ponta do Playwright usam `*.spec.ts`.
- **Build:** `pnpm build` roda o build real dos bundles com electron-vite desde a Tarefa 12.1 (ver "Registros posteriores", entrada da Tarefa 12.1). O renderer sai minificado desde a Tarefa 12.2. Os tipos continuam sendo conferidos por `pnpm typecheck`, que faz parte do gate.
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

### 2026-10-19, Tarefa 4: React, roteamento por hash e testes do renderer

- **Decisão:** o renderer usa React 19.3.1, React DOM 19.3.1 e React Router 8.4.0, todos em `devDependencies` de `apps/desktop`, com versão exata. Ficam em `devDependencies` porque o Vite junta o renderer inteiro no bundle, como faz com os pacotes do workspace (registro de build da Tarefa 3). Não há plugin do Vite para React: o Vite compila o JSX sozinho (conferido no build e nos testes), e o `tsconfig.json` do desktop usa `"jsx": "react-jsx"` e acrescenta `"DOM"` em `lib`.
- **React Router 8.4.0, e não a `latest`:** a 8.5.0 foi publicada menos de um dia antes da instalação, abaixo do prazo mínimo de um dia (`minimumReleaseAge`, item 1). A 8.4.0 é a mais nova que já tinha mais de um dia.
- **Roteamento por hash:** `main.tsx` usa `HashRouter`, e os testes usam `MemoryRouter`. `BrowserRouter` não entra em lugar nenhum: em produção o renderer carrega de `file://`, onde rotas por caminho não funcionam. Trocar só o `#` funciona e não dispara `will-navigate` (ver "navegação, janelas novas e permissões"); conferido no aplicativo, em `http://localhost:5173` e em `file://`, com o Tab e o Enter. As rotas desta etapa são `/` (Início) e `/projects` (Projetos).
- **Testes:** o projeto `renderer` do `vitest.config.ts` roda `apps/desktop/test/renderer/**` em jsdom 30.1.3, com `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.8 e `@testing-library/jest-dom` 7.0.1. O arquivo `apps/desktop/test/renderer/setup.ts` registra os matchers do jest-dom e limpa o DOM entre os testes. O projeto `unit` deixa de fora essa pasta e todo `*.test.tsx`, então cada arquivo roda uma vez só, e `**/dist/**` entrou nas exclusões de todos os projetos. Um `*.test.tsx` fora de `apps/desktop/test/renderer/` não roda em projeto nenhum.
- **Consequência:** os testes do renderer só passam pela configuração da raiz (`pnpm test`, ou `pnpm exec vitest run <arquivo>` a partir da raiz). `pnpm --filter @project-hub/desktop test` roda o Vitest do pacote com a configuração padrão, sem jsdom, e os arquivos de `test/renderer/` falham com `document is not defined`. Dentro do projeto `renderer`, `new URL('texto literal', import.meta.url)` não serve para achar arquivos: o Vite reescreve esse padrão para um endereço `http://localhost`. Os testes usam `import.meta.dirname`.

### 2026-10-19, Tarefa 4: CSS ligado por `<link>`, sem afrouxar a CSP

- **Contexto:** `style-src 'self'` (item 6) recusa estilo inline. Em produção, o Vite extrai o CSS para um arquivo (`out/renderer/assets/index-<hash>.css`) e o liga por `<link>`, o que a política aceita. Em desenvolvimento, o cliente do Vite transforma o CSS importado por um módulo TS em elementos `<style>` (função `updateStyle`, em `vite/dist/client/client.mjs`). Conferido no Electron 44.9.0, com `import './styles/app.css'` em `main.tsx`: o Vite inseriu dois `<style>` (um por arquivo CSS), o Chromium registrou o erro "Applying inline style violates the following Content Security Policy directive 'style-src 'self''" e a página ficou sem estilo.
- **Decisão:** o `index.html` liga `styles/tokens.css` e `styles/app.css` por `<link rel="stylesheet">`, e nenhum módulo do renderer importa CSS. O Vite serve esses arquivos como CSS nos dois modos, e a atualização a quente do CSS continua funcionando (conferido: "css hot updated", sem recarregar a página). Nenhuma diretiva da CSP foi afrouxada, nem em desenvolvimento, e a `<meta>` do item 6 ficou como estava.
- **Consequência:** o `index.html` não tem `<style>` nem atributo `style`. O teste `apps/desktop/test/renderer/renderer-styles.test.ts` confere isso e confere que nenhum módulo do renderer importa CSS. CSS novo entra em `app.css` ou num arquivo novo ligado por `<link>` no `index.html`.

### 2026-10-19, Tarefa 5: `schema_migrations` com o shape do Drizzle

- **Contexto:** o brief descreve a tabela de controle `schema_migrations` com `id TEXT PK` e `applied_at TEXT`. O `migrate` do Drizzle aceita o nome pela opção `migrationsTable`, mas cria a tabela ele mesmo, com `id SERIAL PRIMARY KEY`, `hash text NOT NULL` e `created_at numeric`.
- **Decisão:** a tabela usa o shape do Drizzle. Não há migrador próprio: o `migrate` do Drizzle roda as migrações numa transação, e o shape do brief exigiria reimplementá-lo.
- **Consequência:** o nome `schema_migrations` vale, mas as colunas são outras. A regra de pendência lê `created_at` (o `when` do journal), e não `applied_at`.

### 2026-10-19, Tarefa 5: tipos de `packages/domain` importados por caminho relativo

- **Contexto:** `packages/database` usa os tipos `ProjectRecord` e `NewProject`, de `packages/domain`. O pacote não declara `@project-hub/domain` como dependência, e declarar exige editar o `package.json` e o lockfile e rodar `pnpm install`, o que as regras da fundação proíbem nesta etapa.
- **Decisão:** o import é de tipo e usa caminho relativo (`../../../domain/src/project`). Ele some na compilação, então não há efeito em tempo de execução.
- **Consequência:** é aceito até o pacote de banco consumir o domínio em tempo de execução. Nesse momento, declara-se `"@project-hub/domain": "workspace:*"` e exporta-se o domínio pelo índice dele.

### 2026-10-19, Tarefa 6: caminhos validados no processo principal e operações por `id`

- **Decisão:** `projects:add` revalida o caminho no processo principal, na aplicação (`addProject`). O caminho precisa ser absoluto (`VALIDATION_FAILED`), não pode ser vazio (o schema recusa antes) e tem de apontar para um diretório que existe (`PROJECT_PATH_UNAVAILABLE`). As operações das tarefas seguintes (Git, worktrees, remoção) identificam o projeto por `id`, nunca pelo caminho que veio do renderer. `ProjectSummary.path` serve só para exibição.
- **Motivo:** o caminho que volta do renderer é entrada não confiável (seção 17.1), e a seção 13.1 pede versões sanitizadas. A revalidação no processo principal cobre um renderer comprometido, que o preload sozinho não cobre (seção 17.2).
- **Consequência:** as tarefas seguintes recebem `id` nos casos de uso. Caminho relativo nunca vira projeto.

### 2026-10-19, Tarefa 6: remetente do IPC e validação das respostas

- **Decisão:** todo handler IPC do processo principal (`app:ping:v1` e os `projects:*`) confere o remetente antes de rodar, pelo `event.senderFrame.url` e por `isTrustedSenderUrl`, em `security.ts`. Em desenvolvimento, a origem é a do servidor do Vite, e vale `isAllowedNavigation`. Em produção, a origem é `file://`, que é opaca: o remetente confiável é qualquer arquivo dentro de `out/renderer`, pelo critério de `isFileUrlInside`. Chamada de outra origem recebe `PERMISSION_DENIED`, código que já existe em `ERROR_CODES`, e o handler não roda. O preload confere a resposta de cada canal com o schema dele (`responseSchemas`, em `packages/contracts`) e devolve `VALIDATION_FAILED` quando não bate.
- **Motivo:** a seção 17.2 trata o renderer comprometido como ameaça, e o relatório da Tarefa 3 deixou a checagem para esta tarefa. Aplicar `isAllowedNavigation` a `file://` recusaria toda chamada em produção, porque a origem opaca nunca bate com ela.
- **Consequência:** nenhum código de erro novo. Um canal novo passa por `registerTrustedHandler` e ganha entrada em `responseSchemas`.

### 2026-10-19, Tarefa 6: `better-sqlite3` fora do bundle e migrações ao lado do bundle

- **Contexto:** o electron-vite deixa de fora do bundle só o que está em `dependencies` de `apps/desktop`. Sem isso, o bundle do processo principal embute o `better-sqlite3`, e o carregador dele procura `prebuilds/` ao lado de `out/main`. Além disso, o `migrate.ts` lê as migrações em `new URL('../migrations', import.meta.url)`, que no bundle aponta para `out/migrations`, pasta que o build não criava. Os dois problemas aparecem no `electron-vite build` antes da correção.
- **Decisão:** `better-sqlite3` 13.0.3, a mesma versão de `packages/database`, entra em `dependencies` de `apps/desktop`, como o item sobre módulos nativos manda. `electron.vite.config.ts` copia `packages/database/migrations` para `out/migrations` no início de cada build do processo principal, também nos rebuilds do modo watch, antes de o bundle sair (R75).
- **Motivo:** o `better-sqlite3` 13 traz um binário N-API em `prebuilds/`. Carregado pelo runtime do Electron 44.9.0 (Node 24.22, ABI 149) com `ELECTRON_RUN_AS_NODE=1`, o módulo abre um banco em memória sem erro de ABI, sem abrir janela. A cópia é a solução mais simples até a Tarefa 12 definir o empacotamento.
- **Consequência:** a lockfile ganhou a entrada de `apps/desktop` e os links de `packages/application` e `packages/database`. A lista de versões de pacotes não mudou (502 antes e depois). Abrir o banco dentro da janela continua pendente do passo 10 do plano, que é verificação manual.

### 2026-10-19, Tarefa 7: `execFile` do Node no lugar do `execa`

- **Contexto:** o item 2 e o plano pedem `execa`. Ele é uma dependência externa nova, e dependência nova só entra com a permissão do usuário (R46).
- **Decisão:** `runGit`, em `packages/git-adapter/src/run-git.ts`, usa `execFile` de `node:child_process`. Continuam valendo as garantias do item 2: sem shell, argumentos em array, tempo limite (`timeoutMs`, padrão 15000) e executável ausente (`ENOENT`) como `GIT_NOT_AVAILABLE`, com a mensagem "Instale o Git e reinicie o Project Hub.". O `windowsHide` evita a janela de console do `git.exe` no Windows.
- **`ENOENT` de pasta ausente:** o Node responde `ENOENT` também quando o `cwd` não existe. Nesse caso `runGit` confere a pasta e devolve `PROJECT_PATH_UNAVAILABLE`, para uma pasta que sumiu não aparecer como Git não instalado.
- **Consequência:** nenhuma dependência nova, e o lockfile só ganhou links entre pacotes do workspace. Se o `execa` entrar um dia, só o `run-git.ts` muda.

### 2026-10-19, Tarefa 7: lista de permissão do `runGit` e ambiente do processo

- **Decisão:** `runGit` só roda `status`, `rev-parse`, `symbolic-ref` e `branch --show-current` (os argumentos de `branch` têm de ser exatamente esses). O subcomando precisa ser o primeiro argumento, então `-c`, `-C` e `--exec-path` antes dele são recusados. Qualquer outro comando rejeita com `PERMISSION_DENIED` antes de criar o processo. O `symbolic-ref` escreve quando recebe um segundo nome e quando recebe `-d` ou `-m`, então só vale a forma de leitura: um nome, com as opções `--short`, `-q` ou `--quiet`. Depois dessa checagem, o adaptador acrescenta `-c core.fsmonitor=false` antes do subcomando em toda chamada: o `core.fsmonitor` da configuração de um repositório não confiável (seção 17.1) é um comando que o `git status` executaria. Só o adaptador passa `-c`; o do chamador continua recusado.
- **Ambiente:** o processo roda com `LC_ALL=C` (a detecção reconhece "not a git repository" no texto de erro, que sem isso sairia traduzido), `GIT_OPTIONAL_LOCKS=0` (o `status` não regrava o índice, então ler não altera o repositório) e sem `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` e `GIT_COMMON_DIR`, que fariam o Git ignorar a pasta recebida.
- **Motivo:** RF-GIT-007, seção 17.2 e seção 11 de `docs/regras-subagentes.md`. A API pública de `@project-hub/git-adapter` não exporta nada com `commit`, `push`, `merge`, `fetch` ou `pull` no nome, e um teste confere.
- **Consequência:** a Tarefa 8 acrescenta `worktree` à lista, com uma entrada aqui dizendo quais formas valem. Subcomando novo não entra sem essa entrada.

### 2026-10-19, Tarefa 7: detecção, status e erros do Git

- **Detecção (regra de subpasta revogada por R199, ver a seção R198 a R200):** uma pasta é Git quando `rev-parse --is-inside-work-tree` diz `true`, o que inclui subpastas de um repositório. Repositório bare e a pasta `.git` dão `none`. A branch padrão é a que `origin/HEAD` aponta (`symbolic-ref`), senão a branch em uso (`branch --show-current`), e em HEAD destacado sem remoto não há branch.
- **O que vira `none`:** só a resposta "not a git repository" (código 128). Git ausente, tempo esgotado, pasta recusada por dono diferente (`safe.directory`) e qualquer outra falha sobem como `GitError`: cadastrar como "sem Git" por engano esconderia o problema.
- **Status:** `getStatus` faz uma chamada só, `status --porcelain=v2 --branch --untracked-files=all -z`. Cada arquivo conta uma vez (renomeado inclusive), e cada arquivo de uma pasta nova conta, e não a pasta. Em HEAD destacado a branch é `HEAD`. Repositório sem commits rejeita, porque não tem `baseCommit`.
- **Erros:** `GitError` leva `code` e `message` do contrato `AppError`, mais `exitCode` e `stderr`. A saída de erro do Git não entra na mensagem, porque pode trazer conteúdo do repositório (seção 17.1). `GIT_NOT_AVAILABLE` já constava em `ERROR_CODES` (seção 13.7), então não houve código novo nem mudança no teste do contrato. Falha sem código específico usa `UNKNOWN`.
- **Erro do Git na tela:** `registerTrustedHandler`, em `apps/desktop/src/main/ipc/trusted-handler.ts`, devolve o `code` e a `message` de um `GitError` (por exemplo `GIT_NOT_AVAILABLE`, com a instrução de instalar o Git), e só dele. Qualquer outro erro continua `UNKNOWN` ("Algo deu errado"). Um teste cobre o `projects:add` com o Git ausente.

### 2026-10-19, Tarefa 7: `restore` grava a detecção e `addProject` consulta a duplicata antes do Git

- **Contexto:** uma pasta removida pode ter ganhado ou perdido o Git até ser cadastrada de novo, e o `restore` só limpava `removedAt`. Além disso, `addProject` chamava o detector antes de procurar a duplicata, então uma pasta repetida rodava o Git à toa.
- **Decisão:** `restore(id, updatedAt, git)`, com `git: { repositoryKind; defaultBranch? }`, grava o tipo e a branch padrão da detecção nova, e `defaultBranch: null` quando ela não traz branch. A porta em `packages/application` e o repositório em `packages/database` mudaram juntos. `addProject` procura a duplicata ativa antes de chamar o Git.
- **Dois lookups:** o Git é assíncrono, então outro cadastro da mesma pasta pode gravar enquanto ele roda. `addProject` repete a consulta depois do `await`, e daí até a escrita não há `await` (a invariante do cadastro continua). Um teste com dois cadastros simultâneos confere que o segundo recebe `PROJECT_ALREADY_EXISTS`, e não um erro do índice único.

### 2026-10-19, Tarefa 8: `runGitWorktree` e as formas fixas de escrita

- **Contexto:** `runGit` é só de leitura (RF-GIT-007), mas criar e remover worktree escreve. Acrescentar `worktree` à lista de `runGit` o deixaria escrever, e a Tarefa 7 prometeu uma entrada aqui dizendo quais formas valem.
- **Decisão:** `runGit` continua só de leitura e recusa qualquer `worktree`. As escritas passam por `runGitWorktree`, em `packages/git-adapter/src/run-git.ts`, que aceita exatamente duas formas: `['worktree', 'add', '-b', <branch>, <pasta>, <base>]` e `['worktree', 'remove', <pasta>]`. Nunca `--force`, `-B`, `--detach`, `branch -d` ou `-D`, `push`, `fetch`, `pull`, `merge`, `commit`, `reset` nem `clean`. Os três valores de `add` e a pasta de `remove` não podem ser vazios nem começar com `-`, para o Git não os ler como opção. Qualquer outra forma rejeita com `PERMISSION_DENIED` antes de criar um processo, e um teste recusa cada uma, com o `execFile` imitado.
- **Proteções em comum:** `runGit` e `runGitWorktree` passam pela mesma função interna (`runApproved`, não exportada), cada uma depois da sua lista de permissão: `execFile` sem shell, argumentos em array, ambiente sem `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` e `GIT_COMMON_DIR`, e `-c core.fsmonitor=false` antes do subcomando. A lista de `runGit` não mudou. O `worktree add` leva também um `-c core.hooksPath` (registro de 2026-10-20, abaixo).
- **Tempo limite:** o padrão de `runGitWorktree` é 120 s, e não os 15 s de uma leitura: o checkout de um repositório grande leva mais, e cortá-lo no meio deixaria um worktree pela metade. `timeoutMs` o troca.
- **Consequência:** `runGitWorktree` não sai de `index.ts`. Quem usa o adaptador chama `createWorktree` e `removeWorktree`. Um subcomando de escrita novo só entra com uma entrada aqui.

### 2026-10-19, Tarefa 8: a pasta do worktree tem de ficar dentro da raiz

- **Decisão:** `createWorktree` exige `worktreesRoot` absoluta (`VALIDATION_FAILED`), resolve `<worktreesRoot>/<relativeDir>` com `path.resolve` e só segue se o resultado estiver estritamente DENTRO da raiz, pela conta de `path.relative`. Pasta relativa com `..`, absoluta, de rede ou de outra unidade, e a própria raiz, rejeitam com `PATH_OUTSIDE_ALLOWED_SCOPE` (código que já existe) antes de qualquer comando do Git. A base (`baseRef`) vazia ou começando com `-` também é recusada antes do Git, com `WORKTREE_CREATE_FAILED`, porque o `rev-parse` a leria como opção.
- **Motivo:** `buildWorktreeNames` nunca gera `..`, mas `createWorktree` recebe `names` como dado e não deve confiar nele (seção 17.1: entrada que vem de fora é não confiável). `path.relative` e não teste de prefixo, porque `C:\raiz-outra` começa com `C:\raiz`. Os testes montam à mão pastas que de fato escapam e conferem que nada é criado fora da raiz.
- **Limite:** a checagem é de texto. Um link simbólico ou junção que já exista dentro da raiz e aponte para fora não é seguido nem recusado; a raiz é uma pasta do aplicativo (item 5), e quem consegue criar o link nela já escreve onde quiser.

### 2026-10-19, Tarefa 8: remoção protegida e colisão

- **Remoção, duas guardas hoje (eram três; a guarda dos ignorados foi revogada por R198, ver a seção R198 a R200), nenhuma com `--force` (corrigido em 2026-10-20):** `removeWorktree` exige `worktreePath` absoluto (`VALIDATION_FAILED`, como `createWorktree` faz com a raiz). Lê o `getStatus` do worktree, e com `changedFiles > 0` rejeita com `WORKTREE_HAS_UNSAVED_CHANGES` sem chamar `worktree remove`. Só então roda `worktree remove <pasta>`, que recusa por conta própria uma pasta com arquivo modificado (o caso de uma alteração que chegou depois do status). Arquivo novo não ignorado é protegido pelo `getStatus` (`--untracked-files=all`): com `status.showUntrackedFiles=no` o `worktree remove` o apagaria, e só a guarda do status o impede. Essa recusa também vira `WORKTREE_HAS_UNSAVED_CHANGES`, reconhecida pelo texto "contains modified or untracked files" (o ambiente fixa `LC_ALL=C`). Qualquer outra recusa do Git sobe como `GitError`. A branch nunca é apagada. `removeWorktree` não apaga o checkout principal nem uma pasta que o Git não conhece como worktree do repositório: o Git recusa as duas.
- **Arquivos ignorados (REVOGADO por R198, ver a seção R198 a R200; o texto abaixo descreve o que existia até dae4c3e):** o `git worktree remove` apaga os arquivos ignorados (`.env`, `node_modules`, saídas de build) junto com a pasta, e o `status` comum não os lista, então um worktree "limpo" podia perder um `.env`. `removeWorktree` faz uma leitura separada no worktree, `status --porcelain=v2 --ignored --untracked-files=normal -z` (`hasIgnoredFiles`, em `status.ts`; `runGit` já aceita qualquer `status`), e qualquer registro `! <caminho>` (arquivo ou pasta inteira ignorada, de `.gitignore` ou de `.git/info/exclude`) rejeita com `WORKTREE_HAS_UNSAVED_CHANGES`, com uma mensagem que fala em arquivos ignorados, antes do `worktree remove`. O `--untracked-files=normal` é explícito porque `status.showUntrackedFiles=no` na configuração do repositório (de terceiros, seção 17.1) faz o `--ignored` não listar nada, e sem ele um `.env` passaria; um teste de integração cobre essa configuração. O campo que segue um registro de renomeado é o caminho antigo, e não um registro, então um nome antigo começando com `! ` não conta. Para remover, o usuário salva ou apaga esses arquivos antes. Fica por conta da tela de remoção (Tarefas 9 a 12) oferecer essa limpeza.
- **Colisão:** `createWorktree` resolve a base, e rejeita com `WORKTREE_COLLISION` se a pasta existir (qualquer coisa nela, arquivo inclusive) ou se a branch local existir, sem tocar no que existe. Como a branch fica depois da remoção, criar de novo com os mesmos nomes colide. A base inválida rejeita com `WORKTREE_CREATE_FAILED` antes de qualquer criação, então nada fica para trás; uma falha do próprio `worktree add` também vira `WORKTREE_CREATE_FAILED`, e o Git desfaz sozinho o que começou. Git ausente continua `GIT_NOT_AVAILABLE`. A criação parte do commit inteiro que a base resolveu, e não do nome dela.
- **Códigos:** os três (`WORKTREE_COLLISION`, `WORKTREE_CREATE_FAILED`, `WORKTREE_HAS_UNSAVED_CHANGES`) já estavam em `ERROR_CODES`; nenhum código novo, e o teste do contrato não mudou.
- **Não coberto:** um worktree registrado no Git cuja pasta foi apagada por fora só é detectado quando a branch ainda existe (a colisão sai pela branch). Listar os worktrees (`worktree list`) fica para a reconciliação (seção 16.6), que traz o comando e a entrada aqui.

### 2026-10-19, Tarefa 8: nomes seguros e `missionShortId`

- **Slug:** o título passa por um sanitizador só: minúsculas ASCII, o acento vira a letra base (`Ação` vira `acao`), toda sequência fora de `[a-z0-9]` vira um `-`, sem `-` nas pontas, no máximo 40 caracteres (o corte não deixa `-` no fim), `missao` quando nada sobra e prefixo `x-` num nome reservado do Windows (`con`, `prn`, `aux`, `nul`, `com1` a `com9`, `lpt1` a `lpt9`). Letras sem decomposição, como `ß` e `ø`, viram `-`.
- **`projectSlug` (R99):** passa pelo mesmo sanitizador, com as mesmas regras, inclusive `missao` para o vazio e o corte em 40.
- **`missionShortId` (R100):** os 8 primeiros caracteres de `missionId`, depois as mesmas regras do slug (minúsculas ASCII, sem `-` nas pontas, sem corte nem `missao`). Pode ficar com menos de 8 (`abc-----xyz` dá `abc`). Se não sobra nenhum caractere, `buildWorktreeNames` rejeita com `VALIDATION_FAILED`, porque dois ids assim gerariam o mesmo nome. Um UUID dá os 8 primeiros hexadecimais.
- **Formato:** `branch = ph/<missionShortId>-<slug>` e `relativeDir = <projectSlug>/<missionShortId>-<slug>`, sempre com `/`. O resultado só tem `[a-z0-9-]` e a barra, então não contém `..`, `\` nem `//`.

### 2026-10-20, Tarefa 8 (correção 1): hook `post-checkout` de repositório de terceiros não roda

- **Contexto:** o `worktree add` faz um checkout, e o checkout roda o hook `post-checkout` do repositório (na pasta `hooks` dele ou na indicada por `core.hooksPath` da configuração dele). Num repositório de terceiros (seção 17.1) é código alheio, executado pelo Project Hub. O `-c core.fsmonitor=false` do adaptador já tratava o caso análogo do `status`. Um teste de controle mostrou o problema: com um `post-checkout` que grava um marcador, o `createWorktree` gravava o marcador.
- **Decisão:** só no `worktree add`, `runGitWorktree` acrescenta `-c core.hooksPath=<pasta>` logo depois do `-c core.fsmonitor=false` e antes do subcomando, com uma pasta vazia. A pasta é criada pelo adaptador (`mkdtemp` em `os.tmpdir()`, nome aleatório, modo restrito no POSIX), uma por chamada, e apagada ao fim, com sucesso ou falha (se a limpeza falhar, sobra uma pasta vazia na pasta temporária, e o resultado do `add` não é escondido). Se a pasta não puder ser criada (pasta temporária sem permissão ou cheia), o `add` rejeita com `WORKTREE_CREATE_FAILED`, sem criar processo e sem deixar o erro cru do sistema de arquivos subir. Foi escolhida em vez de uma pasta fixa e de uma opção do chamador: um nome previsível na pasta temporária deixaria alguém plantar hooks nela, e uma opção deixaria cada chamador responsável por não esquecer. O `-c` de linha de comando vale mais que o `core.hooksPath` da configuração do repositório; um teste cobre os dois caminhos de hook. O `worktree remove` não faz checkout e não leva o `-c`; `runGit` também não.
- **Consequência:** hooks do repositório não rodam na criação de worktree pelo Project Hub. Se o produto quiser rodar um bootstrap, será uma ação à parte e aprovada (seção 16.3, passo 9), e não um hook herdado. O flag só vem do adaptador: o `-c` do chamador continua recusado.

### 2026-10-20, Tarefa 9: migração gerada pelo drizzle-kit (`0001_missoes`)

- **Contexto:** o plano previa `0002_missoes.sql` escrito à mão. O R4 manda gerar todas as migrações pelo drizzle-kit, e o nome sai como `0001`, porque a `0000_projetos` já existe.
- **Decisão:** `drizzle-kit generate --name missoes` gera `0001_missoes.sql` e o snapshot. Entram as seis tabelas das seções 9.1 e 9.4 que a tarefa usa: `missions`, `mission_acceptance_criteria`, `mission_steps`, `executions`, `approval_requests` e `audit_events`. Ficam para as próximas tarefas as tabelas `agent_profiles`, `worktrees`, `terminal_sessions`, `artifacts` e `app_settings`.
- **Consequência:** o teste de migração espera `['0000_projetos', '0001_missoes']` (R119). A migração só cria tabelas e índices novos.

### 2026-10-20, Tarefa 9: `@project-hub/domain` declarado em `packages/database`

- **Contexto:** o schema lê as listas de valores das enumerações em runtime, para os `CHECK` do banco. O registro da Tarefa 5 previa declarar o pacote quando isso acontecesse.
- **Decisão:** `"@project-hub/domain": "workspace:*"` em `packages/database`, importado pelo índice do pacote. O `project-repository.ts` deixa o caminho relativo e importa do mesmo jeito.
- **Consequência:** o `pnpm install` só ligou os workspaces. O lockfile ganhou entradas de importers, sem versão nova.

### 2026-10-20, Tarefa 9: máquina de estados e nova tentativa

- **Decisão:** `canTransition` segue a seção 9.3 e acrescenta duas arestas. `failed` e `cancelled` voltam para `queued`, e é assim que uma nova tentativa começa: a missão não vai direto a `running`, e a execução anterior fica encerrada. Cancelar vale de qualquer estado não terminal. `waiting_approval` não vai direto a `failed`: a recusa de uma aprovação passa por `running` (`waiting_approval` -> `running` -> `failed`), e a recuperação após reinício faz o mesmo quando a missão esperava algo.
- **Motivo:** a seção 9.3 não diz como uma nova tentativa sai de um estado final sem voltar a `running`. Com `queued`, a execução anterior continua terminal e a nova é outra `Execution`, como manda a seção. A passagem por `running` mantém a tabela sem arestas fora da seção.
- **Consequência:** `failed` e `cancelled` deixam de ser finais para a missão, mas continuam finais para a execução. Quem mostrar o estado da missão precisa tratar `queued` depois de `failed`.

### 2026-10-20, Tarefa 9: `WorktreePort` na porta, nomes injetados pela composição

- **Decisão:** `WorktreePort` tem `create` e `remove`, com as formas de `createWorktree` e `removeWorktree` (R122). `packages/application` não importa `@project-hub/git-adapter`: o nome do worktree vem de uma função injetada (`worktreeNames`), que a composição liga a `buildWorktreeNames`. Quando a criação falha, a porta rejeita com um erro que traz `code` do contrato, e o orquestrador devolve esse código.
- **Consequência:** a composição (Tarefa 10) faz a ligação. `remove` está na porta e ainda não é chamado por nenhum caso de uso, porque o encerramento do worktree fica para a tarefa que trata da revisão.

### 2026-10-20, Tarefa 9: auditoria com `sequence` por agregado, numa transação

- **Decisão:** `sequence` cresce dentro de cada `aggregate_id`, com índice único em `(aggregate_id, sequence)`. O repositório atribui o número na própria gravação. Cada transição de missão e a auditoria dela entram numa transação (`repo.transaction`). Os eventos do agente vão para a auditoria da execução, com `actor = agent`, na ordem em que chegaram.
- **Consequência:** a ordem de gravação segue a seção 15.3: estado e auditoria antes de qualquer retorno. Ainda não há atualização visual, que chega com a Tarefa 10.

### 2026-10-20, Tarefa 9: `provideInput` e os códigos `MISSION_NOT_FOUND` e `APPROVAL_NOT_FOUND`

- **Contexto:** o brief não traz método para responder ao pedido de entrada do agente, e sem ele `waiting_input` não tem saída. A seção 13.7 também não tem código para missão ou aprovação inexistente.
- **Decisão:** o `Orchestrator` ganha `provideInput({ missionId, text })`, que leva `waiting_input` a `running`. `ERROR_CODES` ganha `MISSION_NOT_FOUND` e `APPROVAL_NOT_FOUND`. Os outros códigos usados já existiam: `PROJECT_WITHOUT_GIT`, `MISSION_INVALID_STATE`, `VALIDATION_FAILED`, `PROJECT_NOT_FOUND`, `APPROVAL_EXPIRED`, `AGENT_UNAVAILABLE` e `PATH_OUTSIDE_ALLOWED_SCOPE`.

### 2026-10-20, Tarefa 9: agente simulado

- **Caminho fora do worktree (R125):** `create-file` recusa caminho absoluto, com `..` ou que caia fora da pasta de trabalho. A recusa vira `tool.completed` com `PATH_OUTSIDE_ALLOWED_SCOPE`, e a sessão termina com `session.failed`. Um link simbólico dentro da pasta não é verificado, igual à Tarefa 8.
- **Aprovação:** `approve` com `rejected` termina a sessão com `session.failed` e `APPROVAL_REQUIRED`. O roteiro não informa o tipo de ação protegida, então o pedido sai com `write_outside_worktree`.
- **Uso:** o adaptador não informa uso (`usageReporting: false`). Cancelar (abortar o sinal ou chamar `stop`) para a sessão sem emitir mais nada (R126).

### 2026-10-20, Tarefa 10: toda missão roda em worktree (R160)

- **Decisão:** `prepareWorkspace` cria o worktree da missão para toda missão, também a que não altera código (`altersCode` falso). `startMission` recusa com `PROJECT_WITHOUT_GIT` qualquer missão num projeto sem Git. O campo `altersCode` continua gravado, mas deixou de escolher o diretório de trabalho.
- **Motivo:** a decisão do usuário é que nenhum agente roda na pasta original do projeto. Assim, um agente que escreve sem querer fica confinado ao worktree, e o Git do projeto não recebe alteração sem revisão.
- **Consequência:** a pasta de um projeto sem Git não executa missão, mesmo sem alteração de código. O teste de integração `missions-flow` cobre o caso.

### 2026-10-20, Tarefa 10: replanejar e a versão do plano (R161)

- **Decisão:** `planMission` aceita a missão em `planned`, além de `draft`. Replanejar troca as etapas (`replaceSteps`, na mesma transação) e fica registrado na auditoria como `plan.generated`, com os títulos das etapas. A missão continua em `planned`. Uma missão em `queued` ou depois não replaneja.
- **Motivo:** a seção 10.6 pede que um plano refeito seja uma nova versão, e a versão aprovada é a que roda (seção 15.2). A tabela `mission_steps` tem `(missionId, position)` único, e o histórico de versões fica na auditoria. Não há coluna de versão nesta etapa, para não mexer no schema.
- **Consequência:** as etapas só mostram o plano vigente. As versões anteriores estão na auditoria, sem uma consulta própria.

### 2026-10-20, Tarefa 10: canais de missão e o canal de eventos (R165)

- **Decisão:** além dos canais de R165, entram três canais de leitura e de ação, sem os quais a interface não fecha: `missions:list:v1` (cartões da aba Missões, R167), `missions:get:v1` (visão do workspace, R168) e `missions:provide-input:v1` (caixa de resposta ao pedido de entrada, que o orquestrador já trata). `missions:event:v1` vai do processo principal ao renderer, só para a janela principal, e cada evento é conferido por `missionEventDtoSchema` antes do ouvinte. O preload expõe `missions.subscribe(listener)`, que devolve a função de cancelamento.
- **Entrega:** o repositório de missões é envolvido por `withMissionEvents`: cada evento de auditoria de missão ou de tentativa é entregue logo depois da gravação, com o `missionId` da missão dona. Se a transação for desfeita, o renderer recebe um evento sem registro, e a tela busca o estado de novo, então o custo é uma leitura.
- **Respostas:** todo canal de pedido tem schema de resposta em `responseSchemas`. O canal de evento não tem resposta, e o teste de contrato diz isso.
- **Códigos de erro:** nenhum código novo. A entrada inválida devolve `VALIDATION_FAILED`, e a origem não confiável devolve `PERMISSION_DENIED`, como nos canais de projetos.

### 2026-10-20, Tarefa 10: tokens visuais escuros (R172)

- **Decisão:** o aplicativo tem só o tema escuro. Os tokens de cor passam a ser `--bg`, `--panel`, `--panel-2`, `--line`, `--field-line`, `--text`, `--muted`, `--log`, `--amber`, `--violet` e `--pink`, em `tokens.css`, com os valores da especificação de design. Os tokens `--color-*` da Tarefa 4 saem. O teste de contraste lê os novos nomes e confere os pares de texto em 4,5:1: a razão vai de 6,7:1 (pior par) a 17:1 (melhor par).
- **Fontes:** só pilhas do sistema, sem fonte externa (R164). Mono é `ui-monospace, Menlo, Consolas, monospace`.
- **CSP:** nenhum atributo `style` no HTML ou no React. Cores e estados saem de classes CSS, e a barra de progresso é uma classe com animação, com `prefers-reduced-motion` respeitado.

### 2026-10-20, Tarefa 10: `createProjectServices` vira `createAppServices`, e a composição liga as missões

- **Decisão:** a composição do processo principal é `createAppServices`, que abre o banco, aplica as migrações, liga o orquestrador, roda `recoverInterruptedExecutions` e devolve `missions` junto com os serviços de projetos. A raiz dos worktrees vem de `resolveWorktreesRoot`: `APP_WORKTREES_ROOT`, depois `PROJECT_HUB_DATA_DIR/worktrees`, depois `<home>/ProjectHub/worktrees`. O agente é o simulado, com roteiro fixo (`demo-agent.ts`).
- **Motivo:** o nome antigo falava só de projetos. O renomeio atinge um só teste (`projects-flow`).

### 2026-10-20, Tarefa 10: `defaultBranch` no resumo do projeto

- **Decisão:** `ProjectSummary` ganha `defaultBranch?`, preenchido quando a pasta é um repositório Git. A aba de detalhe do projeto mostra a branch no cabeçalho (R167).
- **Consequência:** `contracts.test.ts` confere o tipo novo.

### 2026-10-20, Tarefa 10b: pausa e retomada da missão (R181)

- **Decisão:** `pauseMission` e `resumeMission` no orquestrador. O agente é chamado primeiro (`session.pause()` ou `session.resume()`). Só se ele aceitar, a missão e a execução mudam de estado numa transação, que confere o estado de novo: o agente pode ter terminado enquanto a pausa era pedida. Se a transação falhar, a chamada ao agente é desfeita. Falha do agente vira `AGENT_UNAVAILABLE`, e os dois casos nunca lançam.
- **Motivo:** a ordem inversa deixaria o banco dizendo `paused` enquanto o agente seguia emitindo eventos, e o orquestrador rejeitaria cada um deles. Com o agente primeiro, o pior caso é a missão seguir `running` com um pedido recusado.
- **Consequência:** o agente simulado segura cada `yield` e cada gravação em disco enquanto pausado. A conferência é síncrona com a ação, então nada sai entre a pausa e a retomada. A execução ganha o estado `paused`, e o cancelamento fecha execuções `running` ou `paused`. A recuperação ao iniciar também trata `paused` como interrompida (`failed` com `interrupted_by_restart`), porque a sessão não sobrevive ao fechamento do app.

### 2026-10-20, Tarefa 10b: nova tentativa pelo canal (R180)

- **Decisão:** o canal `missions:retry:v1` chama o `retryMission` que já existia, sem mudar o contrato dele. Ele leva a missão para `queued` e inicia a tentativa na mesma chamada, então a missão não fica `queued` depois de um sucesso: ela segue para o estado em que o agente parou.
- **Motivo:** R180 pedia que o sucesso deixasse a missão `queued`, mas o `retryMission` já inicia a tentativa e a regra do ruling mandava seguir o contrato atual. Mudar isso exigiria um início separado, que não está na especificação.
- **Consequência:** o botão "Tentar de novo" aparece em `failed` e `cancelled`. Se o início falhar antes do agente, a missão fica `queued`, como em qualquer início que falha.

### 2026-10-20, Tarefa 10b: aba da decisão e a Conversa montada (R182)

- **Decisão:** a aba inicial é a Conversa quando a missão está em `waiting_approval` ou `waiting_input`, e o Plano nos outros casos. Enquanto a pessoa não escolhe uma aba, a escolha segue a situação. Um aviso no cabeçalho ("Aguarda sua decisão") leva à Conversa. A Conversa fica montada e escondida quando outra aba está ativa.
- **Motivo:** a resposta digitada é estado da tela. Desmontar a Conversa perderia o texto não enviado.

### 2026-10-20, Tarefa 10b (rodada de correção): capacidade de pausa e estado de controle separado

- **Decisão:** antes de `session.pause()` ou `session.resume()`, o orquestrador consulta `getCapabilities` e checa `pauseResume`. Se for `false`, devolve `AGENT_CAPABILITY_UNSUPPORTED` (código novo em `ERROR_CODES`, porque nenhum código da seção 13.7 descreve um agente que não pausa), sem chamar o agente e sem mudar o estado. A view da missão não leva a capacidade, então o botão Pausar continua visível e a recusa aparece como erro na tela.
- **Decisão:** a tela tem dois estados de espera. `busy` cobre as chamadas longas (início, decisão, resposta, nova tentativa e plano). `controlBusy` cobre só a chamada de pausar, retomar ou cancelar, então os controles funcionam com um início ainda pendente.
- **Motivo:** o início espera o `drive()`, que só termina quando a missão para numa aprovação, numa entrada ou no fim. Desabilitar a pausa durante essa espera impediria o controle que a especificação pede.
- **Consequência:** duas chamadas concorrentes de pausa ou de retomada não se desfazem. A segunda vê o estado pedido, termina com sucesso e não chama o desfazer.

### 2026-10-20, Tarefa 11: variáveis de teste e o que elas liberam (R189)

- **Decisão:** a composição lê duas variáveis para os testes de ponta a ponta. `PROJECT_HUB_DATA_DIR` aponta a pasta de dados: o banco fica em `<pasta>/database/project-hub.sqlite` (`resolveDatabaseFile`) e os worktrees em `<pasta>/worktrees` (`resolveWorktreesRoot`, que já existia). Sem ela, o banco continua em `userData` e os worktrees em `<home>/ProjectHub/worktrees`. `PROJECT_HUB_TEST_DIALOG_PATH` troca o seletor nativo de pasta por um caminho fixo (`resolveDirectoryChooser`), e só é lida quando `PROJECT_HUB_ENV` vale exatamente `test`. Qualquer outro valor (ausente, vazio, `TEST`, `production`) ignora o caminho e abre o diálogo real. Um teste unitário (`test/test-env.test.ts`) prova essa regra.
- **Motivo:** o Playwright não alcança o diálogo nativo de pasta, e o fluxo vertical precisa cadastrar um projeto pela interface. O ponto de troca é só o seletor de pasta (a função que `registerProjectHandlers` já recebia): o caminho escolhido continua passando pela mesma revalidação do cadastro (R66), e nenhuma outra porta lê essas variáveis.
- **Consequência:** quem controla o ambiente do processo escolhe a pasta que o seletor devolve, e quem controla o ambiente já controla o processo inteiro, então a variável não abre acesso novo. O aplicativo empacotado ignora as variáveis (ver a entrada da rodada de correção, R193). A pasta `userData` do Chromium (cache, armazenamento local) não depende de `PROJECT_HUB_DATA_DIR`: os testes a isolam com `--user-data-dir`, no fixture, sem código novo no aplicativo.

### 2026-10-20, Tarefa 11: Playwright e a pasta `e2e/` (R187, R188)

- **Decisão:** `@playwright/test` 1.64.1, em `devDependencies` de `apps/desktop`, com versão exata (publicada em 2026-10-14, acima do prazo mínimo de um dia do pnpm 12). Entram no lockfile só `@playwright/test`, `playwright` e `playwright-core`, nenhum com script de instalação, então o `allowBuilds` não mudou. Nenhum navegador é baixado: os testes usam a API `_electron` sobre o Electron 44.9.0 que já está instalado. `@project-hub/test-utils` (pacote do workspace) entra em `devDependencies` de `apps/desktop` para o `createTempRepo`.
- **Layout:** `apps/desktop/e2e/` tem `fixtures.ts`, `fixtures.spec.ts`, `security.spec.ts` e `vertical-slice.spec.ts`, e `apps/desktop/playwright.config.ts` fixa um worker, nenhuma repetição automática e a saída em `out/e2e-results`. `pnpm test:e2e` (na raiz e em `apps/desktop`) roda `install-electron && electron-vite build && playwright test`, então testa sempre o bundle construído. A pasta fica fora do Vitest (os projetos só incluem `*.test.*`) e dentro do lint e do `typecheck` (o `tsconfig` do desktop inclui `e2e` e `playwright.config.ts`). O CI da Tarefa 12 não roda o E2E, que fica para a branch de release (seção 20.5).
- **Isolamento:** cada teste cria uma pasta temporária para `PROJECT_HUB_DATA_DIR` e para `--user-data-dir`, abre um repositório Git temporário fora dela e apaga tudo no fim. O fixture tira do ambiente `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL` e `APP_WORKTREES_ROOT`, e nunca passa `--no-sandbox`: o teste de segurança vale para a configuração real. Reiniciar o aplicativo é abrir de novo com a mesma pasta de dados.
- **Observações:** o filtro de arquivo é `pnpm test:e2e security`; com `--` (`pnpm test:e2e -- security`) o pnpm repassa o `--` ao Playwright e o filtro é ignorado. Depois que o renderer tenta navegar e o `will-navigate` cancela, o Playwright passa a esperar essa navegação nas ações com localizador; o teste de navegação confere o resultado com `evaluate` e com um ouvinte de `will-navigate` no processo principal. A CSP do cabeçalho é lida na resposta do documento principal, que o Playwright expõe também para `file://`.

### 2026-10-20, Tarefa 11 (rodada de correção): ambiente empacotado, isolamento do teste e acessibilidade adiada (R193)

- **Variáveis de teste no aplicativo empacotado:** `applicationEnvironment(env, isPackaged)`, em `composition.ts`, devolve o ambiente do processo fora do pacote. Empacotado, devolve só `APP_WORKTREES_ROOT`: `PROJECT_HUB_DATA_DIR`, `PROJECT_HUB_ENV` e `PROJECT_HUB_TEST_DIALOG_PATH` não redirecionam o banco, os worktrees nem o seletor de uma instalação. `APP_WORKTREES_ROOT` fica, porque é a configuração da raiz dos worktrees (R166), não uma variável de teste. `index.ts` passa o resultado de `applicationEnvironment(process.env, app.isPackaged)` aos três resolvedores, e `test/test-env.test.ts` cobre o caso. O E2E confere `app.isPackaged === false` e as variáveis no processo principal (`e2e/fixtures.spec.ts`), então as variáveis valem no lançamento de teste.
- **Isolamento do Git:** o aplicativo e os comandos Git do teste rodam com `GIT_CONFIG_GLOBAL` e `GIT_CONFIG_SYSTEM` apontando para um arquivo vazio e com `GIT_CONFIG_NOSYSTEM=1`. Nesta máquina, a configuração do sistema liga `core.autocrlf=true` e filtros do LFS, que mudariam o conteúdo dos arquivos do worktree. A branch inicial do repositório de teste é `main`, fixada pelo `createTempRepo` (`--initial-branch=main`).
- **Fechamento do aplicativo no teste:** o fixture registra o fechamento logo depois do `electron.launch`, antes de esperar a janela. Se a espera falha, ele fecha o app e relança o erro original. O fechamento tem prazo (15 s por padrão); passado o prazo, o fixture encerra a árvore de processos (`taskkill /T /F` no Windows) e avisa com erro, para o teardown não travar. `e2e/fixtures.spec.ts` prova os dois caminhos e o isolamento.
- **Defeito encontrado, corrigido depois:** fechar o aplicativo enquanto o `index.html` ainda carrega fazia o `loadFile` rejeitar (`ERR_FAILED`), o `handleStartupFailure` chamar `dialog.showErrorBox` e o processo ficar parado na caixa modal. Era a causa do travamento que o prazo de fechamento do fixture contorna. A correção está na entrada "fechar durante o carregamento" no fim deste registro.
- **Acessibilidade na E2E: adiada.** A semana 11 do cronograma da especificação (seção 22, "E2E, segurança, acessibilidade e testes multiplataforma") inclui acessibilidade, e esta tarefa não acrescenta teste automatizado dela. Os testes de ponta a ponta usam seletores acessíveis (`getByRole`, `getByLabel`), o que confere nome e papel dos elementos que o fluxo toca, mas não é uma auditoria. Uma auditoria automatizada (por exemplo `@axe-core/playwright`) exigiria uma dependência externa nova, vedada pelo R46, e a verificação manual de teclado e leitor de tela segue pendente. Fica para a tarefa que fechar a semana 11.

### 2026-10-20, correção: fechar o aplicativo durante o carregamento não trava mais

- **Defeito:** fechar com o renderer ainda carregando faz o `loadFile`/`loadURL` rejeitar. O `.catch` chamava `handleStartupFailure`, que abre `dialog.showErrorBox` (modal, síncrona, sem janela-pai) na mesma thread que estava encerrando o processo. O processo ficava preso na caixa, o `will-quit` (que fecha o SQLite) nunca rodava e o aplicativo não saía. O fixture do E2E escondia isso com o prazo de fechamento, que encerra a árvore de processos.
- **Decisão:** quem separa "fechando" de falha real é o estado, nunca o erro. A rejeição observada ao fechar é `ERR_FAILED` (`errno` -2), o mesmo código de uma falha de verdade, então nenhum teste de código ou de texto serve. `index.ts` calcula `closing` a partir de `quitting` (ligado em `app.once('before-quit')`), do evento `close` da janela e de `win.isDestroyed()`. `handleWindowLoadFailure(cause, { closing }, io)`, em `startup-failure.ts`, decide: fechando, só registra no console (`logIgnored`, com `code` e `errno`) e não mostra caixa nem chama `app.exit`. Com o aplicativo vivo, delega a `handleStartupFailure`: registra, mostra a caixa e sai com 1. O `.catch` do `whenReady` usa a mesma função com `closing: quitting`, então uma falha de banco continua com caixa e código 1, salvo se a saída já tinha sido pedida antes do `ready`.
- **Código de saída:** 0. Nenhum `app.exit(0)` no caminho de fechamento: a saída em andamento termina pelo `will-quit`, que fecha o SQLite, e o processo sai com o código do `app.quit()`. Forçar a saída ali pularia o fechamento do banco.
- **Detalhe:** o estado "janela fechando" é por janela (variável local de `createMainWindow`), e só `quitting` vale para o aplicativo inteiro. No macOS, fechar a janela sem sair não deixa uma falha de carregamento da janela reaberta pelo `activate` ser tratada como fechamento. `confirmExternal` devolve `false` na hora quando está fechando: um diálogo nativo aberto durante a saída seguraria o encerramento do mesmo jeito.
- **Prova:** `test/startup-failure.test.ts` cobre fechando com erro parecido com `ERR_FAILED`, com cancelamento e com arquivo ausente (só registra), e sem fechar com cancelamento, `ERR_FAILED` e arquivo ausente (caixa e saída 1). `e2e/close-while-loading.spec.ts` abre o aplicativo com `ELECTRON_RENDERER_URL` apontando para um servidor local que não termina a resposta, espera `webContents.isLoading()`, troca `dialog.showErrorBox` por um gravador, fecha, e confere saída 0, nenhuma chamada à caixa, `will-quit` executado e a linha de registro da falha ignorada. O servidor envia o cabeçalho e o começo do HTML: sem nenhum byte, o Playwright não consegue anexar à janela e o `electron.launch` não termina.
- **Fixture:** `launchApp` ganhou a opção `rendererUrl` (a variável continua removida por padrão) e o irmão `launchProcess`, que não espera janela nem interface. O encerramento à força do fechamento continua como rede de segurança, mas deixou de ser silencioso: se o teste não chamou `close()` e viu o resultado, qualquer falha do fechamento (inclusive o prazo vencido e o encerramento da árvore de processos) é relançada depois da limpeza e reprova o teste.
- **Prova da falha real:** `e2e/close-while-loading.spec.ts` tem o contraponto. Com o carregamento pendente (cabeçalho e corpo parcial) e o gravador de `showErrorBox` instalado, o servidor derruba a conexão sem que o aplicativo feche. A rejeição chega com a janela viva e sem saída pedida: o gravador recebe uma chamada com "Não foi possível iniciar o Project Hub.", o processo sai sozinho com código 1 (o `app.exit(1)` funciona com a caixa gravada) e não há `before-quit`. Ligar `closing` como `() => true` em `index.ts` reprova esse teste (o processo não sai). O prazo de 15 s para a saída existe para a falha aparecer como erro claro, não como estouro do limite do teste.
- **Resíduo conhecido:** uma falha real que acontece com uma saída já em andamento é só registrada e o processo sai com 0; a falha não é mostrada. Além disso, `quitting` e a flag da janela nunca voltam a `false`: hoje nada cancela um `before-quit` nem um `close`, e se algum fluxo passar a cancelá-los as flags precisam ser zeradas junto, senão uma falha real posterior seria engolida.
- **`confirmExternal`:** a regra "fechando devolve false sem abrir o diálogo" fica em `confirmUnlessClosing` (`security.ts`), testável sem Electron em `test/security.test.ts`.

### 2026-10-20, Tarefa 12.1: `pnpm build` gera o app desktop com electron-vite

- **Decisão:** `apps/desktop` ganha o script `build` (`electron-vite build`), e o `build` da raiz vira `pnpm --filter @project-hub/desktop build`. Isso substitui o build provisório da seção 8, que só rodava `pnpm typecheck`. O `build` não chama `install-electron`, porque não precisa do binário do Electron. O `test:e2e` continua com o próprio passo de build.
- **Saída (como saiu no primeiro build):** `apps/desktop/out/main/index.js` (processo principal, ES module), `out/preload/index.cjs` (CommonJS), `out/renderer/` (`index.html` e `assets/`) e `out/migrations/` (cópia de `packages/database/migrations`, feita pelo plugin do `electron.vite.config.ts`). A pasta `out/` já está no `.gitignore`.
- **Consequência:** o build imprime um aviso de `"use client"` vindo do `react-router` 8.4.0, que fica para a Tarefa 12.2.

### 2026-10-20, Tarefa 12.2: renderer minificado e aviso use client tratado

- **Causa do bundle de 735 kB:** o preset de configuração do renderer do electron-vite força `build.minify: false` (`node_modules/electron-vite/dist/chunks/lib-DoUt4oMD.js`). O padrão do Vite 8 para clientes seria `oxc`, mas o preset vence. O tamanho não vinha das dependências: react-dom e react-router já entravam em produção, só sem minificar.
- **Decisão:** `renderer.build.minify: true` em `apps/desktop/electron.vite.config.ts` (no Vite 8, `true` vira `oxc`). O CSS segue ligado por `<link>`, e o layout de `out/renderer/` (`index.html` e `assets/`) não mudou. `main` e `preload` não mudaram.
- **Aviso `MODULE_LEVEL_DIRECTIVE`:** filtro em `build.rolldownOptions.onwarn`, estreito: só o código `MODULE_LEVEL_DIRECTIVE` e só o arquivo `react-router/dist/production/index.js`. Os demais avisos seguem para o `defaultHandler`. A justificativa está no próprio config: `"use client"` é marca de React Server Components, e o app é só cliente, rodando no Chromium do Electron, onde a diretiva é uma string sem efeito.
- **Tamanho (JS do renderer, `pnpm build`):** antes 735.37 kB (735 379 bytes), depois 279.14 kB (279 144 bytes), queda de 62%. CSS: de 10.95 kB para 7.53 kB.
- **Prova:** com o filtro desligado (regex que não casa), o aviso volta. Com o filtro, o build sai com código 0 e sem o aviso. Gate da raiz: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (653 testes), `pnpm test:integration` (176) e `pnpm test:e2e` (14, incluindo a CSP) passaram.
- **Resíduo:** o filtro depende do caminho do arquivo. Se uma versão nova do react-router mudar esse caminho, o aviso volta e a regex precisa de ajuste.

### 2026-10-20, Tarefa 12.4: CI só para Windows (R197)

- **Decisão:** `.github/workflows/ci.yml` roda em `windows-latest`, sem matriz de sistemas: a versão para Windows termina primeiro (R197), e macOS e Linux entram com os ports, quando o arquivo ganhar a matriz. Dispara em `push` para `main` e em `pull_request`, com `concurrency` que cancela a execução anterior da mesma ref e `timeout-minutes: 30`. Os passos, um por comando e nesta ordem: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration` e `pnpm build`, todos com `shell: bash` (Git Bash do runner).
- **Versões:** Node 24.22.0, lido do `.nvmrc` por `node-version-file` (é a versão que o Electron 44.9.0 embute, e a linha 24 é a do `engines` e do `@types/node`; o Node 26.7.0 da máquina de desenvolvimento não é usado). pnpm 12.14.0, lido do `packageManager` do `package.json` pelo `pnpm/action-setup` (sem `version` explícita, para haver uma só fonte). O cache do pnpm vem do `actions/setup-node` (`cache: pnpm`), e o `pnpm/action-setup` roda antes dele.
- **Segurança:** `permissions: contents: read` no workflow, sem segredos, sem `pull_request_target` e `persist-credentials: false` no checkout. Só ações oficiais, cada uma fixada pelo SHA completo do commit, com a tag em comentário: `actions/checkout` v7.0.1 (`3d3c42e5aac5ba805825da76410c181273ba90b1`), `actions/setup-node` v7.0.0 (`820762786026740c76f36085b0efc47a31fe5020`) e `pnpm/action-setup` v6.1.0 (`ea17c68df8912ef543352723c149a84f56e3d413`, tag anotada resolvida até o commit). A política é fixar sempre pelo SHA, em releases com mais de duas semanas, resolvendo-o com `gh api repos/<dono>/<repo>/git/ref/tags/<tag>` (e `git/tags/<sha>` quando a tag é anotada). Atualizar uma ação é trocar SHA e comentário juntos.
- **Sem E2E:** `pnpm test:e2e` não roda no CI; fica para a branch de release (seção 20.5). Há um comentário no arquivo dizendo isso.
- **Windows:** nenhuma configuração global do Git é adicionada. O `createTempRepo` já fixa identidade e `core.autocrlf=false` no repositório temporário. Os testes com links simbólicos (`simulated-adapter.integration.test.ts`) dependem de o runner hospedado do Windows rodar como administrador, o que permite criar links.
- **Verificado (12.5 e 12.6):** a sequência rodou limpa localmente e o workflow passou no GitHub Actions em `windows-latest` (run 39507693834, 3m16s, todos os passos verdes). Nenhuma dependência nova; o lockfile não mudou.

### 2026-10-20, decisões do usuário antes da revisão final (R198 a R200)

- **R198, arquivos ignorados na remoção de worktree:** `node_modules` e outros arquivos ignorados pelo Git deixam de contar como trabalho não salvo. Só arquivo rastreado modificado ou arquivo novo não ignorado bloqueia a remoção. Revoga o efeito de R107 e R111. **Feito:** `removeWorktree` (`packages/git-adapter/src/worktree.ts`) lê só o status comum e deixa o `git worktree remove` sem `--force` fazer o resto; a leitura com `--ignored` (`hasIgnoredFiles`) e o seu teste unitário foram apagados. Os testes de integração passaram a afirmar a remoção com `.env`, `node_modules`, `build` e `info/exclude` ignorados (inclusive com `status.showUntrackedFiles=no`) e que arquivo modificado, novo não ignorado, apagado, renomeado e em conflito continuam bloqueando. Quem protege o arquivo novo não ignorado é a guarda de `getStatus` (`--untracked-files=all`): com `status.showUntrackedFiles=no` na configuração do repositório, o `git worktree remove` sem `--force` o apaga e sai com 0 (verificado com o Git 2.54), e um teste de integração cobre esse caso. O `git worktree remove` só funciona como segunda guarda para arquivo versionado modificado que chegou depois do status. Resíduos aceitos: o `.env` ignorado de um worktree é apagado junto com ele, sem aviso; um repositório aninhado com trabalho não enviado dentro de uma pasta ignorada (por exemplo `vendor/`) também é apagado sem aviso; um arquivo novo criado entre o `getStatus` e o `worktree remove` já era um risco antes e continua.
- **R199, subpasta de repositório:** só a raiz do repositório (a pasta que tem o `.git`) é projeto Git. Uma subpasta de repositório é cadastrada como "sem Git", o que evita que um repositório de dotfiles na pasta pessoal faça todas as pastas abaixo entrarem como `git` (resolve R95f). **Feito:** `createGitDetector` (`packages/git-adapter/src/detect.ts`) chama `rev-parse --is-inside-work-tree --show-prefix` e só aceita `true` com prefixo vazio; é o Git quem diz que a pasta é a raiz, sem comparar caminhos no Windows. Subpasta, a pasta `.git` por dentro e repositório bare viram `none`; raiz comum, repositório sem commits, worktree vinculado e submódulo continuam `git`. A lista de permissão do `runGit` já aceitava `rev-parse`, então não mudou (só ganhou um caso de teste). Resíduo: quem cadastrou uma subpasta como `git` antes mantém o registro até o projeto ser reavaliado; nenhuma mudança de UI.
- **R200, nova tentativa:** `failed` e `cancelled` podem voltar para `queued` pela nova tentativa. É o que o orquestrador já faz (resolve R129). Sem mudança no código.

### 2026-10-20, paleta multicolorida como cores padrão do app

- **Decisão:** a paleta violeta e âmbar de `apps/desktop/src/renderer/styles/tokens.css` foi trocada por um fundo único (`#080614`, também em `--panel` e `--panel-2`) com acentos fortes, cada um com um papel: violeta (marca e "aguarda sua decisão"), vermelho (parar, recusar e falha), azul (plano), magenta (conversa e item ativo da navegação), laranja (pausa e agente Claude), lima (executando, aprovar e ação principal), ciano (terminal, Git e projetos) e amarelo (logs e progresso). Valem para o app inteiro, não só para o workspace da missão. Só cores: layout, espaçamento, fontes (system stacks, por causa da CSP, R164) e `border-radius` não mudaram.
- **Tokens:** saem `--amber` e `--pink`, e `--log` (o texto de log passa a usar `--text`); entram `--red`, `--blue`, `--magenta`, `--orange`, `--lime`, `--cyan` e `--yellow`. O tipo `Tone` de `mission-text.ts` virou `lime | violet | red | orange | muted`, e o sentido de cada estado não mudou (roda = lima, espera a pessoa = violeta, falha = vermelho, pausa = laranja agora, o resto neutro).
- **Contraste:** `test/renderer/contrast.test.ts` mede texto, texto secundário e cada acento sobre cada superfície, e o texto escuro sobre cada acento cheio, todos com o mínimo de 4,5:1. Os valores da decisão passaram todos, sem ajuste (o menor é o vermelho, 5,60:1).

### 2026-10-20, interface do workspace, Tarefa 1: fontes Inter e JetBrains Mono locais (R201)

- **Decisão:** o texto usa Inter e os dados usam JetBrains Mono, como pede o estilo aceito (`brain/decisoes/decisao-estilo-workspace-multicor.md`). As duas são OFL-1.1 e vêm como arquivos `.woff2` em `apps/desktop/src/renderer/assets/fonts/`: Inter `latin` nos pesos 400, 500, 600 e 700, e JetBrains Mono `latin` nos pesos 400, 500 e 600, todos em estilo normal (o subconjunto `latin` cobre os acentos e o `ç` do português). Isto supera o "só pilhas do sistema" da Tarefa 10 (R164, R172); o motivo da pilha, a CSP, continua valendo e foi o que pediu arquivos locais. R201 (usuário, 2026-10-20): obter os arquivos por `npm pack` e copiar só os `.woff2` e a licença, sem dependência nova (R46); o `package.json` e o lockfile não mudaram.
- **Origem:** `@fontsource/inter@5.3.0` (`sha512-RofMylZmjlJEfELXeNHFWBRcSs75rGU/6bV2S2jfnvv/3rPXPGe0LgUJTklcHZ9lM4OZmAVFhcJPnACfb91A3g==`) e `@fontsource/jetbrains-mono@5.3.0` (`sha512-fqDfB5I9f1p1TV486aUgB9t8zP84P0O1FtQR5Ol9vjwPy+S+EIGlVYm1cvj2W5shcZMTg2nZFdVMoH5wFu8a1A==`), ambos publicados em 2026-07-19 (mais de 14 dias antes do download). Baixados com `npm pack --ignore-scripts` numa pasta temporária isolada, fora do repositório, sem `npm install` e sem executar código do pacote; o tarball foi conferido contra o `integrity` que o npm informa, e cada `.woff2` tem a assinatura `wOF2`. `assets/fonts/LICENSES.md` guarda o pacote, a versão, o hash do tarball, o SHA-256 de cada arquivo e o texto da OFL de cada fonte.
- **CSS:** `styles/fonts.css` declara os `@font-face` (`font-display: swap`, `src: url(../assets/fonts/...) format('woff2')`, sempre relativo) e é ligado por um `<link>` próprio no `index.html`, antes de `tokens.css`. Ficou fora do `tokens.css` porque este só tem variáveis e é lido pelo teste de contraste; um arquivo por papel mantém cada `<link>` pequeno, e o teste confere a lista de `<link>`. Nenhum módulo do renderer importa CSS, e não há `<style>` nem atributo `style`. `--font-sans` passou a começar por `Inter` e `--font-mono` por `'JetBrains Mono'`, com a pilha do sistema de antes como reserva (enquanto carrega e para símbolos que o subconjunto não cobre).
- **CSP intocada:** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:` não mudou, nem no cabeçalho de `security.ts` nem na `<meta>`. Fonte cai em `default-src 'self'`, e o arquivo é do aplicativo. O Vite só embute como `data:` o que tem menos de 4 KB, e cada fonte passa de 21 KB, então sai como arquivo com hash em `out/renderer/assets/`, dentro da pasta que o filtro `restrictFileRequests` aceita. Quem trocar uma fonte por uma menor que 4 KB (improvável) teria `data:` bloqueado para fonte: o E2E acusaria.
- **Prova:** `test/renderer/renderer-styles.test.ts` confere os `@font-face` (famílias, pesos, `swap`, `url()` relativo sem `http`, `data:` nem `//`), que cada arquivo referenciado existe em `assets/fonts/`, que a pasta não tem arquivo a mais, a assinatura `wOF2`, os tokens e o `index.html` sem `<style>` nem script inline. `e2e/security.spec.ts` (`fontes locais`) abre o aplicativo construído, que carrega por `file://` como o empacotado, e confere: as sete faces com `status: 'loaded'`, os sete pedidos `.woff2` concluídos e nenhum cancelado, nenhuma violação de CSP nem erro de console, e, pelo CDP (`CSS.getPlatformFontsForNode`), que o texto da navegação é formado por Inter e um elemento `.mono` por JetBrains Mono, os dois com `isCustomFont: true`. O caminho `loadURL` do servidor de desenvolvimento não é exercitado pelo E2E.
- **Resíduo:** o CSS ainda usa `font-weight: 800` em dois lugares; como o Inter local tem até 700, o Chromium usa o 700 (nada de negrito sintético mais pesado). Quem quiser 800 acrescenta o arquivo e a linha em `fonts.css`.

### 2026-10-20, interface do workspace, Tarefa 2: componente `Panel` e `--radius-panel`

- **Decisão:** `components/Panel.tsx` exporta `Panel` (seção com `aria-labelledby` por `useId`, faixa de 3px no topo na cor do acento por `panel--<acento>`, cabeçalho com ponto, título, meta e tag via `StatusChip`, corpo com rolagem própria) e `PanelEmpty`. Nenhuma página o usa ainda (Tarefas 5 e 6). Sem par de cores novo: título em `--text` e meta e vazio em `--muted`, sobre `--panel`, já medidos em `contrast.test.ts`.
- **Ajuste ao plano:** o plano pedia `--radius: 12px`, mas `--radius` (2px) é usado por botões, campos e cartões, e mudá-lo arredondaria tudo. Entrou `--radius-panel: 12px` em `tokens.css`, usado só pelo painel; `--radius` continua em 2px. Provado por `test/renderer/panel-styles.test.ts`.

### 2026-10-20, interface do workspace, Tarefa 3: cabeçalho de 50px

- **Casca:** `.app-shell` é uma coluna com `height: 100vh`; o cabeçalho tem 50px e não quebra linha; `.app-main` ocupa o resto (`flex: 1; min-height: 0; overflow: auto`) e rola sozinha, com o conteúdo limitado a 72rem em `.app-main__content`. Prepara a barra lateral (Tarefa 4) e a grade de painéis (Tarefa 5), que precisam de altura definida.
- **Marca e navegação:** símbolo em duas metades (violeta e vermelho, por `::before` e `::after`, `aria-hidden`) e o nome em caixa alta pela CSS (o texto continua "Project Hub"). O item ativo da navegação é magenta cheio com texto `--bg` (par medido no teste de contraste). A navegação rola de lado em janela estreita.
- **Contadores:** `App` aceita `headerStatus?: ReactNode`, mostrado à direita em `.app-header__status`; sem ele, nada é renderizado. A Tarefa 7 passa os contadores.
- **Minor da Tarefa 2 corrigidos:** meta vazia não cria o `span`; o comentário do `.panel` não cita mais uma classe de log inexistente; o teste de forma afirma as cores de título, meta e vazio. O leitor de regras dos testes (`test/renderer/css-rules.ts`) passou a juntar todas as regras com o mesmo seletor.
- **Correção da revisão (Critical):** a navegação tem `overflow-x: auto`, que cortava o anel de foco (2px, recuo 2px por fora) dos links. `.app-nav a:focus-visible` usa `outline-offset: -2px`, com o anel por dentro do link. O E2E `e2e/shell.spec.ts` mede na janela real que o anel cabe na navegação e que o documento não rola. `headerStatus` nulo também não cria o espaço vazio. O leitor de regras dos testes lê grupos (`a, b {}`) e deixa de fora o `@media`, que se lê por `mediaBlock`.

### 2026-10-20, interface do workspace, Tarefa 4: barra lateral de projetos e missões

- **Barra:** `components/Sidebar.tsx`, de 230px, à esquerda da página, dentro de `.app-body` (linha flex, abaixo do cabeçalho). A seção Projetos aparece sempre; a seção Missões só na rota de um projeto ou de uma missão. Abaixo de 1000px a barra some (`display: none`) e a navegação fica no cabeçalho.
- **Projeto da rota: `useMatch`, não `useParams`.** O App monta a barra fora de `<Routes>`, onde `useParams` devolve vazio. A barra lê a rota com `useMatch` (vale de qualquer lugar do roteador). Se vier a prop `currentProjectId`, ela tem prioridade.
- **Dados:** `use-sidebar-data.ts` carrega os projetos e as missões de cada um. Recarrega a cada evento de missão, a cada troca de rota e quando a página de Projetos cadastra uma pasta (evento `PROJECTS_CHANGED_EVENT`, em `projects-events.ts`, para que quem dispara não dependa de quem ouve). A troca de rota continua recarregando, para um projeto cadastrado por outro caminho. Um evento não cancela a carga em curso, para a barra seguir atualizada com eventos seguidos; cada carga tem um número, e uma carga antiga que termina depois da nova não sobrescreve o resultado. Erro vira a mensagem geral, e a página segue.
- **Foco:** os links e botões da barra têm `outline-offset: -2px`, e os itens ocupam a largura toda da barra, então um contorno de 2px por fora seria cortado pela rolagem. O E2E `e2e/sidebar.spec.ts` anda pelo Tab por cada item e mede que o contorno cabe no retângulo da `aside`. Com quatro itens a barra não rola, e o teste não detectava `outline-offset: 2px` (mutação feita, passou). Por isso o teste limita a altura da barra e confere que ela rola antes da medição; com a barra rolando, `outline-offset: 2px` faz o E2E falhar (mutação feita, 2026-10-20).
- **Botões de criação:** "+ Novo projeto" e "+ Nova missão" são `button` que navegam, como pede a tarefa. Os itens da lista são `Link`.
- **Página atual (revisão de 2026-10-20):** `aria-current="page"` vai só para a página atual. Na rota de uma missão, o projeto dela mantém o ponto ciano, mas não leva `aria-current`. Os nomes truncados têm `title` com o nome completo.
- **Evento de cadastro (revisão de 2026-10-20):** `PROJECTS_CHANGED_EVENT` saiu de `use-sidebar-data.ts` para `projects-events.ts`. A página de Projetos o dispara depois de cadastrar, e um teste confere a emissão (sem a linha, o teste falha).
- **Pendente, Tarefa 8:** a barra e os contadores fazem cada um a própria carga (`projects.list` mais uma `missions.list` por projeto, a cada evento), duplicada, sem agrupar. Uma carga compartilhada entra junto com a Tarefa 8, que já mexe em `useOverview`.

### 2026-10-20, interface do workspace, Tarefa 7: contadores globais no cabeçalho

- **Decisão:** a contagem sai de `use-overview.ts` no cliente. O hook lê `projects.list` e `missions.list` de cada projeto e refaz a leitura a cada evento de `missions.subscribe`, sem canal novo. A assinatura é cancelada ao desmontar.
- **Contagem:** `running` conta em "executando"; `planned`, `waiting_approval` e `waiting_input` contam em "aguarda você". `failed`, `draft`, `queued`, `paused`, `succeeded` e `cancelled` não entram em nenhum dos dois. `items` traz só as missões que contam.
- **Falha:** a resposta com erro, ou a exceção, de um projeto entra em `failedProjects` e não zera a contagem dos outros. Se a própria lista de projetos falha numa releitura, a tela mantém a última contagem, em vez de mostrar zero por engano.
- **Forma:** `.overview-counters` é uma linha flex, e cada `.overview-counter` tem um ponto de 8px no `::before`: lima para executando e violeta para aguarda você. O contêiner é `aria-live="polite"`. A ligação em `App` e `main.tsx` fica para a integração das tarefas.
- **Antes da primeira leitura (revisão de 2026-10-20):** `Overview` ganhou `loaded`, que é `false` até a primeira leitura chegar. Enquanto isso, o contador mostra "—" em vez de zero, porque zero pareceria um dado. A mudança é aditiva: `running`, `waiting`, `items` e `failedProjects` continuam como estavam.

### 2026-10-25, migração com chaves estrangeiras desligadas

- **Decisão:** `migrateDatabase` desliga `foreign_keys` antes de rodar as migrações do Drizzle, confere `foreign_key_check` ao fim e religa `foreign_keys` no `finally`. Se a checagem achar violação, lança erro.
- **Por quê:** a migração 0005 recria a tabela `missions` para trocar a CHECK do estado. Com `foreign_keys` ligado, o `DROP TABLE` apagaria em cascata etapas, critérios, tentativas, aprovações e auditoria. Um `PRAGMA` dentro do SQL da migração não tem efeito, porque o Drizzle já abriu a transação. O teste `packages/database/test/migrate-review.integration.test.ts` monta um banco com filhas e confere que elas sobrevivem.
- **Consequência:** toda migração que recria tabela pai passa por esse caminho e precisa de teste com filhas.

### 2026-10-25, zod em devDependencies e modo jitless

- **Decisão:** `zod` fica em `devDependencies` de `apps/desktop`, e o renderer chama `z.config({ jitless: true })` antes do primeiro schema.
- **Por quê:** o electron-vite deixa de fora do bundle só o que está em `dependencies`. Com o `zod` lá, o preload construído passava a ter `require("zod")`, e o preload com sandbox só pode pedir `electron`: a API `window.projectHub` deixava de existir. Além disso, o zod compila schemas com `new Function`, que a CSP (sem `unsafe-eval`) bloqueia.
- **Consequência:** dependência usada pelo preload ou pelo processo principal vai para `devDependencies`. Só módulo nativo fica em `dependencies`.

### 2026-10-28, orquestrador fatia 2: planejador do Claude Code

- **Decisão:** a criação do plano das missões pode vir do Claude Code. O planejador (`apps/desktop/src/main/claude-planner.ts`) roda o executável externo `claude -p` por `execFile`, sem shell, com os argumentos em array e o caminho completo do executável. Só ferramentas de leitura (`Read`, `Grep` e `Glob`, pela opção `--tools`) e o modo de permissão `plan`: o processo não escreve nem roda comandos. Sem persistência de sessão (`--no-session-persistence`). O texto da pessoa (objetivo, critérios e pedido de ajuste) vai só pela entrada padrão, nunca nos argumentos. O ambiente do processo é o filtrado dos terminais (`buildTerminalEnv`), e a pasta de trabalho é a do projeto.
- **Validação do resultado:** a saída do CLI passa por um type guard e depois por `validatePlan`, no máximo 12 tarefas. Plano fora do formato, ou que não passa na validação, não muda o plano anterior da missão e fica na auditoria como `plan.failed`.
- **Tempo e cancelamento:** tempo máximo de 180 s. Cada planejamento tem o próprio controlador de aborto, pela missão. Ele é abortado quando o app fecha (`createAppServices().close()` chama `orchestrator.dispose()` antes de fechar o banco, que aborta todos) e quando a missão é cancelada (`cancelMission`); em ambos o processo `claude` é encerrado. Não há botão próprio de cancelar o planejamento na v1. Aprovar o plano é recusado enquanto ele está sendo gerado, como a edição. Cancelamento e tempo esgotado voltam ao orquestrador como `AGENT_UNAVAILABLE`.
- **Ligação:** `index.ts` liga o planejador com `APP_AGENT_ADAPTER=claude-code`. Para os testes de ponta a ponta, `APP_PLANNER_COMMAND` troca o comando por um CLI falso e liga o planejador mesmo sem aquela variável, mas só com `PROJECT_HUB_ENV=test` (`resolvePlannerCommand`, no mesmo padrão de `resolveDirectoryChooser`, R189). No Windows o comando vai direto ao `execFile` e precisa ser um `.exe`; por isso `APP_PLANNER_SCRIPT` (um `.mjs`, também só em teste) roda o próprio Electron como Node (`ELECTRON_RUN_AS_NODE=1`) com o script na frente dos argumentos fixos, e o CLI falso dos testes é um script (`commandPrefix` e `extraEnv` de `createClaudePlanner`). O resolvedor devolve também se houve troca (`overridden`), que é o que liga o planejador. Empacotado, `applicationEnvironment` retira as variáveis (R193). Sem nada disso, vale o plano simples de antes, com um passo por critério.
- **Isolamento da configuração do projeto e leitura confinada (revisão final):** o `claude -p` pula o diálogo de confiança da pasta e, sem mais nada, obedece ao `.claude/settings.json` do projeto (hooks, permissões) e ao `.mcp.json` (servidores MCP), então um repositório clonado poderia rodar comandos ao clicar em Orquestrar. Por isso os argumentos fixos incluem `--restricted` (ignora os arquivos de configuração de usuário, projeto e local, remove as ferramentas que rodam código e confina as ferramentas de arquivo à pasta de trabalho) e `--strict-mcp-config` (nenhum servidor MCP, já que nenhum é passado por `--mcp-config`). A lacuna anterior, `Read` fora da pasta do projeto, fica fechada pelo confinamento. Conferido à mão com o `claude` 2.1.312 real, numa pasta temporária fora do repositório: com os argumentos antigos, um hook `SessionStart` do `.claude/settings.json` rodou (marcador criado); com os novos, não rodou (marcador ausente), o plano voltou em `structured_output` com o mesmo envelope da fixture, e um `Read` de um arquivo fora da pasta foi negado (apareceu em `permission_denials`). A mesma chamada ficou bem mais barata (cerca de US$ 0,03 contra mais de US$ 1), porque os plugins e as configurações do usuário deixam de ser carregados. Não verificado: servidor MCP do `.mcp.json` (o `--strict-mcp-config` é pela documentação do CLI, sem execução), `--add-dir` (não usado) e o comportamento em outras versões do CLI. O texto lido da pasta do projeto continua sendo conteúdo não confiável (seção 17.1) e volta como parte do plano que a pessoa revisa e edita antes de aprovar; a descrição de cada tarefa, que vai ao prompt do agente executor, é mostrada e editável na tela do Plano.
- **Saída grande demais:** acima de 8 MB de saída o processo é encerrado e o resultado é "O Claude Code devolveu um plano fora do formato." (`AGENT_PROTOCOL_ERROR`), não o de tempo esgotado.
