import { useNavigate } from 'react-router';
import { ROUTE_PATHS } from '../../routes';

/**
 * Chamada principal do Início: "Nova missão". A missão nasce dentro de um projeto, então o botão leva
 * para a lista de Projetos, onde a pessoa escolhe em qual. O ícone e o botão são os únicos destaques
 * em lima da tela.
 */
export function CallToAction() {
  const navigate = useNavigate();
  return (
    <section className="home-cta" aria-labelledby="home-cta-title">
      <span className="home-cta__icon" aria-hidden="true">
        +
      </span>
      <div className="home-cta__text">
        <h2 id="home-cta-title" className="home-cta__title">
          Nova missão
        </h2>
        <p className="home-cta__hint">Descreva o trabalho e acompanhe o agente em um só lugar</p>
      </div>
      <button
        type="button"
        className="btn-primary home-cta__button"
        onClick={() => navigate(ROUTE_PATHS.projects)}
      >
        Começar →
      </button>
    </section>
  );
}
