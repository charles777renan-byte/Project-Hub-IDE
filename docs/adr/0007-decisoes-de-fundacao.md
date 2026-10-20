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

- **Detecção:** uma pasta é Git quando `rev-parse --is-inside-work-tree` diz `true`, o que inclui subpastas de um repositório. Repositório bare e a pasta `.git` dão `none`. A branch padrão é a que `origin/HEAD` aponta (`symbolic-ref`), senão a branch em uso (`branch --show-current`), e em HEAD destacado sem remoto não há branch.
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

- **Remoção, três guardas, nenhuma com `--force` (corrigido em 2026-10-20):** `removeWorktree` exige `worktreePath` absoluto (`VALIDATION_FAILED`, como `createWorktree` faz com a raiz). Lê o `getStatus` do worktree, e com `changedFiles > 0` rejeita com `WORKTREE_HAS_UNSAVED_CHANGES` sem chamar `worktree remove`. Depois faz a leitura dos arquivos ignorados (próximo item). Só então roda `worktree remove <pasta>`, que recusa por conta própria uma pasta com arquivo modificado ou novo (o caso de uma alteração que chegou depois do status). Essa recusa também vira `WORKTREE_HAS_UNSAVED_CHANGES`, reconhecida pelo texto "contains modified or untracked files" (o ambiente fixa `LC_ALL=C`). Qualquer outra recusa do Git sobe como `GitError`. A branch nunca é apagada. `removeWorktree` não apaga o checkout principal nem uma pasta que o Git não conhece como worktree do repositório: o Git recusa as duas.
- **Arquivos ignorados (corrigido em 2026-10-20):** o `git worktree remove` apaga os arquivos ignorados (`.env`, `node_modules`, saídas de build) junto com a pasta, e o `status` comum não os lista, então um worktree "limpo" podia perder um `.env`. `removeWorktree` faz uma leitura separada no worktree, `status --porcelain=v2 --ignored --untracked-files=normal -z` (`hasIgnoredFiles`, em `status.ts`; `runGit` já aceita qualquer `status`), e qualquer registro `! <caminho>` (arquivo ou pasta inteira ignorada, de `.gitignore` ou de `.git/info/exclude`) rejeita com `WORKTREE_HAS_UNSAVED_CHANGES`, com uma mensagem que fala em arquivos ignorados, antes do `worktree remove`. O `--untracked-files=normal` é explícito porque `status.showUntrackedFiles=no` na configuração do repositório (de terceiros, seção 17.1) faz o `--ignored` não listar nada, e sem ele um `.env` passaria; um teste de integração cobre essa configuração. O campo que segue um registro de renomeado é o caminho antigo, e não um registro, então um nome antigo começando com `! ` não conta. Para remover, o usuário salva ou apaga esses arquivos antes. Fica por conta da tela de remoção (Tarefas 9 a 12) oferecer essa limpeza.
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
