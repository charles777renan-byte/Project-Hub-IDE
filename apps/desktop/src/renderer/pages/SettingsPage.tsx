import { Navigate, NavLink, useParams } from 'react-router';
import { Bot, SlidersHorizontal, Users, type LucideIcon } from '../components/Icon';
import { AgentsSection } from '../components/settings/AgentsSection';
import { AccountsSection } from '../components/settings/AccountsSection';
import { GeneralSection } from '../components/settings/GeneralSection';
import { SETTINGS_SECTIONS, settingsPath, type SettingsSection } from '../routes';

const SECTIONS: Record<SettingsSection, { label: string; icon: LucideIcon }> = {
  contas: { label: 'Contas', icon: Users },
  agentes: { label: 'Agentes', icon: Bot },
  geral: { label: 'Geral', icon: SlidersHorizontal },
};

function isSection(value: string | undefined): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value ?? '');
}

/**
 * As Configurações do app: a navegação das seções à esquerda e a seção da rota à direita. Endereço sem seção, ou
 * com uma que não existe, cai na primeira. A página abre por uma aba própria da barra de cima (TopBar).
 */
export function SettingsPage() {
  const section = useParams()['*'];
  if (!isSection(section)) return <Navigate to={settingsPath()} replace />;
  return (
    <div className="settings">
      <h1 className="settings__title">Configurações</h1>
      <div className="settings__layout">
        <nav aria-label="Seções das configurações" className="settings__nav">
          {SETTINGS_SECTIONS.map((id) => {
            const { label, icon: SectionIcon } = SECTIONS[id];
            return (
              <NavLink key={id} to={settingsPath(id)} className="settings__nav-link">
                <SectionIcon size={16} strokeWidth={2} aria-hidden />
                {label}
              </NavLink>
            );
          })}
        </nav>
        <div className="settings__body">
          {section === 'contas' ? <AccountsSection /> : null}
          {section === 'agentes' ? <AgentsSection /> : null}
          {section === 'geral' ? <GeneralSection /> : null}
        </div>
      </div>
    </div>
  );
}
