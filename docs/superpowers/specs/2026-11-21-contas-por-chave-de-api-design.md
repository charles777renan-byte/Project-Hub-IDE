# Contas por chave de API: desenho

> **Depois da prova na máquina (2026-11-21):** a pessoa decidiu que esta entrega cobre só o Claude Code. O Codex interativo ignora a chave do ambiente e pede login; a conta API do Codex fica para quando ele aceitar a chave pelo ambiente. O Claude Code interativo pergunta se usa a chave do ambiente: o app grava a aprovação no `.claude.json` da pasta da conta (os 20 últimos caracteres, o que o programa grava ao aprovar), e a tira na troca e na remoção da chave. Resultado da prova em `2026-11-21-contas-por-chave-de-api-prova.md`.

Data: 2026-11-21, revisado no mesmo dia depois da leitura de construtor. Estado: aprovado pela pessoa em 2026-11-21, com a cifra do cofre em duas camadas (Windows mais senha), escolhida por ela.

Complementa `2026-11-18-configuracoes-e-contas-design.md`, que deixou "login por chave de API" fora do escopo.

## Intenção

A pessoa tem chaves de API da Anthropic e da OpenAI e quer usar o Claude Code e o Codex por elas, como contas normais do app, ao lado das contas de assinatura. Não é uma reserva para quando a assinatura bate no limite: é uma conta que ela escolhe ao abrir um painel ou iniciar uma missão.

Pediu "muito mais segurança na hora da criação e integração". A chave é um segredo de longa duração e com cobrança por uso: quem a copia gasta o dinheiro da pessoa.

## Metas

1. Criar uma conta do Claude Code ou do Codex do tipo **API**, com a chave que a pessoa já tem.
2. Usar essa conta como qualquer outra: escolher ao abrir painel ou missão, definir como padrão, renomear, remover.
3. Trocar a chave de uma conta (rodízio) e removê-la, sem recriar a conta.
4. A chave guardada cifrada, fora dos canais do app com a tela, dos logs do app e do ambiente dos outros terminais.
5. A tela deixar claro, em toda parte onde a conta aparece, que ela cobra por uso.

## Fora do escopo

- Um chat próprio do app, falando com os modelos sem o Claude Code nem o Codex.
- Chaves de outros serviços (Gemini, OpenRouter, Bedrock, Vertex, Azure) e endereços de API alternativos (`ANTHROPIC_BASE_URL`, provedores do Codex).
- Mostrar gasto em dinheiro, saldo ou limite de gasto da chave. A conta API não tem os limites de assinatura; a tela diz só "cobrança por uso".
- Criar, listar ou revogar chaves no Console da Anthropic ou na plataforma da OpenAI. Isso a pessoa faz no site.
- Transformar a conta Principal em conta API. A Principal continua sendo a pasta do programa na máquina.
- Trocar o tipo de uma conta existente (assinatura para API ou o contrário). Cria-se outra conta.
- Mascarar a chave na saída dos terminais, e limpar a chave do que o programa ou o agente escrevem (ver "O que o app não controla").
- Apagar ou reescrever os backups antigos do banco.

## O que não pode acontecer

Vale para o que **o app** faz. O que o programa e o agente fazem com a chave que receberam está em "O que o app não controla".

- O app mandar a chave ao processo da tela (renderer): nem num campo, nem num evento, nem numa resposta de IPC.
- O app gravar a chave em texto puro: no banco, em arquivo, em log, na auditoria ou num aviso.
- O app pôr a chave no ambiente de um processo que não seja o programa daquela conta. Git, `gh`, leitores de sessão, de uso e de limites, e os comandos de estado, saída e login nunca a recebem.
- Uma chave da máquina (`ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` no ambiente da pessoa) vazar por herança para qualquer terminal. Hoje a lista de variáveis permitidas já impede; não pode regredir.
- Uma conta API cair na assinatura ou na Principal em silêncio quando a chave falta ou não abre. A abertura falha com mensagem clara.
- O app fazer uma chamada cobrada para "testar" a chave.
- Um erro ou exceção carregar o texto lido da área de transferência ou a chave. O handler de IPC grava o objeto de erro no console (`trusted-handler.ts`); os erros do cofre e da validação são criados sem o valor.

