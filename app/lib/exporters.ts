'use client';

import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Apartment, CalculationMode, EquipmentColor, ScenarioGroup, SourceData, SpecificationRow } from '../data/types';
import { publicAsset } from './public-path';

const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('ru-RU');

const modeLabel: Record<CalculationMode, string> = {
  rooms: 'По помещениям',
  categories: 'По категориям',
  manual: 'Ручная комплектация',
};

const colorLabel: Record<EquipmentColor, string> = { white: 'Белый', carbon: 'Карбон' };

export interface ExportContext {
  projectName: string;
  projectNumber: string;
  apartment: Apartment;
  mode: CalculationMode;
  color: EquipmentColor;
  rows: SpecificationRow[];
  scenarios: ScenarioGroup[];
  total: number;
  devices: number;
  uniqueSku: number;
  data: SourceData;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'project';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function projectRows(context: ExportContext): (string | number)[][] {
  const warning = context.total < context.data.meta.minimumOrder
    ? `Сумма меньше минимального заказа ${currency.format(context.data.meta.minimumOrder)}.`
    : '';
  return [
    ['Проект', context.projectName],
    ['Внутренний номер', context.projectNumber],
    ['Квартира', `${context.apartment.name}, ${context.apartment.area}`],
    ['Режим расчёта', modeLabel[context.mode]],
    ['Цвет оборудования', colorLabel[context.color]],
    ['Дата выгрузки', new Date().toLocaleString('ru-RU')],
    ['Версия данных', `${context.data.meta.version}; цены с ${context.data.meta.priceDate}`],
    ['Количество устройств', context.devices],
    ['Уникальных SKU', context.uniqueSku],
    ['Итог оборудования', context.total],
    ['Предупреждение', warning],
  ];
}

export async function exportExcel(context: ExportContext) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const project = XLSX.utils.aoa_to_sheet(projectRows(context));
  project['!cols'] = [{ wch: 24 }, { wch: 70 }];
  if (project.B10) project.B10.z = '#,##0 "₽"';
  XLSX.utils.book_append_sheet(workbook, project, 'Проект');

