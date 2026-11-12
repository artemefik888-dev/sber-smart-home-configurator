import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { calculateManual, calculateReady, roomsFor } from '../app/lib/calculations.ts';
import { parseUpdatedFiles } from '../app/lib/importer.ts';
import {
  loadStoredRelease3State,
  PROJECTS_STORAGE_KEY,
  RELEASE3_MIGRATION_KEY,
  SOURCE_DATA_STORAGE_KEY,
} from '../app/lib/project-state.ts';

const data = JSON.parse(await readFile(new URL('../app/data/default-data.json', import.meta.url), 'utf8'));
const catalog = new Map(data.catalog.map((product) => [product.sku, product]));
const newProducts = {
  'SBDV-00320GR': ['Интеллектуальная колонка СберБум 2.0, зеленый', 21990, '/products/sbdv-00320gr.png'],
  'SBDV-00320LG': ['Интеллектуальная колонка СберБум 2.0, светло-серый', 21990, '/products/sbdv-00320lg.png'],
  'SBDV-00320G': ['Интеллектуальная колонка СберБум 2.0, тёмно-серый', 21990, '/products/sbdv-00320g.png'],
};
const priceUpdates = {
  ATN000113Z: 2590,
  ATN000115Z: 2590,
  ATN000117Z: 3190,
  ATN000145Z: 2790,
  ATN000153Z: 3190,
  ATN001013Z: 2990,
  ATN001015Z: 2990,
  ATN001017Z: 3690,
  ATN001045Z: 3290,
  ATN001053Z: 3690,
};
const expectedTotals = {
  'studio:white': [42280, 75060],
  'studio:carbon': [45780, 79060],
  'one:white': [54450, 92810],
  'one:carbon': [58550, 98410],
  'two:white': [74200, 112560],
  'two:carbon': [79400, 119260],
  'three:white': [90160, 131310],
  'three:carbon': [95860, 139010],
};

assert.equal(data.meta.version, '4Q 2026', 'default data version');
assert.equal(data.catalog.length, 45, '45 catalog products');
assert.equal(new Set(data.catalog.map((product) => product.sku)).size, 45, 'catalog SKUs are unique');
for (const [sku, [name, price, image]] of Object.entries(newProducts)) {
  const product = catalog.get(sku);
  assert(product, `${sku} exists`);
  assert.equal(product.name, name, `${sku} name`);
  assert.equal(product.price, price, `${sku} price`);
  assert.equal(product.image, image, `${sku} image`);
  assert(!data.readyRows.some((row) => row.sku === sku), `${sku} stays manual-only`);
}
for (const [sku, price] of Object.entries(priceUpdates)) assert.equal(catalog.get(sku)?.price, price, `${sku} price`);

assert.equal(catalog.get('SBDV-00171G')?.price, 6990, 'SBDV-00171G catalog price is unchanged');
assert(data.readyRows.some((row) => row.sku === 'SBDV-00171G'), 'SBDV-00171G stays in ready rows');

for (const [variant, [roomsTotal, categoriesTotal]] of Object.entries(expectedTotals)) {
  const [apartment, color] = variant.split(':');
  const selectedRooms = roomsFor(data, apartment, color);
  const common = {
    apartment,
    color,
    selectedRooms,
    selectedCategories: ['Свет', 'Климат', 'Безопасность'],
    includeGift: true,
    includeLeakProtection: false,
  };
  assert.equal(calculateReady(data, { ...common, mode: 'rooms' }).total, roomsTotal, `${variant} rooms total`);
  assert.equal(calculateReady(data, { ...common, mode: 'categories' }).total, categoriesTotal, `${variant} categories total`);
}

