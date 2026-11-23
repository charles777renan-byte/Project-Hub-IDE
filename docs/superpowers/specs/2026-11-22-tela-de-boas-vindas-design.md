# Tela de boas-vindas

## Por quê

O planejamento pede uma tela de onboarding (seção 10.2, critério 21.1): preparar o ambiente sem exigir que a pessoa
conheça a arquitetura. Hoje o primeiro uso mostra só "Comece por um projeto", com dois passos. Quem não tem o Git ou o
Claude Code instalado só descobre quando a primeira missão falha.

## O que é

No Início, enquanto não há nenhum projeto, o painel de boas-vindas toma o lugar do estado vazio. Ele tem quatro
partes, de cima para baixo:

1. **Boas-vindas**: o título e uma frase que explica o fluxo (missão, plano, cópia separada do projeto, aprovação).
2. **Antes de começar**: três conferências, cada uma com ícone, nome, estado em palavras e o que fazer quando falta.
   - **Git**: instalado, com a versão, ou "Não encontrado".
   - **Claude Code**: instalado ou "Não encontrado", com o botão **Testar** (o mesmo teste da seção Agentes).
   - **Conta do Claude Code**: "Conectada" ou "Sem login", com o atalho **Abrir Contas**.
   - O botão **Conferir de novo** relê as três.
3. **Onde ficam os seus dados**: a pasta de dados do app, a pasta das cópias de trabalho (worktrees), e duas frases
   sobre login e aprovação.
4. **Adicionar projeto**: a ação principal, pelo mesmo pedido da barra lateral. Uma linha acima dela resume o estado:
   tudo pronto, ou o que falta (a pessoa pode adicionar o projeto mesmo assim).

Quando o primeiro projeto entra, o Início volta ao painel de sempre. Não há estado gravado de "boas-vindas concluída":
a tela depende só de existir projeto.

## Regras

- A conferência do Git roda `git --version` no processo principal, sem shell, com prazo de 10 s. A tela recebe só se
  está instalado e a primeira linha da saída, com no máximo 80 caracteres.
- As pastas são só para exibição. A tela não escolhe nem abre caminho.
- Uma conferência que não pôde ser lida não trava as outras, e nunca impede adicionar o projeto.
- O estado é dito por ícone e palavra, nunca só pela cor.

## Abordagens

1. **Painel no lugar do estado vazio do Início** (escolhida): aparece sozinho no primeiro uso, some sozinho, e não
   pede estado novo no banco.
2. Assistente de várias etapas em tela cheia: mais código e mais cliques para dizer a mesma coisa, e pede um estado
   de "concluído".
3. Seção nas Configurações: a pessoa nova não chega lá sozinha.

## Fora desta entrega

- Escolher a pasta dos worktrees (hoje ela sai da pasta de dados; mudar pede mover o que já existe).
- Instalar o Git ou os programas pelo app.
- Conferir os outros programas (ficam na seção Agentes).

## Peças

- Contrato: `environmentDtoSchema` (`git.installed`, `git.version`, `worktreesRoot`), canal `system:environment:v1`,
  `window.projectHub.system.environment()`.
- Processo principal: `environment-check.ts` e o canal em `ipc/system.ts`.
- Tela: `components/home/Welcome.tsx`, no lugar de `FirstSteps` em `HomePage.tsx`; estilos em `home.css`.
