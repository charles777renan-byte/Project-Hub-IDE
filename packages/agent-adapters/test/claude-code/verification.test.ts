import { describe, expect, it } from 'vitest';
import type { HookRecord } from '../../src/claude-code/settings';
import {
  MAX_VERIFICATION_OUTPUT_CHARS,
  countTests,
  isTestCommand,
  verificationOf,
} from '../../src/claude-code/verification';

const at = '2026-11-17T12:00:00.000Z';

function record(payload: Record<string, unknown>, seq = 1): HookRecord {
  return { seq, receivedAt: at, payload };
}

function bash(command: string, stdout: string, extra: Record<string, unknown> = {}): HookRecord {
  return record({
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_response: { stdout, stderr: '', interrupted: false },
    tool_use_id: 't1',
    duration_ms: 4187,
    ...extra,
  });
}

describe('isTestCommand', () => {
  it.each([
    'pnpm test',
    'npm test',
    'npm run test',
    'yarn test',
    'bun test',
    'pnpm -r test',
    'pnpm --filter @project-hub/domain test',
    'pnpm --filter=@project-hub/domain run test:unit -- --watch=false',
    'pnpm test:e2e capturas.spec.ts',
    'cd apps/desktop && pnpm test:e2e',
    'CI=1 pnpm test',
    'pnpm test 2>&1 | tail -20',
    'npx vitest run',
    'pnpm exec vitest run packages/application',
    'npx jest --ci',
    'npx playwright test',
    'pytest -q',
    'python -m pytest tests/',
    'uv run pytest',
    'go test ./...',
    'cargo test',
    'cargo nextest run',
    'dotnet test',
    './gradlew test',
    'mvn -q test',
    'deno test',
    'node --test',
    'bundle exec rspec',
    'make test',
  ])('reconhece %s', (command) => {
    expect(isTestCommand(command)).toBe(true);
  });

  it.each([
    'pnpm lint',
    'pnpm build',
    'pnpm install',
    'pnpm exec eslint test',
    'git status',
    'ls test',
    'cat test/foo.test.ts',
    'echo "pnpm test"',
    'pnpm typecheck',
    'grep -rn vitest .',
    '',
  ])('ignora %s', (command) => {
    expect(isTestCommand(command)).toBe(false);
  });
});

