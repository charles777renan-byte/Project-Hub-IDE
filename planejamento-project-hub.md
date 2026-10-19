# Project Hub

## Planejamento completo do produto e da implementação

**Tipo de produto:** aplicativo desktop para organização de projetos de software e execução assistida por agentes de IA  
**Plataformas-alvo:** Windows, macOS e Linux  
**Abordagem:** local-first, extensível e segura  
**Stack-base:** Electron, React, TypeScript e Node.js  
**Fase inicial:** MVP  
**Status do documento:** proposta técnica pronta para refinamento e implementação

---

## 1. Resumo executivo

O Project Hub será um aplicativo desktop que reúne, em uma única interface, o contexto necessário para planejar, executar e acompanhar trabalho em projetos de software. O produto deve permitir cadastrar repositórios locais, visualizar seu estado, criar missões, delegar etapas a agentes de IA, acompanhar execuções, revisar alterações, operar terminais e isolar tarefas simultâneas por meio de Git worktrees.

A proposta é reduzir a fragmentação entre gerenciadores de projeto, terminal, editor, Git e ferramentas de IA. O aplicativo não pretende substituir integralmente uma IDE no MVP. Seu papel inicial é funcionar como uma camada de coordenação: ele mantém o contexto do projeto, transforma objetivos em missões rastreáveis, executa agentes com limites claros e apresenta evidências para revisão humana.

O MVP deve priorizar um fluxo completo e confiável:

1. adicionar um projeto local;
2. inspecionar o estado do repositório;
3. criar uma missão com objetivo e critérios de aceite;
4. gerar um plano de execução;
5. executar etapas em um worktree isolado;
6. acompanhar logs, comandos e arquivos alterados;
7. revisar o diff;
8. aprovar, solicitar ajustes ou encerrar a missão.

O produto será local-first: projetos, configurações, histórico e metadados operacionais permanecerão no computador do usuário por padrão. Integrações remotas serão explícitas, configuráveis e limitadas ao necessário.

---

## 2. Visão do produto

### 2.1 Declaração de visão

Criar um centro de comando desktop para desenvolvimento de software assistido por IA, no qual pessoas possam transformar objetivos em trabalho executável, acompanhar cada ação dos agentes e manter controle sobre código, permissões, custos e decisões.

### 2.2 Problema que o produto resolve

Fluxos modernos de desenvolvimento com IA costumam ficar espalhados entre várias ferramentas:

- a especificação está em um documento ou chat;
- os comandos são executados em terminais separados;
- o código fica em uma IDE;
- o estado do Git exige outra interface;
- agentes têm contextos e permissões diferentes;
- resultados, erros e decisões são difíceis de rastrear;
- tarefas paralelas podem disputar o mesmo checkout;
- não há um modelo único para aprovação e auditoria.

O Project Hub centraliza esses elementos sem esconder as operações relevantes. O usuário vê o que será feito, o que está em execução, o que mudou e quais decisões precisam de intervenção humana.

### 2.3 Proposta de valor

- **Contexto unificado:** projetos, missões, agentes, terminais, diffs e decisões no mesmo lugar.
- **Execução controlada:** permissões, limites e aprovações definidos por projeto e por missão.
- **Paralelismo seguro:** isolamento de tarefas com Git worktrees.
- **Rastreabilidade:** registro de planos, mensagens, comandos, saídas, artefatos e alterações.
- **Extensibilidade:** adaptadores para diferentes agentes, provedores e ferramentas locais.
- **Privacidade:** dados locais por padrão e envio remoto somente quando necessário e autorizado.

### 2.4 Princípios do produto

1. **O humano mantém o controle.** Ações irreversíveis, publicação remota e acesso sensível exigem política ou aprovação explícita.
2. **Toda execução deve ser explicável.** O aplicativo registra objetivo, plano, eventos, decisões e resultado.
3. **Isolamento antes de paralelismo.** Missões concorrentes não devem editar o mesmo checkout sem coordenação.
4. **Falhar com segurança.** Uma falha deve preservar código, logs e estado recuperável.
5. **Local-first por padrão.** A experiência principal deve funcionar sem uma conta central obrigatória.
6. **Contratos estáveis entre camadas.** Renderer, processo principal e agentes se comunicam por interfaces validadas.
7. **MVP vertical, não uma coleção de telas.** A primeira versão precisa concluir um fluxo real do início ao fim.

---

## 3. Objetivos e indicadores

### 3.1 Objetivos do MVP

- cadastrar e reabrir projetos locais;
- detectar repositórios Git e apresentar seu estado;
- criar missões estruturadas;
- executar uma missão com um agente configurado;
- criar e gerenciar um worktree por missão;
- exibir eventos e logs em tempo real;
- mostrar arquivos alterados e diff consolidado;
- solicitar aprovação para ações protegidas;
- pausar, cancelar, retomar e encerrar execuções;
- manter histórico local pesquisável;
- recuperar-se de fechamento inesperado sem perder o estado essencial.

### 3.2 Objetivos posteriores

- múltiplos agentes trabalhando em uma mesma missão;
- grafo de dependências entre etapas;
- modelos reutilizáveis de missão;
- integrações com provedores de código, issues e CI;
- sincronização opcional entre dispositivos;
- colaboração em equipe;
- catálogo de extensões;
- políticas corporativas centralizadas;
- avaliação automática de qualidade e regressões.

### 3.3 Não objetivos do MVP

- substituir completamente uma IDE;
- oferecer edição de código avançada equivalente a editores especializados;
- hospedar repositórios Git;
- operar como serviço de CI em escala;
- treinar modelos de IA;
- permitir execução remota arbitrária em máquinas não gerenciadas;
- oferecer colaboração multiusuário em tempo real;
- executar alterações destrutivas sem confirmação ou política explícita.

### 3.4 Indicadores de sucesso

| Indicador | Meta inicial |
|---|---:|
| Tempo entre abrir o app e visualizar um projeto existente | até 5 segundos em máquina de referência |
| Taxa de criação bem-sucedida de worktree | pelo menos 98% em repositórios compatíveis |
| Missões recuperadas após reinício inesperado | 100% das missões persistidas |
| Eventos de execução registrados | 100% dos eventos aceitos pelo orquestrador |
| Ações protegidas executadas sem aprovação | 0 |
| Crash-free sessions | pelo menos 99,5% |
| Tempo para criar e iniciar uma missão simples | até 2 minutos para usuário familiarizado |
| Clareza do resultado em teste de usabilidade | 80% dos participantes identificam status e próximo passo sem ajuda |

---

## 4. Personas e cenários principais

### 4.1 Desenvolvedor individual

Mantém vários projetos, quer delegar tarefas delimitadas e precisa revisar o resultado antes de integrar alterações.

**Cenário:** seleciona um projeto, descreve uma correção, aprova o plano, acompanha a execução em worktree separado, revisa testes e diff e então integra o trabalho.

### 4.2 Líder técnico

Precisa padronizar como tarefas assistidas por IA são executadas e verificadas.

**Cenário:** define um modelo de missão com verificações obrigatórias, escolhe permissões e analisa o histórico de decisões e resultados.

### 4.3 Pessoa aprendendo um código-base

Quer explorar arquitetura e fazer mudanças pequenas sem perder o contexto.

**Cenário:** cria uma missão de investigação, recebe um plano, consulta evidências e converte a descoberta em uma missão de implementação.

### 4.4 Mantenedor de múltiplos repositórios

Alterna entre projetos e precisa identificar rapidamente tarefas ativas, branches, worktrees e bloqueios.

**Cenário:** usa o painel geral para localizar missões aguardando aprovação e limpar ambientes já concluídos.

---

## 5. Escopo do MVP

### 5.1 Incluído

#### Projetos

- adicionar projeto por seleção de pasta;
- validar acesso e detectar repositório Git;
- armazenar nome, caminho, descrição e preferências;
- listar projetos recentes e favoritos;
- detectar branch atual, mudanças locais e worktrees;
- abrir a pasta em ferramenta externa configurada;
- remover o projeto do catálogo sem apagar arquivos.

#### Missões

- criar missão com título, objetivo, contexto e critérios de aceite;
- escolher agente e perfil de execução;
- gerar ou editar plano antes da execução;
- executar etapas sequenciais;
- pausar, retomar e cancelar;
- solicitar entrada ou aprovação humana;
- registrar conclusão, falha ou cancelamento;
- anexar arquivos e referências locais permitidas;
- apresentar resumo final e artefatos;
- visão geral das missões em lista, com o status de cada uma em uma frase;
- avisos dentro do app e notificação do sistema quando uma missão precisar de atenção (permissão protegida, pergunta sem resposta ou falha).

#### Agentes

- cadastrar ao menos um adaptador de agente local ou por API;
- verificar disponibilidade e autenticação;
- iniciar sessão com contexto limitado;
- receber eventos incrementais;
- encaminhar respostas do usuário;
- encerrar o processo de forma controlada;
- normalizar uso, erros e resultado final.

#### Git e worktrees

- verificar se Git está instalado;
- criar branch e worktree para uma missão;
- impedir colisão de nomes e caminhos;
- acompanhar branch, commit base e status;
- exibir diff por arquivo e consolidado;
- manter o worktree ao concluir, por padrão;
- permitir arquivamento ou remoção com confirmação;
- detectar worktrees órfãos ou removidos externamente.

#### Terminal e logs

- terminal integrado por projeto ou missão;
- streaming de saída;
- redimensionamento e encerramento de sessão;
- logs estruturados do aplicativo;
- busca e filtros básicos no histórico de eventos;
- mascaramento de segredos conhecidos.

#### Configurações e segurança

- preferências gerais;
- perfis de execução;
- permissões por projeto;
- armazenamento seguro de credenciais;
- exportação de diagnóstico sem segredos;
- política de telemetria desativada por padrão no MVP.

### 5.2 Fora do MVP

- edição colaborativa em tempo real;
- execução distribuída em vários computadores;
- marketplace público;
- faturamento e gestão de organizações;
- aplicativo móvel;
- hospedagem de modelos;
- editor visual completo de pipelines;
- resolução automática de conflitos complexos;
- revisão e publicação automática de pull requests sem aprovação;
- filtros e agrupamento avançados da visão geral de missões, para quando houver muitas missões.

