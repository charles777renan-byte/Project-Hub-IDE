# Troca automática de conta quando o limite acaba: desenho

Data: 2026-11-21, revisado depois da leitura de construtor. Estado: rascunho, para aprovação da pessoa.

Complementa `2026-11-18-configuracoes-e-contas-design.md` (várias contas por programa) e `2026-11-21-contas-por-chave-de-api-design.md` (contas por chave de API). O primeiro deixou de fora "trocar a conta de um painel ou de uma missão que já está rodando". Este desenho abre uma exceção só para a missão, e só quando o limite acaba.

## Intenção

A pessoa tem mais de uma conta de assinatura do Claude Code, e às vezes também do Codex. Quando o limite de uma conta acaba, o trabalho para. Ela quer que o app passe sozinho para outra conta que ainda tem limite, e quer escolher em Configurações se essa troca fica ligada ou desligada.

Escolhas da pessoa (2026-11-21):

- **Onde a troca age: A + C.**
  - **A**: a missão que está rodando continua em outra conta, levando a conversa junto.
  - **C**: ao abrir algo novo (painel ou missão), o app evita a conta que já está sem limite.
  - Painel aberto não troca sozinho.
- **Como o app percebe que o limite acabou:** pela linha que o Claude Code grava na conversa quando o limite acaba. Isso não gasta cota.
- **Como escolhe a próxima conta:** pelo último estado conhecido dos limites.
- **Ordem da troca:** a conta padrão primeiro, depois as outras na ordem da lista. O app pula conta sem login, sem chave ou com o cofre trancado.
- **Contas de chave de API** ficam fora da troca. Uma opção separada, desligada por padrão, inclui essas contas, porque elas cobram sem teto.
- **A opção** fica em Configurações > Contas, com um interruptor por programa, desligado por padrão.

## Metas

1. Em Configurações > Contas, cada programa com várias contas (Claude Code e Codex) ganha o interruptor "Trocar de conta quando o limite acabar". O Claude Code ganha também "Incluir contas de chave de API". Os dois começam desligados.
2. Com a opção ligada, uma missão cujo limite acaba continua sozinha na próxima conta que pode ser usada. A conversa vai junto, e a troca fica registrada na missão e num aviso do sistema.
3. Com a opção ligada, ao abrir um painel ou planejar, iniciar ou tentar de novo uma missão, a conta esgotada não vem marcada: a primeira conta que pode ser usada vem no lugar dela.
4. Com a opção desligada, nada troca. Mesmo assim, a missão cujo limite acaba diz isso claramente no bloco "Sua decisão", com a hora em que a cota renova, em vez de ficar em "esperando resposta" sem explicação.

## Fora do escopo

- Trocar a conta de um painel aberto (terminal interativo). A pessoa abre outro painel em outra conta.
- Retomar sozinho, quando a cota renova, uma missão que ficou sem nenhuma conta. A missão fica esperando, dizendo quando a cota renova, e a pessoa pede para continuar.
- Troca automática no Codex dentro de missões: as missões rodam no Claude Code. No Codex, a opção vale só para a abertura de painéis (C).
- Escolher uma ordem de troca diferente da ordem da lista.
- Ler os limites de todas as contas antes de trocar. Cada leitura do Claude gasta cota de verdade, e o app continua lendo só o que já lê hoje.
- O planejador do plano da missão trocar de conta no meio da geração. Se o limite acaba durante o planejamento, vale a regra C na próxima tentativa.

## O que não pode acontecer

- Trocar para uma conta de chave de API sem a opção "Incluir contas de chave de API" ligada.
- Entrar em laço: voltar a uma conta esgotada antes da hora da renovação, ou trocar sem parar.
- Trocar de conta em silêncio: toda troca fica na linha do tempo da missão e gera um aviso.
- Perder o trabalho da missão: os arquivos ficam no worktree da missão, e a troca não mexe neles.
- Pedir a senha do cofre sem a pessoa ter pedido nada. Uma conta API com o cofre trancado fica fora da troca automática.
- A chave de API aparecer em evento, auditoria, aviso ou log. Isso continua valendo como na entrega anterior.
- Trocar a conta de uma missão que a pessoa pausou ou parou.

## Abordagens consideradas

### Perceber que o limite acabou

1. **Pela linha que o Claude Code grava na conversa (escolhida).** Quando o limite acaba, o transcript da sessão recebe uma entrada de erro com `error: "rate_limit"`, `isApiErrorMessage: true` e um texto como "You've hit your session limit · resets 8:10pm (America/Sao_Paulo)". Esse formato foi visto nos transcripts desta máquina. O adaptador já lê os transcripts da missão para o gasto de tokens. É imediato e não gasta cota. O risco é o formato mudar numa versão nova do programa: os testes fixam o formato visto, e uma linha que não bate não dispara nada (a missão fica como hoje).
2. **Pela leitura de limites, quando uma janela chega a 100%.** Já existe, mas atualiza sozinha só a conta padrão e as contas em uso, e gasta cota. Perceberia tarde.
3. **Pelo texto da tela do terminal.** Frágil (idioma, cores, largura). Descartada.

### Continuar a conversa na outra conta

