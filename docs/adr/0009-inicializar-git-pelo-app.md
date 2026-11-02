# ADR 0009: Criar o repositório Git pelo aplicativo

- Status: aceita (aprovada pelo usuário em 2026-11-02; implementada no mesmo dia)
- Data: 2026-11-02
- Origem: conversa sobre o aviso "Este projeto não é um repositório Git" na visão Missões
- Altera: ADR 0004 e ADR 0007, na parte que proíbe commit pelo aplicativo

## Contexto

Projeto sem Git não tem missões. O worktree de uma missão sai de um commit base: o `createWorktree` confere `baseRef^{commit}`, e o `getStatus` rejeita repositório sem commits (ADR 0007). Hoje a única saída é a pessoa rodar `git init` e fazer o primeiro commit fora do aplicativo.

O ADR 0004 e o RF-GIT-007 proíbem commit, push, merge, fetch e pull. Esta decisão libera um único comando de escrita: criar o repositório com o primeiro commit. Nada além disso.

## Decisão

1. **Botão no aviso.** Na visão Missões, o aviso de projeto sem Git ganha o botão "Criar repositório Git". O texto do aviso continua.
2. **Confirmação antes.** Ao clicar, aparece uma confirmação que diz que o primeiro commit leva os arquivos que o `.gitignore` não ignora, e lista os arquivos com nome sensível que a pasta tem (`.env`, `*.pem`, `*.key`), com o aviso de que eles entram no commit se o `.gitignore` não os ignorar.
3. **Sequência fixa.** Ao confirmar, o adaptador roda, nesta ordem: `init --initial-branch=main`, `add` (respeitando o `.gitignore`) e `commit` com a mensagem "Estado inicial do projeto". Essas formas ficam numa função só, sem exportação de commit.
4. **`.gitignore` básico.** Se o projeto não tiver `.gitignore`, o aplicativo cria um com `node_modules/`, `.env`, `*.pem`, `*.key` e `dist/`, antes do `add`. A confirmação mostra que isso vai acontecer.
5. **Identidade.** O commit usa o `user.name` e o `user.email` que já estão no Git da pessoa. Se faltar qualquer um dos dois, o botão não cria nada e mostra a instrução para configurar. O aplicativo não inventa autor.
6. **Desfazer em falha.** Se algum passo falhar depois do `init`, o aplicativo remove a pasta `.git` que criou e o `.gitignore` que criou, e mostra o erro. Só remove o que ele mesmo criou.
7. **Depois de dar certo,** o projeto passa a ser tratado como Git na hora, e Nova missão fica habilitado.

Commit de rotina, push, merge, fetch e pull continuam proibidos. A fase 2 do painel direito (Código-fonte) precisa de outra decisão, em ADR próprio.

## Por quê

- Sem Git não há missão (ADR 0004). Pedir para a pessoa rodar comandos fora do aplicativo é o atrito que o botão resolve.
- O escopo é um comando, com confirmação explícita e desfazer em falha. Nenhum arquivo existente é alterado, exceto o `.gitignore`, que só é criado quando não existe.
- O `.gitignore` antes do primeiro commit evita gravar `.env` e chaves no histórico, onde são difíceis de tirar depois.

## Alternativas descartadas

- **Só `git init`, sem commit.** As missões continuariam sem funcionar. O aviso só mudaria de lugar.
- **Inventar a identidade do commit** (por exemplo, "Project Hub"). Gravaria um autor que a pessoa não escolheu no histórico dela.
- **Commitar tudo sem olhar o `.gitignore`.** Pode gravar segredos no histórico.
- **Liberar commit em geral agora.** Amplia a regra além do necessário. Fica para o ADR da fase 2.

## Consequências

- Os ADR 0004 e 0007 passam a valer com uma exceção: a criação do repositório e o primeiro commit, numa única função do adaptador. Um teste da API pública continua conferindo que nenhuma função com `commit` no nome é exportada.
- A lista de formas de escrita do adaptador (ADR 0007, item de `runGitWorktree`) ganha essa sequência fixa.
- Um canal IPC novo, versionado, recebe o pedido. O processo principal confere o projeto pelo `id`, nunca pelo caminho vindo da tela.
- A tela mostra a confirmação antes de qualquer escrita.
- Testes com repositório temporário: criação com `.gitignore` existente e ausente, `.env` fora do primeiro commit, falta de identidade, falha no commit com remoção do `.git` criado.
- Ajuste em relação à proposta: a confirmação não conta os arquivos do primeiro commit. A contagem depende do índice do Git, que só existe depois do `add`; por isso o aviso é sobre os nomes sensíveis e a regra do `.gitignore`.
- A identidade do Git é lida por `config --get user.name` e `user.email`, duas formas novas na lista de leitura do adaptador. Tudo o mais continua só de leitura.
- A prévia (`projects:repository-preview:v1`) não escreve nada; a criação (`projects:init-repository:v1`) só roda depois da confirmação.
- Pendente: a fase 2 decide se o aplicativo pode commitar em geral.