## A exceção ao compromisso anterior

O desenho de contas diz que "o app nunca vê nem guarda senha ou token". Este desenho abre uma exceção, só para contas do tipo API: o processo principal recebe a chave, a cifra e a guarda. Vale para a chave de API e para mais nada. As contas de assinatura continuam como estão, com o login no próprio programa.

## O que o app não controla

A pessoa precisa conhecer estes limites antes de aprovar. A tela os resume na criação da conta.

- **O programa e o agente enxergam a chave.** Ela está no ambiente do processo. O agente, e qualquer comando que ele rode, pode lê-la. A própria pessoa pode lê-la digitando um comando no painel. Se a chave aparecer na saída de um comando, ela vai para onde a saída vai: a tela do terminal, os transcripts do programa na pasta da conta, o log de hooks da missão e a auditoria (que guarda o final da saída dos testes).
- **O programa pode gravar um trecho da chave.** O Claude Code, ao aceitar uma chave pela primeira vez, guarda um trecho final dela na pasta da conta, em texto puro (a confirmar na prova).
- **Programas do mesmo usuário do Windows.** Com o cofre trancado, não abrem a chave sem a senha. Com o cofre destrancado, a chave de cifra está na memória do processo principal do app; um programa capaz de ler a memória de outro processo do mesmo usuário ainda poderia alcançá-la.
- **A área de transferência.** O histórico do Windows (Win+V), a sincronização da área de transferência na nuvem e gerenciadores de área de transferência podem guardar a chave copiada. O app limpa a área de transferência, mas não esses históricos.
- **Chave removida não é chave revogada.** Backups antigos do banco guardam o texto cifrado da época. Quem remove uma chave por suspeita de vazamento precisa revogá-la no site do serviço.

Texto da criação da conta: "O programa e os comandos que ele executa têm acesso à chave. Use uma chave só para este computador, com limite de gasto definido no site do serviço. Se suspeitar de vazamento, revogue a chave no site."

## O que foi conferido na máquina e no código (2026-11-21)

- `codex login --with-api-key` lê a chave pela entrada do programa e a grava na pasta da conta (`auth.json`), em texto puro. É o caminho que este desenho **evita**.
- `claude auth login --console` faz login pelo navegador com cobrança por API. Não usa uma chave já existente; não serve à meta 1.
- A lista de variáveis permitidas dos terminais (`terminal-host/env.ts`) não inclui `ANTHROPIC_API_KEY` nem `OPENAI_API_KEY`, e uma variável extra substitui a do ambiente sem diferenciar maiúsculas.
- O processo de terminais não guarda o ambiente de um terminal, não o devolve em resposta e não o grava em log. Ao reiniciar o app, o terminal é reassinado, e não reaberto: não há ambiente persistido.
- O app não tem cofre de segredos hoje (nenhum uso de `safeStorage`).
- A conta removida não é apagada do banco: recebe `removed_at`. A remoção não é uma transação: saída pelo programa, pasta, marca.
- O ambiente do agente de missão é fixado uma vez, quando o app sobe (`claude-agent.ts`, `adapter.ts`); `AgentStartInput` é só `{ cwd, prompt }`.

## Caminhos considerados

1. **O app guarda a chave num cofre cifrado e a entrega ao programa da conta por variável de ambiente.** Serve para a chave exata da pessoa nos dois programas e a deixa cifrada em disco. Custo: o app passa a guardar um segredo (a exceção acima). **Escolhido pela pessoa em 2026-11-21.**
2. **O programa guarda.** Codex por `--with-api-key` (texto puro na pasta da conta), Claude Code por `--console` (não usa a chave que a pessoa tem). O app não vê nada, mas a chave do Codex fica em texto puro e a meta 1 não é atendida no Claude Code.
3. **Misto.** Codex pelo caminho 2 e Claude Code pelo 1. Dois comportamentos para explicar e a chave do Codex em texto puro.

## Como funciona

### O tipo da conta

A conta ganha um tipo: `subscription` (as de hoje) ou `api`. O tipo é escolhido na criação e não muda. A Principal é sempre `subscription`.

