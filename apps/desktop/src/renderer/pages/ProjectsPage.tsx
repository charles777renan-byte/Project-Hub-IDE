// Estado vazio. A lista e o cadastro de projetos entram numa etapa seguinte; até lá o botão fica
// desabilitado.
export function ProjectsPage() {
  return (
    <>
      <h1>Projetos</h1>
      <p>Nenhum projeto ainda. Adicione uma pasta para começar.</p>
      <button type="button" disabled>
        Adicionar projeto
      </button>
    </>
  );
}