### 5.3 Entrega mínima vertical

O MVP somente será considerado funcional quando o seguinte percurso estiver completo:

> Projeto local → nova missão → plano aprovado → worktree criado → agente executado → testes registrados → diff revisado → missão concluída.

---

## 6. Roadmap

### Fase 0 — Descoberta e fundação

- validar os fluxos com protótipos;
- registrar decisões arquiteturais;
- definir ameaças e limites de confiança;
- criar monorepo, automação de qualidade e empacotamento mínimo;
- comprovar terminal, Git worktree, IPC e persistência em um protótipo técnico.

### Fase 1 — MVP local-first

- catálogo de projetos;
- detalhe do projeto;
- criação e execução de missão;
- adaptador inicial de agente;
- worktree por missão;
- terminal, eventos e diff;
- aprovações;
- histórico e recuperação;
- instaladores para as plataformas priorizadas.

### Fase 2 — Orquestração avançada

- múltiplos agentes;
- etapas paralelas com dependências;
- papéis especializados, como planejador, implementador e revisor;
- políticas por tipo de ação;
- templates de missão;
- fila global e limites de concorrência;
- retry configurável e checkpoints.

### Fase 3 — Integrações e colaboração

- provedores de repositório e issues;
- criação assistida de pull requests;
- integração com pipelines de CI;
- compartilhamento de relatórios;
- sincronização opcional;
- equipes, papéis e políticas organizacionais.

### Fase 4 — Plataforma extensível

- SDK de adaptadores;
- plugins assinados;
- catálogo de integrações;
- execução remota controlada;
- políticas administráveis;
- métricas e avaliações agregadas.

---

## 7. Stack tecnológica

### 7.1 Base

| Camada | Tecnologia | Motivo |
|---|---|---|
| Desktop | Electron | integração madura entre interface web e recursos nativos, distribuição multiplataforma e ecossistema amplo |
| Interface | React | componentes previsíveis, boa testabilidade e ecossistema consolidado |
| Linguagem | TypeScript | contratos explícitos, refatoração segura e compartilhamento de tipos |
| Runtime local | Node.js | Git, processos, arquivos, terminais e integrações locais |
| Build | Vite | ciclo rápido de desenvolvimento e configuração simples para renderer |
| Monorepo | pnpm workspaces | instalações determinísticas, economia de espaço e divisão clara em pacotes |
| Banco local | SQLite | persistência transacional, portável e adequada a um aplicativo local-first |

Versões exatas devem ser fixadas no lockfile durante a fundação técnica. A política é adotar versões estáveis e suportadas, validar compatibilidade entre Electron e Node e fazer upgrades em lotes pequenos.

### 7.2 Bibliotecas recomendadas

#### Interface e experiência

- **React Router:** navegação e rotas internas.
- **Zustand:** estado efêmero da interface.
- **TanStack Query:** cache e sincronização de operações assíncronas quando agregar valor.
- **Radix UI:** primitivas acessíveis para componentes interativos.
- **Tailwind CSS:** estilos utilitários e tokens de design.
- **Lucide:** ícones consistentes.
- **React Hook Form:** formulários.
- **Zod:** validação de entrada e contratos compartilhados.
- **Monaco Editor:** leitura e edição leve de texto quando necessária.
- **xterm.js:** terminal integrado.
- **react-virtuoso:** listas grandes de eventos e logs.

#### Processo principal e domínio

- **better-sqlite3:** acesso local simples e transacional ao SQLite.
- **Drizzle ORM:** schema tipado e migrações legíveis.
- **execa:** execução controlada de processos não interativos.
- **node-pty:** processos de terminal interativos.
- **simple-git** ou invocação direta do Git: operações Git com camada própria de validação.
- **pino:** logs estruturados.
- **nanoid** ou **UUID:** identificadores estáveis.
- **keytar** ou cofre nativo equivalente: credenciais no armazenamento seguro do sistema.
- **chokidar:** observação de mudanças no sistema de arquivos, com escopo limitado.
- **proper-lockfile:** exclusão mútua onde o SQLite não for suficiente.

#### Qualidade e distribuição

- **Vitest:** testes unitários e de integração rápidos.
- **Testing Library:** testes de componentes por comportamento.
- **Playwright:** testes ponta a ponta do aplicativo Electron.
- **ESLint:** análise estática.
- **Prettier:** formatação automática.
- **electron-builder** ou **Electron Forge:** empacotamento, assinatura e atualização.
- **Changesets:** versionamento de pacotes, se o monorepo publicar SDKs.

### 7.3 Critérios para escolher dependências

- manutenção ativa e licença compatível;
- suporte às plataformas-alvo;
- superfície de ataque e histórico de vulnerabilidades;
- impacto no tamanho do pacote;
- compatibilidade com sandbox e context isolation;
- possibilidade de substituir a biblioteca por uma abstração própria;
- tipos TypeScript de boa qualidade;
- testes e documentação suficientes.

---

## 8. Arquitetura

### 8.1 Visão geral

```text
┌───────────────────────────────────────────────────────────────┐
│ Renderer: React                                               │
│ telas, estado visual, formulários, terminal, diff e eventos   │
└────────────────────────────┬──────────────────────────────────┘
                             │ API tipada exposta pelo preload
┌────────────────────────────▼──────────────────────────────────┐
│ Preload                                                      │
│ allowlist mínima, validação e adaptação de IPC                │
└────────────────────────────┬──────────────────────────────────┘
                             │ IPC request/response + eventos
┌────────────────────────────▼──────────────────────────────────┐
│ Processo principal                                           │
│ casos de uso, políticas, persistência, Git e coordenação      │
├───────────────┬───────────────────┬───────────────────────────┤
│ SQLite        │ Processos/PTY     │ Cofre seguro              │
│ repositórios  │ agentes e shell   │ tokens e credenciais      │
└───────────────┴─────────┬─────────┴───────────────────────────┘
                          │ adaptadores
┌─────────────────────────▼─────────────────────────────────────┐
│ Agentes, Git, provedores e ferramentas externas              │
└───────────────────────────────────────────────────────────────┘
```

### 8.2 Processos e responsabilidades

#### Renderer

- renderiza a interface;
- mantém somente estado visual e caches descartáveis;
- envia comandos por API tipada;
- nunca acessa diretamente Node.js, shell, arquivos, banco ou segredos;
- trata eventos como dados não confiáveis;
- exibe confirmações e decisões pendentes.

#### Preload

- expõe uma API pequena por `contextBridge`;
- não oferece acesso genérico a IPC;
- valida payloads nas duas direções;
- converte assinaturas internas em métodos orientados ao domínio;
- controla inscrição e cancelamento de listeners.

#### Processo principal

- executa casos de uso;
- aplica políticas e permissões;
- gerencia janelas e ciclo de vida;
- acessa SQLite e armazenamento seguro;
- controla subprocessos, PTYs e Git;
- persiste eventos e snapshots;
- envia atualizações incrementais ao renderer.

#### Workers opcionais

Operações intensivas ou com risco de bloquear o event loop devem migrar para worker threads ou processos utilitários:

- indexação de repositório;
- geração de diff muito grande;
- busca textual;
- análise estática;
- parsing de logs volumosos.

### 8.3 Organização em camadas

```text
Presentation
  └─ telas, componentes, view-models
Application
  └─ casos de uso, comandos, consultas, orquestração
Domain
  └─ entidades, regras, estados, eventos e interfaces
Infrastructure
  └─ SQLite, Git, filesystem, PTY, agentes, telemetria
```

As camadas internas não devem depender de Electron. Isso permite testar regras de domínio fora do aplicativo e reaproveitar partes em serviços futuros.

### 8.4 Estrutura sugerida do monorepo

```text
project-hub/
├─ apps/
│  └─ desktop/
│     ├─ src/main/
│     ├─ src/preload/
│     ├─ src/renderer/
│     └─ resources/
├─ packages/
│  ├─ domain/
│  ├─ application/
│  ├─ contracts/
│  ├─ database/
│  ├─ git-adapter/
│  ├─ agent-sdk/
│  ├─ agent-adapters/
│  ├─ design-system/
│  └─ test-utils/
├─ docs/
│  ├─ adr/
│  ├─ product/
│  └─ security/
├─ scripts/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ README.md
```

### 8.5 Padrões arquiteturais

- **Ports and adapters:** integrações externas implementam interfaces do domínio.
- **Command/query separation leve:** comandos alteram estado; consultas retornam projeções.
- **State machine:** missões e execuções têm transições explícitas.
- **Event log:** eventos importantes são persistidos para auditoria e recuperação.
- **Repository pattern:** acesso ao banco isolado em repositórios tipados.
- **Dependency injection manual:** composição explícita, sem contêiner complexo no MVP.

### 8.6 Decisões arquiteturais iniciais

| ID | Decisão | Justificativa |
|---|---|---|
| ADR-001 | Electron com renderer isolado | oferece integração nativa mantendo fronteira de segurança |
| ADR-002 | SQLite como fonte local de verdade | transações, portabilidade e recuperação simples |
| ADR-003 | eventos persistidos com snapshots | auditoria sem exigir event sourcing completo |
| ADR-004 | um worktree por missão executável | reduz colisões e simplifica revisão |
| ADR-005 | adaptadores de agente por contrato | evita dependência de um único provedor |
| ADR-006 | aprovação orientada a políticas | controle consistente sobre ações sensíveis |

---

## 9. Modelo de domínio

### 9.1 Entidades principais

#### Project

Representa uma pasta de projeto cadastrada.

```ts
type Project = {
  id: string;
  name: string;
  path: string;
  description?: string;
  repositoryKind: 'git' | 'none';
  defaultBranch?: string;
  isFavorite: boolean;
  settings: ProjectSettings;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
};
```

#### Mission

Representa um objetivo com ciclo de vida próprio.

