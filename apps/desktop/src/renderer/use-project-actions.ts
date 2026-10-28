import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '@project-hub/contracts';
import { notify } from './notify';
import { ADD_PROJECT_REQUEST_EVENT, PROJECTS_CHANGED_EVENT } from './projects-events';

const GENERIC_ERROR = 'Não foi possível concluir a ação. Tente de novo.';

export type ProjectActions = {
  /** Projetos arquivados, lidos do processo principal. Vazio enquanto não chegam ou se a leitura falhar. */
  archived: ProjectSummary[];
  /** Se o cadastro de um projeto está em andamento (o botão fica desabilitado). */
  adding: boolean;
  /** A mensagem da última ação que falhou pelos botões da barra, ou `null`. */
  error: string | null;
  /** Abre o seletor de pasta e cadastra o projeto escolhido. Cancelar o seletor não faz nada. */
  addProject: () => Promise<void>;
  /** Tira o projeto dos arquivados e o devolve à lista. Diz se deu certo (o erro fica em `error`). */
  restoreProject: (projectId: string) => Promise<boolean>;
};

/**
 * As ações de projeto da barra lateral: adicionar uma pasta pelo seletor, listar os arquivados e restaurá-los.
 * Toda falha vira a mensagem da API ou, se a chamada ao processo principal quebrar, uma mensagem geral. Depois
 * de cadastrar ou restaurar, o hook avisa a janela por `PROJECTS_CHANGED_EVENT`: a lista de projetos da
 * barra recarrega por ela, e a dos arquivados também, o que cobre quem arquivou um projeto em outra tela. O
 * pedido `ADD_PROJECT_REQUEST_EVENT` (paleta, menu "+") faz o mesmo que o botão, com uma regra para a falha: quem
 * clicou no botão da barra vê o alerta embaixo dele (`error`); quem pediu de fora vê um aviso (`notify.error`),
 * porque a barra pode estar recolhida e o alerta ficaria invisível. Nunca os dois para o mesmo pedido.
 */
export function useProjectActions(): ProjectActions {
  const [archived, setArchived] = useState<ProjectSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const loadId = useRef(0);

  const loadArchived = useCallback(async () => {
    const id = ++loadId.current;
    try {
      const result = await window.projectHub.projects.listArchived();
      if (id === loadId.current && result.ok) setArchived(result.data);
    } catch {
      // Sem a leitura, a seção Arquivados só não aparece: a lista de projetos mostra a falha de conexão.
    }
  }, []);

  useEffect(() => {
    void loadArchived();
    const reload = () => void loadArchived();
    window.addEventListener(PROJECTS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, reload);
  }, [loadArchived]);

  const runAdd = useCallback(async (fromRequest: boolean) => {
    if (busy.current) return;
    busy.current = true;
    setAdding(true);
    setError(null);
    const fail = (message: string) => (fromRequest ? notify.error(message) : setError(message));
    try {
      const chosen = await window.projectHub.projects.chooseDirectory();
      if (!chosen.ok) {
        fail(chosen.error.message);
        return;
      }
      if (chosen.data === null) return;

      const added = await window.projectHub.projects.add({ path: chosen.data.path });
      if (!added.ok) {
        fail(added.error.message);
        return;
      }
      window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    } catch {
      fail(GENERIC_ERROR);
    } finally {
      busy.current = false;
      setAdding(false);
    }
  }, []);

  const addProject = useCallback(() => runAdd(false), [runAdd]);

  useEffect(() => {
    const request = () => void runAdd(true);
    window.addEventListener(ADD_PROJECT_REQUEST_EVENT, request);
    return () => window.removeEventListener(ADD_PROJECT_REQUEST_EVENT, request);
  }, [runAdd]);

  const restoreProject = useCallback(async (projectId: string) => {
    setError(null);
    try {
      const result = await window.projectHub.projects.unarchive(projectId);
      if (!result.ok) {
        setError(result.error.message);
        return false;
      }
    } catch {
      setError(GENERIC_ERROR);
      return false;
    }
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    return true;
  }, []);

  return { archived, adding, error, addProject, restoreProject };
}