const sha256 = async (relativePath) => createHash('sha256').update(await readFile(new URL(`../public/products/${relativePath}`, import.meta.url))).digest('hex');
const imageHashes = {
  'atn000113z.png': '7c9fb0f080e3673ad84324f2e56cd815509ff06eb36a8ec24043c1a29b89929c',
  'atn001013z.png': '5fd1ed6ce944f491425fd4e398b75f9f035d84b98a86936016d54903ad427388',
  'atn000153z.png': '9bcf63322d108538c14f5147faea2b548e1c07f63c21c965be173b599448bdef',
  'atn001053z.png': '90685fee4c51481a330a45f1c66552f1c3c7052f672810477a3ec1557ac66d47',
  'atn000115z.png': '7c9fb0f080e3673ad84324f2e56cd815509ff06eb36a8ec24043c1a29b89929c',
  'atn001015z.png': '5fd1ed6ce944f491425fd4e398b75f9f035d84b98a86936016d54903ad427388',
  'atn000117z.png': '9bcf63322d108538c14f5147faea2b548e1c07f63c21c965be173b599448bdef',
  'atn001017z.png': '90685fee4c51481a330a45f1c66552f1c3c7052f672810477a3ec1557ac66d47',
  'sbdv-00320gr.png': '5f2c5e742dd1e24d84aaafa44a5e5d82681f6235b9bea93c91c9cab859747415',
  'sbdv-00320lg.png': 'e4370103728969c769230dacfbcaaa0e43cb9f95c409cb8ff7ce31542f9394b6',
  'sbdv-00320g.png': '6996d44bc64d5043770ab58b97ed8f9baa66a58638a150fbc9f977bc6879ef83',
};
for (const [file, expectedHash] of Object.entries(imageHashes)) {
  assert.equal(await sha256(file), expectedHash, `${file} matches the visually mapped Excel image`);
}

const project = {
  schemaVersion: 2,
  id: 'release-3-project',
  name: 'Сохранённый проект',
  number: 'SH-R3-001',
  updatedAt: '2026-11-12T10:00:00.000Z',
  apartment: 'two',
  color: 'carbon',
  mode: 'manual',
  selectedRooms: { studio: ['Прихожая'], one: ['Кухня'], two: ['Гостиная'], three: ['Спальня 1'] },
  selectedCategories: ['Свет', 'Безопасность'],
  includeGift: false,
  includeLeakProtection: true,
  manualCart: { ATN000115Z: 2, 'SBDV-00171G': 1 },
  manualRooms: { ATN000115Z: 'Гостиная' },
  readyQuantities: { rooms: { 'two-carbon-10': 4 }, categories: { 'two-carbon-10': 0 } },
};
const oldData = { ...data, meta: { ...data.meta, version: '2Q 2026', priceDate: '07.04.2026' } };
const storageMap = new Map([
  [SOURCE_DATA_STORAGE_KEY, JSON.stringify(oldData)],
  [PROJECTS_STORAGE_KEY, JSON.stringify([project])],
]);
const storage = {
  getItem: (key) => storageMap.get(key) ?? null,
  setItem: (key, value) => storageMap.set(key, value),
  removeItem: (key) => storageMap.delete(key),
};
const firstOpen = loadStoredRelease3State(storage, data);
assert(firstOpen.migrated, 'Release 3 migration runs once');
assert.equal(firstOpen.data.meta.version, '4Q 2026', 'old stored catalog is invalidated');
assert.equal(storageMap.get(RELEASE3_MIGRATION_KEY), '1', 'migration marker is stored');
assert.equal(firstOpen.projects[0].name, project.name, 'project name survives');
assert.equal(firstOpen.projects[0].number, project.number, 'project number survives');
assert.equal(firstOpen.projects[0].apartment, project.apartment, 'apartment survives');
assert.equal(firstOpen.projects[0].mode, project.mode, 'mode survives');
assert.deepEqual(firstOpen.projects[0].selectedRooms, project.selectedRooms, 'room selections survive');
assert.deepEqual(firstOpen.projects[0].selectedCategories, project.selectedCategories, 'category selections survive');
assert.deepEqual(firstOpen.projects[0].manualCart, project.manualCart, 'manual quantities survive');
assert.deepEqual(firstOpen.projects[0].manualRooms, project.manualRooms, 'room assignments survive');
assert.deepEqual(firstOpen.projects[0].readyQuantities, project.readyQuantities, 'ready quantity overrides survive');
assert.equal(calculateManual(firstOpen.data, firstOpen.projects[0].manualCart).total, 12170, 'saved project recalculates with 4Q prices');

