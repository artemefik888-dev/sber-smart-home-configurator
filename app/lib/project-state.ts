import type {
  ApartmentKey,
  CalculationMode,
  ConfiguratorProject,
  EquipmentColor,
  ManualRoom,
  ReadyCalculationMode,
  SmartCategory,
  SourceData,
} from '../data/types';
import { roomsFor } from './calculations.ts';

export const MANUAL_ROOM_PLACEHOLDER = 'Назначить комнату';
export const MANUAL_ROOMS: ManualRoom[] = [
  'Прихожая/коридор',
  'Кухня',
  'Гостиная',
  'Спальня 1',
  'Спальня 2/Детская',
  'Ванная',
];
export const MANUAL_HINTS = [
  { label: 'Стояков водоснабжения', help: 'Сверьте количество зон перекрытия воды', sku: 'O2U152W1R' },
  { label: 'Радиаторов отопления', help: 'Сверьте точки управления отоплением', sku: 'SBDV-00185' },
  { label: '1-постовых выключателей, белых', help: 'Сверьте световые группы', sku: 'ATN000115Z' },
  { label: '2-постовых выключателей, белых', help: 'Сверьте световые группы', sku: 'ATN000117Z' },
  { label: '1-постовых выключателей, карбон', help: 'Сверьте световые группы', sku: 'ATN001015Z' },
  { label: '2-постовых выключателей, карбон', help: 'Сверьте световые группы', sku: 'ATN001017Z' },
  { label: 'Розеток, белый', help: 'Сверьте управляемые потребители', sku: 'ATN000145Z' },
  { label: 'Розеток, карбон', help: 'Сверьте управляемые потребители', sku: 'ATN001045Z' },
] as const;

const APARTMENTS: ApartmentKey[] = ['studio', 'one', 'two', 'three'];
const COLORS: EquipmentColor[] = ['white', 'carbon'];
const MODES: CalculationMode[] = ['rooms', 'categories', 'manual'];
const READY_MODES: ReadyCalculationMode[] = ['rooms', 'categories'];
const CATEGORIES: SmartCategory[] = ['Свет', 'Климат', 'Безопасность'];

export function defaultRoomMap(data: SourceData): Record<ApartmentKey, string[]> {
  return {
    studio: roomsFor(data, 'studio', 'white'),
    one: roomsFor(data, 'one', 'white'),
    two: roomsFor(data, 'two', 'white'),
    three: roomsFor(data, 'three', 'white'),
  };
}

export function emptyReadyQuantities(): ConfiguratorProject['readyQuantities'] {
  return { rooms: {}, categories: {} };
}

function quantities(value: unknown, keepZero: boolean) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, quantity]) => typeof quantity === 'number' && Number.isFinite(quantity) && (keepZero || quantity > 0))
      .map(([key, quantity]) => [key, Math.min(999, Math.max(keepZero ? 0 : 1, Math.floor(quantity as number)))])
  );
}

export function normalizeProject(raw: unknown, data: SourceData): ConfiguratorProject {
  const source = raw && typeof raw === 'object' ? raw as Partial<ConfiguratorProject> : {};
  const roomDefaults = defaultRoomMap(data);
  const selectedRooms = Object.fromEntries(APARTMENTS.map((key) => [
    key,
    Array.isArray(source.selectedRooms?.[key])
      ? source.selectedRooms[key].filter((room): room is string => typeof room === 'string')
      : roomDefaults[key],
  ])) as Record<ApartmentKey, string[]>;
  const manualRooms = Object.fromEntries(
    Object.entries(source.manualRooms ?? {}).filter((entry): entry is [string, ManualRoom] => MANUAL_ROOMS.includes(entry[1] as ManualRoom)),
  );
  const readyQuantities = Object.fromEntries(READY_MODES.map((mode) => [
    mode,
    quantities(source.readyQuantities?.[mode], true),
  ])) as ConfiguratorProject['readyQuantities'];
  const now = new Date();

  return {
    schemaVersion: 2,
    id: typeof source.id === 'string' ? source.id : `project-${Date.now()}`,
    name: typeof source.name === 'string' ? source.name : 'Новый проект',
    number: typeof source.number === 'string'
      ? source.number
      : `SH-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now.toISOString(),
    apartment: APARTMENTS.includes(source.apartment as ApartmentKey) ? source.apartment as ApartmentKey : 'studio',
    color: COLORS.includes(source.color as EquipmentColor) ? source.color as EquipmentColor : 'white',
    mode: MODES.includes(source.mode as CalculationMode) ? source.mode as CalculationMode : 'rooms',
    selectedRooms,
    selectedCategories: Array.isArray(source.selectedCategories)
      ? source.selectedCategories.filter((category): category is SmartCategory => CATEGORIES.includes(category as SmartCategory))
      : [...CATEGORIES],
    includeGift: typeof source.includeGift === 'boolean' ? source.includeGift : true,
    includeLeakProtection: typeof source.includeLeakProtection === 'boolean' ? source.includeLeakProtection : false,
    manualCart: quantities(source.manualCart, false),
    manualRooms,
    readyQuantities,
  };
}
