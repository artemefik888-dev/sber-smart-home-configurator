import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateManual, calculateReady, roomsFor } from '../app/lib/calculations.ts';
import { MANUAL_HINTS, MANUAL_ROOM_PLACEHOLDER, normalizeProject } from '../app/lib/project-state.ts';

const data = JSON.parse(await readFile(new URL('../app/data/default-data.json', import.meta.url), 'utf8'));
const catalog = new Map(data.catalog.map((product) => [product.sku, product]));
const expected = {
  'studio:white': [49080, 83060],
  'studio:carbon': [53980, 88760],
  'one:white': [60850, 102810],
  'one:carbon': [66750, 111110],
  'two:white': [84600, 126560],
  'two:carbon': [92700, 137060],
  'three:white': [102360, 148310],
  'three:carbon': [111460, 160610],
};
const categories = ['Свет', 'Климат', 'Безопасность'];

for (const [variant, [roomsTotal, categoriesTotal]] of Object.entries(expected)) {
  const [apartment, color] = variant.split(':');
  const selectedRooms = roomsFor(data, apartment, color);
  const common = { apartment, color, selectedRooms, selectedCategories: categories, includeGift: true, includeLeakProtection: false };
  assert.equal(calculateReady(data, { ...common, mode: 'rooms', quantityOverrides: {} }).total, roomsTotal, `${variant} rooms baseline`);
  assert.equal(calculateReady(data, { ...common, mode: 'categories', quantityOverrides: {} }).total, categoriesTotal, `${variant} categories baseline`);
  const giftSku = new Set(data.readyRows.filter((row) => row.apartment === apartment && row.color === color && row.gift).map((row) => row.sku));
  assert.equal(giftSku.size, 3, `${variant} has three gift positions`);
}

const selectedRooms = roomsFor(data, 'studio', 'white');
const common = { apartment: 'studio', color: 'white', selectedRooms, selectedCategories: categories, includeGift: true, includeLeakProtection: false };
const original = calculateReady(data, { ...common, mode: 'rooms' });
const target = original.rows.find((row) => !row.gift);
assert(target, 'ready row available for quantity tests');

const removed = calculateReady(data, { ...common, mode: 'rooms', quantityOverrides: { [target.id]: 0 } });
assert.equal(removed.rows.find((row) => row.id === target.id)?.quantity, 0, 'zeroed ready row remains visible');
assert.equal(removed.total, original.total - target.amount, 'zeroed ready row leaves the total');

const hidden = calculateReady(data, { ...common, mode: 'rooms', selectedRooms: selectedRooms.filter((room) => room !== target.room), quantityOverrides: { [target.id]: 4 } });
assert(!hidden.rows.some((row) => row.id === target.id), 'disabled room hides its rows');
const restored = calculateReady(data, { ...common, mode: 'rooms', quantityOverrides: { [target.id]: 4 } });
assert.equal(restored.rows.find((row) => row.id === target.id)?.quantity, 4, 'room re-enable restores the last user quantity');

const categoryTarget = calculateReady(data, { ...common, mode: 'categories' }).rows.find((row) => row.id === target.id);
assert(categoryTarget, 'same source row is present in categories mode');
const categoryAdjusted = calculateReady(data, { ...common, mode: 'categories', quantityOverrides: { [target.id]: 7 } });
assert.equal(categoryAdjusted.rows.find((row) => row.id === target.id)?.quantity, 7, 'categories keep their own quantity');
assert.equal(restored.rows.find((row) => row.id === target.id)?.quantity, 4, 'rooms override remains independent');

assert.equal(MANUAL_HINTS.length, 8, 'eight manual hints');
assert.equal(new Set(MANUAL_HINTS.map((hint) => hint.sku)).size, 8, 'manual hint SKUs are unique');
for (const hint of MANUAL_HINTS) {
  const product = catalog.get(hint.sku);
  assert(product, `${hint.sku} exists in catalog`);
  assert.equal(typeof product.price, 'number', `${hint.sku} has a catalog price`);
}

const hintSku = MANUAL_HINTS[1].sku;
const placeholderRow = calculateManual(data, { [hintSku]: 3 }).rows[0];
assert.equal(placeholderRow.quantity, 3, 'hint quantity replaces the manual cart quantity');
assert.equal(placeholderRow.room, MANUAL_ROOM_PLACEHOLDER, 'automatic hint row starts without an assigned room');
const assignedRow = calculateManual(data, { [hintSku]: 3 }, { [hintSku]: 'Кухня' }).rows[0];
assert.equal(assignedRow.room, 'Кухня', 'one room applies to the complete SKU row');

const legacy = {
  id: 'legacy-project',
  name: 'Проект первой версии',
  number: 'SH-OLD',
  updatedAt: '2026-09-14T00:00:00.000Z',
  apartment: 'two',
  color: 'carbon',
  mode: 'manual',
  selectedRooms: { studio: ['Прихожая'], one: ['Прихожая'], two: ['Прихожая'], three: ['Прихожая'] },
  selectedCategories: ['Свет'],
  includeGift: true,
  includeLeakProtection: false,
  manualCart: { 'SBDV-00029': 2 },
  manualHints: { risers: 9, radiators: 8, switches: 7, sockets: 6 },
};
const migrated = normalizeProject(legacy, data);
assert.equal(migrated.schemaVersion, 2, 'legacy project migrates to schema 2');
assert.deepEqual(migrated.manualCart, { 'SBDV-00029': 2 }, 'legacy cart is unchanged');
assert.deepEqual(migrated.manualRooms, {}, 'legacy project receives safe room defaults');
assert.deepEqual(migrated.readyQuantities, { rooms: {}, categories: {} }, 'legacy project receives safe ready-mode defaults');
assert(!MANUAL_HINTS.some((hint) => migrated.manualCart[hint.sku]), 'legacy inactive hints do not add products');

const roundTrip = normalizeProject(JSON.parse(JSON.stringify({
  ...migrated,
  manualRooms: { 'SBDV-00029': 'Ванная' },
  readyQuantities: { rooms: { [target.id]: 0 }, categories: { [target.id]: 5 } },
})), data);
assert.equal(roundTrip.manualRooms['SBDV-00029'], 'Ванная', 'manual room survives save and reopen');
assert.equal(roundTrip.readyQuantities.rooms[target.id], 0, 'zero quantity survives save and reopen');
assert.equal(roundTrip.readyQuantities.categories[target.id], 5, 'category quantity survives save and reopen');

console.log('Release 2 logic checks passed.');
console.log(JSON.stringify({ variantsChecked: 16, hintsChecked: MANUAL_HINTS.length, legacyMigration: true }, null, 2));