Cada conta tem a sua pasta de dados, e a conversa (o transcript) fica dentro dela. O `claude --resume <id>` procura `projects/<pasta do projeto>/<id>.jsonl` na pasta da conta em que roda.

1. **Copiar o transcript para a pasta da nova conta e abrir com `--resume <id>` (escolhida).** O agente continua com todo o contexto.
2. **Abrir uma sessão nova na outra conta, com o texto da tarefa e um pedido para continuar.** Funciona sempre, mas o agente perde a conversa e precisa redescobrir o que fez olhando os arquivos.

Escolha: a 1, com a 2 como reserva quando a 1 falhar (o transcript não existe, a cópia falha, ou a sessão retomada termina antes de começar). Antes de construir, o plano começa por **uma prova na máquina, rodada pela pessoa**: retomar, numa conta extra, uma conversa iniciada em outra conta. Se a retomada entre contas não funcionar (por exemplo, se o servidor recusar a conversa feita em outra organização), a reserva vira o caminho principal, e a pessoa decide.

## Como funciona

### 1. A opção em Configurações

- Em Configurações > Contas, no grupo de cada programa, abaixo da lista de contas, fica o interruptor "Trocar de conta quando o limite acabar", com a explicação "Quando o limite de uma conta acaba, a missão continua na próxima conta com limite, e painéis e missões novos não abrem na conta esgotada."
- No Claude Code, logo abaixo, fica o interruptor "Incluir contas de chave de API", com a explicação "Elas cobram por uso, sem teto." Ele só fica ativo quando o principal está ligado.
- Com uma conta só no programa, os interruptores ficam desativados, com o motivo: "Adicione outra conta para usar a troca automática."
- Os valores ficam em `app_settings`: `accounts.autoSwitch.<provider>` e `accounts.autoSwitch.includeApi.claude`. Valor que falta conta como desligado.
- O interruptor segue as regras visuais do app: nada com a aparência padrão do navegador, o estado mostrado por forma e texto (nunca só por cor), e o CSP rígido.

### 2. Quem pode receber a troca (conta elegível)

Uma conta é elegível, para um programa, quando:

- não foi removida;
- é de assinatura e está conectada; ou é de API, com "Incluir contas de chave de API" ligado, com a chave guardada e o cofre destrancado;
- não está **esgotada**.

**Esgotada** quer dizer uma destas coisas:
- o último estado de limites da conta tem uma janela em 100% que ainda não renovou (é a mesma regra de `quotaExhaustedMessage`);
- ou o app viu, nesta execução do app, a linha de limite dessa conta, e a hora da renovação ainda não chegou.

Sem a hora da renovação, a conta fica esgotada por 5 horas, ou até uma leitura de limites dizer o contrário.

Uma conta sem leitura nenhuma conta como elegível. Se ela também estiver sem limite, o detector percebe logo e a troca segue para a próxima.

**Ordem:** a lista de candidatas é a conta padrão, depois as outras na ordem da lista (a Principal primeiro, depois as extras na ordem de criação, sem repetir a padrão). Na abertura (C), vale a primeira elegível dessa lista. Na troca de uma missão (A), a conta atual fica de fora, e vale a primeira elegível da mesma lista. A missão sem conta gravada está na conta padrão.

### 3. A missão que bate no limite (A)

1. O adaptador do Claude Code, ao ler os transcripts da execução, encontra a entrada de limite. Ele emite um evento novo do agente, `limit.reached`, com a hora da renovação quando o texto a traz. O evento leva só a janela e a hora, nunca o texto inteiro da conversa.
2. O orquestrador marca a conta como esgotada até essa hora, no serviço de limites, para a regra C e a próxima troca enxergarem.
3. **Com a opção desligada:** nada muda no terminal. O Claude Code continua aberto, esperando, e a missão fica em `waiting_input`, como hoje. A diferença é o motivo, que o bloco "Sua decisão" mostra: "O limite da conta Trabalho acabou. Renova às 20:10. Quando renovar, peça para continuar. Ou pare a missão e tente de novo em outra conta." Não há um estado novo de pausa.
4. **Com a opção ligada:** o app escolhe a próxima conta elegível. Se não houver nenhuma, faz como no item 3, com o motivo "O limite acabou em todas as contas. A primeira renova às 20:10." Se houver:
   - encerra o terminal da execução;
   - grava a nova conta na missão;
   - copia o transcript da sessão (e a pasta de subagentes dela, se existir) para a mesma posição na pasta da nova conta;
   - abre uma nova tentativa da mesma tarefa na nova conta, com `--resume <id>` e uma mensagem curta pedindo para continuar de onde parou;
   - registra na linha do tempo da missão: "Limite da conta Trabalho acabou (renova às 20:10). A missão continuou na conta Pessoal.";
   - emite um aviso do sistema com o mesmo texto, que respeita o silêncio por projeto que já existe.
