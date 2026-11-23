# Tela de agentes: programas e perfis de execução

Data: 2026-11-22. Origem: planejamento, seções 10.9 e 10.10, Épico E, RF-AGT-001 e RF-AGT-005.

## Intenção

Dar à pessoa um lugar para ver os programas de agente que o app usa e para dizer como as missões rodam. Hoje toda
missão abre o Claude Code do mesmo jeito, sem modelo, esforço nem modo de permissão escolhidos, e a única forma de
saber se um programa funciona é abrir um painel.

## O que entra

Uma seção **Agentes** em Configurações, entre Contas e Geral, com duas partes.

### Programas

Uma linha por programa que o app sabe abrir (Claude Code, Codex, Antigravity CLI, OpenCode, Freebuff):

- instalado ou não instalado, por forma e rótulo, nunca só por cor;
- o que o programa faz no app: "Missões e painéis" (Claude Code) ou "Painéis" (os outros);
- o botão **Testar**, que roda `<programa> --version` e mostra a versão ou a falha. O teste não faz chamada cobrada
  e não lê conta nem credencial.

### Perfis de execução

Um perfil diz como o Claude Code de uma missão abre:

- **nome**, com as regras do nome de conta;
- **modelo**: Padrão do programa, Fable, Opus, Sonnet ou Haiku (`--model <apelido>`);
- **esforço**: Padrão do programa, baixo, médio, alto, extra alto ou máximo (`--effort`);
- **modo de permissão**: Padrão do programa, Perguntar tudo (`manual`), Aceitar edições (`acceptEdits`) ou
  Automático (`auto`), por `--permission-mode`.

Sempre existe o perfil **Padrão do programa**, que não tem linha no banco, não se edita e não passa opção nenhuma.
A pessoa cria, edita e remove os outros, e marca um como o padrão das missões novas.

A missão nasce com o perfil padrão. A pessoa troca o perfil no bloco de decisão da missão, ao lado da conta, com a
mesma trava da conta: antes de começar, ou depois de falhar ou ser cancelada. As opções do perfil são lidas a cada
tentativa, na hora de abrir o agente, também na retomada em outra conta.

## O que fica de fora

- `bypassPermissions`, `dontAsk` e `plan` não são oferecidos: os dois primeiros tiram a pessoa do controle, e o
  terceiro não executa.
- Limite de tempo, de custo e de ferramentas por perfil (RF-AGT-005) fica para a próxima entrega: exige um relógio
  no orquestrador que sobreviva ao reinício do app.
- Perfis para o Codex e os outros programas: só o Claude Code roda missões.
- O planejador (`claude -p`) não usa o perfil.
- Desativar um perfil sem removê-lo.

## Regras

- O modelo, o esforço e o modo vêm de listas fixas no contrato. A tela manda só o id do perfil; os argumentos nascem
  no processo principal.
- Remover um perfil devolve as missões dele ao Padrão do programa (o repositório faz isso na mesma transação da
  remoção) e, se ele era o padrão, limpa o padrão.
- Nome repetido é recusado, sem diferenciar maiúsculas.
- O teste do programa tem prazo de 10 s, mostra só a primeira linha da saída, com no máximo 80 caracteres, e nunca
  roda dois testes do mesmo programa ao mesmo tempo.

## Abordagens

1. **Perfis numa tabela, missão apontando para o perfil** (escolhida): a missão já tinha a coluna
   `execution_profile_id`, reservada pela fundação com o valor `padrao`; ela passa a guardar o id do perfil, sem
   migração na tabela de missões. Não há chave estrangeira (o valor `padrao` não é uma linha): a remoção do perfil
   devolve as missões ao `padrao` na mesma transação.
2. Perfis como JSON nas configurações do app: menos código, mas sem integridade com as missões.
3. Só um conjunto global de opções, sem perfis: mais simples, mas não deixa uma missão rodar no Haiku e outra no Opus.

## Peças

- Banco: tabela `execution_profiles` (migração 0019) e o repositório dela; a missão usa a coluna
  `execution_profile_id`, que já existia.
- Contratos: `agents.ts` (programas, perfis, entradas), canais `agents:*:v1` e `missions:set-profile:v1`, campos
  `profileId` e `profileName` na missão.
- Aplicação: casos de uso dos perfis, `setMissionProfile`, o orquestrador passa as opções ao adaptador.
- Adaptador do Claude Code: `AgentStartInput.options` vira `--model`, `--effort` e `--permission-mode`.
- Processo principal: serviço dos agentes (programas, teste, perfis) e os canais.
- Tela: `AgentsSection`, com as linhas dos programas e a lista de perfis; seletor de perfil no bloco de decisão.
