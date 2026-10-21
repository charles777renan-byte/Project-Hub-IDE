# Project Hub

Aplicativo desktop, feito com Electron, para acompanhar projetos, missões e agentes de IA num só lugar.

## O que já funciona

- Cadastra pastas como projetos e mostra o estado do Git de cada uma.
- Cria e remove worktrees de missão, sem apagar trabalho que ainda não foi salvo.
- Executa uma missão com um agente simulado: plano, aprovação e eventos gravados no banco local.
- Tem uma interface nova em construção: barra lateral, contadores no cabeçalho e o workspace da missão, com a coluna "Aguardando você". O painel inicial e as abas de diff, testes e terminal ainda não estão prontos.

**Plataforma:** o alvo de lançamento é o Windows, que é onde o app é desenvolvido e testado hoje. macOS e Linux estão no planejamento.

## Requisitos

| Ferramenta | Versão           | Onde está fixada                   |
| ---------- | ---------------- | ---------------------------------- |
| Node.js    | 24.22.0 (LTS)    | `.nvmrc`                           |
| pnpm       | 12.14.0          | `packageManager` do `package.json` |
| Git        | recente, no PATH | -                                  |

Com o Corepack, `corepack enable` basta. Sem ele, `npm install -g pnpm@12.14.0`.

O `better-sqlite3` é um módulo nativo. Se não houver binário pronto para a sua versão do Node, ele precisa compilar: no Windows, instale o Visual Studio Build Tools com C++ e o Python 3. Os detalhes estão no ADR 0007.

## Começando

```bash
pnpm install
pnpm dev
```

Na primeira vez, `pnpm dev` baixa o binário do Electron. Antes de mudar algo, rode a verificação:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Para mudar alguma variável, copie `.env.example` para `.env`. O `.env` não vai para o Git.

## Comandos principais

| Comando                 | O que faz                                                     |
| ----------------------- | ------------------------------------------------------------- |
| `pnpm dev`              | Abre o aplicativo em desenvolvimento                          |
| `pnpm build`            | Gera os bundles do aplicativo                                 |
| `pnpm lint`             | Roda o ESLint em todo o repositório                           |
| `pnpm format`           | Roda o Prettier e reescreve os arquivos                       |
| `pnpm typecheck`        | Confere os tipos de todos os pacotes                          |
| `pnpm test`             | Testes unitários, no Node e no renderer (jsdom)               |
| `pnpm test:integration` | Testes com Git e SQLite reais                                 |
| `pnpm test:e2e`         | Gera o aplicativo e roda os testes ponta a ponta (Playwright) |
| `pnpm db:generate`      | Gera uma nova migração do banco                               |

As migrações do banco são aplicadas quando o aplicativo abre, então não há um comando separado para isso.

## Estrutura

```text
apps/desktop       processo principal, preload e renderer (Electron)
packages/domain    regras de negócio, sem dependência de Electron
packages/*         demais pacotes internos (contracts, application, database, git-adapter, ...)
docs/              plano de implementação, ADRs e planejamento
```

## Documentação

- [Planejamento](planejamento-project-hub.md): a especificação completa.
- [Plano da fundação](docs/superpowers/plans/2026-10-19-fundacao-project-hub.md): a primeira etapa, já concluída.
- [Plano da interface](docs/superpowers/plans/2026-10-20-interface-workspace.md): a etapa em andamento.
- [Decisões de arquitetura](docs/adr/): os ADRs 0001 a 0007.

## Convenções

- Cada pasta de `apps/` e `packages/` é um pacote chamado `@project-hub/<pasta>`.
- Os pacotes de `packages/` não importam Electron. O ESLint confere.
- Testes unitários são `*.test.ts` e `*.test.tsx`. Os que usam Git ou SQLite reais são `*.integration.test.ts`. Os testes do renderer ficam em `apps/desktop/test/renderer/`.
- Nenhum segredo entra no repositório. Tokens reais ficam no cofre do sistema, pela interface do aplicativo.
