import { z } from 'zod';

/**
 * Perfil local: o nome que a saudação do Início usa. Fica só neste computador; não há conta nem servidor.
 * `displayName` é `null` quando a pessoa ainda não informou um.
 */
export const profileDtoSchema = z.object({ displayName: z.string().nullable() });

export type ProfileDto = z.infer<typeof profileDtoSchema>;

/**
 * Entrada de `profile:set-display-name:v1`. `name` nulo ou vazio tira o nome. O limite de 40 caracteres
 * vale depois de aparar os espaços, como o do grupo do projeto.
 */
export const setDisplayNameInputSchema = z.object({
  name: z.string().trim().max(40).nullable(),
});

export type SetDisplayNameInput = z.infer<typeof setDisplayNameInputSchema>;