```ts
type MissionStatus =
  | 'draft'
  | 'planned'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_input'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

type Mission = {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  context?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  status: MissionStatus;
  priority: 'low' | 'normal' | 'high';
  agentProfileId: string;
  executionProfileId: string;
  worktreeId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};
```

#### MissionStep

```ts
type MissionStep = {
  id: string;
  missionId: string;
  position: number;
  title: string;
  description: string;
  kind: 'analysis' | 'code' | 'command' | 'test' | 'review' | 'custom';
  status: 'pending' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'skipped';
  dependsOn: string[];
  startedAt?: string;
  finishedAt?: string;
};
```

#### Execution

Uma missão pode ter várias tentativas de execução.

```ts
type Execution = {
  id: string;
  missionId: string;
  attempt: number;
  status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
  agentSessionId?: string;
  exitReason?: string;
  usage?: UsageSummary;
  startedAt?: string;
  finishedAt?: string;
};
```

#### AgentProfile

```ts
type AgentProfile = {
  id: string;
  name: string;
  adapterType: string;
  model?: string;
  configuration: Record<string, unknown>;
  capabilities: AgentCapability[];
  enabled: boolean;
};
```

#### Worktree

```ts
type Worktree = {
  id: string;
  projectId: string;
  missionId?: string;
  path: string;
  branch: string;
  baseRef: string;
  baseCommit: string;
  status: 'creating' | 'ready' | 'busy' | 'orphaned' | 'archived' | 'error';
  createdAt: string;
  archivedAt?: string;
};
```

#### ApprovalRequest

```ts
type ApprovalRequest = {
  id: string;
  missionId: string;
  executionId: string;
  actionType: ProtectedAction;
  title: string;
  rationale: string;
  commandPreview?: string;
  affectedResources: string[];
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestedAt: string;
  decidedAt?: string;
  decisionNote?: string;
};
```

#### AuditEvent

```ts
type AuditEvent = {
  id: string;
  aggregateType: 'project' | 'mission' | 'execution' | 'worktree' | 'settings';
  aggregateId: string;
  eventType: string;
  severity: 'debug' | 'info' | 'warning' | 'error';
  actor: 'user' | 'agent' | 'system';
  payload: Record<string, unknown>;
  sequence: number;
  createdAt: string;
};
```

### 9.2 Relações

```text
Project 1 ── N Mission
Project 1 ── N Worktree
Mission 1 ── N MissionStep
Mission 1 ── N Execution
Mission 1 ── 0..1 Worktree ativo
Execution 1 ── N AuditEvent
Execution 1 ── N ApprovalRequest
AgentProfile 1 ── N Mission
```

### 9.3 Estados da missão

```text
draft → planned → queued → running → succeeded
                              ├──→ waiting_approval → running
                              ├──→ waiting_input ───→ running
                              ├──→ paused ──────────→ running
                              ├──→ failed
                              └──→ cancelled
```

Regras:

- apenas missões `draft` ou `planned` podem ter objetivo e critérios editados livremente;
- `running` exige execução ativa e worktree válido quando houver alteração de código;
- `waiting_approval` bloqueia a ação protegida, não apenas a interface;
- estados terminais não retornam a `running`; uma nova tentativa cria outra `Execution`;
- cancelamento encerra processos filhos antes de marcar a execução;
- conclusão deve registrar resumo, verificação e estado Git.

### 9.4 Schema inicial do banco

Tabelas sugeridas:

- `projects`;
- `project_settings`;
- `missions`;
- `mission_steps`;
- `mission_acceptance_criteria`;
- `executions`;
- `agent_profiles`;
- `worktrees`;
- `approval_requests`;
- `audit_events`;
- `terminal_sessions`;
- `artifacts`;
- `app_settings`;
- `schema_migrations`.

Índices essenciais:

- missões por `project_id`, `status` e `updated_at`;
- eventos por `aggregate_id` e `sequence`;
- aprovações por `status` e `requested_at`;
- worktrees por `project_id`, `mission_id` e caminho normalizado;
- projetos por caminho normalizado único.

---

## 10. Telas e fluxos

### 10.1 Estrutura de navegação

```text
App
├─ Início
├─ Projetos
│  └─ Projeto
│     ├─ Visão geral
│     ├─ Missões
│     ├─ Repositório
│     ├─ Worktrees
│     └─ Configurações
├─ Missões globais
├─ Agentes
├─ Atividade
└─ Configurações
```

### 10.2 Tela de onboarding

**Objetivo:** preparar o ambiente sem exigir conhecimento da arquitetura interna.

Elementos:

- boas-vindas e explicação curta do fluxo;
- verificação de Git;
- escolha de pasta padrão para worktrees;
- configuração do primeiro agente;
- teste de conexão ou execução;
- opção para adicionar o primeiro projeto;
- resumo de privacidade e permissões.

Estados:

- dependência ausente;
- credencial inválida;
- teste bem-sucedido;
- configuração parcial salva;
- configuração concluída.

### 10.3 Painel inicial

**Objetivo:** mostrar rapidamente o que exige atenção.

Blocos:

- projetos recentes;
- missões em execução;
- aprovações pendentes;
- missões bloqueadas ou com falha;
- atividade recente;
- ação “Nova missão”.

### 10.4 Catálogo de projetos

Elementos:

- busca;
- filtros por favorito, estado Git e atividade;
- cards ou tabela;
- branch e mudanças locais;
- quantidade de missões ativas;
- ação para adicionar pasta;
- menu para abrir externamente, editar detalhes ou remover do catálogo.

### 10.5 Detalhe do projeto

Cabeçalho:

- nome e caminho;
- branch atual;
- indicador de mudanças;
- ações de abrir terminal, abrir externamente e criar missão.

Abas:

- visão geral;
- missões;
- repositório;
- worktrees;
- configurações e permissões.

**Aba Missões**

As missões do projeto aparecem como cartões. Cada cartão mostra o nome, a situação em uma frase e a ação necessária, quando houver. Um cartão que precisa de atenção fica destacado e oferece ação direta, como aprovar ou ver. Ao selecionar um cartão, abrem-se as abas da missão: Terminal, Diff, Testes, Logs e Artefatos (seção 10.7).

**Navegação entre projetos**

Abas no topo permitem trocar de projeto sem voltar ao catálogo. A visão geral de todas as missões continua sendo a lista da seção 10.12.

### 10.6 Criação de missão

Campos:

- título;
- objetivo;
- contexto e restrições;
- critérios de aceite;
- arquivos ou pastas relevantes;
- agente;
- perfil de execução;
- base Git;
- prioridade;
- opção de somente planejar.

Etapas do fluxo:

1. preenchimento;
2. validação;
3. geração do plano;
4. revisão e edição do plano;
5. confirmação de permissões;
6. criação de worktree;
7. início da execução.

**Início a partir de um prompt**

O usuário pode começar escrevendo apenas um prompt livre, dizendo o que deseja que seja feito. Os campos continuam existindo, mas o prompt dispensa o preenchimento manual antes do envio:

- o app sugere título e critérios de aceite, que o usuário confirma ou edita;
- o agente gera um plano curto, em lista de etapas;
- se o plano estiver adequado, o usuário inicia a execução; se não estiver, pede ao agente que o refaça;
- cada plano refeito fica como nova versão, e a versão aprovada é a que será executada (seção 15.2);
- enquanto o plano não for aprovado, nenhuma alteração é feita no código (RF-MIS-003).

### 10.7 Workspace da missão

Esta é a tela central do produto. Ao selecionar uma missão em um projeto (seção 10.5), ela abre com um cabeçalho e um conjunto de abas.

Layout sugerido:

```text
┌────────────────────────────────────────────────────────────────┐
│ Missão / status / duração / pausar / cancelar                  │
├────────────────────────────────────────────────────────────────┤
│ Projeto · branch · worktree                                    │
├────────────────────────────────────────────────────────────────┤
│ Plano · Conversa · Terminal · Diff · Testes · Logs · Artefatos │
├────────────────────────────────────────────────────────────────┤
│ conteúdo da aba selecionada                                    │
└────────────────────────────────────────────────────────────────┘
```

Recursos:

- **Cabeçalho:** status atual em linguagem clara, duração, ações de pausar e cancelar e, ao concluir, o resumo final.
- **Plano:** etapas, a etapa em execução e a aprovação do plano antes da primeira execução, com a opção de pedir que o agente o refaça (RF-MIS-003).
- **Conversa:** eventos em tempo real com filtros, caixa de resposta quando o agente pedir entrada e cartões de permissão com impacto e ação.
- **Terminal:** terminal vinculado ao worktree da missão.
- **Diff:** arquivos alterados, com a frase do agente para cada um, diff por arquivo e comentários ligados a uma linha (seção 10.8).
- **Testes:** resultado dos testes executados.
- **Logs:** registro técnico da execução, com busca.
- **Artefatos:** saídas da missão, como relatórios e arquivos gerados.

Os arquivos alterados ficam na aba Diff, e a branch e o worktree aparecem no cabeçalho.

### 10.8 Revisão de alterações

- árvore de arquivos alterados;
- uma frase escrita pelo agente para cada arquivo alterado, dizendo o que mudou, exibida ao lado do nome do arquivo e identificada como texto do agente, sempre conferível no diff;
- filtros por adicionado, modificado, removido e não rastreado;
- diff lado a lado e unificado;
- estatísticas de linhas;
- marcação de arquivos revisados;
- avisos para binários, segredos e arquivos grandes;
- comandos de verificação executados;
- critérios de aceite com estado;
- ações para solicitar ajustes, concluir ou abrir externamente.

**Pedido de ajustes**

O usuário pode pedir ajustes de duas formas:

- comentário ligado a um arquivo ou a uma linha do diff, com o trecho exibido junto ao texto;
- mensagem geral sobre a missão, sem vínculo com um trecho.

Cada pedido gera uma nova tentativa, e a tentativa anterior permanece no histórico (RF-MIS-006). O encerramento é sempre uma decisão do usuário, tomada quando ele considera a missão pronta.

### 10.9 Agentes

