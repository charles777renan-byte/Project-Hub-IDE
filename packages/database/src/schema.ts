import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    normalizedPath: text('normalized_path').notNull().unique(),
    description: text('description'),
    repositoryKind: text('repository_kind', { enum: ['git', 'none'] }).notNull(),
    defaultBranch: text('default_branch'),
    isFavorite: integer('is_favorite', { mode: 'boolean' })
      .notNull()
      .default(sql`0`),
    trusted: integer('trusted', { mode: 'boolean' })
      .notNull()
      .default(sql`0`),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastOpenedAt: text('last_opened_at'),
    removedAt: text('removed_at'),
  },
  (table) => [
    check('projects_repository_kind_check', sql`${table.repositoryKind} IN ('git', 'none')`),
  ],
);

export const schema = { projects };
