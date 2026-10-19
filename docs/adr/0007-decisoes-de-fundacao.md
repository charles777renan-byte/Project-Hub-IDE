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
