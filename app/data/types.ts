export type ApartmentKey = 'studio' | 'one' | 'two' | 'three';
export type EquipmentColor = 'white' | 'carbon';
export type CalculationMode = 'rooms' | 'categories' | 'manual';
export type SmartCategory = 'Свет' | 'Климат' | 'Безопасность';

export interface Apartment {
  key: ApartmentKey;
  name: string;
  area: string;
  layout: ApartmentKey;
}

export interface CatalogProduct {
  sku: string;
  name: string;
  description: string;
  price: number | null;
  image?: string | null;
  badge?: string;
  sourceRow?: number;
}

export interface ReadyRow {
  id: string;
  apartment: ApartmentKey;
  color: EquipmentColor;
  sourceName: string;
  sku: string;
  quantity: number;
  room: string;
  category: string;
  gift: boolean;
  recommended: boolean;
  sourceRow?: number;
  valid: boolean;
}

export interface ScenarioGroup {
  category: SmartCategory;
  intro: string;
  items: string[];
}

export interface SourceData {
  meta: {
    version: string;
    priceDate: string;
    currency: 'RUB';
    minimumOrder: number;
    source: string;
  };
  apartments: Apartment[];
  catalog: CatalogProduct[];
  readyRows: ReadyRow[];
  scenarios: ScenarioGroup[];
  diagnostics?: Record<string, unknown>;
}

export interface SpecificationRow extends ReadyRow {
  name: string;
  description: string;
  price: number;
  image?: string | null;
  amount: number;
}

export interface ManualHints {
  risers: number;
  radiators: number;
  switches: number;
  sockets: number;
}

export interface ConfiguratorProject {
  id: string;
  name: string;
  number: string;
  updatedAt: string;
  apartment: ApartmentKey;
  color: EquipmentColor;
  mode: CalculationMode;
  selectedRooms: Record<ApartmentKey, string[]>;
  selectedCategories: SmartCategory[];
  includeGift: boolean;
  includeLeakProtection: boolean;
  manualCart: Record<string, number>;
  manualHints: ManualHints;
}

export interface CalculationResult {
  rows: SpecificationRow[];
  devices: number;
  uniqueSku: number;
  total: number;
  categories: SmartCategory[];
  invalidSku: string[];
}

export interface ImportReport {
  valid: boolean;
  requiredSheetsFound: string[];
  missingSheets: string[];
  apartmentTypesFound: number;
  productCount: number;
  readySkuCount: number;
  missingSku: string[];
  duplicateSku: string[];
  invalidPriceSku: string[];
  externalFormulaWithoutValue: string[];
  headingIssues: string[];
  formulaIssues: string[];
  data?: SourceData;
}
