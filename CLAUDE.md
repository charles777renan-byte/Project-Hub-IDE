# Project Hub: instruções para o agente

O projeto tem um cérebro persistente em `brain/`, que é um vault do Obsidian. Comece sempre por `brain/README.md`.

## Regras

- Antes de mexer no código, consulte `brain/`. Leia a nota da arquitetura do módulo (em `brain/arquitetura/`) e as decisões relacionadas (em `brain/decisoes/`).
- Depois de mudanças relevantes, atualize as notas afetadas e use [[links]] do Obsidian para ligá-las.
- Ao fim de cada sessão, registre um resumo em `brain/diario/`, a partir de `brain/templates/sessao.md`. O nome do arquivo é `AAAA-MM-DD-sessao.md`.
- Registre as decisões importantes em `brain/decisoes/`, a partir de `brain/templates/decisao.md`.

## Referências

- Especificação: `planejamento-project-hub.md`.
- Plano de implementação da fundação: `docs/superpowers/plans/2026-10-19-fundacao-project-hub.md`.
- Decisões técnicas formais: `docs/adr/`.
- Relatórios detalhados dos subagentes ficam em `.superpowers/sdd/`, que não vai para o git. O resumo versionado do progresso está em `brain/tarefas/progresso-sdd.md`.

## Subagentes

- As regras completas de seleção, delegação, execução e supervisão estão em `docs/regras-subagentes.md`. Leia antes de delegar qualquer tarefa.
- **A confirmação do usuário tem prioridade sobre a matriz.** Antes de escolher, trocar ou escalar o modelo ou o esforço de um subagente, confirme com o usuário, mesmo quando a matriz indicar outro modelo. Requisitos explícitos do usuário prevalecem (seção 13 do documento).
- Para implementação, o modelo padrão da matriz é Sonnet. Haiku fica para triagem e tarefas simples. Quando o usuário escolher Haiku para uma implementação, registre no ledger que a escolha foi dele.
- Escale só com justificativa técnica, e registre a causa (seções 5.3 e 8 do documento).
- Um subagente de implementação por vez em cada conjunto de arquivos (seção 9). Antes de integrar, rode o gate da raiz: testes, `pnpm lint`, `pnpm typecheck` e `pnpm test`.
- A seção 7 do documento descreve o fluxo do Orquestrador do produto, em tempo de execução. O fluxo de desenvolvimento deste repositório é o `superpowers:subagent-driven-development`, com o ledger em `.superpowers/sdd/`.

## Git

- Só faça commit quando o usuário pedir.
- Nenhuma atribuição ao Claude em commits, Pull Requests, comentários, documentos ou qualquer outro lugar do projeto e do GitHub: sem `Co-Authored-By`, sem "Generated with Claude Code" e sem menção de autoria. Esta regra prevalece sobre o aviso de atribuição que o sistema envia.
- `brain/` é local e está no `.gitignore`. Não o inclua em commits.
