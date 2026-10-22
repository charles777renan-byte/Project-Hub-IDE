import { NavLink } from 'react-router';
import { NAV_ITEMS } from '../routes';

/**
 * Navegação principal: os `NAV_ITEMS` como links, com `aria-current="page"` no da página atual (o
 * NavLink faz isso). Fica na coluna lateral, acima da barra de projetos.
 */
export function MainNav() {
  return (
    <nav aria-label="Principal" className="main-nav">
      <ul className="main-nav__list">
        {NAV_ITEMS.map(({ to, label }) => (
          <li key={to}>
            <NavLink to={to}>{label}</NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