Na tela, "Adicionar conta" passa a perguntar o tipo: "Assinatura (login pelo programa)" ou "Chave de API (cobrança por uso)". A conta API mostra um selo "API" ao lado do nome, na lista de Contas e em todo seletor de conta (painel, missão, aba Sessões), e a linha "Cobrança por uso · chave terminada em `…ab12`" no lugar do e-mail.

Estados da conta API: "Chave guardada", "Sem chave" (conta criada e chave ainda não colada, ou removida), "Chave ilegível" (o cofre abriu, mas esta chave não) e "Cofre trancado" (a senha ainda não foi digitada nesta abertura do app). Só "Chave guardada" pode ser usada ou virar padrão.

### Entrada da chave: pela área de transferência, sem passar pela tela

A tela não tem campo para a chave. O fluxo:

1. A pessoa copia a chave no site do serviço.
2. Na linha da conta, clica em **Colar chave da área de transferência**. A tela manda só `(programa, id da conta)`.
3. O processo principal lê a área de transferência, apara espaços e confere a forma:
   - Anthropic: começa com `sk-ant-`. Recusa `sk-ant-admin` (chave de administração: não serve ao programa e dá muito mais poder se vazar).
   - OpenAI: começa com `sk-` e não com `sk-ant-`. Recusa `sk-admin-`.
   - Só letras, números, `-` e `_`; tamanho entre 20 e 512.
   - Texto fora da forma é recusado com "A área de transferência não tem uma chave de API da Anthropic" (ou da OpenAI), ou "Esta é uma chave de administração. Use uma chave de API comum.", e nada é guardado. A mensagem nunca repete o texto lido.
4. A chave é cifrada e guardada. A resposta para a tela leva só os 4 últimos caracteres.
5. O processo principal limpa a área de transferência, se ela ainda tiver a mesma chave.
6. A tela mostra "Chave guardada, terminada em `…ab12`. Confira se é a chave certa." e lembra: "Apague a chave do histórico da área de transferência do Windows (Win+V), se ele estiver ligado."

**Trocar chave** repete o fluxo e substitui a anterior. **Remover chave** apaga a chave do cofre e deixa a conta em "Sem chave".

Trocar e remover **não são bloqueados** por painéis abertos: quem troca por suspeita de vazamento não pode ser impedido. A confirmação, na linha, diz o que acontece: "Os painéis abertos desta conta continuam com a chave antiga até serem fechados: A, B. Para a chave antiga parar de valer, revogue-a no site do serviço."

### O cofre

- Um único módulo do processo principal (`accounts/account-vault.ts`) cifra, decifra, confere e apaga. Só ele toca a cifra. A chave decifrada existe só como valor local, entregue a quem monta o ambiente de lançamento; não fica em variável de módulo nem em cache.
- O texto cifrado fica no banco do app, numa tabela própria (`account_secrets`: id da conta, texto cifrado, 4 últimos caracteres, data). Não fica na pasta da conta, que é a pasta de trabalho do programa e do agente.
- A linha do cofre é apagada com `secure_delete` ligado, para o texto cifrado não sobrar em páginas livres do banco.
- **Remover a conta**: primeiro apaga a linha do cofre, depois a pasta, depois marca a conta como removida. Não há saída pelo programa (conta API não tem login). Se a pasta falhar, a conta fica na lista em "Sem chave", e não com chave órfã.
- **Estado na lista**: com o cofre destrancado, a lista pede ao cofre para conferir cada conta API (`check`: decifra e descarta dentro do módulo). É assim que "Chave ilegível" aparece antes de a pessoa tentar abrir um painel. Com o cofre trancado, a lista não confere nada e mostra "Cofre trancado", com o botão "Destrancar".
- **Conta padrão**: remover a chave da conta padrão devolve a padrão à Principal, e a confirmação diz isso ("Esta é a conta padrão do Claude Code. A padrão volta a ser a Principal."). Uma chave que fica ilegível não muda a padrão: a abertura falha com a mensagem, e a pessoa decide.
- **A cifra**: duas camadas, descritas em "A cifra: Windows mais senha do cofre". Sem as duas disponíveis a conta API não pode ser criada, e não há modo sem cifra.

