# Início: bloco "Visão geral" com mensagens e tokens por agente

Data: 2026-11-01. Origem: conversa com a pessoa, com esboços no navegador (direção A, cores por agente, posição no topo).

> **Atualização de 2026-11-03.** O corpo do bloco foi redesenhado: a primeira aba passou a se chamar "Resumo" (o título do bloco continua "Visão geral", e a aba repetia o nome); o mapa ficou compacto e de células de tamanho fixo, com a régua de meses; o corpo ganhou três colunas, "Por dia" (o mapa), "Por agente" (uma tabela com a parte de cada agente, no lugar da barra e da legenda dos totais) e "No período" (os totais). O número de colunas depende da largura do próprio bloco (consulta de contêiner). O que as abas, os períodos, as cores e as fontes de dados mostram não mudou.

## Intenção

O Início está fraco e com muito espaço vazio: a coluna da esquerda acaba em "Missões" e o mapa de atividade conta só eventos de missão (2 em 90 dias, mesmo com uso diário dos terminais). A pessoa quer ver, ao abrir o app, quanto usou cada agente: mensagens enviadas e tokens por dia, separados por agente, no estilo da tela `/stats` do Claude Code (abas no topo, mapa de dias, filtro de período).

## Decisões da pessoa

- **Formato:** um bloco só, com abas que trocam a métrica do mapa (direção A dos esboços).
- **Abas:** "Visão geral", "Mensagens" e "Tokens". A Visão geral substitui a antiga "Atividade".
- **Visão geral:** o mapa mostra mensagens enviadas por dia. Ao lado ficam mensagens no período, tokens no período, sequência de dias seguidos, dia mais ativo e agente mais usado.
- **Eventos de missão** saem do mapa. Eles já aparecem na faixa Missões e na aba Progresso.
- **Filtros:** período (Tudo, 7 dias, 30 dias, 90 dias) e chips por agente (Todos, Claude, Codex, Antigravity). Um agente novo entra sozinho pelo registro de provedores (`ORDER` em `apps/desktop/src/main/providers.ts`).
- **Cores:** cada agente usa a cor de referência dele. Com um agente filtrado, o mapa usa a rampa da cor dele. Com "Todos", cada dia leva a cor do agente que mais usou naquele dia, e a intensidade é o total do dia.
- **Fonte:** só o que foi feito pelo app. Uso dos mesmos CLIs fora do Project Hub não conta.
- **Missões:** contam só nos tokens (aba Tokens e total do período), com os mesmos números do contador de tokens da missão. Não contam como mensagens.
- **Antigravity:** só as mensagens. Os tokens dele aparecem como "indisponível" por enquanto.
- **Posição:** largura toda, logo abaixo da saudação. Embaixo, duas colunas: "Precisa de você" e "Missões" à esquerda, "Uso dos agentes" à direita.

## Objetivos

- Mostrar mensagens e tokens por dia e por agente, só do uso pelo app.
- Preencher o Início com o bloco em destaque, sem espaço morto.
- Aceitar agentes novos sem mudar a tela.

## Fora do escopo

- Uso fora do app.
- Tokens do Antigravity.
- Custo em dólar no bloco (o custo da missão continua na tela da missão).
- Aba "Modelos" como no `/stats`.

## Anti-objetivos

- Número simulado ou zero no lugar de dado que falta. Falta de dado aparece como "indisponível" ou traço, nunca como 0.
- Ler o histórico inteiro dos CLIs a cada abertura do Início, a ponto de travar a tela.
- Contar duas vezes a mesma resposta (por exemplo, a mesma sessão do Claude lida pelo terminal e pela missão).

## Dados disponíveis (levantamento de 2026-11-01)

