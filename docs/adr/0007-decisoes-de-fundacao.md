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