- lista de perfis;
- status de disponibilidade;
- capacidades declaradas;
- modelo e provedor, quando aplicável;
- teste de configuração;
- limites de custo, tempo e ferramentas;
- permissões padrão;
- criação, edição e desativação.

### 10.10 Configurações

Categorias:

- aparência;
- caminhos e shell;
- Git;
- agentes e credenciais;
- execução e concorrência;
- segurança e aprovações;
- dados e retenção;
- diagnósticos;
- atualizações.

### 10.11 Estados globais de interface

Toda tela que carrega dados deve prever:

- carregando;
- vazio com próximo passo claro;
- erro recuperável;
- permissão negada;
- recurso removido externamente;
- operação em andamento;
- modo offline quando uma integração remota não estiver acessível.

### 10.12 Acompanhamento de missões e avisos

**Objetivo:** permitir que o usuário deixe missões em execução e faça outro trabalho, voltando apenas quando algo precisar dele.

**Visão geral das missões**

Lista com uma linha por missão, reunindo todos os projetos:

- status da missão em uma frase, em linguagem clara;
- projeto, tempo decorrido e etapa atual;
- ações rápidas: abrir, responder e pausar;
- aviso no topo com a quantidade de missões que precisam de atenção.

**Avisos**

- *App em primeiro plano:* banner dentro da tela, sem interromper o que o usuário está fazendo.
- *App minimizado ou em segundo plano:* notificação do sistema operacional, com o nome da missão e o motivo em uma frase. Ao clicar, o app abre direto a missão.
- *Notificação do sistema:* somente para pedido de permissão protegida, pergunta sem resposta que bloqueia o agente e falha.
- *Conclusão de missão:* aviso discreto dentro do app, sem notificação do sistema.
- *Silêncio por projeto:* cada projeto pode desativar os próprios avisos.

**Conteúdo das notificações**

Notificações não exibem saída de comandos, trechos de código, variáveis de ambiente ou conteúdo de arquivos. Mostram apenas o nome da missão e o motivo resumido, e levam à tela da missão, onde o detalhe fica protegido pelas regras da seção 17.

**Espera produtiva**

Enquanto as missões executam, o usuário pode iniciar outra missão ou trabalhar em outro projeto, respeitando o limite de execuções simultâneas da seção 15.6.

**Requisitos relacionados:** RF-OBS-006 a RF-OBS-011 (seção 11).

**Decisões de escopo**

- a visão geral em lista e os avisos, incluindo a notificação do sistema, entram no MVP (seção 5.1);
- filtros e agrupamento avançados ficam para depois do MVP (seção 5.2).

**Em aberto**

- comportamento das notificações do sistema em cada plataforma.

---

## 11. Requisitos funcionais

### Projetos

| ID | Requisito | Prioridade |
|---|---|---|
| RF-PROJ-001 | O usuário deve poder adicionar uma pasta como projeto. | Must |
| RF-PROJ-002 | O sistema deve normalizar e impedir caminhos duplicados. | Must |
| RF-PROJ-003 | O sistema deve detectar se a pasta contém um repositório Git. | Must |
| RF-PROJ-004 | O usuário deve poder favoritar, renomear e descrever o projeto no catálogo. | Should |
| RF-PROJ-005 | Remover um projeto do catálogo não deve apagar seus arquivos. | Must |
| RF-PROJ-006 | O sistema deve detectar projetos inacessíveis e oferecer relocalização. | Should |

### Missões

| ID | Requisito | Prioridade |
|---|---|---|
| RF-MIS-001 | O usuário deve poder criar uma missão associada a um projeto. | Must |
| RF-MIS-002 | Objetivo e ao menos um critério de aceite devem ser exigidos para executar. | Must |
| RF-MIS-003 | O usuário deve revisar o plano antes da primeira execução. | Must |
| RF-MIS-004 | O sistema deve registrar todas as transições de estado. | Must |
| RF-MIS-005 | O usuário deve poder pausar, retomar e cancelar. | Must |
| RF-MIS-006 | O sistema deve permitir nova tentativa sem apagar a tentativa anterior. | Must |
| RF-MIS-007 | O sistema deve apresentar resumo final e evidências de verificação. | Must |
| RF-MIS-008 | O usuário deve poder duplicar uma missão concluída. | Could |

### Execução e agentes

| ID | Requisito | Prioridade |
|---|---|---|
| RF-AGT-001 | O sistema deve verificar a disponibilidade do agente antes de iniciar. | Must |
| RF-AGT-002 | Adaptadores devem emitir eventos no contrato comum. | Must |
| RF-AGT-003 | O sistema deve encaminhar entrada humana à sessão correta. | Must |
| RF-AGT-004 | O sistema deve encerrar processos filhos no cancelamento. | Must |
| RF-AGT-005 | Limites de duração e uso devem poder ser configurados. | Should |
| RF-AGT-006 | Falhas do adaptador devem produzir erro normalizado e acionável. | Must |
| RF-AGT-007 | O agente por CLI local só deve rodar em projetos que o usuário confirmou como confiáveis. | Must |

### Git e worktrees

| ID | Requisito | Prioridade |
|---|---|---|
| RF-GIT-001 | Missões que alteram código devem usar worktree isolado por padrão. | Must |
| RF-GIT-002 | O sistema deve registrar base, branch e caminho do worktree. | Must |
| RF-GIT-003 | A criação deve falhar com segurança se houver colisão. | Must |
| RF-GIT-004 | O sistema deve exibir status e diff do worktree. | Must |
| RF-GIT-005 | A remoção deve exigir confirmação e verificar alterações não salvas. | Must |
| RF-GIT-006 | O sistema deve reconciliar worktrees criados ou removidos externamente. | Should |
| RF-GIT-007 | O sistema não deve fazer push ou merge remoto sem aprovação explícita. | Must |

### Aprovações

| ID | Requisito | Prioridade |
|---|---|---|
| RF-APR-001 | Ações protegidas devem gerar pedido de aprovação antes de executar. | Must |
| RF-APR-002 | O pedido deve explicar ação, motivo e recursos afetados. | Must |
| RF-APR-003 | Aprovar ou rejeitar deve ficar registrado. | Must |
| RF-APR-004 | Aprovações devem expirar quando o contexto da ação mudar. | Must |
| RF-APR-005 | O usuário deve poder definir políticas por projeto. | Should |

### Terminal, logs e histórico

| ID | Requisito | Prioridade |
|---|---|---|
| RF-OBS-001 | A saída da execução deve aparecer incrementalmente. | Must |
| RF-OBS-002 | Logs devem conter horário, origem, severidade e correlação. | Must |
| RF-OBS-003 | O usuário deve poder pesquisar eventos de uma missão. | Should |
| RF-OBS-004 | Segredos conhecidos devem ser mascarados antes de persistir ou exibir. | Must |
| RF-OBS-005 | O usuário deve poder exportar um pacote de diagnóstico sanitizado. | Should |
| RF-OBS-006 | A visão geral deve listar as missões de todos os projetos, com o status de cada uma em uma frase. | Must |
| RF-OBS-007 | Missões que precisam de atenção devem aparecer em destaque no app. | Must |
| RF-OBS-008 | Notificações do sistema devem ser enviadas somente para permissão protegida, pergunta sem resposta e falha. | Must |
| RF-OBS-009 | Notificações não devem conter saída de comandos, trechos de código, variáveis de ambiente ou conteúdo de arquivos. | Must |
| RF-OBS-010 | Ao clicar em uma notificação, o app deve abrir a missão correspondente. | Must |
| RF-OBS-011 | O usuário deve poder silenciar os avisos de cada projeto. | Should |

---

## 12. Requisitos não funcionais

### 12.1 Segurança

- `nodeIntegration` desativado no renderer;
- `contextIsolation` ativado;
- sandbox do renderer ativado sempre que compatível;
- Content Security Policy restritiva;
- IPC somente por canais conhecidos e validados;
- credenciais fora do SQLite e dos logs;
- execução de comandos sem composição insegura de strings;
- validação de caminhos e prevenção de escape do workspace autorizado;
- dependências verificadas no pipeline;
- instaladores assinados para distribuição pública.

### 12.2 Desempenho

- janela principal interativa em até 3 segundos após bootstrap em máquina de referência;
- consultas comuns ao banco em até 100 ms no percentil 95;
- renderização de listas com milhares de eventos por virtualização;
- saída de terminal percebida em tempo real, sem bloquear a interface;
- operações acima de 100 ms não devem bloquear o renderer;
- diffs grandes devem ser carregados de forma incremental.

### 12.3 Confiabilidade

- transações para mudanças de estado relacionadas;
- migrações de banco idempotentes e testadas;
- recuperação de missões interrompidas no próximo início;
- encerramento gradual de processos;
- escrita atômica para arquivos de configuração;
- backup do banco antes de migração destrutiva;
- correlação entre execução, processo e eventos.

### 12.4 Usabilidade e acessibilidade

- navegação principal por teclado;
- foco visível e ordem lógica;
- nomes acessíveis em controles;
- contraste compatível com WCAG 2.2 AA onde aplicável;
- status não comunicado somente por cor;
- mensagens de erro com causa provável e ação recomendada;
- atalhos configuráveis em fase posterior.

### 12.5 Portabilidade

- suporte inicial definido por matriz de versões do sistema operacional;
- caminhos tratados por APIs multiplataforma;
- shell escolhido por plataforma e configurável;
- nenhum requisito central dependente de utilitário exclusivo de um sistema;
- testes de empacotamento em Windows, macOS e Linux.

### 12.6 Manutenibilidade

- TypeScript em modo estrito;
- cobertura mínima focada em domínio e políticas;
- lint e testes obrigatórios no CI;
- contratos versionados;
- decisões relevantes documentadas em ADRs;
- módulos com responsabilidade clara;
- adaptadores externos cobertos por testes de contrato.

### 12.7 Privacidade

- telemetria opcional e desativada por padrão no MVP;
- explicação clara de dados enviados a provedores;
- retenção configurável;
- exclusão local disponível;
- diagnósticos exportados sem tokens, conteúdo sensível ou variáveis secretas;
- anexos enviados a agentes somente quando incluídos no escopo da missão.

