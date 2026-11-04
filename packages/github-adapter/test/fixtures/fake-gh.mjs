// `gh` falso dos testes do adaptador. É um script Node: o adaptador o roda pelo `process.execPath`, só com
// `PROJECT_HUB_ENV=test` e `PROJECT_HUB_GH_BIN=<este arquivo>` (o Windows não executa um `.cmd` nem um `.js`
// direto pelo `execFile`). Nada aqui fala com o GitHub.
//
// Variáveis que o teste define:
// - FAKE_GH_LOG: arquivo onde cada chamada é gravada, uma linha de JSON por chamada ({ argv, cwd, env }).
// - FAKE_GH_SCENARIO: o que o falso responde (veja `scenario` abaixo). Sem ele, o PR 47 da fixture.
// - FAKE_GH_HEAD: a branch do PR nos cenários `open-green` e `open-failing` (testes de ponta a ponta).
//
// A saída de `pr view` parte de `gh-pr-view.json` (saída real do `gh`, com um `StatusContext` e um comentário
// sintéticos acrescentados pelo teste de contrato; aqui só a parte real).
import { appendFileSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const scenario = process.env['FAKE_GH_SCENARIO'] ?? 'pr-open';

const log = process.env['FAKE_GH_LOG'];
if (log !== undefined && log !== '') {
  const watched = [
    'GH_REPO',
    'GH_HOST',
    'GH_PROMPT_DISABLED',
    'NO_COLOR',
    'CLICOLOR',
    'GH_NO_UPDATE_NOTIFIER',
    'CLICOLOR_FORCE',
    'GH_FORCE_TTY',
  ];
  const env = Object.fromEntries(watched.map((name) => [name, process.env[name] ?? null]));
  appendFileSync(log, `${JSON.stringify({ argv, cwd: process.cwd(), env })}\n`);
}

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const fixture = () =>
  JSON.parse(readFileSync(new URL('./gh-pr-view.json', import.meta.url), 'utf8'));

/**
 * Saídas de erro. As três primeiras foram capturadas do `gh` real (2.92). `NOT_MERGEABLE` NÃO foi: é o texto
 * conhecido do `gh`, escrito à mão, porque capturá-lo exigiria um merge de verdade.
 */
const UNAUTHENTICATED =
  'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.';
const NETWORK =
  'Post "https://api.github.com/graphql": proxyconnect tcp: dial tcp 127.0.0.1:1: connectex: No connection could be made because the target machine actively refused it.';
const NOT_FOUND =
  'GraphQL: Could not resolve to a PullRequest with the number of 999999. (repository.pullRequest)';
const NOT_MERGEABLE =
  'X Pull request #12 is not mergeable: the merge commit cannot be cleanly created.';

if (scenario === 'unauthenticated') fail(4, UNAUTHENTICATED);
if (scenario === 'network') fail(1, NETWORK);
if (scenario === 'not-found') fail(1, NOT_FOUND);
if (scenario === 'not-mergeable') fail(1, NOT_MERGEABLE);
if (scenario === 'no-pr-error' && argv[1] === 'list') fail(1, 'no pull requests found');
if (scenario === 'unknown-error') fail(1, 'algo que o adaptador não reconhece <script>');
if (scenario === 'hang') setInterval(() => undefined, 1000);
else if (scenario === 'garbage') process.stdout.write('isto não é JSON');
else if (argv[0] === 'pr' && argv[1] === 'list') {
  process.stdout.write(scenario === 'no-pr' ? '[]' : '[{"number":47}]');
} else if (argv[0] === 'pr' && argv[1] === 'view') {
  const pr = fixture();
  if (scenario === 'foreign-host') {
    pr.url = 'https://ghe.example.com/org/repo/pull/47';
  } else if (scenario === 'lookalike-host') {
    pr.url = 'https://github.com.exemplo.com/org/repo/pull/47';
  } else if (scenario === 'open-green' || scenario === 'open-failing') {
    // Para os testes de ponta a ponta: PR aberto, mesclável, com checks verdes (ou com o segundo falho).
    // `FAKE_GH_HEAD` é a branch do PR (a do repositório descartável do teste).
    pr.state = 'OPEN';
    pr.mergeable = 'MERGEABLE';
    pr.mergeStateStatus = 'CLEAN';
    pr.headRefName = process.env['FAKE_GH_HEAD'] ?? pr.headRefName;
    if (scenario === 'open-failing') pr.statusCheckRollup[1].conclusion = 'FAILURE';
  } else if (scenario === 'unknown-enums') {
    pr.state = 'SUSPENDED';
    pr.mergeable = 'MAYBE';
    pr.mergeStateStatus = 'NEW_VALUE';
    pr.reviewDecision = 'SOMETHING_ELSE';
    pr.statusCheckRollup[0].status = 'TELEPORTING';
    pr.statusCheckRollup[1].conclusion = 'NEW_CONCLUSION';
  }
  process.stdout.write(JSON.stringify(pr));
}
// `pr comment` e `pr merge` não imprimem nada em caso de sucesso, como o `gh` real com saída que não é terminal.
