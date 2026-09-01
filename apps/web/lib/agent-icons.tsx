import {
  faShieldHalved,
  faServer,
  faChartLine,
  faScaleBalanced,
  faHandshake,
  faBuilding,
  faCoins,
  faRocket,
  faUsers,
  faBriefcase,
  faGavel,
  faLeaf,
  faNetworkWired,
  faLock,
  faBug,
  faCloud,
  faWifi,
  faLaptopCode,
  faDatabase,
  faChartPie,
  faGlobe,
  faLightbulb,
  faWrench,
  faHardHat,
  faTruck,
  faHouse,
  faCity,
  faMap,
  faFileContract,
  faUserTie,
  faHeadset,
  faStar,
  faCrown,
  faBrain,
  faRobot,
  faMicrochip,
  faKey,
  faBell,
  faFlag,
  faCompass,
  faClipboardList,
  faChartBar,
  faSeedling,
  faRecycle,
  faSun,
  faBolt,
  faMoneyBillTrendUp,
  faPeopleGroup,
  faMagnifyingGlassChart,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

/**
 * Ícones curados pra conselheiros (padrão + custom) — não é a biblioteca
 * inteira do Font Awesome (milhares de ícones), é um conjunto pequeno o
 * bastante pra virar uma grade clicável de verdade. `iconKey` é o que fica
 * salvo em `agent_profile.icon_key`; null/desconhecido cai no emoji
 * (`agent-display.ts`), nunca quebra a tela.
 */
export const AGENT_ICONS: Record<string, IconDefinition> = {
  'shield-halved': faShieldHalved,
  server: faServer,
  'chart-line': faChartLine,
  'scale-balanced': faScaleBalanced,
  handshake: faHandshake,
  building: faBuilding,
  coins: faCoins,
  rocket: faRocket,
  users: faUsers,
  briefcase: faBriefcase,
  gavel: faGavel,
  leaf: faLeaf,
  'network-wired': faNetworkWired,
  lock: faLock,
  bug: faBug,
  cloud: faCloud,
  wifi: faWifi,
  'laptop-code': faLaptopCode,
  database: faDatabase,
  'chart-pie': faChartPie,
  globe: faGlobe,
  lightbulb: faLightbulb,
  wrench: faWrench,
  'hard-hat': faHardHat,
  truck: faTruck,
  house: faHouse,
  city: faCity,
  map: faMap,
  'file-contract': faFileContract,
  'user-tie': faUserTie,
  headset: faHeadset,
  star: faStar,
  crown: faCrown,
  brain: faBrain,
  robot: faRobot,
  microchip: faMicrochip,
  key: faKey,
  bell: faBell,
  flag: faFlag,
  compass: faCompass,
  'clipboard-list': faClipboardList,
  'chart-bar': faChartBar,
  seedling: faSeedling,
  recycle: faRecycle,
  sun: faSun,
  bolt: faBolt,
  'money-bill-trend-up': faMoneyBillTrendUp,
  'people-group': faPeopleGroup,
  'magnifying-glass-chart': faMagnifyingGlassChart,
};

export const AGENT_ICON_KEYS = Object.keys(AGENT_ICONS);

/** Renderiza o ícone escolhido (Font Awesome, com cor opcional) OU o emoji de fallback — nunca os dois. */
export function AgentIcon({
  iconKey,
  iconColor,
  emoji,
  className,
}: {
  iconKey: string | null | undefined;
  /** Só vale com iconKey — emoji mantém a cor própria dele, não dá pra tingir. */
  iconColor?: string | null;
  emoji: string;
  className?: string;
}) {
  const icon = iconKey ? AGENT_ICONS[iconKey] : undefined;
  if (icon) {
    return (
      <FontAwesomeIcon
        icon={icon}
        className={className}
        style={iconColor ? { color: iconColor } : undefined}
        aria-hidden="true"
      />
    );
  }
  return (
    <span aria-hidden="true" className={className}>
      {emoji}
    </span>
  );
}