---

## 13. Contratos internos e APIs

### 13.1 Convenções

- payloads validados com Zod;
- respostas usam união discriminada;
- erros possuem código estável e mensagem segura;
- datas usam ISO 8601 em UTC;
- IDs são opacos;
- caminhos são absolutos apenas no processo principal; o renderer recebe versões necessárias e sanitizadas;
- comandos IPC são versionados quando houver mudança incompatível.

### 13.2 Envelope de resultado

```ts
type AppResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
        retryable: boolean;
      };
    };
```

### 13.3 API exposta pelo preload

```ts
type ProjectHubApi = {
  projects: {
    list(): Promise<AppResult<ProjectSummary[]>>;
    chooseDirectory(): Promise<AppResult<{ path: string } | null>>;
    add(input: AddProjectInput): Promise<AppResult<Project>>;
    get(projectId: string): Promise<AppResult<ProjectDetail>>;
    remove(projectId: string): Promise<AppResult<void>>;
  };
  missions: {
    create(input: CreateMissionInput): Promise<AppResult<Mission>>;
    plan(missionId: string): Promise<AppResult<MissionPlan>>;
    start(missionId: string): Promise<AppResult<Execution>>;
    pause(missionId: string): Promise<AppResult<void>>;
    resume(missionId: string): Promise<AppResult<void>>;
    cancel(missionId: string): Promise<AppResult<void>>;
    respond(input: MissionResponseInput): Promise<AppResult<void>>;
    subscribe(missionId: string, listener: (event: MissionEvent) => void): Unsubscribe;
  };
  approvals: {
    decide(input: ApprovalDecisionInput): Promise<AppResult<void>>;
  };
  git: {
    status(projectId: string): Promise<AppResult<GitStatus>>;
    diff(input: DiffRequest): Promise<AppResult<DiffResult>>;
    listWorktrees(projectId: string): Promise<AppResult<Worktree[]>>;
  };
  terminal: {
    create(input: CreateTerminalInput): Promise<AppResult<TerminalSession>>;
    write(sessionId: string, data: string): Promise<AppResult<void>>;
    resize(sessionId: string, cols: number, rows: number): Promise<AppResult<void>>;
    close(sessionId: string): Promise<AppResult<void>>;
    subscribe(sessionId: string, listener: (event: TerminalEvent) => void): Unsubscribe;
  };
};
```

### 13.4 Canais IPC sugeridos

| Canal | Direção | Uso |
|---|---|---|
| `projects:list:v1` | request/response | listar projetos |
| `projects:add:v1` | request/response | cadastrar projeto |
| `missions:create:v1` | request/response | criar missão |
| `missions:start:v1` | request/response | iniciar execução |
| `missions:event:v1` | main → renderer | eventos da missão |
| `approvals:decide:v1` | request/response | aprovar ou rejeitar |
| `git:diff:v1` | request/response | obter diff paginado |
| `terminal:create:v1` | request/response | abrir PTY |
| `terminal:data:v1` | main → renderer | dados do PTY |

O preload não deve expor `ipcRenderer.send` ou `invoke` diretamente.

### 13.5 Contrato do adaptador de agente

```ts
interface AgentAdapter {
  readonly type: string;

  probe(config: AgentConfig): Promise<AgentProbeResult>;
  getCapabilities(config: AgentConfig): Promise<AgentCapabilities>;
  start(input: AgentStartInput, signal: AbortSignal): Promise<AgentSession>;
}

interface AgentSession {
  readonly id: string;
  events(): AsyncIterable<AgentEvent>;
  send(input: AgentUserInput): Promise<void>;
  approve(input: AgentApprovalDecision): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(reason: string): Promise<void>;
}
```

### 13.6 Eventos normalizados do agente

```ts
type AgentEvent =
  | { type: 'session.started'; sessionId: string; at: string }
  | { type: 'message.delta'; content: string; at: string }
  | { type: 'message.completed'; messageId: string; at: string }
  | { type: 'tool.requested'; call: ToolCall; at: string }
  | { type: 'tool.started'; callId: string; at: string }
  | { type: 'tool.output'; callId: string; chunk: string; at: string }
  | { type: 'tool.completed'; callId: string; result: ToolResult; at: string }
  | { type: 'approval.requested'; request: ApprovalRequestDraft; at: string }
  | { type: 'input.requested'; request: InputRequest; at: string }
  | { type: 'usage.updated'; usage: UsageSummary; at: string }
  | { type: 'session.completed'; result: AgentResult; at: string }
  | { type: 'session.failed'; error: AgentError; at: string };
```

### 13.7 Códigos de erro iniciais

- `PROJECT_NOT_FOUND`;
- `PROJECT_PATH_UNAVAILABLE`;
- `PROJECT_ALREADY_EXISTS`;
- `GIT_NOT_AVAILABLE`;
- `GIT_DIRTY_BASE_REQUIRES_DECISION`;
- `WORKTREE_COLLISION`;
- `WORKTREE_CREATE_FAILED`;
- `MISSION_INVALID_STATE`;
- `AGENT_UNAVAILABLE`;
- `AGENT_AUTH_REQUIRED`;
- `AGENT_PROTOCOL_ERROR`;
- `APPROVAL_REQUIRED`;
- `APPROVAL_EXPIRED`;
- `PROCESS_START_FAILED`;
- `PERMISSION_DENIED`;
- `PATH_OUTSIDE_ALLOWED_SCOPE`;
- `DATABASE_MIGRATION_FAILED`.

---

## 14. Integração de agentes

### 14.1 Objetivo da camada de integração

A camada de agentes deve permitir trocar provedor ou forma de execução sem alterar o domínio de missões. O aplicativo conhece capacidades e eventos normalizados; detalhes de CLI, API, autenticação e streaming pertencem ao adaptador.

### 14.2 Formas de integração

#### Agente por CLI local

- iniciado como subprocesso;
- recebe diretório de trabalho do worktree;
- comunicação por JSON Lines, stdio ou protocolo definido;
- ambiente filtrado;
- árvore de processos rastreada;
- saída normalizada pelo adaptador;
- usa o Claude Code oficial, sem modificações, e nunca lê, guarda nem repassa o token de login do usuário;
- com login por assinatura, não usa `--bare`, pois essa opção ignora a assinatura. Sem ela, hooks e servidores MCP do repositório rodam sem confirmação de confiança. Por isso, o CLI só roda em projetos que o usuário confirmou como confiáveis, no cadastro (RF-AGT-007). Enquanto o adaptador por API não existir, projetos não confirmados não rodam agentes no MVP.

#### Agente por API

- token lido do cofre seguro;
- requisições com timeout e cancelamento;
- streaming convertido em eventos comuns;
- arquivos enviados somente dentro do escopo autorizado;
- uso e custo registrados quando disponíveis.

#### Agente embutido ou SDK

- executado em processo utilitário, não no renderer;
- mesmas políticas e contrato dos demais;
- falhas isoladas da janela principal.

### 14.3 Capacidades declaradas

Cada adaptador deve informar se suporta:

- streaming;
- ferramentas;
- entrada interativa;
- aprovação durante a execução;
- pausa e retomada;
- anexos;
- uso e custo;
- contexto persistente;
- execução local;
- modelos disponíveis.

A interface deve habilitar somente ações realmente suportadas.

### 14.4 Contexto enviado ao agente

Pacote mínimo:

- objetivo da missão;
- critérios de aceite;
- plano aprovado;
- restrições;
- caminho do worktree;
- arquivos explicitamente selecionados;
- instruções locais do repositório, quando autorizadas;
- perfil de ferramentas;
- orçamento de tempo e uso;
- histórico necessário da tentativa atual.

Não enviar por padrão:

- credenciais;
- variáveis de ambiente completas;
- arquivos fora do projeto;
- histórico de outras missões;
- dados de outros projetos;
- logs não relacionados.

### 14.5 Política de ferramentas

Ferramentas devem ser descritas por capacidade, risco e escopo. Exemplos:

| Ferramenta | Risco padrão | Política sugerida |
|---|---|---|
| Ler arquivo no worktree | baixo | permitir |
| Editar arquivo no worktree | médio | permitir e registrar |
| Executar testes conhecidos | médio | permitir e registrar |
| Instalar dependência | médio/alto | solicitar aprovação conforme perfil |
| Acessar rede | alto | solicitar aprovação ou permitir por domínio |
| Escrever fora do worktree | alto | bloquear por padrão |
| Alterar credenciais | crítico | aprovação explícita |
| Push, merge ou publicação | crítico | aprovação explícita |
| Remoção recursiva | crítico | aprovação explícita e validação do alvo |

### 14.6 Prompt e instruções do sistema

O prompt montado pelo aplicativo deve ser versionado e composto por blocos:

1. papel do agente;
2. objetivo e critérios;
3. escopo de arquivos;
4. política de ferramentas;
5. regras de segurança;
6. formato de progresso;
7. formato do resultado;
8. contexto do repositório.

O texto deve ser registrado sem segredos para permitir auditoria e reprodução aproximada.

---

## 15. Missões e orquestração

### 15.1 Definição de missão

Uma missão é a unidade de trabalho rastreável do Project Hub. Ela descreve um resultado desejado, limites, evidências de conclusão e uma sequência planejada de etapas.

### 15.2 Ciclo de execução

1. validar missão e projeto;
2. validar Git, agente e permissões;
3. congelar a versão do plano;
4. criar ou reutilizar worktree autorizado;
5. criar tentativa de execução;
6. iniciar sessão do agente;
7. consumir eventos;
8. aplicar política a chamadas de ferramenta;
9. solicitar aprovação ou entrada quando necessário;
10. executar verificações finais;
11. capturar estado Git, testes e artefatos;
12. finalizar a tentativa e a missão.

### 15.3 Orquestrador do MVP

O MVP usa uma máquina de estados e etapas sequenciais. Apenas uma etapa de uma missão executa por vez. O orquestrador deve:

