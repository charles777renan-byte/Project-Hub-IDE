const HINT = 'Conta por chave de API, cobrada por uso';

/**
 * O selo "API" ao lado do nome de uma conta por chave de API: na lista de Contas e em todo seletor de conta. É um
 * fato da conta (ela cobra por uso), dito por texto e contorno, sem cor de alerta.
 */
export function ApiBadge() {
  return (
    <span className="api-badge" title={HINT}>
      API
    </span>
  );
}