describe('countTests', () => {
  it('Vitest: soma a linha Tests e ignora a de arquivos', () => {
    const output = [
      ' Test Files  1 failed | 285 passed (286)',
      '      Tests  1 failed | 6734 passed (6735)',
      '   Duration  160.95s',
    ].join('\n');
    expect(countTests(output)).toEqual({ passed: 6734, failed: 1 });
  });

  it('Vitest com cores do terminal', () => {
    const output =
      '\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m12 passed\u001b[39m\u001b[22m (12)';
    expect(countTests(output)).toEqual({ passed: 12, failed: 0 });
  });

  it('Jest: lê a linha Tests e ignora a de suítes', () => {
    const output = [
      'Test Suites: 1 failed, 3 passed, 4 total',
      'Tests:       2 failed, 14 passed, 16 total',
    ].join('\n');
    expect(countTests(output)).toEqual({ passed: 14, failed: 2 });
  });

  it('monorepo: soma o resumo de cada pacote, com ou sem o prefixo do pnpm', () => {
    const output = [
      'packages/domain test:  Test Files  2 passed (2)',
      'packages/domain test:       Tests  10 passed (10)',
      'apps/desktop test:       Tests  1 failed | 2 passed (3)',
      '. test:       Tests  5 passed (5)',
    ].join('\n');
    expect(countTests(output)).toEqual({ passed: 17, failed: 1 });
  });

  it('pytest: resumo entre sinais de igual, com erros contando como falha', () => {
    expect(countTests('===== 3 passed, 1 failed, 2 skipped, 1 error in 0.12s =====')).toEqual({
      passed: 3,
      failed: 2,
    });
    expect(countTests('5 passed in 0.03s')).toEqual({ passed: 5, failed: 0 });
  });

  it('Playwright: linhas separadas de aprovados e falhos; a lista de testes não conta', () => {
    const output = [
      '  ok  1 e2e/capturas.spec.ts:44:1 › capturas (16.1s)',
      '  x   2 e2e/outro.spec.ts:10:1 › falha (2.0s)',
      '  1 failed',
      '    e2e/outro.spec.ts:10:1 › falha',
      '  2 skipped',
      '  10 passed (2.1m)',
    ].join('\n');
    expect(countTests(output)).toEqual({ passed: 10, failed: 1 });
  });

  it('Mocha: passing e failing', () => {
    expect(countTests('  5 passing (30ms)\n  1 failing')).toEqual({ passed: 5, failed: 1 });
  });

  it('cargo: soma cada "test result"', () => {
    const output = [
      'test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out',
      'test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out',
    ].join('\n');
    expect(countTests(output)).toEqual({ passed: 7, failed: 1 });
  });

  it('node --test: resumo do TAP e do relator padrão', () => {
    expect(countTests('# tests 6\n# pass 5\n# fail 1')).toEqual({ passed: 5, failed: 1 });
    expect(countTests('ℹ tests 3\nℹ pass 3\nℹ fail 0')).toEqual({ passed: 3, failed: 0 });
  });

  it('dotnet: linha de resultado', () => {
    expect(
      countTests('Failed!  - Failed:     1, Passed:     5, Skipped:     0, Total:     6'),
    ).toEqual({ passed: 5, failed: 1 });
  });

  it('Maven e Gradle: vale a última linha "Tests run"', () => {
    const output = [
      '[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 0.1 s',
      '[ERROR] Tests run: 4, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 0.2 s',
      '[ERROR] Tests run: 7, Failures: 1, Errors: 1, Skipped: 1',
    ].join('\n');
    expect(countTests(output)).toEqual({ passed: 4, failed: 2 });
  });

  it('go test: conta os testes do modo detalhado, ou os pacotes sem ele', () => {
    const verbose =
      '--- PASS: TestA (0.00s)\n--- FAIL: TestB (0.00s)\n    --- PASS: TestB/sub (0.00s)\nFAIL';
    expect(countTests(verbose, 'go')).toEqual({ passed: 1, failed: 1 });
    const packages =
      'ok  \texemplo.com/a\t0.123s\nok  \texemplo.com/b\t(cached)\nFAIL\texemplo.com/c\t0.5s\nFAIL';
    expect(countTests(packages, 'go')).toEqual({ passed: 2, failed: 1 });
  });

  it('sem resumo reconhecido, não devolve contagem', () => {
    expect(countTests('Error: Cannot find module express')).toBeUndefined();
    expect(countTests('')).toBeUndefined();
    // Frase solta no meio da saída não é resumo.
    expect(countTests('o log diz que 3 passed e 2 failed em algum lugar')).toBeUndefined();
  });
});