const importedAgain = { ...data, meta: { ...data.meta, source: 'Повторный импорт' } };
storage.setItem(SOURCE_DATA_STORAGE_KEY, JSON.stringify(importedAgain));
const secondOpen = loadStoredRelease3State(storage, data);
assert(!secondOpen.migrated, 'migration marker prevents a second reset');
assert.equal(secondOpen.data.meta.source, 'Повторный импорт', 'imports work after migration');

function workbookFile(name, workbook) {
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const calculations = XLSX.utils.book_new();
for (const name of ['Студия 30 м²', '1-к квартира 40 м²', '2-к квартира 60 м²', '3-к квартира 65-75 м²']) {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Комплект, цвет белый'],
    ['Тестовый выключатель', 'ATN000113Z', 1, null, null, 'Кухня', 'Свет', ''],
  ]);
  XLSX.utils.book_append_sheet(calculations, sheet, name);
}
XLSX.utils.book_append_sheet(calculations, XLSX.utils.aoa_to_sheet(Array.from({ length: 29 }, () => [''])), 'Сценарии');

const priceList = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(priceList, XLSX.utils.aoa_to_sheet([
  ['Артикул производителя', 'Название номенклатуры', 'Фото', 'Краткое описание', 'РРЦ ЭУИ, руб. с НДС 4Q 2026', 'Скидка', 'Цена со скидкой'],
  ['ATN000113Z', 'Тестовый выключатель', null, 'Электроустановочные изделия', 2590, 0.99, 1],
]), 'Sber');
const fixtureReport = await parseUpdatedFiles(workbookFile('calculations.xlsx', calculations), workbookFile('catalog.xlsx', priceList), data);
assert(fixtureReport.valid, 'A–E catalog fixture imports successfully');
assert.equal(fixtureReport.data?.catalog[0].price, 2590, 'column E is the imported price');
assert.equal(fixtureReport.data?.catalog[0].badge, '', 'columns F–G never create a badge');
assert.equal(fixtureReport.data?.meta.version, '4Q 2026', 'import keeps the 4Q 2026 label');

if (process.env.RELEASE3_CATALOG_XLSX && process.env.RELEASE3_CALCULATIONS_XLSX) {
  const [catalogBytes, calculationBytes] = await Promise.all([
    readFile(process.env.RELEASE3_CATALOG_XLSX),
    readFile(process.env.RELEASE3_CALCULATIONS_XLSX),
  ]);
  const actualReport = await parseUpdatedFiles(
    new File([calculationBytes], 'calculations.xlsx'),
    new File([catalogBytes], 'catalog-4Q-2026.xlsx'),
    data,
  );
  assert(actualReport.valid, 'provided Release 3 workbooks import successfully');
  assert.equal(actualReport.productCount, 45, 'provided catalog imports 45 products');
  assert.equal(actualReport.data?.meta.version, '4Q 2026', 'provided catalog imports the 4Q label');
  for (const [sku, price] of Object.entries(priceUpdates)) {
    assert.equal(actualReport.data?.catalog.find((product) => product.sku === sku)?.price, price, `${sku} actual import price`);
  }
}

const [configuratorSource, exporterSource] = await Promise.all([
  readFile(new URL('../app/components/Configurator.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/lib/exporters.ts', import.meta.url), 'utf8'),
]);
assert(!configuratorSource.includes('2Q 2026'), 'user interface has no 2Q 2026 label');
assert(!configuratorSource.includes('07.04.2026'), 'user interface has no old price date');
assert(!configuratorSource.includes('РРЦ с {data.meta.priceDate}'), 'user interface has no old dated-RRP wording');
assert(exporterSource.includes('РРЦ ${context.data.meta.version}'), 'exports label RRP as 4Q 2026');
assert(!/скидк/i.test(exporterSource), 'exports contain no discount fields');

console.log('Release 3 logic checks passed.');
console.log(JSON.stringify({ catalogProducts: data.catalog.length, pricesChecked: Object.keys(priceUpdates).length, variantsChecked: 16, actualImport: Boolean(process.env.RELEASE3_CATALOG_XLSX) }, null, 2));