### Duas funções: a pasta para todos, a chave só para o lançamento

Hoje `account-paths.ts` tem `envOf`, que todo o app chama (comandos de conta, leitores, e depois painéis, missões, `gh`). A chave não pode entrar ali. Passam a existir duas funções:

- `envOf(programa, id)`: como hoje, só a pasta da conta. É a que os comandos de conta, os leitores, o Git e o `gh` usam. Nunca devolve a chave.
- `launchEnvOf(programa, id)`: o `envOf` mais a chave (`ANTHROPIC_API_KEY` no Claude Code, `OPENAI_API_KEY` no Codex), pedida ao cofre na hora. Só três lugares a chamam: a abertura de painel, o início de uma sessão de agente de missão e o planejador da missão.

Barreiras no código, e não só na disciplina de quem chama:
- `account-cli` (estado, saída e login) recusa conta do tipo `api`. `accounts-service` não chama esses comandos para conta API: o estado vem do cofre, "definir como padrão" exige "Chave guardada", e remover não roda a saída pelo programa.
- Um teste percorre o código do processo principal e falha se `launchEnvOf` for chamada fora dos três lugares.

Sem chave ou com chave ilegível, `launchEnvOf` falha ("A conta não tem uma chave de API guardada." / "Não foi possível abrir a chave desta conta. Cole a chave de novo."), e nada abre.

### Missões

- A parte 1B leva o **id da conta**, e não o ambiente, até o adaptador do agente. O adaptador chama `launchEnvOf` a cada `start`: a chave é lida do cofre no início de cada sessão da cadeia e não fica guardada entre uma tarefa e outra.
- Se a chave for removida ou ficar ilegível no meio da cadeia, a tarefa seguinte falha ao iniciar, com a mensagem do cofre, e a missão para como em qualquer falha de início de agente. Ela não troca de conta.
- **O planejador roda na conta da missão**, como o desenho de 11-18 já diz, e recebe a chave. É o mesmo programa, na conta que a pessoa escolheu; o custo é que o planejamento também cobra por uso.

### O que a conta API não tem

- Não tem "Conectar", "Desconectar" nem login guiado.
- Não tem identidade (e-mail) nem organização: o app não consulta o serviço.
- Não entra na leitura de limites de assinatura. Onde as outras contas mostram uso, ela mostra "Cobrança por uso".

### Avisos de cobrança

- Ao criar a conta e ao defini-la como padrão: "Esta conta cobra por uso, sem o teto de uma assinatura. Missões longas podem custar caro." A definição como padrão pede confirmação na linha.
- Iniciar missão com conta API mostra o selo "API" junto do botão; não há confirmação a mais a cada missão.

## A cifra: Windows mais senha do cofre

Decidido pela pessoa em 2026-11-21, no lugar de só a proteção do Windows. A senha existe para que outro programa do mesmo usuário (um agente de outra conta, por exemplo) não abra o cofre lendo o banco.

### As duas camadas

1. **Senha do cofre.** Da senha sai a chave de cifra, por `scrypt` (do Node, com sal aleatório de 16 bytes guardado no banco; N=2^17, r=8, p=1). Cada chave de API é cifrada com AES-256-GCM, com um nonce aleatório por gravação.
2. **Proteção do Windows.** O resultado da camada 1 é embrulhado com `safeStorage` (presa ao usuário do Windows) antes de ir para o banco.

Para abrir uma chave é preciso o usuário do Windows **e** a senha. A senha nunca é gravada, nem cifrada. O banco guarda um verificador (um texto fixo cifrado com a chave derivada), para distinguir senha errada de cofre corrompido.

### Criar a senha

Ao guardar a primeira chave de API, o app pede para criar a senha do cofre: no mínimo 12 caracteres, digitada duas vezes, sem regra de composição. O texto diz: "Esta senha não pode ser recuperada. Se você a esquecer, será preciso colar as chaves de novo."

### Onde a senha é digitada

