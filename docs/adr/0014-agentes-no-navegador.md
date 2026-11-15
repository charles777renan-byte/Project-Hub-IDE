# ADR 0014: Agentes dos terminais usando o navegador do projeto

- Status: proposta; implementada na fase 3, no ramo `feat/navegador-agentes`. Passa a aceita com a integração do ramo.
- Data: 2026-11-15
- Origem: agentes vendo e usando o navegador, em `docs/superpowers/specs/2026-11-14-navegador-agentes-design.md`
- Complementa: ADR 0012 (navegador interno em view isolada), ADR 0013 (preview automático), ADR 0001 (isolamento do Electron) e ADR 0007 (decisões de fundação). Esta decisão abre uma terceira exceção controlada: um programa que roda num terminal passa a comandar páginas dentro do app.

## Contexto

Nas fases 1 e 2, só a pessoa via o navegador do projeto. O agente que roda num terminal (Claude Code, Codex) mudava o código e não tinha como conferir o resultado na página: abrir, ler, clicar, capturar a tela, ler o console. A fase 3 dá isso a ele.

Os riscos são três. O agente é um programa de fora, e o conteúdo de uma página é texto que pode tentar mandar nele. A sessão da pessoa no navegador tem logins. E o agente trabalha enquanto a pessoa faz outra coisa, então nada pode tomar o foco, abrir diálogo ou aparecer na tela sem ela pedir.

## Decisão

1. **Servidor de ferramentas no processo principal.** Um servidor HTTP do próprio app, só em `127.0.0.1`, numa porta escolhida pelo sistema, no caminho `/mcp`, sem estado entre pedidos. Ele recusa, sempre sem corpo: pedido sem `Authorization: Bearer` de um token vivo (401), `Host` que não é o dele (403) e qualquer pedido com `Origin` (403), que é o que uma página web manda. O token é conferido primeiro.
2. **Um token por terminal, preso ao projeto.** São 32 bytes aleatórios, gerados quando o terminal abre e comparados em tempo constante. O token existe na memória do processo principal e no ambiente daquele terminal (`PROJECT_HUB_BROWSER_TOKEN`); não vai para argumento de linha de comando, arquivo, log nem banco. O projeto de uma chamada sai do token: nenhuma ferramenta recebe um projeto. O token morre com o terminal.
3. **O renderer não participa.** Nenhum canal IPC leva o endereço do servidor, o token ou texto de comando. O único canal novo (`browser:agent-access:v1`) devolve rótulos de programas e sim ou não. O comando do terminal é montado só no processo principal, e o app continua sem escrever num terminal aberto.
4. **Sessão do agente separada e em memória.** As abas do agente usam a partição `navegador-agente-<projeto>`, sem `persist:`: começam deslogadas, não veem os cookies da pessoa e somem ao fechar o app. As políticas das páginas da ADR 0012 valem, e mais: download cancelado, `alert`, `confirm`, `prompt`, login HTTP, `mailto:` e links externos descartados sem diálogo. Cada descarte fica no console que o agente lê, sem repetir o endereço.
5. **Janela de apoio fora do monitor.** A captura de tela só funciona numa página que está sendo desenhada. Um experimento no Electron do projeto (44.9, Windows 11) mediu os arranjos: view solta, view em janela escondida e view invisível na janela principal não capturam; view de 1 por 1 na janela principal só captura com a janela à vista; view numa janela sem moldura, sem foco, fora da barra de tarefas, posicionada fora de qualquer monitor e mostrada sem ativar captura com a janela principal à vista, minimizada ou escondida. A captura é a do protocolo de depuração (`Page.captureScreenshot`); a nativa (`capturePage()`) falhou também nesse arranjo. As páginas de agente vivem nessa janela, com 1280 por 800. Ela nasce com a primeira aba de agente e é destruída com a última.
6. **A pessoa pode olhar.** As abas do agente aparecem na faixa de abas do navegador, depois das da pessoa, com a marca "Agente". Escolher uma move a view para a janela principal; escolher uma aba própria, trocar de projeto ou fechar o painel a devolve à janela de apoio. Enquanto olha, a pessoa navega e fecha a aba; parar a carga e inspecionar não valem para ela.
7. **Limites.** Quatro abas de agente por projeto. O fim do terminal fecha as abas dele. As ferramentas agem só em abas do próprio terminal.
8. **Ligação com cada programa, sem tocar no que é da pessoa.** O Claude Code recebe `--mcp-config` apontando um arquivo na pasta de configurações do app, com `${PROJECT_HUB_BROWSER_TOKEN}` no lugar do token, e a permissão `mcp__navegador` no arquivo de `--settings` que o app já gerava. O Codex recebe o endereço e o nome da variável do token por `-c`. O app não escreve no repositório da pessoa nem na configuração global de nenhum programa.
9. **Reinício perde o navegador.** Terminais sobrevivem ao reinício do app; os tokens e o servidor, não. Um terminal recuperado mostra "Sem navegador: o app foi reiniciado. Abra um terminal novo para o agente voltar a usar."
10. **Windows primeiro.** O recurso só liga no Windows, a plataforma medida. No macOS e no Linux o cartão "Agentes e o navegador" diz que os agentes ainda não alcançam o navegador, até o experimento do item 5 ser repetido em cada um.

## O que não muda

A janela do app, a CSP, a checagem de remetente dos canais e a sessão da pessoa no navegador. O protocolo do processo de terminais. Uma falha no navegador do agente nunca impede o terminal de abrir.

## Alternativas descartadas

- **Dar ao agente a sessão da pessoa.** Ele agiria logado como ela em qualquer site.
- **Servidor num processo à parte, falando com o app.** Mais um processo e mais um canal para proteger, sem ganho: quem tem as páginas é o processo principal.
- **Página do agente só quando a aba Navegador está aberta.** O agente pararia sempre que a pessoa trocasse de projeto ou fechasse o painel.
- **Guardar o token para sobreviver ao reinício.** Um segredo em disco, para um caso que se resolve abrindo um terminal novo.

## Consequências

- Uma dependência nova no app: `@modelcontextprotocol/sdk`, que traz 82 pacotes.
- O estado do navegador publicado ao renderer passou a ser composto: abas da pessoa e abas do agente (`owner: 'agent'`).
- Fora do macOS, fechar a janela principal revoga os tokens, fecha o servidor e destrói a janela de apoio, para ela não segurar o app aberto.
- O conteúdo das páginas chega ao agente como dado não confiável; a descrição de cada ferramenta diz isso.

## Limites conhecidos

- **Codex:** cada chamada do navegador pede a aprovação da pessoa no terminal. Não há opção de linha de comando conferida para liberar um servidor só, e o app não escreve na configuração global do Codex.
- **Antigravity CLI** e os outros programas: ainda sem o navegador.
- **Outro programa do computador** que leia o ambiente de um terminal da pessoa alcança o token daquele terminal. É o mesmo alcance que ele já teria sobre o próprio terminal.
- **Tamanho da captura:** enquanto a pessoa olha a aba do agente, a captura sai no tamanho do painel, e não em 1280 por 800.
- **Endereço do preview:** o agente recebe o último endereço conhecido do preview do projeto, mesmo com o servidor parado; a navegação falha e ele vê o erro.
