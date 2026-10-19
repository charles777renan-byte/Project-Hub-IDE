# Project Hub

Aplicativo desktop, feito com Electron, para organizar projetos, missões e agentes de IA em um só lugar. A plataforma de lançamento é o Windows, e a matriz de testes cobre Windows, macOS e Linux.

O repositório está na primeira etapa: um aplicativo Electron seguro que cadastra projetos, mostra o estado do Git, cria e remove worktrees e executa uma missão com agente simulado, gravando eventos persistidos.

## Documentos

- [Planejamento](planejamento-project-hub.md): a especificação completa.
- [Plano de implementação](docs/superpowers/plans/2026-10-19-fundacao-project-hub.md): as tarefas da primeira etapa.
- [Decisões de arquitetura](docs/adr/): os ADRs 0001 a 0007.

## Requisitos

| Ferramenta | Versão           | Onde está fixada                   |
| ---------- | ---------------- | ---------------------------------- |
| Node.js    | 24.22.0 (LTS)    | `.nvmrc`                           |
| pnpm       | 12.14.0          | `packageManager` do `package.json` |
| Git        | recente, no PATH | -                                  |

Se o seu Node não trouxer o Corepack, instale o pnpm com `npm install -g pnpm@12.14.0`. Com Corepack, `corepack enable` basta.

O `better-sqlite3` é um módulo nativo. Quando não existe binário pré-compilado, ele precisa de ferramentas de compilação: no Windows, Visual Studio Build Tools com C++ e Python 3; no macOS, Xcode Command Line Tools; no Linux, compilador e Python. O ADR 0007 explica o rebuild para o Electron.

## Começando

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Copie `.env.example` para `.env` se quiser mudar alguma variável. O `.env` não vai para o Git.

## Scripts da raiz

| Comando                 | O que faz                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Abre o aplicativo em desenvolvimento. Delega ao pacote `@project-hub/desktop`.              |
| `pnpm build`            | Provisório: confere os tipos de todos os pacotes. Será trocado pelo build real dos bundles. |
| `pnpm lint`             | Roda o ESLint em todo o repositório.                                                        |
| `pnpm format`           | Roda o Prettier e reescreve os arquivos.                                                    |
| `pnpm typecheck`        | Roda o `tsc` na raiz e o script `typecheck` de cada pacote.                                 |
| `pnpm test`             | Testes unitários: `*.test.ts` no Node e `*.test.tsx` do renderer, em jsdom.                 |
| `pnpm test:integration` | Testes com Git ou SQLite reais (`*.integration.test.ts`).                                   |
| `pnpm test:e2e`         | Testes de ponta a ponta com Playwright. Delega ao pacote `@project-hub/desktop`.            |
| `pnpm db:generate`      | Gera migrações. Delega ao pacote `@project-hub/database`.                                   |
| `pnpm db:migrate`       | Aplica migrações. Delega ao pacote `@project-hub/database`.                                 |

`test:e2e`, `db:generate` e `db:migrate` delegam a pacotes ou scripts que chegam nas próximas tarefas e, até lá, terminam com erro. Na primeira vez, `pnpm dev` baixa o binário do Electron (ADR 0007, "Registros posteriores").

## Estrutura

```text
apps/desktop      processo principal, preload e renderer
packages/domain   regras de negócio, sem dependência de Electron
packages/*        demais pacotes internos (contracts, application, database, git-adapter, ...)
docs/adr          decisões de arquitetura
```

## Convenções

- **Pacotes.** Cada pasta de `apps/` e `packages/` é um pacote chamado `@project-hub/<pasta>`. Para criar um, copie `packages/domain`: `package.json` com `"private": true` e `"type": "module"`, os scripts `typecheck` e `test`, e um `tsconfig.json` que estende `../../tsconfig.base.json`.
- **TypeScript.** Modo estrito, com `noUncheckedIndexedAccess` e `exactOptionalPropertyTypes`, em `tsconfig.base.json`. A base não inclui tipos do Node nem do DOM: um pacote que usa `node:*` declara `"types": ["node"]`, e o renderer acrescenta `"DOM"` em `lib`.
- **Testes.** Os nomes dos arquivos e a separação entre unitários e integração estão no ADR 0007, item 8. A configuração do Vitest fica na raiz, em `vitest.config.ts`. `pnpm --filter <pacote> test` roda o Vitest dentro do pacote e inclui os testes de integração dele. Os testes do renderer (`apps/desktop/test/renderer/`) dependem do jsdom e do arquivo de setup da configuração da raiz: rode-os por `pnpm test`, ou por `pnpm exec vitest run <arquivo>` na raiz.
- **Importações.** Os pacotes de `packages/` não importam Electron. O ESLint confere.
- **Segredos.** Nenhum segredo entra no repositório nem no `.env.example`. Tokens reais vão para o cofre do sistema, pela interface do aplicativo.

## Decisões de arquitetura

| ADR                                                         | Decisão                                    |
| ----------------------------------------------------------- | ------------------------------------------ |
| [0001](docs/adr/0001-electron-renderer-isolado.md)          | Electron com renderer isolado              |
| [0002](docs/adr/0002-sqlite-fonte-local-de-verdade.md)      | SQLite como fonte local de verdade         |
| [0003](docs/adr/0003-eventos-persistidos-com-snapshots.md)  | Eventos persistidos com snapshots          |
| [0004](docs/adr/0004-um-worktree-por-missao-executavel.md)  | Um worktree por missão executável          |
| [0005](docs/adr/0005-adaptadores-de-agente-por-contrato.md) | Adaptadores de agente por contrato         |
| [0006](docs/adr/0006-aprovacao-por-politicas.md)            | Aprovação por políticas                    |
| [0007](docs/adr/0007-decisoes-de-fundacao.md)               | Versões, Git, banco, CSP e outras escolhas |