Numa **janela própria**, pequena e modal, aberta pelo processo principal. Ela não é a tela do app: tem página, preload e canal próprios, que só sabem enviar a senha e cancelar; roda em sandbox, com a mesma CSP estrita, sem navegação e sem acesso aos canais do app. A tela do app só pede "destrancar" e recebe "destrancado" ou "cancelado". A senha não passa pelo processo da tela do app.

### Trancado e destrancado

- O cofre nasce **trancado** a cada abertura do app. Ele é destrancado quando a pessoa clica em "Destrancar" em Contas, ou na primeira vez que algo precisa de uma chave (abrir painel ou iniciar missão numa conta API): a janela da senha aparece e a ação segue depois dela.
- Destrancado, a chave derivada fica na memória do módulo do cofre até o app fechar ou a pessoa clicar em **Trancar cofre** (em Contas). As chaves de API continuam sem cache: são decifradas a cada uso.
- Senha errada: "Senha incorreta." Depois de 5 erros seguidos, a espera entre tentativas cresce (2 s, 4 s, 8 s, até 60 s), contada no processo principal.
- **Missões**: uma missão que precisa iniciar uma sessão com o cofre trancado (por exemplo, retomada depois de reabrir o app) não inicia; fica em "aguarda você", com "Destranque o cofre para continuar", e o app avisa como avisa os outros pedidos de atenção. Ela não troca de conta.

### Trocar e esquecer a senha

- **Trocar senha**: pede a atual e a nova; todas as chaves são regravadas com a nova, numa transação.
- **Esqueci a senha**: "Redefinir cofre" apaga todas as chaves guardadas e o verificador, com confirmação na linha que lista as contas afetadas. As contas ficam em "Sem chave" e a pessoa cola as chaves de novo, com uma senha nova.

### O que esta camada não cobre

- O agente da própria conta API, que recebe a chave no ambiente.
- Um programa que leia a memória do processo principal enquanto o cofre está destrancado.
- Um programa que registre o teclado da pessoa.

## Entregas

Esta entrega depende da parte 1B (usar a conta ao abrir painel e missão). Ordem: **1B**, depois **contas por chave de API**, depois **GitHub**. A 1B já deve nascer levando o id da conta até o adaptador do agente.

A primeira tarefa do plano é uma prova na máquina, antes de qualquer código de produto (ver "A confirmar").

## Testes

- Cofre: cifra e decifra; o texto cifrado não contém a chave; sem cifra disponível, recusa; chave ilegível vira estado, e não exceção; os erros do cofre não carregam o valor nem a senha.
- Senha: trancado não decifra nada; senha errada não destranca e a espera cresce depois de 5 erros; a senha e a chave derivada não aparecem no banco nem em log; trocar a senha regrava tudo e a antiga deixa de abrir; redefinir apaga as chaves e o verificador; trancar apaga a chave derivada da memória do módulo.
- Janela da senha: a senha não aparece em nenhum canal de IPC da tela do app; a janela não tem acesso aos canais do app.
- Colar: forma certa guarda e devolve só os 4 últimos; forma errada não guarda e a mensagem não repete o texto; chave de administração é recusada; chave de um serviço na conta do outro é recusada; a área de transferência é limpa só se ainda tem a chave.
- Contratos: com uma chave conhecida guardada, o valor dela não aparece em nenhuma resposta serializada dos canais de contas, de terminais e de missões. A entrada de colar leva só programa e id.
- Ambiente: `launchEnvOf` de conta API traz a variável certa; `envOf` nunca traz; conta de assinatura nunca recebe; chave da máquina não é herdada; conta API sem chave falha e não cai na Principal; `launchEnvOf` só é chamada nos três lugares.
- Comandos de conta: estado, saída e login recusam conta API.
- O que o app escreve: depois de colar a chave e abrir um painel com o programa falso, a chave não aparece em nenhuma linha de log do app, no log do processo de terminais nem no banco (fora do texto cifrado).
- Remoção: remover a chave ou a conta apaga a linha do cofre; remover a chave da conta padrão devolve a padrão à Principal.
- Missão: com o cofre trancado, a sessão não inicia e a missão fica em "aguarda você"; a chave é lida a cada `start`; chave removida no meio da cadeia faz a tarefa seguinte falhar com a mensagem, sem trocar de conta.
- Tela: selo "API" na lista e nos seletores; estados; confirmações com os nomes dos painéis abertos; a conta API não oferece Conectar.
- Ponta a ponta, com programa falso e chave falsa: criar conta API, colar a chave, abrir um painel e conferir que o programa falso recebeu a variável; trocar e remover a chave.

