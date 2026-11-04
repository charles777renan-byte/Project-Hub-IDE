import * as RadixTabs from '@radix-ui/react-tabs';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { openFile, type FileMode } from '../../open-files';
import { projectViewFromParams } from '../../project-views';
import { projectViewPath, workspacePath } from '../../routes';
import { useGithubPanel } from '../../use-github-panel';
import { EmptyState } from '../EmptyState';
import { Hint } from '../Hint';
import {
  Files,
  Folder,
  GitBranch,
  History,
  ICON_PROPS,
  ListChecks,
  type LucideIcon,
} from '../Icon';
import { checksDot } from './checks-dot';
import { ChecksTab } from './ChecksTab';
import { FilesTab } from './FilesTab';
import { GitTab } from './GitTab';
import { RIGHT_TABS, readRightTab, saveRightTab, type RightTab } from './right-panel-state';

/** Nome acessível, dica e ícone de cada aba: a barra é só de ícones, então o nome vai no `aria-label`. */
const TAB_INFO: Record<RightTab, { label: string; icon: LucideIcon }> = {
  arquivos: { label: 'Arquivos', icon: Files },
  sessoes: { label: 'Sessões', icon: History },
  codigo: { label: 'Código-fonte', icon: GitBranch },
  checks: { label: 'Checks', icon: ListChecks },
};

/** As abas que já têm conteúdo. Sessões aparece na barra desligada, com a dica "Em breve". */
const AVAILABLE_TABS: ReadonlySet<RightTab> = new Set<RightTab>(['arquivos', 'codigo', 'checks']);

/**
 * O painel direito do corpo da janela: uma barra de abas só de ícones (Arquivos, Sessões, Código-fonte e Checks, num
 * `tablist` do Radix) e o conteúdo da aba escolhida. Arquivos, Código-fonte e Checks são abas de verdade; Sessões
 * fica `aria-disabled` e não se seleciona, nem por clique nem pelas setas (o Radix ativa a aba que recebe o foco),
 * mas continua focável, para a dica "Em breve" aparecer também no teclado. A aba escolhida é lembrada. Sem
 * projeto (o Início, por exemplo), o conteúdo é o aviso para abrir um. A aba Checks leva um ponto de estado na barra
 * (`checksDot`) quando o PR tem checks. Um arquivo que a aba Arquivos pede para abrir
 * entra nos arquivos abertos do projeto (`openFile`) e a rota vai para a visão Terminais dele, onde as abas moram,
 * se já não estiver lá. `onOpenFile` só existe para os testes injetarem um espião no lugar disso.
 */
export function RightPanel({
  projectId,
  onOpenFile,
}: {
  projectId: string | null;
  onOpenFile?: (path: string, mode?: FileMode) => void;
}) {
  const [tab, setTab] = useState<RightTab>(readRightTab);
  const location = useLocation();
  const navigate = useNavigate();
  // O PR é dado do painel, não da aba: o ponto de estado da barra precisa dele com a aba fechada. É chamado uma
  // vez, aqui; a aba Checks lê o retorno (e o ponto da barra, depois). A releitura de 30 s só vale com a aba visível.
  const github = useGithubPanel(projectId, tab === 'checks');

  function open(project: string, path: string, mode?: FileMode) {
    if (mode === undefined) openFile(project, path);
    else openFile(project, path, { mode });
    const here =
      location.pathname === workspacePath(project) &&
      projectViewFromParams(new URLSearchParams(location.search)) === 'terminais';
    if (!here) navigate(projectViewPath(project, 'terminais'), { replace: true });
  }

  function choose(value: string) {
    const next = RIGHT_TABS.find((item) => item === value);
    if (next === undefined || !AVAILABLE_TABS.has(next)) return;
    setTab(next);
    saveRightTab(next);
  }

  return (
    <RadixTabs.Root asChild value={tab} onValueChange={choose}>
      <aside className="right-panel" aria-label="Painel direito">
        <RadixTabs.List aria-label="Painéis laterais" className="right-panel__tabs">
          {RIGHT_TABS.map((id) => {
            const { label, icon: Icon } = TAB_INFO[id];
            const available = AVAILABLE_TABS.has(id);
            // O ponto só existe na aba Checks, e o estado vai também no texto do nome e da dica (nunca só na cor).
            const dot = id === 'checks' ? checksDot(github.state) : null;
            const name = dot?.label ?? label;
            return (
              <Hint key={id} label={available ? name : 'Em breve'}>
                <RadixTabs.Trigger
                  value={id}
                  className="right-panel__tab"
                  aria-label={name}
                  aria-disabled={available ? undefined : true}
                >
                  <Icon {...ICON_PROPS} size={15} />
                  {dot === null ? null : (
                    <span
                      aria-hidden="true"
                      className={`right-panel__dot right-panel__dot--${dot.tone}`}
                    />
                  )}
                </RadixTabs.Trigger>
              </Hint>
            );
          })}
        </RadixTabs.List>
        <RadixTabs.Content value={tab} className="right-panel__content">
          {tab === 'codigo' ? (
            <GitTab
              projectId={projectId}
              active={tab === 'codigo'}
              {...(projectId === null
                ? {}
                : {
                    onOpenFile: (path: string, mode: FileMode) =>
                      onOpenFile === undefined
                        ? open(projectId, path, mode)
                        : onOpenFile(path, mode),
                  })}
            />
          ) : projectId === null ? (
            <EmptyState icon={Folder} title="Abra um projeto para ver os arquivos" />
          ) : tab === 'arquivos' ? (
            <FilesTab
              projectId={projectId}
              onOpenFile={onOpenFile ?? ((path) => open(projectId, path))}
            />
          ) : tab === 'checks' ? (
            <ChecksTab projectId={projectId} github={github} />
          ) : (
            <EmptyState icon={TAB_INFO[tab].icon} title="Em breve" />
          )}
        </RadixTabs.Content>
      </aside>
    </RadixTabs.Root>
  );
}