| Agente | Mensagens | Tokens | Ligação com o app |
|---|---|---|---|
| Claude | entradas do usuário no transcript (`~/.claude/projects`, ou `CLAUDE_CONFIG_DIR`). O app não assina `UserPromptSubmit` (`HOOK_EVENTS` em `packages/agent-adapters/src/claude-code/settings.ts`) | já lido por terminal (`apps/desktop/src/main/terminal-usage.ts`), soma por `message.id` | hooks `SessionStart` de cada terminal, que trazem o `transcript_path`. Terminais anteriores aos hooks (de 22/10 até a leitura de uso, em 28/10) não têm log: ligam pela pasta e horário, como o Codex |
| Codex | `~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl` (as antigas comprimidas em `.jsonl.zst`, lidas também), eventos de mensagem do usuário | eventos `event_msg` com `type: token_count` (`total_token_usage`: entrada, cache lido, cache escrito, saída) | `session_meta.payload.cwd` e horário contra `terminal_sessions` |
| Antigravity | `~/.gemini/antigravity-cli/history.jsonl`: uma linha por mensagem, com `display`, `timestamp` (ms), `workspace` e `conversationId`; linhas com `type: slash_command` são comandos | SQLite por conversa com campos binários sem documentação: fora do escopo | `workspace` e `timestamp` contra `terminal_sessions` |

`terminal_sessions` (em `packages/database/src/schema.ts`) guarda `provider`, `projectId`, `createdAt` e `closedAt`, e o projeto dá a pasta. Isso permite ligar sessões passadas, não só as novas.

Missões (decisão da pessoa, 2026-11-01): entram só nos tokens, não nas mensagens, porque quem escreve o pedido é o app. Os tokens de cada execução (`executions.usage`, o mesmo número da seção "Gasto de tokens" da missão) somam no Claude, na aba Tokens e no total "tokens no período". `usage` é um total por execução, sem divisão por dia: o construtor decide em que dia ele entra (por exemplo, o dia de término da execução).

## Restrições

- CSP estrita do renderer: sem `<style>` e sem atributo `style` em texto. Os níveis e as cores do mapa entram por classe (como as `activity-level--N` de hoje).
- O renderer não importa zod em tempo de execução.
- Canal IPC novo só de leitura, com entrada e saída validadas por zod e listado nas listas de canais e de respostas.
- Textos e comentários em português.
- Contraste: o nível mais baixo do mapa com pelo menos 3:1 contra o cartão, e cada dia com nome acessível (regra do commit `37ed453`, branch `fix/inicio-decisoes`, que deve entrar antes ou junto).
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, build e `pnpm test:e2e`.

## Deixado ao construtor

- Como e quando ler os arquivos dos CLIs (sob demanda com cache, ou agregados guardados no banco). A tela não pode esperar uma leitura completa a cada abertura.
- A regra exata de ligação por pasta e horário (folga de tempo, pasta igual ou subpasta).
- A forma do contrato do canal novo (dias por agente com mensagens e tokens).
- As rampas de cor por agente, desde que respeitem o contraste.

## Escolhas minhas (a pessoa pode trocar)

- **Cores:** Claude `#D97757` (laranja do ícone oficial em `ProviderIcon.tsx`), Antigravity `#3186FF` (azul do ícone), Codex branco acinzentado (a marca é preto e branco). Elas entram como tokens novos em `tokens.css`.
- **Tokens no total:** a aba Tokens soma entrada nova e saída, com o cache à parte, a mesma regra da seção "Gasto de tokens" da missão.
- **Mensagem:** cada texto enviado pela pessoa ao agente. Comandos de barra (`/model`, `/usage`) não contam.
- **Período padrão:** 90 dias. "Tudo" vai até o registro mais antigo que o app tem.
- **Histórico:** entra o que o app consegue ligar a sessões passadas por `terminal_sessions`, não só o uso daqui para frente.
- **Codex e Antigravity no mesmo dia em pastas iguais fora do app:** podem ser contados por engano. Aceito, e dito numa nota curta do bloco.
- **Nome do agente mais usado:** pelo número de mensagens no período.
- **Mensagens do Claude:** contadas pelas entradas do usuário no transcript, que valem também para o passado. Não se cria um hook `UserPromptSubmit` novo.
- **Terminais do Claude sem log de hooks:** ligados pela pasta e horário, lendo `~/.claude/projects`. Missões rodam em worktrees de outra pasta, então não se confundem com os terminais.
- **"Tokens no período" com "Todos":** soma de quem tem dado (Claude e Codex), com a nota "sem Antigravity". Na aba Tokens, a cor do dia é a do agente que mais usou entre os que têm dado.
- **Agentes sem leitor:** o `shell` fica de fora. Um agente novo no registro aparece como chip, com mensagens e tokens "indisponível" até ganhar um leitor.