- garantir transições válidas;
- persistir o estado antes de emitir a atualização visual;
- manter um `AbortController` por execução;
- correlacionar processos filhos;
- aplicar timeout;
- suportar espera humana sem manter recursos desnecessários;
- produzir um resultado determinístico para falha, cancelamento ou conclusão.

### 15.4 Evolução para DAG

Após o MVP, passos podem formar um grafo acíclico direcionado:

```text
Analisar ──→ Implementar ──→ Testar ──→ Revisar
     └────→ Mapear riscos ──────────────┘
```

Regras futuras:

- um passo inicia quando todas as dependências obrigatórias concluem;
- falha pode bloquear descendentes ou acionar estratégia alternativa;
- paralelismo respeita limite global, projeto e recursos compartilhados;
- agentes diferentes podem assumir passos diferentes;
- saídas são artefatos tipados, não apenas texto livre.

### 15.5 Checkpoints

Checkpoints recomendados:

- plano aprovado;
- worktree pronto;
- dependências alteradas;
- primeira alteração relevante;
- testes executados;
- revisão final disponível.

Um checkpoint guarda estado suficiente para explicar onde a missão parou. O MVP não promete retomar o estado interno de qualquer agente, mas deve criar uma nova tentativa com contexto reconstruído.

### 15.6 Concorrência

- limite global inicial: duas missões executando simultaneamente, configurável;
- no máximo uma missão gravando em cada worktree;
- um projeto pode ter vários worktrees;
- operações de manutenção Git usam lock por projeto;
- aprovações pendentes não ocupam vaga de processo quando a sessão puder ser suspensa;
- terminal manual e agente não devem compartilhar a mesma sessão de shell.

### 15.7 Cancelamento e recuperação

Cancelamento:

1. marcar intenção de cancelamento;
2. sinalizar a sessão;
3. aguardar encerramento gracioso por período curto;
4. encerrar árvore de processos se necessário;
5. registrar estado Git e último evento;
6. marcar execução como cancelada.

Recuperação após reinício:

- execuções persistidas como `running` tornam-se `paused` ou `failed` com motivo de interrupção;
- processos sobreviventes são identificados quando possível e nunca reassumidos sem validação;
- worktrees são reconciliados;
- o usuário pode iniciar nova tentativa.

---

## 16. Estratégia de Git worktrees

### 16.1 Objetivo

Cada missão que modifica código deve operar em um checkout isolado, evitando que tarefas concorrentes disputem arquivos e permitindo revisão ou descarte independente.

### 16.2 Convenções

```text
Branch:  ph/<mission-short-id>-<slug>
Pasta:   <worktrees-root>/<project-slug>/<mission-short-id>-<slug>
```

O slug deve ser sanitizado, curto e independente do título completo. Antes de criar, o sistema verifica branch, caminho e worktrees existentes.

### 16.3 Fluxo de criação

1. validar repositório e base;
2. atualizar metadados locais do Git sem rede, salvo autorização;
3. resolver o commit base;
4. verificar colisões;
5. reservar o registro no banco como `creating`;
6. executar criação da branch e do worktree;
7. confirmar o commit e o caminho reais;
8. marcar como `ready`;
9. executar bootstrap opcional aprovado.

Se falhar, o sistema registra diagnóstico e tenta reverter somente os recursos criados por essa operação.

### 16.4 Repositório com mudanças locais

Se a base selecionada for o checkout principal e houver mudanças locais:

- não copiar mudanças silenciosamente;
- oferecer usar o commit atual sem mudanças;
- oferecer criar um snapshot/commit somente com ação explícita;
- oferecer cancelar e preparar o repositório manualmente;
- deixar claro o que será ou não incluído.

### 16.5 Encerramento da missão

Opções:

- manter worktree e branch;
- abrir para revisão externa;
- marcar como arquivado no aplicativo;
- remover worktree após verificar mudanças e confirmação;
- excluir branch local somente em ação separada e segura.

O aplicativo não deve remover automaticamente um worktree com mudanças não commitadas.

### 16.6 Reconciliação

Ao abrir o projeto:

- consultar `git worktree list --porcelain`;
- comparar com registros locais;
- marcar ausentes como órfãos;
- importar worktrees desconhecidos apenas após confirmação;
- executar limpeza de metadados somente com operação explícita.

---

## 17. Segurança e modelo de ameaças

### 17.1 Fronteiras de confiança

Dados não confiáveis incluem:

- conteúdo de repositórios;
- saída de comandos;
- mensagens de agentes;
- nomes de branch e arquivos;
- diffs;
- conteúdo obtido da rede;
- metadados de plugins e integrações.

Nenhum desses dados deve ser tratado como HTML confiável, comando ou instrução de sistema sem validação.

### 17.2 Ameaças principais e controles

| Ameaça | Controle |
|---|---|
| XSS por conteúdo de arquivo ou log | escape de conteúdo, CSP e ausência de HTML arbitrário |
| Comprometimento do renderer | context isolation, sandbox e API preload mínima |
| Injeção de comando | argumentos estruturados, sem shell quando possível e validação explícita |
| Escape de diretório | caminhos canônicos e checagem de pertencimento ao escopo |
| Exposição de token | cofre do sistema, redação de logs e acesso só no processo principal |
| Agente executando ação excessiva | política de ferramentas, allowlist e aprovação |
| Dependência maliciosa | lockfile, auditoria, revisão e atualizações controladas |
| Plugin adulterado | assinatura e permissões em fase futura |
| Link externo perigoso | confirmação, allowlist de protocolo e abertura no navegador do sistema |
| Remoção acidental de dados | checagem de alvo, confirmação e operações recuperáveis |

### 17.3 Ações protegidas

Devem exigir aprovação por padrão:

- escrita fora do worktree autorizado;
- acesso a diretórios sensíveis;
- instalação global;
- elevação de privilégio;
- acesso de rede não previsto;
- uso de credencial nova;
- exclusão recursiva;
- alteração de configuração Git global;
- push, force push, merge ou publicação;
- execução de binário baixado durante a missão;
- leitura de arquivos identificados como segredos.

### 17.4 Armazenamento de credenciais

- tokens armazenados no cofre nativo;
- SQLite guarda apenas uma referência opaca;
- tokens nunca retornam ao renderer;
- interface mostra estado “configurado”, não o valor;
- rotação e remoção disponíveis;
- exportação de dados exclui credenciais;
- cópia para clipboard exige ação explícita e deve ser evitada.

### 17.5 Política de conteúdo remoto

- URLs abertas externamente, não dentro de uma webview privilegiada;
- nenhum conteúdo remoto recebe ponte para APIs nativas;
- downloads são tratados como não confiáveis;
- atualizações usam canal autenticado e artefatos assinados;
- integrações aplicam timeout, TLS e validação de destino.

### 17.6 Auditoria

Registrar:

- criação e mudança de missão;
- início e fim de execução;
- chamadas de ferramentas;
- comandos e códigos de saída, com sanitização;
- pedidos e decisões de aprovação;
- mudanças de política;
- criação e remoção de worktrees;
- erros e recuperação.

Não registrar:

- token completo;
- conteúdo de credenciais;
- variáveis de ambiente completas;
- arquivos sensíveis não necessários;
- texto do clipboard;
- dados de outros projetos sem relação.

---

## 18. Persistência, arquivos e retenção

### 18.1 Diretórios do aplicativo

Usar os diretórios fornecidos pelo Electron para dados do usuário. Estrutura lógica:

```text
userData/
├─ database/
│  └─ project-hub.sqlite
├─ logs/
├─ cache/
├─ diagnostics/
└─ config/
```

Worktrees devem ficar em raiz separada e configurável, não dentro de `userData`.

### 18.2 Migrações

- cada migração tem ID crescente;
- migrações executam em transação quando possível;
- backup antes de mudanças incompatíveis;
- falha impede abertura normal e oferece diagnóstico;
- downgrade não é automático;
- migrações são testadas com bancos de versões anteriores.

### 18.3 Retenção

Política inicial:

- metadados de missões: mantidos até exclusão do usuário;
- eventos detalhados: configurável, padrão de 90 dias;
- logs técnicos: rotação por tamanho e tempo;
- cache de diff: descartável;
- artefatos: mantidos enquanto vinculados ou conforme política;
- terminais: saída persistida somente quando vinculada a uma execução e sanitizada.

---

## 19. Observabilidade e diagnósticos

### 19.1 Logs

Formato estruturado com:

- timestamp;
- nível;
- componente;
- correlation ID;
- project ID e mission ID, quando aplicável;
- evento;
- dados sanitizados;
- erro com stack no processo principal.

### 19.2 Métricas locais

- tempo de inicialização;
- duração de operações Git;
- quantidade de missões por estado;
- falhas por adaptador;
- tempo em espera por aprovação;
- uso de memória;
- tamanho do banco e dos logs.

No MVP, essas métricas podem alimentar apenas a tela de diagnóstico local.

### 19.3 Pacote de diagnóstico

Conteúdo:

- versão do aplicativo e sistema;
- status de dependências, sem segredos;
- logs recentes sanitizados;
- schema e versão do banco, sem conteúdo do usuário;
- configuração segura selecionada;
- lista de falhas recentes;
- manifesto do pacote.

Antes da exportação, o usuário deve ver o que será incluído.

---

## 20. Testes e estratégia de qualidade

### 20.1 Pirâmide de testes

#### Unitários

Cobrem:

- transições de estado;
- avaliação de políticas;
- normalização de caminhos;
- geração de nomes de branch e worktree;
- validação de contratos;
- sanitização e redação de segredos;
- cálculo de dependências entre etapas;
- mapeamento de erros dos adaptadores.

#### Integração

Cobrem:

- repositórios com SQLite real temporário;
- migrações;
- operações Git em repositórios temporários;
- ciclo de subprocessos;
- adaptadores falsos e eventos;
- IPC entre preload e processo principal;
- recuperação após interrupção simulada.

#### Componentes

Cobrem:

- formulários e validação;
- estados vazio, erro e carregamento;
- timeline de eventos;
- cartão de aprovação;
- navegação por teclado;
- diff e listas virtualizadas.

#### Ponta a ponta

Fluxos prioritários:

1. onboarding e primeiro projeto;
2. criação e conclusão de missão com agente simulado;
3. aprovação de ação protegida;
4. cancelamento durante execução;
5. falha e nova tentativa;
6. criação e arquivamento de worktree;
7. reinício do app com missão interrompida;
8. remoção do projeto apenas do catálogo.

### 20.2 Agente simulado

Criar um adaptador determinístico para testes que:

- emite eventos com tempo controlável;
- solicita entrada;
- solicita aprovação;
- simula falha e cancelamento;
- cria arquivos conhecidos;
- reporta uso fictício;
- permite testar retry e recuperação.

Isso reduz dependência de rede, custo e variação dos modelos.

### 20.3 Testes de segurança

- fuzz de schemas IPC;
- tentativa de path traversal;
- nomes de arquivo e branch maliciosos;
- logs com sequências de terminal e HTML;
- comandos contendo espaços, aspas e metacaracteres;
- vazamento de segredos em logs e exportações;
- navegação para protocolos não permitidos;
- renderer comprometido tentando canais não expostos;
- remoção com caminhos simbólicos e junctions.

### 20.4 Testes multiplataforma

Matriz mínima no CI:

- Windows;
- macOS;
- Linux.

Casos sensíveis:

- separadores de caminho;
- nomes reservados;
- permissões e links simbólicos;
- shell padrão;
- encerramento de árvore de processos;
- armazenamento seguro;
- assinatura e instalador;
- node-pty e binários nativos.

### 20.5 Gates de qualidade

Para integrar uma mudança:

- lint e typecheck aprovados;
- testes unitários e de integração aprovados;
- nenhum segredo detectado;
- análise de dependências sem vulnerabilidade crítica não aceita;
- build do desktop concluído;
- fluxos E2E essenciais aprovados em branch de release;
- revisão de contrato quando IPC ou schema mudarem.

---

## 21. Critérios de aceite do MVP

### 21.1 Produto

- [ ] O usuário instala e inicia o aplicativo na plataforma priorizada.
- [ ] O onboarding verifica Git e configura ao menos um agente.
- [ ] Uma pasta Git pode ser adicionada como projeto.
- [ ] O painel mostra o projeto e seu estado básico.
- [ ] Uma missão pode ser criada com objetivo e critérios de aceite.
- [ ] Um plano pode ser gerado, editado e aprovado.
- [ ] O sistema cria branch e worktree isolados.
- [ ] O agente executa no diretório correto.
- [ ] Eventos aparecem em tempo real e permanecem após reinício.
- [ ] Uma ação protegida é bloqueada até decisão do usuário.
- [ ] O usuário pode responder a uma solicitação do agente.
- [ ] O usuário pode pausar ou cancelar uma execução.
- [ ] Arquivos alterados e diff são apresentados.
- [ ] Resultados de testes e critérios de aceite são visíveis.
- [ ] A missão pode terminar como concluída, falha ou cancelada.
- [ ] O worktree não é removido automaticamente ao concluir.
- [ ] Uma nova tentativa preserva o histórico anterior.

### 21.2 Segurança

- [ ] O renderer não possui acesso direto ao Node.js.
- [ ] Todos os payloads IPC são validados.
- [ ] Credenciais ficam no armazenamento seguro do sistema.
- [ ] Tokens e padrões conhecidos de segredo não aparecem nos logs.
- [ ] Escrita fora do escopo autorizado é bloqueada.
- [ ] Push, publicação e remoção destrutiva exigem aprovação.
- [ ] Links remotos não executam dentro de contexto privilegiado.
- [ ] Exportação de diagnóstico é sanitizada.

### 21.3 Qualidade

- [ ] Testes de domínio cobrem todas as transições de missão.
- [ ] Operações de worktree possuem testes de integração.
- [ ] O fluxo vertical principal possui teste E2E.
- [ ] Recuperação após encerramento inesperado foi validada.
- [ ] A interface principal é utilizável por teclado.
- [ ] Erros críticos apresentam ação de recuperação.
- [ ] Build instalável é gerado por CI.

### 21.4 Definição de pronto por história

Uma história está pronta quando:

- comportamento atende aos critérios;
- estados alternativos foram tratados;
- testes relevantes foram adicionados;
- acessibilidade foi verificada;
- logs não expõem dados sensíveis;
- documentação ou contrato foi atualizado;
- revisão técnica foi concluída;
- não há regressão conhecida de alta severidade.

---

## 22. Cronograma sugerido

Estimativa para uma equipe pequena, com uma pessoa responsável pelo produto/design e duas a três pessoas de engenharia. Ajustar após os protótipos técnicos.

| Semana | Entrega principal |
|---:|---|
| 1 | descoberta, fluxos, ameaças, ADRs e wireframes |
| 2 | monorepo, Electron seguro, design system e CI inicial |
| 3 | SQLite, migrações, contratos IPC e catálogo de projetos |
| 4 | detalhe do projeto, Git status e tratamento de caminhos |
| 5 | modelo de missão, criação, estados e timeline |
| 6 | adaptador de agente simulado e orquestrador sequencial |
| 7 | criação, reconciliação e ciclo de vida de worktrees |
| 8 | terminal, streaming de eventos e cancelamento |
| 9 | integração do primeiro agente real e aprovações |
| 10 | diff, testes, resumo final e recuperação após reinício |
| 11 | E2E, segurança, acessibilidade e testes multiplataforma |
| 12 | empacotamento, correções, documentação e piloto interno |

### Marcos

- **M1 — Fundação pronta:** app inicia com segurança, persiste dados e passa no CI.
- **M2 — Fluxo simulado completo:** missão conclui com agente falso e worktree real.
- **M3 — Integração real:** primeiro adaptador executa com aprovação e logs.
- **M4 — MVP candidato:** instalador, testes críticos e critérios de aceite cumpridos.

### Primeira etapa de implementação: duas semanas

Objetivo: reduzir os maiores riscos antes de construir todas as telas.

Entregáveis:

1. monorepo configurado;
2. janela Electron com preload mínimo e CSP;
3. React com navegação e tokens visuais;
4. SQLite com primeira migração;
5. API IPC tipada de exemplo;
6. cadastro e listagem de projetos;
7. prova de conceito de `git status`;
8. prova de conceito de criação e remoção segura de worktree temporário;
9. adaptador de agente simulado;
10. pipeline com lint, typecheck, testes e build.

Critério de saída: selecionar uma pasta, cadastrá-la, visualizar estado Git e executar uma missão simulada que grave eventos persistidos sem expor Node.js ao renderer.

---

## 23. Riscos e mitigação

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Complexidade de processos e cancelamento multiplataforma | alta | alto | protótipo precoce, árvore de processos rastreada e testes por SO |
| Comportamento variável entre agentes | alta | alto | contrato normalizado, capabilities e adaptador simulado |
| Vazamento de dados sensíveis | média | crítico | cofre, escopo mínimo, sanitização e revisão de segurança |
| Comandos destrutivos sugeridos por agente | média | crítico | políticas, aprovação e validação do alvo |
| Colisão ou perda em worktrees | média | alto | locks, reconciliação, operações idempotentes e nunca remover com mudanças |
| Crescimento excessivo do escopo | alta | alto | fluxo vertical fixo e não objetivos explícitos |
| Electron aumentar consumo de memória | média | médio | limites, profiling, virtualização e processos sob demanda |
| Dependências nativas dificultarem distribuição | média | alto | matriz CI desde o início e poucas dependências nativas |
| Mudanças em APIs de provedores | alta | médio | adaptadores, testes de contrato e versionamento |
| Logs crescerem indefinidamente | média | médio | rotação e retenção configurável |
| Recuperação inconsistente após crash | média | alto | persistência transacional, snapshots e testes de interrupção |
| Diffs grandes travarem a interface | média | médio | paginação, streaming, limite e worker |
| Usuário não entender estado da missão | média | alto | máquina de estados visível, linguagem clara e testes de usabilidade |
| Custo inesperado de API | média | alto | orçamento por missão, estimativa e alerta |

---

## 24. Instalação do ambiente de desenvolvimento

### 24.1 Pré-requisitos

- Git instalado e disponível no PATH;
- Node.js em versão LTS compatível com a versão escolhida do Electron;
- pnpm habilitado via Corepack;
- ferramentas de compilação nativa exigidas pelo sistema operacional;
- credenciais do agente configuradas apenas quando a integração real for testada.

Requisitos adicionais comuns:

- **Windows:** ferramentas de build C++ quando dependências nativas exigirem;
- **macOS:** Xcode Command Line Tools;
- **Linux:** compilador, Python e bibliotecas necessárias ao Electron e ao node-pty.

### 24.2 Criação inicial do projeto

Exemplo de sequência após o repositório existir:

```bash
corepack enable
pnpm install
pnpm db:migrate
pnpm dev
```

Scripts esperados no workspace:

```json
{
  "scripts": {
    "dev": "executa o aplicativo em desenvolvimento",
    "build": "gera os bundles",
    "package": "gera o instalador local",
    "lint": "executa análise estática",
    "format": "formata os arquivos",
    "typecheck": "valida tipos",
    "test": "executa testes unitários",
    "test:integration": "executa integrações locais",
    "test:e2e": "executa o aplicativo com Playwright",
    "db:generate": "gera migrações",
    "db:migrate": "aplica migrações"
  }
}
```

Os valores acima descrevem a intenção dos scripts; a implementação deve usar os comandos reais escolhidos no bootstrap.

### 24.3 Variáveis de ambiente

Manter um arquivo `.env.example` sem segredos:

```dotenv
APP_LOG_LEVEL=info
APP_DEVTOOLS=false
APP_AGENT_ADAPTER=mock
APP_WORKTREES_ROOT=
```

Tokens reais devem ir para o cofre do sistema por meio da interface do aplicativo. Arquivos `.env` locais devem estar ignorados pelo Git.

### 24.4 Configuração recomendada da segurança Electron

```ts
new BrowserWindow({
  webPreferences: {
    preload: PRELOAD_PATH,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true
  }
});
```

Também é necessário:

