import type { ProviderId } from '@project-hub/contracts';

/**
 * Ícone de cada programa no menu de terminais. Claude Code usa o logo oficial do pacote
 * simple-icons (CC0), na cor da marca. O Antigravity usa a marca oficial dele (ver AntigravityArtwork). O Codex
 * e o OpenCode usam ícones do pacote @lobehub/icons-static-svg (MIT), em tom único. O Freebuff é a marca do favicon
 * dele redesenhada em vetor. O PowerShell é desenho próprio. São SVG inline com atributos de apresentação (fill, stroke); nada de atributo
 * `style`, que a CSP do app bloquearia.
 */
const CLAUDE_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';
/** Ícone do Codex do pacote @lobehub/icons-static-svg (MIT), em tom único: segue a cor do texto do contêiner. */
const CODEX_PATH =
  'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z';
/** Ícone do OpenCode do pacote @lobehub/icons-static-svg 1.102.0 (MIT), em tom único. */
const OPENCODE_PATH = 'M16 6H8v12h8V6zm4 16H4V2h16v20z';
/**
 * A marca do Freebuff (o "F" de blocos do favicon de freebuff.com), medida no PNG de 180 px e redesenhada em vetor
 * no quadro de 24. O site só publica o favicon em imagem, sem SVG.
 */
const FREEBUFF_PATH = 'M2 2h20v5H7v15H2zm6.4 6.4h10.2v5h-5v8.6H8.4z';

/**
 * A marca oficial do Antigravity (favicon.svg de antigravity.google), sem o círculo branco de fundo. Três ajustes para
 * a CSP do app: a máscara do original vira `clipPath` (o `mask-type` seria um atributo `style`), o `<style>` do modo
 * escuro sai, e o conjunto é recortado para a marca (viewBox 18 18 100 100 do original de 136) e encolhido a 24.
 */
