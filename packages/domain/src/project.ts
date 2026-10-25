/** Projeto registrado no Hub, como o banco o guarda e como o repositório o devolve. */
export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  normalizedPath: string;
  description?: string;
  repositoryKind: 'git' | 'none';
  defaultBranch?: string;
  isFavorite: boolean;
  /** Usado pela RF-AGT-007. */
  trusted: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  /** Arquivado: sai da listagem principal e fica na seção de arquivados, que permite restaurar. */
  archivedAt?: string;
  /** Remoção lógica: o registro continua no banco, mas sai da listagem. */
  removedAt?: string;
  /** Grupo escolhido pela pessoa (Trabalho, Pessoal...), para agrupar a barra lateral. Sem grupo, ausente. */
  groupName?: string;
  /** Apelido curto que a interface mostra no lugar do nome da pasta. Sem apelido, ausente. */
  nickname?: string;
};

/** Dados que o usuário informa ao adicionar um projeto. O restante é preenchido pelo banco. */
export type NewProject = Omit<
  ProjectRecord,
  'isFavorite' | 'trusted' | 'updatedAt' | 'removedAt' | 'lastOpenedAt'
>;