describe('verificationOf', () => {
  it('comando de teste que passou vira verification.completed, com a contagem e a duração', () => {
    const event = verificationOf(bash('pnpm test', '      Tests  12 passed (12)\n'));
    expect(event).toEqual({
      type: 'verification.completed',
      command: 'pnpm test',
      passed: 12,
      failed: 0,
      durationMs: 4187,
      output: '      Tests  12 passed (12)',
      at,
    });
  });

  it('comando de teste que falhou (PostToolUseFailure) lê a contagem do erro', () => {
    const event = verificationOf(
      record({
        hook_event_name: 'PostToolUseFailure',
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
        error: 'Exit code 1\n      Tests  1 failed | 11 passed (12)',
        is_interrupt: false,
        duration_ms: 900,
      }),
    );
    expect(event).toMatchObject({
      type: 'verification.completed',
      command: 'pnpm test',
      passed: 11,
      failed: 1,
      durationMs: 900,
    });
  });

  it('falha sem contagem legível conta como uma checagem que falhou', () => {
    const event = verificationOf(
      record({
        hook_event_name: 'PostToolUseFailure',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        error: "Exit code 1\nError: Cannot find module 'express'",
      }),
    );
    expect(event).toMatchObject({ passed: 0, failed: 1, durationMs: 0 });
  });

  it('saída com código de erro e nenhum teste falho ainda é falha', () => {
    const event = verificationOf(
      record({
        hook_event_name: 'PostToolUseFailure',
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
        error: 'Exit code 1\n      Tests  12 passed (12)\nError: Unhandled error',
      }),
    );
    expect(event).toMatchObject({ passed: 12, failed: 1 });
  });

  it('comando que passou sem contagem legível sai 0 de 0: não prova nada', () => {
    expect(verificationOf(bash('make test', 'tudo certo'))).toMatchObject({ passed: 0, failed: 0 });
  });

  it('junta a saída padrão e a de erro, e aceita o PowerShell', () => {
    const event = verificationOf(
      record({
        hook_event_name: 'PostToolUse',
        tool_name: 'PowerShell',
        tool_input: { command: 'pnpm test' },
        tool_response: { stdout: 'saída', stderr: '      Tests  3 passed (3)' },
      }),
    );
    expect(event).toMatchObject({
      passed: 3,
      failed: 0,
      output: 'saída\n      Tests  3 passed (3)',
    });
  });

  it('o comando sai numa linha só e cortado, e a saída guarda só o final', () => {
    const long = `${'linha de teste\n'.repeat(2000)}      Tests  4 passed (4)`;
    const event = verificationOf(bash(`pnpm   test\n  --reporter=dot ${'x'.repeat(500)}`, long));
    if (event?.type !== 'verification.completed') throw new Error('era para ser uma verificação');
    expect(event.command.length).toBeLessThanOrEqual(300);
    expect(event.command.startsWith('pnpm test --reporter=dot')).toBe(true);
    expect(event.output?.length).toBeLessThanOrEqual(MAX_VERIFICATION_OUTPUT_CHARS);
    expect(event.output?.endsWith('Tests  4 passed (4)')).toBe(true);
    expect(event.passed).toBe(4);
  });

  it('ignora o que não é resultado de um comando de teste', () => {
    // Outro comando.
    expect(verificationOf(bash('pnpm lint', 'ok'))).toBeUndefined();
    // Outra ferramenta.
    expect(
      verificationOf(
        record({
          hook_event_name: 'PostToolUse',
          tool_name: 'Write',
          tool_input: { command: 'pnpm test' },
          tool_response: {},
        }),
      ),
    ).toBeUndefined();
    // Antes de o comando rodar.
    expect(
      verificationOf(
        record({
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'pnpm test' },
        }),
      ),
    ).toBeUndefined();
    // Em segundo plano: o resultado ainda não existe.
    expect(
      verificationOf(
        bash('pnpm test', '', { tool_input: { command: 'pnpm test', run_in_background: true } }),
      ),
    ).toBeUndefined();
    // Interrompido pela pessoa.
    expect(
      verificationOf(
        bash('pnpm test', 'Tests  1 passed (1)', {
          tool_response: { stdout: 'Tests  1 passed (1)', interrupted: true },
        }),
      ),
    ).toBeUndefined();
    expect(
      verificationOf(
        record({
          hook_event_name: 'PostToolUseFailure',
          tool_name: 'Bash',
          tool_input: { command: 'pnpm test' },
          error: 'interrompido',
          is_interrupt: true,
        }),
      ),
    ).toBeUndefined();
    // Evento sem comando.
    expect(
      verificationOf(
        record({ hook_event_name: 'PostToolUse', tool_name: 'Bash', truncated: true }),
      ),
    ).toBeUndefined();
  });
});
