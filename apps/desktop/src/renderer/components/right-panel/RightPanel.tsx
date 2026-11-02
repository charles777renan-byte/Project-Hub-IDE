import * as RadixTabs from '@radix-ui/react-tabs';
import { useState } from 'react';
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
import { FilesTab } from './FilesTab';
import { RIGHT_TABS, readRightTab, saveRightTab, type RightTab } from './right-panel-state';

/** Nome acessível, dica e ícone de cada aba: a barra é só de ícones, então o nome vai no `aria-label`. */
const TAB_INFO: Record<RightTab, { label: string; icon: LucideIcon }> = {
  arquivos: { label: 'Arquivos', icon: Files },
  sessoes: { label: 'Sessões', icon: History },
  codigo: { label: 'Código-fonte', icon: GitBranch },
  checks: { label: 'Checks', icon: ListChecks },
};

/** As abas que já têm conteúdo. As outras aparecem na barra, desligadas, com a dica "Em breve". */
const AVAILABLE_TABS: ReadonlySet<RightTab> = new Set<RightTab>(['arquivos']);

/** Sem editor ligado (a aba Arquivos de hoje), abrir um arquivo não faz nada. */
function ignoreOpenFile(): void {}

/**
 * O painel direito do corpo da janela: uma barra de abas só de ícones (Arquivos, Sessões, Código-fonte e Checks, num
 * `tablist` do Radix) e o conteúdo da aba escolhida. Por enquanto só Arquivos é uma aba de verdade; as outras três
 * ficam `aria-disabled` e não se selecionam, nem por clique nem pelas setas (o Radix ativa a aba que recebe o foco),
 * mas continuam focáveis, para a dica "Em breve" aparecer também no teclado. A aba escolhida é lembrada. Sem
 * projeto (o Início, por exemplo), o conteúdo é o aviso para abrir um. `onOpenFile` recebe o caminho relativo do arquivo
 * que a aba Arquivos pede para abrir.
 */
export function RightPanel({
  projectId,
  onOpenFile = ignoreOpenFile,
}: {
  projectId: string | null;
  onOpenFile?: (path: string) => void;
}) {
  const [tab, setTab] = useState<RightTab>(readRightTab);

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
            return (
              <Hint key={id} label={available ? label : 'Em breve'}>
                <RadixTabs.Trigger
                  value={id}
                  className="right-panel__tab"
                  aria-label={label}
                  aria-disabled={available ? undefined : true}
                >
                  <Icon {...ICON_PROPS} size={15} />
                </RadixTabs.Trigger>
              </Hint>
            );
          })}
        </RadixTabs.List>
        <RadixTabs.Content value={tab} className="right-panel__content">
          {projectId === null ? (
            <EmptyState icon={Folder} title="Abra um projeto para ver os arquivos" />
          ) : tab === 'arquivos' ? (
            <FilesTab projectId={projectId} onOpenFile={onOpenFile} />
          ) : (
            <EmptyState icon={TAB_INFO[tab].icon} title="Em breve" />
          )}
        </RadixTabs.Content>
      </aside>
    </RadixTabs.Root>
  );
}
