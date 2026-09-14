import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../app/data/default-data.json', import.meta.url), 'utf8'));
const catalog = new Map(data.catalog.map((product) => [product.sku, product]));

function calculate(apartment, color, mode, options = {}) {
  const rooms = options.rooms ?? [...new Set(data.readyRows.filter((row) => row.apartment === apartment && row.color === color && !row.recommended).map((row) => row.room))];
  const categories = options.categories ?? ['Свет', 'Климат', 'Безопасность'];
  const includeGift = options.includeGift ?? true;
  const includeLeak = options.includeLeak ?? false;
  const selected = data.readyRows.filter((row) => {
    if (row.apartment !== apartment || row.color !== color) return false;
    if (row.gift && !includeGift) return false;
    if (mode === 'rooms') return row.recommended ? includeLeak : rooms.includes(row.room);
    if (row.recommended) return categories.includes('Безопасность') || includeLeak;
    return categories.includes(row.category);
  });
  const unique = [...new Map(selected.map((row) => [row.id, row])).values()];
  const rows = unique.map((row) => {
    const product = catalog.get(row.sku);
    assert(product, `SKU ${row.sku} is missing from catalog`);
    assert.equal(typeof product.price, 'number', `SKU ${row.sku} has no numeric price`);
    return { ...row, price: product.price, amount: product.price * row.quantity };
  });
  return {
    rows,
    devices: rows.reduce((sum, row) => sum + row.quantity, 0),
    sku: new Set(rows.map((row) => row.sku)).size,
    total: rows.reduce((sum, row) => sum + row.amount, 0),
  };
}

assert.equal(data.catalog.length, 42, 'Catalog product count');
assert.equal(new Set(data.catalog.map((product) => product.sku)).size, 42, 'Catalog SKU uniqueness');
assert.equal(data.readyRows.length, 152, 'Normalized ready row count');
assert.equal(new Set(data.readyRows.map((row) => row.sku)).size, 15, 'Ready-set SKU count');

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

for (const [variant, [roomsTotal, categoriesTotal]] of Object.entries(expected)) {
  const [apartment, color] = variant.split(':');
  const roomResult = calculate(apartment, color, 'rooms');
  const categoryResult = calculate(apartment, color, 'categories');
  assert.equal(roomResult.total, roomsTotal, `${variant} room total`);
  assert.equal(categoryResult.total, categoriesTotal, `${variant} category total`);
  assert.equal(new Set(roomResult.rows.map((row) => row.id)).size, roomResult.rows.length, `${variant} keeps source rows unique`);
  assert.equal(new Set(categoryResult.rows.map((row) => row.id)).size, categoryResult.rows.length, `${variant} category rows are not duplicated`);

  const rooms = [...new Set(roomResult.rows.map((row) => row.room))];
  const removed = rooms[rooms.length - 1];
  const withoutRoom = calculate(apartment, color, 'rooms', { rooms: rooms.filter((room) => room !== removed) });
  const removedValue = roomResult.rows.filter((row) => row.room === removed).reduce((sum, row) => sum + row.amount, 0);
  assert.equal(withoutRoom.total, roomResult.total - removedValue, `${variant} room toggle`);

  const giftValue = roomResult.rows.filter((row) => row.gift).reduce((sum, row) => sum + row.amount, 0);
  const withoutGift = calculate(apartment, color, 'rooms', { includeGift: false });
  assert.equal(withoutGift.total, roomResult.total - giftValue, `${variant} gift toggle`);

  const withLeak = calculate(apartment, color, 'rooms', { includeLeak: true });
  const recommendedValue = data.readyRows.filter((row) => row.apartment === apartment && row.color === color && row.recommended).reduce((sum, row) => sum + catalog.get(row.sku).price * row.quantity, 0);
  assert.equal(withLeak.total, roomResult.total + recommendedValue, `${variant} recommended module`);

  const securityAndLeak = calculate(apartment, color, 'categories', { categories: ['Безопасность'], includeLeak: true });
  assert.equal(securityAndLeak.total, recommendedValue, `${variant} safety module is not duplicated`);
}

const lightClimate = calculate('two', 'white', 'categories', { categories: ['Свет', 'Климат'] });
assert(!lightClimate.rows.some((row) => row.category === 'Безопасность'), 'Category combinations stay isolated');

const detail = calculate('three', 'white', 'rooms');
const aggregatedQuantity = [...detail.rows.reduce((map, row) => map.set(row.sku, (map.get(row.sku) ?? 0) + row.quantity), new Map()).values()].reduce((sum, value) => sum + value, 0);
assert.equal(aggregatedQuantity, detail.devices, 'Duplicate SKU quantities aggregate without dropping rows');
assert(detail.rows.some((row) => row.sku === 'SBDV-00068'), 'Hub row is retained');

const manualCart = { 'SBDV-00029': 3, 'SBDV-00068': 1 };
const manualTotal = Object.entries(manualCart).reduce((sum, [sku, quantity]) => sum + catalog.get(sku).price * quantity, 0);
assert.equal(manualTotal, 8760, 'Manual quantity calculation');
assert(!Object.keys({ 'SBDV-00029': 3 }).includes('SBDV-00068'), 'Manual hub warning condition');
assert(14999 < data.meta.minimumOrder && 15000 >= data.meta.minimumOrder, 'Minimum-order boundary');

const savedProject = JSON.stringify({ apartment: 'two', mode: 'categories', selectedCategories: ['Свет'], manualCart });
assert.deepEqual(JSON.parse(savedProject).manualCart, manualCart, 'Project save/restore round trip');

console.log('Source data checks passed.');
console.log(JSON.stringify({ catalogProducts: data.catalog.length, readyRows: data.readyRows.length, variantsChecked: 16, expectedTotals: expected }, null, 2));
