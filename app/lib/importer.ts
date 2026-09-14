'use client';

import * as XLSX from 'xlsx';
import type {
  Apartment,
  CatalogProduct,
  EquipmentColor,
  ImportReport,
  ReadyRow,
  SourceData,
} from '../data/types';

const REQUIRED_APARTMENT_SHEETS = [
  'Студия 30 м²',
  '1-к квартира 40 м²',
  '2-к квартира 60 м²',
  '3-к квартира 65-75 м²',
] as const;

const APARTMENTS: Record<(typeof REQUIRED_APARTMENT_SHEETS)[number], Apartment> = {
  'Студия 30 м²': { key: 'studio', name: 'Студия', area: '30 м²', layout: 'studio' },
  '1-к квартира 40 м²': { key: 'one', name: 'Однокомнатная квартира', area: '40 м²', layout: 'one' },
  '2-к квартира 60 м²': { key: 'two', name: 'Двухкомнатная квартира', area: '60 м²', layout: 'two' },
  '3-к квартира 65-75 м²': { key: 'three', name: 'Трёхкомнатная квартира', area: '65–75 м²', layout: 'three' },
};

const text = (value: unknown) => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const isPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function detectColor(title: string): EquipmentColor | null {
  const value = title.toLowerCase();
  if (value.includes('карбон')) return 'carbon';
  if (value.includes('бел') && value.includes('цвет')) return 'white';
  return null;
}

function rowsOf(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
}

function readScenarios(workbook: XLSX.WorkBook): SourceData['scenarios'] {
  const sheet = workbook.Sheets['Сценарии'];
  if (!sheet) return [];
  const rows = rowsOf(sheet);
  const valueAt = (row: number) => text(rows[row - 1]?.[0]);
  return [
    { category: 'Свет', intro: valueAt(5), items: [7, 8, 9, 10, 11].map(valueAt).filter(Boolean) },
    { category: 'Климат', intro: valueAt(15), items: [17, 18, 19].map(valueAt).filter(Boolean) },
    { category: 'Безопасность', intro: valueAt(23), items: [25, 26, 27, 28, 29].map(valueAt).filter(Boolean) },
  ];
}

function readCatalog(workbook: XLSX.WorkBook, fallback: SourceData) {
  const sheetName = workbook.SheetNames.includes('Sber') ? 'Sber' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = sheet ? rowsOf(sheet) : [];
  const fallbackImages = new Map(fallback.catalog.map((product) => [product.sku, product.image]));
  const products: CatalogProduct[] = [];
  const externalFormulaWithoutValue: string[] = [];
  const priceHeader = text(rows[0]?.[5]);

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const sku = text(row?.[1]);
    if (!sku) continue;
    const cell = sheet?.[`F${index + 1}`] as XLSX.CellObject | undefined;
    const price = row?.[5];
    if (cell?.f?.includes('[') && !isPrice(price)) externalFormulaWithoutValue.push(sku);
    products.push({
      sku,
      name: text(row?.[2]),
      description: text(row?.[4]),
      price: isPrice(price) ? price : null,
      image: fallbackImages.get(sku) ?? null,
      badge: text(row?.[6]),
      sourceRow: index + 1,
    });
  }

  const counts = products.reduce<Record<string, number>>((map, product) => {
    map[product.sku] = (map[product.sku] ?? 0) + 1;
    return map;
  }, {});
  const priceDate = priceHeader.match(/\d{2}\.\d{2}\.\d{4}/)?.[0] ?? new Date().toLocaleDateString('ru-RU');
  return {
    products,
    duplicateSku: Object.keys(counts).filter((sku) => counts[sku] > 1),
    invalidPriceSku: products.filter((product) => !isPrice(product.price)).map((product) => product.sku),
    externalFormulaWithoutValue,
    priceDate,
    sheetName,
  };
}