5. **Se a retomada falhar**, a nova tentativa abre na mesma conta com o texto da tarefa e o pedido de continuação, sem `--resume`. A linha do tempo registra que a conversa não pôde ser levada.
6. **Limite de trocas:** cada conta é tentada no máximo uma vez por esgotamento. Como uma conta esgotada não volta a ser elegível antes da renovação, o laço não acontece.
7. A troca acontece só com a missão `running` ou `waiting_input` por causa do limite. Uma missão pausada ou parada pela pessoa nunca troca sozinha.

### 4. A abertura (C)

- **Painel (Claude Code e Codex):** com a opção ligada e a conta padrão esgotada, a lista "Conta do …" vem com a primeira conta elegível marcada. A conta esgotada mostra "Sem limite até 20:10" e pode ser escolhida mesmo assim. Com uma conta só, nada muda.
- **Missão (planejar, iniciar, nova tentativa, retomar):** com a opção ligada e a conta da missão esgotada, o app troca para a primeira elegível antes de começar e registra a troca na linha do tempo. Sem nenhuma elegível, a ação falha com a mensagem da cota de hoje.

### 5. O que a pessoa vê

- Na linha do tempo da missão, a troca aparece como um evento próprio, com as duas contas e a hora da renovação.
- No bloco "Sua decisão", a conta mostrada é a nova.
- Na lista de contas (painel e missão), a conta esgotada mostra "Sem limite até HH:MM", com forma e texto.
- Um aviso do sistema a cada troca.

## Segurança

- A cópia do transcript fica dentro das pastas de dados das contas da própria pessoa, neste computador. O app não lê o conteúdo da conversa: só copia o arquivo.
- O caminho do arquivo é montado a partir do id da sessão (um UUID validado) e da pasta do projeto que o próprio programa usa. Nada vindo de fora vira caminho.
- O ambiente da nova tentativa é o da nova conta, montado pela mesma função de hoje. As regras da chave de API não mudam.

## Testes esperados

- **Unidade:**
  - reconhecer a linha de limite, nos formatos vistos e em formatos que não batem;
  - ler a hora da renovação;
  - escolher a conta elegível (ordem, API, cofre trancado, esgotada, conta única);
  - ler e gravar a opção.
- **Orquestrador, com agente simulado:**
  - troca com a opção ligada;
  - motivo do limite, sem troca, com a opção desligada;
  - todas esgotadas;
  - reserva quando a retomada falha;
  - sem laço;
  - não troca missão pausada pela pessoa.
- **Tela:** interruptores (estado, desativado com uma conta, o de API depende do principal); "Sem limite até" na lista; evento na linha do tempo.
- **E2E:** com o `claude` falso gravando a linha de limite num transcript, a missão troca de conta e continua; com a opção desligada, ela fica esperando e mostra o motivo. Só contas e chaves falsas.

## Decisões de construção (depois da leitura de construtor)

São chamadas minhas, que a pessoa pode corrigir.

- **Fim da tentativa que bateu no limite.** A missão roda uma tarefa por vez, e não há tarefas em paralelo dentro da mesma missão. Com a opção ligada e uma conta elegível, o orquestrador encerra o terminal (`stop`, que mata o processo). A tentativa fecha como `failed` com um motivo de saída novo, `account_limit`. A tarefa continua aberta, e uma nova tentativa da mesma tarefa começa na nova conta. A troca vale para a missão inteira: as tarefas seguintes também rodam na nova conta. O gasto lido até ali fica na tentativa antiga, como já acontece quando uma tentativa falha.
- **Como a retomada chega à abertura.**
  - O evento `limit.reached` leva o id da sessão do Claude (o `session_id` dos hooks) e o caminho do transcript (o `transcript_path` dos hooks), que o adaptador já recebe.
  - `AgentStartInput` ganha um campo opcional de retomada, com esses dois valores.
  - O adaptador do Claude Code, que já conhece a pasta de cada conta, faz a cópia para a pasta da nova conta e põe `--resume <id>` nos argumentos.
  - Como a troca acontece na hora, com os dados em memória, não há coluna nova no banco. Se o app fechar no meio da troca, a retomada da missão segue o caminho de hoje, e a nova tentativa abre sem a conversa.
- **Porta da conta esgotada.** `deps.accounts` do orquestrador ganha `exhaustedUntil(accountId)` e `markExhausted(accountId, until)`. O processo principal os implementa sobre o serviço de limites, que guarda a marcação em memória e a soma ao estado lido. Assim, `quotaExhaustedMessage`, a lista de contas e a regra C passam a enxergar a marcação. A escolha da próxima conta é uma função pura, testada sozinha, que recebe as contas, as opções e o estado de esgotamento.
- **A prova vem primeiro, mas só bloqueia a retomada da conversa.** A primeira tarefa do plano é a prova na máquina. A opção, o detector, a mensagem com a opção desligada, a regra C e a troca com a reserva (sessão nova com o pedido de continuação) não dependem dela. A cópia do transcript com `--resume` só entra se a prova passar.

## Deixado para quem constrói

- O nome exato do evento e os campos no contrato do agente.
- Onde guardar a marcação "esgotada até": no serviço de limites, em memória, que é suficiente porque a leitura de limites a corrige depois.
- O texto exato da mensagem de continuação.
- Como achar a pasta do projeto dentro de `projects/`: pelo caminho do transcript que os hooks já informam.
