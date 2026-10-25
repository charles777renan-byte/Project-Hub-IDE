/** Imagens do renderer. O import devolve o endereço do arquivo, que o Vite põe no build. */
declare module '*.png' {
  const url: string;
  export default url;
}