- bloquear navegação inesperada;
- validar criação de novas janelas;
- abrir links autorizados externamente;
- definir CSP;
- desabilitar permissões não usadas;
- não carregar conteúdo remoto privilegiado.

---

## 25. Primeiros passos de implementação

### Passo 1 — Registrar decisões

Criar ADRs para:

- framework de empacotamento;
- banco e migrações;
- biblioteca Git;
- raiz de worktrees;
- primeiro formato de adaptador;
- estratégia de segredos;
- plataformas oficialmente suportadas no MVP.

### Passo 2 — Criar a fundação

- iniciar o monorepo;
- configurar TypeScript estrito;
- configurar lint, formatação e testes;
- criar processo principal, preload e renderer;
- adicionar CSP e políticas de janela;
- criar design tokens e shell da aplicação.

### Passo 3 — Implementar contratos

- pacote `contracts` sem dependência de Electron;
- schemas Zod de projeto, missão, eventos e erros;
- envelope de resultado;
- ponte preload com métodos explícitos;
- teste que confirma que canais arbitrários não estão expostos.

### Passo 4 — Persistir projetos

- criar schema e migração;
- implementar repositório de projetos;
- seleção de pasta;
- normalização de caminho;
- cadastro, listagem e remoção lógica;
- tela de catálogo com estados vazios e erro.

### Passo 5 — Provar Git e worktrees

- detectar Git;
- obter status e branch;
- criar repositório temporário em teste;
- criar worktree com nome seguro;
- detectar colisões;
- validar remoção somente de alvo conhecido;
- persistir e reconciliar estado.

### Passo 6 — Criar núcleo de missões

- entidade e máquina de estados;
- criação e edição;
- plano e critérios;
- tentativa de execução;
- event log;
- timeline na interface.

### Passo 7 — Integrar agente simulado

- implementar contrato;
- emitir mensagens, chamadas de ferramenta e conclusão;
- simular entrada e aprovação;
- testar pausa, cancelamento e falha;
- usar o adaptador em todo o fluxo vertical.

### Passo 8 — Integrar o primeiro agente real

- implementar `probe` e autenticação;
- mapear capacidades;
- normalizar streaming;
- limitar ambiente e diretório;
- registrar uso;
- comparar comportamento com testes de contrato.

### Passo 9 — Completar revisão

- status Git;
- diff paginado;
- resultados de comandos de teste;
- resumo final;
- marcação de critérios de aceite;
- ações de conclusão e solicitação de ajustes.

### Passo 10 — Preparar distribuição

- builds por plataforma;
- ícones e metadados;
- assinatura;
- atualização controlada;
- smoke test do instalador;
- documentação de suporte e diagnóstico.

---

## 26. Backlog inicial por épicos

### Épico A — Fundação desktop

- criar janela principal segura;
- configurar preload tipado;
- configurar roteamento;
- criar tema claro/escuro;
- implementar logging;
- configurar pipeline.

### Épico B — Projetos

- selecionar pasta;
- validar e cadastrar;
- listar e buscar;
- mostrar Git status;
- abrir externamente;
- detectar caminho indisponível.

### Épico C — Missões

- criar e editar draft;
- gerenciar critérios;
- gerar e aprovar plano;
- executar;
- pausar, cancelar e tentar novamente;
- apresentar histórico.

### Épico D — Worktrees

- configurar raiz;
- gerar nomes;
- criar e reconciliar;
- mostrar status;
- arquivar;
- remover com segurança.

### Épico E — Agentes

- SDK e contrato;
- adaptador simulado;
- primeiro adaptador real;
- tela de perfis;
- health check;
- uso e limites.

### Épico F — Observação e revisão

- timeline;
- terminal;
- logs;
- diff;
- testes;
- resumo e artefatos.

### Épico G — Segurança

- cofre;
- políticas;
- aprovações;
- sanitização;
- CSP;
- diagnóstico seguro.

### Épico H — Distribuição

- instaladores;
- assinatura;
- atualizações;
- E2E multiplataforma;
- documentação de instalação.

---

## 27. Perguntas para refinamento antes do desenvolvimento

Estas decisões não impedem o protótipo, mas devem ser respondidas até o fim da fundação:

1. Qual sistema operacional terá prioridade de lançamento?
   - **Resposta:** Windows primeiro. macOS e Linux entram depois, sem mudar a arquitetura, que continua multiplataforma (seção 12.5).
2. O primeiro agente será acessado por CLI local, API ou ambos?
   - **Resposta (provisória):** CLI local, com o Claude Code oficial, para uso pessoal. A chave de API fica para a distribuição. Os outros provedores (GPT e Gemini) entram depois. O caminho do CLI ainda precisa ser confirmado com a Anthropic.
3. O usuário poderá executar missões sem Git, ou Git será obrigatório?
   - **Resposta:** Git é obrigatório para missões que alteram código.
4. Qual nível de automação será padrão: conservador, equilibrado ou autônomo?
   - **Resposta:** equilibrado. O app decide sozinho a leitura de arquivos, a edição dentro do worktree da missão, a execução dos testes já existentes e a frase de resumo de cada arquivo. Pede confirmação para instalar dependências, acessar a internet, apagar arquivos em massa, mexer em credenciais, fazer push, merge ou publicar. Mexer em arquivos fora do worktree fica bloqueado por padrão. A aprovação do plano continua obrigatória (RF-MIS-003), e cada projeto pode ajustar essa lista (RF-APR-005).
5. A criação de commits fará parte do MVP ou ficará sempre manual?
   - **Resposta:** o MVP não cria commits, push nem merge sozinho. Esses passos ficam sob ação humana.
6. Quais shells precisam de suporte oficial em cada plataforma?
   - **Resposta:** PowerShell como shell padrão no Windows, configurável pelo usuário (seção 12.5).
7. Qual limite de tamanho para repositórios, diffs e logs será suportado inicialmente?
   - **Resposta:** limites a definir antes do piloto. Até lá, diffs grandes são carregados de forma incremental (seção 12.2).
8. Haverá atualização automática no piloto ou instalação manual?
   - **Resposta:** instalação manual durante o piloto, antes da atualização automática.
9. Quais dados podem ser enviados ao provedor de agente?
   - **Resposta:** o agente recebe o objetivo, os critérios de aceite, o plano aprovado e os arquivos selecionados (seção 14.4). Credenciais, variáveis de ambiente completas e arquivos fora do projeto nunca são enviados. O código que o agente lê vai ao provedor, como em qualquer uso do Claude.
10. O MVP será distribuído publicamente ou para um grupo controlado?
   - **Resposta (parcial):** uso pessoal primeiro, para testes. A distribuição fica para depois, e ainda não foi definido se será pública ou para um grupo controlado. Em qualquer caso, rodar o Claude Code dentro de um produto exige confirmar as condições comerciais com a Anthropic.

Decisões conservadoras recomendadas para começar:

- priorizar uma plataforma, mantendo a arquitetura multiplataforma;
- usar Git como requisito para missões que alteram código;
- manter commits, push e merge sob ação humana;
- começar com um adaptador real e um adaptador simulado;
- distribuição piloto controlada antes de atualização automática;
- perfil de automação equilibrado, com aprovação para rede, dependências e publicação.

---

## 28. Checklist de lançamento do piloto

### Produto

- [ ] fluxo vertical completo;
- [ ] onboarding funcional;
- [ ] documentação de uso;
- [ ] mensagens de erro revisadas;
- [ ] recuperação de falhas validada;
- [ ] feedback dentro do aplicativo ou canal definido.

### Engenharia

- [ ] builds reproduzíveis;
- [ ] banco e migrações testados;
- [ ] símbolos e logs disponíveis para diagnóstico;
- [ ] dependências auditadas;
- [ ] testes E2E essenciais aprovados;
- [ ] rollback de release documentado.

### Segurança e privacidade

- [ ] modelo de ameaças revisado;
- [ ] segredos no cofre;
- [ ] CSP validada;
- [ ] ações protegidas cobertas;
- [ ] política de dados publicada;
- [ ] exportação e exclusão de dados testadas.

### Operação

- [ ] matriz de sistemas suportados definida;
- [ ] processo de atualização definido;
- [ ] canal para incidentes definido;
- [ ] procedimento de diagnóstico documentado;
- [ ] métricas de sucesso preparadas;
- [ ] plano de feedback do piloto definido.

---

## 29. Glossário

**Adaptador de agente:** implementação que traduz uma CLI, API ou SDK para o contrato comum do aplicativo.

**Agente:** sistema automatizado capaz de analisar contexto, responder e usar ferramentas para cumprir uma missão.

**Aprovação:** decisão humana necessária antes de uma ação protegida.

**Artefato:** saída persistida de uma missão, como relatório, patch, resultado de teste ou arquivo gerado.

**Checkpoint:** registro consistente de um ponto relevante da execução.

**Execução:** uma tentativa de realizar uma missão.

**Missão:** unidade de trabalho com objetivo, contexto, plano e critérios de aceite.

**Orquestrador:** componente que controla estados, etapas, agentes, políticas e recuperação.

**Perfil de execução:** conjunto de limites, permissões e configurações usado por uma missão.

**Worktree:** checkout Git adicional vinculado a uma branch, usado para isolar trabalho.

---

## 30. Conclusão

O caminho mais seguro para construir o Project Hub é entregar primeiro um fluxo vertical local, observável e recuperável. A arquitetura deve separar claramente interface, domínio, infraestrutura e integrações, com Electron configurado de forma restritiva e contratos tipados em todas as fronteiras.

O diferencial do produto não estará apenas em chamar um agente, mas em transformar essa execução em um processo confiável: objetivo explícito, plano revisável, workspace isolado, permissões controladas, eventos rastreáveis, evidências de teste e revisão humana antes da integração.

A prioridade imediata é validar os riscos técnicos de Electron, processos, terminal, Git worktrees, persistência e protocolo de agentes. Com esses pilares comprovados e o fluxo simulado funcionando do início ao fim, a integração de um agente real pode ser adicionada sem comprometer a segurança nem acoplar o produto a um único fornecedor.
