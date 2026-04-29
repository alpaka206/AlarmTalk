import { useMemo } from 'react';
import {
  House,
  Microphone,
  Alarm,
  EnvelopeSimple,
  Bell,
  User,
  Plus,
  CaretRight,
  CaretLeft,
  CaretDown,
  CaretUp,
  Check,
  X,
  Trash,
  PencilSimple,
  Gear,
  MagnifyingGlass,
  Heart,
  Star,
  Play,
  Pause,
  StopCircle,
  Tree,
  Plant,
  Flower,
  Flame,
  type IconProps,
  type IconWeight,
} from 'phosphor-react-native';
import { useTheme } from '../hooks/useTheme';

/**
 * Centralised icon set so screens never depend on phosphor directly.
 * - Default weight is `duotone` per the new design guide (Phase 3).
 * - Stroke color comes from `secondary` token (deep navy / lifted navy);
 *   duotone fill comes from `primary` (mustard) at 35% opacity.
 * - 24×24 viewBox via `size` prop (default 24, snapped to a sane min).
 */
export type AppIconName =
  | 'home'
  | 'mic'
  | 'alarm'
  | 'message'
  | 'bell'
  | 'user'
  | 'plus'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'chevronUp'
  | 'check'
  | 'close'
  | 'trash'
  | 'edit'
  | 'settings'
  | 'search'
  | 'heart'
  | 'star'
  | 'play'
  | 'pause'
  | 'stop'
  // Character growth stages
  | 'acorn'
  | 'sprout'
  | 'tree'
  | 'flower'
  | 'flame';

const ICONS: Record<AppIconName, React.ComponentType<IconProps>> = {
  home: House,
  mic: Microphone,
  alarm: Alarm,
  message: EnvelopeSimple,
  bell: Bell,
  user: User,
  plus: Plus,
  chevronRight: CaretRight,
  chevronLeft: CaretLeft,
  chevronDown: CaretDown,
  chevronUp: CaretUp,
  check: Check,
  close: X,
  trash: Trash,
  edit: PencilSimple,
  settings: Gear,
  search: MagnifyingGlass,
  heart: Heart,
  star: Star,
  play: Play,
  pause: Pause,
  stop: StopCircle,
  // Character stages — phosphor lacks a true acorn glyph, fall back to Plant
  // for stage 0 and let the plant→tree→flower progression carry the metaphor.
  acorn: Plant,
  sprout: Plant,
  tree: Tree,
  flower: Flower,
  flame: Flame,
};

export interface AppIconProps {
  name: AppIconName;
  size?: number;
  /** Override stroke color (defaults to theme secondary). */
  color?: string;
  /** Override duotone fill color (defaults to theme primary). */
  duotoneColor?: string;
  /** Phosphor weight — defaults to "duotone". */
  weight?: IconWeight;
}

export function AppIcon({
  name,
  size = 24,
  color,
  duotoneColor,
  weight = 'duotone',
}: AppIconProps) {
  const { colors } = useTheme();
  const Component = useMemo(() => ICONS[name], [name]);
  return (
    <Component
      size={Math.max(16, size)}
      color={color ?? colors.secondary}
      // Phosphor reads `duotoneColor` and `duotoneOpacity` for the fill layer.
      duotoneColor={duotoneColor ?? colors.primary}
      duotoneOpacity={0.35}
      weight={weight}
    />
  );
}
