/**
 * Ponto único dos ícones (lucide-react). Reexporta só os usados, com imports nomeados, para o bundle
 * não crescer; trocar de biblioteca depois mexe só aqui. Todo ícone é decorativo: o botão ou link que o
 * leva mantém o nome acessível dele (aria-label ou texto).
 */
export {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CirclePause,
  CircleQuestionMark,
  CircleSlash,
  Clock,
  Copy,
  CornerDownLeft,
  Eye,
  File,
  Files,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  GitBranch,
  History,
  House,
  Inbox,
  LayoutGrid,
  ListChecks,
  LoaderCircle,
  Maximize2,
  Minus,
  Minimize2,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldQuestionMark,
  SquareTerminal,
  Undo2,
  UserPen,
  X,
  Zap,
} from 'lucide-react';
export type { LucideIcon } from 'lucide-react';

/** Propriedades comuns dos ícones: 14px, traço 2, escondidos de leitores de tela. */
export const ICON_PROPS = { size: 14, strokeWidth: 2, 'aria-hidden': true } as const;
