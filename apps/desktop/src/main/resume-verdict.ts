import type { SessionProvider } from '@project-hub/contracts';
import { resumeArgs, type ProviderRegistry } from './providers';

/** O que a lista e a retomada precisam saber de uma sessão para dizer se ela pode ser retomada agora. */
export type ResumeCheckInput = {
  id: string;
  provider: SessionProvider;
  /** Pasta de trabalho da sessão: é nela que o programa retoma a conversa. */
  folder: string;
  /** Projeto que contém a pasta (o mais específico), ou `null` quando nenhum projeto aberto contém. */
  projectId: string | null;
  /**
   * Projeto de onde a retomada sairia (o do workspace ativo). `undefined`: a lista não tem um projeto de referência,
   * e então a regra de projeto não se aplica.
   */
  activeProjectId: string | undefined;
};

export type ResumeVerdict = { resumable: boolean; resumeBlockedReason: string | null };

export type ResumeVerdictDeps = {
  folderExists: (folder: string) => boolean;
  providers: Pick<ProviderRegistry, 'list' | 'resolve'>;
  /** Nome do projeto pelo id; `undefined` quando o projeto já não existe. */
  projectName: (projectId: string) => string | undefined;
  /** Relógio do cache de instalação; padrão: a hora atual. */
  now?: () => number;
};

/** Quanto tempo um programa encontrado (ou não) vale. Procurar no PATH a cada sessão da lista seria caro. */
const AVAILABILITY_TTL_MS = 10_000;
/** Nome de projeto no motivo: corta antes que o texto passe do limite do contrato. */
const NAME_MAX = 120;

/**
 * Se uma sessão pode ser retomada agora, e o motivo quando não pode. A ordem importa: primeiro o que o programa não
 * faz, depois a pasta, o programa instalado e por fim o projeto. A lista usa a função para o botão; o `resumeSession`
 * confere de novo antes de abrir o terminal. A instalação do programa fica em cache por `AVAILABILITY_TTL_MS`.
 */
export function createResumeVerdict(
  deps: ResumeVerdictDeps,
): (input: ResumeCheckInput) => ResumeVerdict {
  const now = deps.now ?? Date.now;
  const availability = new Map<SessionProvider, { at: number; reason: string | undefined }>();

  /** Motivo de o programa não abrir (`undefined` quando abre). */
  function unavailableReason(provider: SessionProvider): string | undefined {
    const at = now();
    const last = availability.get(provider);
    if (last !== undefined && at - last.at < AVAILABILITY_TTL_MS) return last.reason;
    const resolution = deps.providers.resolve(provider);
    const reason = resolution.ok ? undefined : resolution.reason;
    availability.set(provider, { at, reason });
    return reason;
  }

  return (input) => {
    const blocked = (reason: string): ResumeVerdict => ({
      resumable: false,
      resumeBlockedReason: reason,
    });

    if (resumeArgs(input.provider, input.id) === undefined) {
      const label = deps.providers.list().find((info) => info.id === input.provider)?.label;
      return blocked(`${label ?? input.provider} não tem comando para retomar uma sessão.`);
    }
    if (!deps.folderExists(input.folder)) {
      return blocked('A pasta da sessão não existe mais.');
    }
    const missing = unavailableReason(input.provider);
    if (missing !== undefined) return blocked(missing);

    if (input.activeProjectId !== undefined && input.projectId !== input.activeProjectId) {
      if (input.projectId === null) {
        return blocked('A pasta desta sessão não está em nenhum projeto aberto.');
      }
      const name = deps.projectName(input.projectId);
      return blocked(
        name === undefined
          ? 'Esta sessão é de outro projeto. Abra esse projeto para retomá-la.'
          : `Esta sessão é do projeto "${name.slice(0, NAME_MAX)}". Abra esse projeto para retomá-la.`,
      );
    }
    return { resumable: true, resumeBlockedReason: null };
  };
}