  const specification = XLSX.utils.aoa_to_sheet([
    ['Категория', 'Помещение', 'Название товара', 'SKU', 'Количество', 'Цена за единицу', 'Сумма', 'Статус'],
    ...context.rows.map((row) => [
      row.category,
      row.room,
      row.name,
      row.sku,
      row.quantity,
      row.price,
      row.amount,
      row.gift ? 'Подарок · Умная прихожая' : row.recommended ? 'Рекомендуемый модуль' : '',
    ]),
    ['', '', '', '', '', '', context.total, 'Итого'],
  ]);
  specification['!cols'] = [
    { wch: 18 }, { wch: 24 }, { wch: 64 }, { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(workbook, specification, 'Спецификация');

  const scenarios = XLSX.utils.aoa_to_sheet([
    ['Категория', 'Описание', 'Сценарий'],
    ...context.scenarios.flatMap((group) =>
      group.items.map((item, index) => [group.category, index === 0 ? group.intro : '', item]),
    ),
  ]);
  scenarios['!cols'] = [{ wch: 18 }, { wch: 72 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(workbook, scenarios, 'Сценарии');

  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
  downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(context.projectNumber || context.projectName)}.xlsx`);
}

async function imageDataUrl(path: string) {
  const response = await fetch(path);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function exportPdf(context: ExportContext) {
  const [{ default: pdfMake }, fonts] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const fontModule = fonts as unknown as { default?: { pdfMake?: { vfs?: Record<string, string> } } | Record<string, string>; pdfMake?: { vfs?: Record<string, string> } };
  const defaultFonts = fontModule.default as { pdfMake?: { vfs?: Record<string, string> } } | undefined;
  pdfMake.vfs = fontModule.pdfMake?.vfs ?? defaultFonts?.pdfMake?.vfs ?? (fontModule.default as Record<string, string>);
  const logo = await imageDataUrl(publicAsset('/sber-smart-home-logo.jpg'));
  const belowMinimum = context.total < context.data.meta.minimumOrder;
  const body = [
    [
      { text: 'Категория', style: 'tableHeader' },
      { text: 'Помещение', style: 'tableHeader' },
      { text: 'Товар и SKU', style: 'tableHeader' },
      { text: 'Кол-во', style: 'tableHeader' },
      { text: 'Цена', style: 'tableHeader' },
      { text: 'Сумма', style: 'tableHeader' },
      { text: 'Статус', style: 'tableHeader' },
    ],
    ...context.rows.map((row) => [
      row.category,
      row.room,
      `${row.name}\n${row.sku}`,
      number.format(row.quantity),
      currency.format(row.price),
      currency.format(row.amount),
      row.gift ? 'Подарок' : row.recommended ? 'Рекомендуемое' : '',
    ]),
  ];
  const document: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [34, 34, 34, 42],
    defaultStyle: { font: 'Roboto', fontSize: 8.5, color: '#26342d' },
    footer: (currentPage, pageCount) => ({
      text: `${context.projectNumber || context.projectName} · ${currentPage} / ${pageCount}`,
      alignment: 'center',
      color: '#718078',
      fontSize: 8,
      margin: [0, 12, 0, 0],
    }),
    content: [
      { columns: [{ image: logo, width: 165, height: 55 }, { text: 'Конфигуратор оборудования', alignment: 'right', color: '#158f66', bold: true, margin: [0, 18, 0, 0] }] },
      { text: context.projectName, style: 'title', margin: [0, 10, 0, 3] },
      { text: context.projectNumber, color: '#66736c', margin: [0, 0, 0, 14] },
      {
        columns: [
          { text: [{ text: 'Квартира\n', bold: true }, `${context.apartment.name}, ${context.apartment.area}`] },
          { text: [{ text: 'Расчёт\n', bold: true }, modeLabel[context.mode]] },
          { text: [{ text: 'Цвет\n', bold: true }, colorLabel[context.color]] },
          { text: [{ text: 'Устройства\n', bold: true }, `${number.format(context.devices)} · ${context.uniqueSku} SKU`] },
        ],
        columnGap: 12,
        margin: [0, 0, 0, 16],
      },
      { text: 'Спецификация', style: 'section' },
      { table: { headerRows: 1, widths: [46, 68, '*', 34, 55, 58, 54], body }, layout: { fillColor: (rowIndex) => rowIndex === 0 ? '#148f66' : rowIndex % 2 === 0 ? '#f3f7f4' : null, hLineColor: '#d8e2dc', vLineColor: '#d8e2dc', paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 5, paddingBottom: () => 5 } },
      { columns: [{ text: `Версия данных: ${context.data.meta.version}\nРРЦ с ${context.data.meta.priceDate}`, color: '#66736c', fontSize: 8, margin: [0, 12, 0, 0] }, { text: `Итого: ${currency.format(context.total)}`, alignment: 'right', bold: true, fontSize: 15, color: '#08734f', margin: [0, 12, 0, 0] }] },
      ...(belowMinimum ? [{ text: `Сумма меньше минимального заказа ${currency.format(context.data.meta.minimumOrder)}. Состав и итог не изменены.`, color: '#8b5c00', bold: true, margin: [0, 10, 0, 0] }] : []),
      { text: 'Сценарии', style: 'section', pageBreak: context.rows.length > 14 ? 'before' : undefined },
      ...(context.scenarios.length
        ? context.scenarios.flatMap((group) => [
            { text: group.category, style: 'scenarioTitle' },
            { text: group.intro, margin: [0, 0, 0, 5] },
            { ul: group.items.map((item) => ({ text: item })), margin: [12, 0, 0, 10] },
          ])
        : [{ text: 'Для текущего состава сценарии из источника не определены.', color: '#66736c' }]),
      { text: `Сформировано ${new Date().toLocaleString('ru-RU')}`, color: '#66736c', fontSize: 8, margin: [0, 12, 0, 0] },
    ],
    styles: {
      title: { fontSize: 22, bold: true, color: '#14261e' },
      section: { fontSize: 14, bold: true, color: '#08734f', margin: [0, 15, 0, 8] },
      scenarioTitle: { fontSize: 11, bold: true, color: '#08734f', margin: [0, 8, 0, 3] },
      tableHeader: { bold: true, color: '#ffffff', fontSize: 7.5 },
    },
  };
  const blob = await new Promise<Blob>((resolve) => pdfMake.createPdf(document).getBlob(resolve));
  downloadBlob(blob, `${safeName(context.projectNumber || context.projectName)}.pdf`);
}