function AntigravityArtwork() {
  const blur = (
    id: string,
    deviation: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => (
    <filter
      id={id}
      x={x}
      y={y}
      width={width}
      height={height}
      filterUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      <feGaussianBlur stdDeviation={deviation} />
    </filter>
  );
  return (
    <g transform="scale(0.24) translate(-18 -18)">
      <g transform="translate(12 10)">
        <path
          d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z"
          fill="#3186FF"
        />
        <clipPath id="antigravity-mark">
          <path d="M89.6992 93.695C94.3659 97.195 101.366 94.8617 94.9492 88.445C75.6992 69.7783 79.7825 18.445 55.8659 18.445C31.9492 18.445 36.0325 69.7783 16.7825 88.445C9.78251 95.445 17.3658 97.195 22.0325 93.695C40.1159 81.445 38.9492 59.8617 55.8659 59.8617C72.7825 59.8617 71.6159 81.445 89.6992 93.695Z" />
        </clipPath>
        <g clipPath="url(#antigravity-mark)">
          <g filter="url(#antigravity-blur-0)">
            <ellipse
              cx={22.7873}
              cy={26.8098}
              rx={22.7873}
              ry={26.8098}
              transform="matrix(-0.112784 0.99362 -0.99362 -0.112781 66.2473 -15.5344)"
              fill="#FFE432"
            />
          </g>
          <g filter="url(#antigravity-blur-1)">
            <ellipse
              cx={96.491}
              cy={35.1231}
              rx={29.5007}
              ry={30.1492}
              transform="rotate(76.9243 96.491 35.1231)"
              fill="#FC413D"
            />
          </g>
          <g filter="url(#antigravity-blur-2)">
            <ellipse
              cx={9.02988}
              cy={41.6647}
              rx={30.832}
              ry={39.9417}
              transform="rotate(74.1257 9.02988 41.6647)"
              fill="#00B95C"
            />
          </g>
          <g filter="url(#antigravity-blur-3)">
            <ellipse
              cx={11.2212}
              cy={42.8915}
              rx={30.22}
              ry={33.2695}
              transform="rotate(45.6065 11.2212 42.8915)"
              fill="#00B95C"
            />
          </g>
          <g filter="url(#antigravity-blur-4)">
            <ellipse
              cx={75.7546}
              cy={104.822}
              rx={29.0177}
              ry={27.943}
              transform="rotate(76.9243 75.7546 104.822)"
              fill="#3186FF"
            />
          </g>
          <g filter="url(#antigravity-blur-5)">
            <ellipse
              cx={33.5661}
              cy={35.4043}
              rx={33.5661}
              ry={35.4043}
              transform="matrix(-0.409539 0.912293 -0.912294 -0.409537 101.25 -15.1674)"
              fill="#FBBC04"
            />
          </g>
          <g filter="url(#antigravity-blur-6)">
            <path
              d="M2.56802 149.695C-15.8116 142.48 15.5987 83.1163 23.4093 63.2203C31.22 43.3244 52.4514 33.0447 70.831 40.26C89.2107 47.4753 110.996 87.2162 103.185 107.112C95.3742 127.008 20.9477 156.91 2.56802 149.695Z"
              fill="#3186FF"
            />
          </g>
          <g filter="url(#antigravity-blur-7)">
            <path
              d="M113.934 75.8079C109.013 81.5509 96.1724 78.6224 85.253 69.2667C74.3335 59.911 69.4704 47.6711 74.391 41.928C79.3116 36.185 92.1525 39.1136 103.072 48.4692C113.991 57.8249 118.855 70.0648 113.934 75.8079Z"
              fill="#749BFF"
            />
          </g>
          <g filter="url(#antigravity-blur-8)">
            <ellipse
              cx={92.611}
              cy={23.7962}
              rx={44.2411}
              ry={27.5016}
              transform="rotate(34.0763 92.611 23.7962)"
              fill="#FC413D"
            />
          </g>
          <g filter="url(#antigravity-blur-9)">
            <ellipse
              cx={23.4949}
              cy={29.5887}
              rx={23.7071}
              ry={13.7869}
              transform="rotate(112.516 23.4949 29.5887)"
              fill="#FFEE48"
            />
          </g>
        </g>
      </g>
      <defs>
        {blur('antigravity-blur-0', '3.89034', 2.49348, -26.5423, 69.0899, 61.2525)}
        {blur('antigravity-blur-1', '18.8078', 28.7524, -32.0333, 135.477, 134.313)}
        {blur('antigravity-blur-2', '15.9884', -62.2884, -21.9253, 142.637, 127.18)}
        {blur('antigravity-blur-3', '15.9884', -52.5697, -20.8346, 127.582, 127.452)}
        {blur('antigravity-blur-4', '15.1937', 17.3619, 45.4646, 116.786, 118.715)}
        {blur('antigravity-blur-5', '13.7698', -7.44765, -60.4737, 125.303, 122.858)}
        {blur('antigravity-blur-6', '12.297', -27.7086, 13.3597, 157.119, 162.029)}
        {blur('antigravity-blur-7', '11.0036', 50.4638, 16.981, 87.3973, 83.7738)}
        {blur('antigravity-blur-8', '9.29385', 34.2604, -28.457, 116.701, 104.506)}
        {blur('antigravity-blur-9', '11.5027', -15.1522, -15.9493, 77.2941, 91.076)}
      </defs>
    </g>
  );
}

function artwork(provider: ProviderId) {
  switch (provider) {
    case 'claude':
      return <path fill="#D97757" d={CLAUDE_PATH} />;
    case 'antigravity':
      return <AntigravityArtwork />;
    case 'codex':
      return <path fill="currentColor" fillRule="evenodd" d={CODEX_PATH} />;
    case 'opencode':
      return <path fill="currentColor" fillRule="evenodd" d={OPENCODE_PATH} />;
    case 'freebuff':
      return <path fill="currentColor" d={FREEBUFF_PATH} />;
    case 'shell':
      return (
        <g
          fill="none"
          stroke="#3d8bff"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7l6 5-6 5" />
          <path d="M13 18h6" />
        </g>
      );
  }
}

export function ProviderIcon({ provider, size = 18 }: { provider: ProviderId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {artwork(provider)}
    </svg>
  );
}