## Decisões do construtor (a pessoa pode rever)

- **Entrada só pela área de transferência**, sem campo de texto. Custo: a pessoa precisa copiar a chave antes de clicar.
- **Sem chamada de teste ao serviço.** Custo: chave errada só é descoberta ao abrir o painel.
- **Texto cifrado no banco**, e não na pasta da conta.
- **Duas funções de ambiente** (`envOf` e `launchEnvOf`), com teste que limita quem chama a segunda.
- **O planejador da missão recebe a chave.** Custo: mais um processo com o segredo, e o planejamento cobra por uso.
- **Trocar e remover a chave não são bloqueados por painéis abertos**; a confirmação avisa que eles seguem com a chave antiga e manda revogar no site.
- **A lista confere cada chave** (decifra e descarta) para mostrar "Chave ilegível". Custo: a chave passa pela memória do processo principal a cada releitura da lista.
- **Remover a chave da conta padrão devolve a padrão à Principal, com aviso**; chave ilegível não muda a padrão.
- **Chaves de administração são recusadas.**
- **Senha do cofre**: mínimo de 12 caracteres, sem regra de composição; `scrypt` com N=2^17; espera crescente depois de 5 erros; sem trancar sozinho por inatividade (uma missão em andamento precisa da chave a cada tarefa). Custo: enquanto o app está aberto e destrancado, o cofre fica aberto.
- **Senha esquecida não tem recuperação**: redefinir o cofre apaga as chaves.
- **A janela da senha é uma janela separada do processo principal**, e não um diálogo da tela do app.
- **Chave por variável de ambiente**, e não pelo ajuste `apiKeyHelper` do Claude Code. O ajuste tiraria a chave do ambiente dos comandos que o agente roda, mas exige um programa auxiliar que busque a chave no app; fica como reforço possível depois.
- **A saída do terminal não é mascarada.** Custo: quem digita um comando que imprime a chave a vê na tela.
- **Backups antigos do banco não são limpos.** Custo: guardam o texto cifrado de chaves já removidas; por isso o aviso de revogar no site.
- **O tipo da conta não muda** depois de criada. **Sem valor em dinheiro na tela.**

## A confirmar na primeira tarefa do plano

Prova na máquina, com uma chave de verdade da pessoa e sem gravar nada no app:

1. **Claude Code**: com `ANTHROPIC_API_KEY` no ambiente e uma pasta de conta vazia, o programa abre e responde sem pedir login? Ele pergunta, na primeira vez, se aceita a chave? Se perguntar: o que ele grava na pasta da conta (procurar a chave inteira e trechos dela), e como uma missão, que nasce sem ninguém no terminal, passa por essa pergunta. Se a pergunta existir, **o app para e leva o resultado à pessoa**, com as saídas possíveis: exigir que a conta seja aberta uma vez num painel antes de servir a missões, ou o app gravar a aprovação na pasta da conta.
2. **Codex**: com `OPENAI_API_KEY` no ambiente e `CODEX_HOME` vazio, o programa usa a chave sem `codex login`? Se não usar, a alternativa é o app entregar a chave ao `codex login --with-api-key` pela entrada do programa, o que grava a chave em texto puro na pasta da conta. Isso muda o que a pessoa aprovou: **se a prova falhar, o app para e pergunta** antes de seguir com o Codex.
3. Nos dois, depois de uma conversa curta, procurar a chave e trechos dela nos arquivos novos da pasta da conta.

## Referências

- `docs/superpowers/specs/2026-11-18-configuracoes-e-contas-design.md`
- `apps/desktop/src/main/accounts/account-paths.ts`, `account-cli.ts`, `accounts-service.ts`
- `apps/desktop/src/terminal-host/env.ts`, `apps/desktop/src/main/ipc/trusted-handler.ts`
