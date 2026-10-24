import { NavLink } from 'react-router';
import { NAV_ITEMS, ROUTE_PATHS } from '../routes';
import { FolderGit2, House, ICON_PROPS } from './Icon';

const ICONS = {
  [ROUTE_PATHS.home]: House,
  [ROUTE_PATHS.projects]: FolderGit2,
} as const;

/**
 * Navegação principal: os `NAV_ITEMS` como links, com `aria-current="page"` no da página atual (o
 * NavLink faz isso). Fica na coluna lateral, acima da barra de projetos. O ícone é decorativo: o nome
 * do link continua sendo só o texto.
 */
export function MainNav() {
  return (
    <nav aria-label="Principal" className="main-nav">
      <ul className="main-nav__list">
        {NAV_ITEMS.map(({ to, label }) => {
          const Glyph = ICONS[to];
          return (
            <li key={to}>
              <NavLink to={to}>
                <Glyph {...ICON_PROPS} />
                {label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
