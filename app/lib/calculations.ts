import type {
  ApartmentKey,
  CalculationMode,
  CalculationResult,
  EquipmentColor,
  ReadyRow,
  SmartCategory,
  SourceData,
  SpecificationRow,
} from '../data/types';

const SMART_CATEGORIES: SmartCategory[] = ['Свет', 'Климат', 'Безопасность'];

export function roomsFor(data: SourceData, apartment: ApartmentKey, color: EquipmentColor): string[] {
  return Array.from(
    new Set(
      data.readyRows
        .filter((row) => row.apartment === apartment && row.color === color && !row.recommended)
        .map((row) => row.room),
    ),
  );
}

export function categoriesForSku(data: SourceData, sku: string): SmartCategory[] {
  return Array.from(
    new Set(
      data.readyRows
        .filter((row) => row.sku === sku && SMART_CATEGORIES.includes(row.category as SmartCategory))
        .map((row) => row.category as SmartCategory),
    ),
  );
}

function hydrateRows(data: SourceData, rows: ReadyRow[]): { rows: SpecificationRow[]; invalidSku: string[] } {
  const catalog = new Map(data.catalog.map((product) => [product.sku, product]));
  const invalidSku = new Set<string>();
  const hydrated: SpecificationRow[] = [];
  for (const row of rows) {
    const product = catalog.get(row.sku);
    if (!product || typeof product.price !== 'number' || !Number.isFinite(product.price)) {
      invalidSku.add(row.sku);
      continue;
    }
    hydrated.push({
      ...row,
      name: product.name,
      description: product.description,
      image: product.image,
      price: product.price,
      amount: product.price * row.quantity,
      valid: true,
    });
  }
  return { rows: hydrated, invalidSku: Array.from(invalidSku) };
}

function finish(rows: SpecificationRow[], invalidSku: string[]): CalculationResult {
  const categories = Array.from(
    new Set(rows.map((row) => row.category).filter((value): value is SmartCategory => SMART_CATEGORIES.includes(value as SmartCategory))),
  );
  return {
    rows,
    devices: rows.reduce((sum, row) => sum + row.quantity, 0),
    uniqueSku: new Set(rows.map((row) => row.sku)).size,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
    categories,
    invalidSku,
  };
}

export function calculateReady(
  data: SourceData,
  options: {
    apartment: ApartmentKey;
    color: EquipmentColor;
    mode: Exclude<CalculationMode, 'manual'>;
    selectedRooms: string[];
    selectedCategories: SmartCategory[];
    includeGift: boolean;
    includeLeakProtection: boolean;
  },
): CalculationResult {
  const variant = data.readyRows.filter(
    (row) => row.apartment === options.apartment && row.color === options.color,
  );
  const selected = variant.filter((row) => {
    if (row.gift && !options.includeGift) return false;
    if (options.mode === 'rooms') {
      return row.recommended
        ? options.includeLeakProtection
        : options.selectedRooms.includes(row.room);
    }
    if (row.recommended) {
      return options.selectedCategories.includes('Безопасность') || options.includeLeakProtection;
    }
    return options.selectedCategories.includes(row.category as SmartCategory);
  });
  const uniqueBySource = Array.from(new Map(selected.map((row) => [row.id, row])).values());
  const hydrated = hydrateRows(data, uniqueBySource);
  return finish(hydrated.rows, hydrated.invalidSku);
}

export function calculateManual(data: SourceData, cart: Record<string, number>): CalculationResult {
  const sourceRows: ReadyRow[] = Object.entries(cart)
    .filter(([, quantity]) => quantity > 0)
    .map(([sku, quantity]) => {
      const sourceCategories = categoriesForSku(data, sku);
      const product = data.catalog.find((item) => item.sku === sku);
      return {
        id: `manual-${sku}`,
        apartment: 'studio',
        color: 'white',
        sourceName: product?.name ?? sku,
        sku,
        quantity,
        room: 'Ручная комплектация',
        category: sourceCategories[0] ?? product?.description ?? 'Каталог',
        gift: false,
        recommended: false,
        valid: true,
      };
    });
  const hydrated = hydrateRows(data, sourceRows);
  return finish(hydrated.rows, hydrated.invalidSku);
}

export function aggregateBySku(result: CalculationResult) {
  const map = new Map<string, { sku: string; name: string; quantity: number; amount: number }>();
  for (const row of result.rows) {
    const current = map.get(row.sku) ?? { sku: row.sku, name: row.name, quantity: 0, amount: 0 };
    current.quantity += row.quantity;
    current.amount += row.amount;
    map.set(row.sku, current);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

export function scenarioGroupsFor(data: SourceData, result: CalculationResult) {
  return data.scenarios.filter((group) => result.categories.includes(group.category));
}

export function hasHubWarning(result: CalculationResult) {
  return result.devices > 0 && !result.rows.some((row) => row.sku === 'SBDV-00068');
}