function readReadyRows(workbook: XLSX.WorkBook): ReadyRow[] {
  const result: ReadyRow[] = [];
  for (const sheetName of REQUIRED_APARTMENT_SHEETS) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const apartment = APARTMENTS[sheetName];
    const rows = rowsOf(sheet);
    let color: EquipmentColor | null = null;
    let recommended = false;
    rows.forEach((row, index) => {
      const sourceName = text(row?.[0]);
      const sku = text(row?.[1]);
      const detected = sku ? null : detectColor(sourceName);
      if (detected) {
        color = detected;
        recommended = false;
        return;
      }
      if (sourceName.toLowerCase().startsWith('дополнительно')) {
        recommended = true;
        return;
      }
      const quantity = row?.[2];
      if (!color || !sku || typeof quantity !== 'number' || quantity <= 0) return;
      result.push({
        id: `${apartment.key}-${color}-${index + 1}`,
        apartment: apartment.key,
        color,
        sourceName,
        sku,
        quantity,
        room: text(row?.[5]) || 'Вся квартира',
        category: text(row?.[6]) || 'Без категории',
        gift: text(row?.[7]).toLowerCase().includes('акция'),
        recommended,
        sourceRow: index + 1,
        valid: true,
      });
    });
  }
  return result;
}

export async function parseUpdatedFiles(
  calculationsFile: File,
  catalogFile: File,
  fallback: SourceData,
): Promise<ImportReport> {
  const [calculationsBuffer, catalogBuffer] = await Promise.all([
    calculationsFile.arrayBuffer(),
    catalogFile.arrayBuffer(),
  ]);
  const calculations = XLSX.read(calculationsBuffer, { type: 'array', cellFormula: true });
  const catalogBook = XLSX.read(catalogBuffer, { type: 'array', cellFormula: true });
  const requiredSheets = [...REQUIRED_APARTMENT_SHEETS, 'Сценарии'];
  const requiredSheetsFound = requiredSheets.filter((name) => calculations.SheetNames.includes(name));
  const missingSheets = requiredSheets.filter((name) => !calculations.SheetNames.includes(name));
  const catalogResult = readCatalog(catalogBook, fallback);
  const readyRows = readReadyRows(calculations);
  const catalogSku = new Set(catalogResult.products.map((product) => product.sku));
  const readySku = Array.from(new Set(readyRows.map((row) => row.sku)));
  const missingSku = readySku.filter((sku) => !catalogSku.has(sku));
  const headingIssues: string[] = [];
  const formulaIssues: string[] = [];

  const threeRows = calculations.Sheets['3-к квартира 65-75 м²']
    ? rowsOf(calculations.Sheets['3-к квартира 65-75 м²'])
    : [];
  if (text(threeRows[0]?.[0]).startsWith('2-комнатная')) {
    headingIssues.push('Заголовок листа 3К ошибочно указывает двухкомнатную квартиру.');
  }
  const twoSheet = calculations.Sheets['2-к квартира 60 м²'];
  const twoTotal = twoSheet?.E34 as XLSX.CellObject | undefined;
  if (twoTotal?.f && !twoTotal.f.includes('E33')) {
    formulaIssues.push('Формула белого итога 2К не включает сумму ванной.');
  }

  const data: SourceData = {
    meta: {
      version: `Импорт ${new Date().toLocaleDateString('ru-RU')}`,
      priceDate: catalogResult.priceDate,
      currency: 'RUB',
      minimumOrder: fallback.meta.minimumOrder,
      source: 'Импортированные данные · локально',
    },
    apartments: Object.values(APARTMENTS),
    catalog: catalogResult.products,
    readyRows: readyRows.map((row) => ({ ...row, valid: catalogSku.has(row.sku) })),
    scenarios: readScenarios(calculations),
  };
  const valid =
    missingSheets.length === 0 &&
    catalogResult.products.length > 0 &&
    readyRows.length > 0 &&
    missingSku.length === 0 &&
    catalogResult.duplicateSku.length === 0 &&
    catalogResult.invalidPriceSku.length === 0 &&
    catalogResult.externalFormulaWithoutValue.length === 0;

  return {
    valid,
    requiredSheetsFound,
    missingSheets,
    apartmentTypesFound: REQUIRED_APARTMENT_SHEETS.filter((name) => calculations.SheetNames.includes(name)).length,
    productCount: catalogResult.products.length,
    readySkuCount: readySku.length,
    missingSku,
    duplicateSku: catalogResult.duplicateSku,
    invalidPriceSku: catalogResult.invalidPriceSku,
    externalFormulaWithoutValue: catalogResult.externalFormulaWithoutValue,
    headingIssues,
    formulaIssues,
    data,
  };
}
