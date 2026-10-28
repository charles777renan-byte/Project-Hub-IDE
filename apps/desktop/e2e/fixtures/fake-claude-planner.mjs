// CLI falso do `claude -p` para os testes de ponta a ponta. Roda no Electron como Node
// (`APP_PLANNER_SCRIPT` + `ELECTRON_RUN_AS_NODE=1`, só com `PROJECT_HUB_ENV=test`). Lê o prompt inteiro do
// stdin e imprime o envelope que o CLI real imprime (ver test/fixtures/claude-plan-output.json).
// Se a instrução da pessoa traz o marcador `trocar-plano`, devolve outro plano, o que prova que a
// instrução chegou ao planejador.

const MARKER = 'trocar-plano';

const FIRST_PLAN = [
  {
    title: 'Modelar o banco de dados',
    description: 'Criar a tabela de usuários. Pronto quando a migração roda do zero.',
    role: 'database',
    dependsOn: [],
  },
  {
    title: 'Implementar a API do login',
    description: 'Criar a rota de login. Pronto quando responde 200 e 401.',
    role: 'backend',
    dependsOn: [1],
  },
  {
    title: 'Construir a tela de login',
    description: 'Criar a página com e-mail e senha. Pronto quando liga na API.',
    role: 'frontend',
    dependsOn: [2],
  },
];

const SECOND_PLAN = [
  {
    title: 'Plano novo: levantar requisitos',
    description: 'Listar o que o login precisa. Pronto quando a lista existe.',
    role: 'general',
    dependsOn: [],
  },
  {
    title: 'Plano novo: documentar o uso',
    description: 'Escrever como usar o login. Pronto quando o README o explica.',
    role: 'docs',
    dependsOn: [1],
  },
];

let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  prompt += chunk;
});
process.stdin.on('end', () => {
  const tasks = prompt.includes(MARKER) ? SECOND_PLAN : FIRST_PLAN;
  const envelope = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 10,
    num_turns: 1,
    result: JSON.stringify({ tasks }),
    structured_output: { tasks },
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    terminal_reason: 'completed',
  };
  process.stdout.write(JSON.stringify(envelope));
});
