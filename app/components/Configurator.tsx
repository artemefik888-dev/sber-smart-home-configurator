'use client';

/* eslint-disable @next/next/no-img-element -- catalog images and user-selected object URLs are dynamic */

import { useEffect, useMemo, useRef, useState } from 'react';
import defaultDataJson from '../data/default-data.json';
import type {
  Apartment,
  ApartmentKey,
  CalculationMode,
  ConfiguratorProject,
  EquipmentColor,
  ImportReport,
  ManualRoom,
  ReadyCalculationMode,
  SmartCategory,
  SourceData,
  SpecificationRow,
} from '../data/types';
import {
  aggregateBySku,
  calculateManual,
  calculateReady,
  hasHubWarning,
  roomsFor,
  scenarioGroupsFor,
} from '../lib/calculations';
import { exportComparisonExcel, exportExcel, exportPdf } from '../lib/exporters';
import { parseUpdatedFiles } from '../lib/importer';
import {
  defaultRoomMap,
  emptyReadyQuantities,
  MANUAL_HINTS,
  MANUAL_ROOM_PLACEHOLDER,
  MANUAL_ROOMS,
  normalizeProject,
} from '../lib/project-state';
import { publicAsset } from '../lib/public-path';

const DEFAULT_DATA = defaultDataJson as SourceData;
const PROJECTS_KEY = 'sber-configurator-projects-v1';
const DATA_KEY = 'sber-configurator-source-data-v1';
const CATEGORIES: SmartCategory[] = ['Свет', 'Климат', 'Безопасность'];
const currency = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('ru-RU');

const modeLabel: Record<CalculationMode, string> = {
  rooms: 'По помещениям',
  categories: 'По категориям',
  manual: 'Собрать самостоятельно',
};

const categoryMeta: Record<SmartCategory, { letter: string; description: string }> = {
  Свет: { letter: 'С', description: 'Освещение, выключатели и голосовое управление' },
  Климат: { letter: 'К', description: 'Температура, влажность и отопление' },
  Безопасность: { letter: 'Б', description: 'Защита от протечек и контроль приборов' },
};

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `project-${Date.now()}`;
}

function makeProject(data: SourceData): ConfiguratorProject {
  const date = new Date();
  return {
    schemaVersion: 2,
    id: newId(),
    name: 'Новый проект',
    number: `SH-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`,
    updatedAt: date.toISOString(),
    apartment: 'studio',
    color: 'white',
    mode: 'rooms',
    selectedRooms: defaultRoomMap(data),
    selectedCategories: [...CATEGORIES],
    includeGift: true,
    includeLeakProtection: false,
    manualCart: {},
    manualRooms: {},
    readyQuantities: emptyReadyQuantities(),
  };
}

function statusText(row: SpecificationRow) {
  if (row.gift) return 'Подарок';
  if (row.recommended) return 'Рекомендуемое';
  return '';
}

function ProductImage({ row, compact = false }: { row: Pick<SpecificationRow, 'name' | 'image' | 'sku'>; compact?: boolean }) {
  return row.image ? (
    <img className={compact ? 'product-image compact' : 'product-image'} src={publicAsset(row.image)} alt={row.name} />
  ) : (
    <span className={compact ? 'product-placeholder compact' : 'product-placeholder'} aria-label="Изображение отсутствует в источнике">
      {row.sku.slice(0, 2)}
    </span>
  );
}

function ColorSelector({ color, onSelect }: { color: EquipmentColor; onSelect: (color: EquipmentColor) => void }) {
  return <div className="segmented compact color-selector" aria-label="Цвет оборудования"><button className={color === 'white' ? 'selected' : ''} onClick={() => onSelect('white')}><i className="swatch white" />Белый</button><button className={color === 'carbon' ? 'selected' : ''} onClick={() => onSelect('carbon')}><i className="swatch carbon" />Карбон</button></div>;
}

function QuantityControl({ label, quantity, onChange }: { label: string; quantity: number; onChange: (quantity: number) => void }) {
  return <span className="quantity-control"><button aria-label={`Уменьшить ${label}`} onClick={() => onChange(Math.max(0, quantity - 1))}>−</button><input aria-label={`Количество ${label}`} type="number" min="0" max="999" value={quantity} onChange={(event) => onChange(Number(event.target.value))} /><button aria-label={`Увеличить ${label}`} onClick={() => onChange(quantity + 1)}>+</button><button className="remove" aria-label={`Обнулить ${label}`} onClick={() => onChange(0)}>×</button></span>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><p className="panel-kicker">Умный дом Sber</p><h2>{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function PlanView({
  apartment,
  rooms,
  selectedRooms,
  rows,
  interactive,
  selectedRoom,
  onSelectRoom,
  onToggleRoom,
  zoom,
  uploadedPlan,
}: {
  apartment: ApartmentKey;
  rooms: string[];
  selectedRooms: string[];
  rows: SpecificationRow[];
  interactive: boolean;
  selectedRoom: string;
  onSelectRoom: (room: string) => void;
  onToggleRoom: (room: string) => void;
  zoom: number;
  uploadedPlan?: { url: string; type: string; name: string } | null;
}) {
  if (uploadedPlan) {
    return uploadedPlan.type === 'application/pdf' ? (
      <object className="uploaded-plan" data={uploadedPlan.url} type="application/pdf" aria-label={uploadedPlan.name}>
        <p>PDF-план загружен. Откройте файл в браузере, если предпросмотр недоступен.</p>
      </object>
    ) : (
      <img className="uploaded-plan" src={uploadedPlan.url} alt={`Загруженный план ${uploadedPlan.name}`} />
    );
  }
  return (
    <div className={`floor-plan layout-${apartment}`} style={{ transform: `scale(${zoom / 100})` }}>
      {rooms.map((room, index) => {
        const roomRows = rows.filter((row) => row.room === room);
        const selected = selectedRooms.includes(room);
        const markers = roomRows.slice(0, 5);
        return (
          <button
            className={`plan-room room-${index + 1} ${selected ? 'selected' : ''} ${selectedRoom === room ? 'focused' : ''}`}
            key={room}
            onClick={() => {
              onSelectRoom(room);
              if (interactive) onToggleRoom(room);
            }}
            aria-pressed={selected}
            title={interactive ? `${selected ? 'Исключить' : 'Включить'} помещение ${room}` : room}
          >
            <span className="plan-room-title">{room}</span>
            <small>{roomRows.reduce((sum, row) => sum + row.quantity, 0)} устройств</small>
            <span className="plan-markers" aria-hidden="true">
              {markers.map((row, markerIndex) => (
                <i className={`marker category-${row.category.toLowerCase()}`} key={`${row.id}-${markerIndex}`}>
                  {categoryMeta[row.category as SmartCategory]?.letter ?? 'У'}
                </i>
              ))}
            </span>
          </button>
        );
      })}
      <span className="plan-disclaimer">Условная схема · не инженерный план</span>
    </div>
  );
}

export default function Configurator() {
  const [data, setData] = useState<SourceData>(DEFAULT_DATA);
  const [project, setProject] = useState<ConfiguratorProject>(() => makeProject(DEFAULT_DATA));
  const [savedProjects, setSavedProjects] = useState<ConfiguratorProject[]>([]);
  const [selectedRoom, setSelectedRoom] = useState('Кухня-гостиная');
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [specSearch, setSpecSearch] = useState('');
  const [specRoom, setSpecRoom] = useState('all');
  const [specCategory, setSpecCategory] = useState('all');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogCategory, setCatalogCategory] = useState('all');
  const [showProjects, setShowProjects] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showClient, setShowClient] = useState(false);
  const [showDataUpdate, setShowDataUpdate] = useState(false);
  const [toast, setToast] = useState('');
  const [calculationsFile, setCalculationsFile] = useState<File | null>(null);
  const [catalogFile, setCatalogFile] = useState<File | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [uploadedPlan, setUploadedPlan] = useState<{ url: string; type: string; name: string } | null>(null);
  const planInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedData = localStorage.getItem(DATA_KEY);
        const nextData = storedData ? JSON.parse(storedData) as SourceData : DEFAULT_DATA;
        setData(nextData);
        const storedProjects = localStorage.getItem(PROJECTS_KEY);
        if (storedProjects) {
          const parsed = JSON.parse(storedProjects) as unknown;
          setSavedProjects(Array.isArray(parsed) ? parsed.map((item) => normalizeProject(item, nextData)) : []);
        }
      } catch {
        setToast('Локальные данные не удалось прочитать. Используются встроенные исходные данные.');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const apartment = data.apartments.find((item) => item.key === project.apartment) ?? data.apartments[0];
  const availableRooms = roomsFor(data, project.apartment, project.color);
  const activeRooms = project.selectedRooms[project.apartment] ?? availableRooms;
  const readyRowsForPlan = calculateReady(data, {
    apartment: project.apartment,
    color: project.color,
    mode: 'rooms',
    selectedRooms: availableRooms,
    selectedCategories: project.selectedCategories,
    includeGift: project.includeGift,
    includeLeakProtection: project.includeLeakProtection,
    quantityOverrides: project.mode === 'rooms' ? project.readyQuantities.rooms : undefined,
  }).rows;

  const result = useMemo(() => {
    if (project.mode === 'manual') return calculateManual(data, project.manualCart, project.manualRooms);
    return calculateReady(data, {
      apartment: project.apartment,
      color: project.color,
      mode: project.mode,
      selectedRooms: activeRooms,
      selectedCategories: project.selectedCategories,
      includeGift: project.includeGift,
      includeLeakProtection: project.includeLeakProtection,
      quantityOverrides: project.readyQuantities[project.mode],
    });
  }, [data, project, activeRooms]);

  const scenarios = useMemo(() => scenarioGroupsFor(data, result), [data, result]);
  const belowMinimum = result.total < data.meta.minimumOrder;
  const manualHubWarning = project.mode === 'manual' && hasHubWarning(result);
  const roomCount = project.mode === 'rooms' ? activeRooms.length : availableRooms.length;
  const giftPositions = project.mode !== 'manual' && project.includeGift ? 3 : 0;
  const selectedProduct = selectedSku ? data.catalog.find((product) => product.sku === selectedSku) : null;
  const selectedRoomRows = result.rows.filter((row) => row.room === selectedRoom);
  const allSpecRooms = Array.from(new Set(result.rows.map((row) => row.room)));
  const allSpecCategories = Array.from(new Set(result.rows.map((row) => row.category)));
  const filteredRows = result.rows.filter((row) => {
    const query = specSearch.toLocaleLowerCase('ru');
    const matchesSearch = !query || `${row.name} ${row.sku} ${row.room}`.toLocaleLowerCase('ru').includes(query);
    return matchesSearch && (specRoom === 'all' || row.room === specRoom) && (specCategory === 'all' || row.category === specCategory);
  });
  const catalogGroups = Array.from(new Set(data.catalog.map((product) => product.description).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'));
  const filteredCatalog = data.catalog.filter((product) => {
    const query = catalogSearch.toLocaleLowerCase('ru');
    const matches = !query || `${product.name} ${product.sku} ${product.description}`.toLocaleLowerCase('ru').includes(query);
    return matches && (catalogCategory === 'all' || product.description === catalogCategory);
  });

  const compareRooms = useMemo(() => calculateReady(data, {
    apartment: project.apartment,
    color: project.color,
    mode: 'rooms',
    selectedRooms: activeRooms,
    selectedCategories: project.selectedCategories,
    includeGift: project.includeGift,
    includeLeakProtection: project.includeLeakProtection,
    quantityOverrides: project.readyQuantities.rooms,
  }), [data, project, activeRooms]);
  const compareCategories = useMemo(() => calculateReady(data, {
    apartment: project.apartment,
    color: project.color,
    mode: 'categories',
    selectedRooms: activeRooms,
    selectedCategories: project.selectedCategories,
    includeGift: project.includeGift,
    includeLeakProtection: project.includeLeakProtection,
    quantityOverrides: project.readyQuantities.categories,
  }), [data, project, activeRooms]);

  function updateProject(patch: Partial<ConfiguratorProject>) {
    setProject((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));
  }

  function toggleRoom(room: string) {
    const selected = activeRooms.includes(room);
    updateProject({
      selectedRooms: {
        ...project.selectedRooms,
        [project.apartment]: selected ? activeRooms.filter((value) => value !== room) : [...activeRooms, room],
      },
    });
  }

  function toggleCategory(category: SmartCategory) {
    const selected = project.selectedCategories.includes(category);
    updateProject({
      selectedCategories: selected
        ? project.selectedCategories.filter((value) => value !== category)
        : [...project.selectedCategories, category],
    });
  }

  function setCartQuantity(sku: string, quantity: number) {
    const next = { ...project.manualCart };
    if (quantity <= 0) delete next[sku];
    else next[sku] = Math.min(999, Math.max(1, Math.floor(quantity)));
    updateProject({ manualCart: next });
  }

  function setManualRoom(sku: string, room: ManualRoom | '') {
    const next = { ...project.manualRooms };
    if (!room) delete next[sku];
    else next[sku] = room;
    updateProject({ manualRooms: next });
  }

  function setReadyQuantity(mode: ReadyCalculationMode, rowId: string, quantity: number) {
    updateProject({
      readyQuantities: {
        ...project.readyQuantities,
        [mode]: {
          ...project.readyQuantities[mode],
          [rowId]: Math.min(999, Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0))),
        },
      },
    });
  }

  function addToCart(sku: string) {
    setCartQuantity(sku, (project.manualCart[sku] ?? 0) + 1);
    setToast('Товар добавлен в ручную спецификацию.');
  }

  function saveProject() {
    const next = [project, ...savedProjects.filter((item) => item.id !== project.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setSavedProjects(next);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
    setToast('Проект сохранён на этом устройстве.');
  }

  function openProject(item: ConfiguratorProject) {
    const normalized = normalizeProject(item, data);
    setProject(normalized);
    setSelectedSku(null);
    setSelectedRoom(normalized.selectedRooms[normalized.apartment]?.[0] ?? '');
    setShowProjects(false);
    setShowDataUpdate(false);
    setToast('Сохранённый проект открыт.');
  }

  function deleteProject(id: string) {
    if (!window.confirm('Удалить сохранённый проект с этого устройства?')) return;
    const next = savedProjects.filter((item) => item.id !== id);
    setSavedProjects(next);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
  }

  function resetProject() {
    if (!window.confirm('Создать новый проект? Несохранённые изменения текущего проекта будут потеряны.')) return;
    const next = makeProject(data);
    setProject(next);
    setSelectedRoom(next.selectedRooms.studio[0] ?? '');
    setSelectedSku(null);
    setUploadedPlan(null);
    setShowDataUpdate(false);
  }

  function selectApartment(key: ApartmentKey) {
    updateProject({ apartment: key });
    setSelectedRoom(project.selectedRooms[key]?.[0] ?? roomsFor(data, key, project.color)[0] ?? '');
    setSelectedSku(null);
  }

  function selectColor(color: EquipmentColor) {
    updateProject({ color });
    const rooms = roomsFor(data, project.apartment, color);
    if (!rooms.includes(selectedRoom)) setSelectedRoom(rooms[0] ?? '');
  }

  function exportContext() {
    return {
      projectName: project.name,
      projectNumber: project.number,
      apartment,
      mode: project.mode,
      color: project.color,
      rows: result.rows,
      scenarios,
      total: result.total,
      devices: result.devices,
      data,
    };
  }

  async function downloadExcel() {
    if (!result.rows.length || result.invalidSku.length) return setToast('Экспорт недоступен: спецификация пуста или содержит ошибки SKU.');
    try {
      await exportExcel(exportContext());
      setToast('Excel-файл сформирован.');
    } catch {
      setToast('Не удалось сформировать Excel. Повторите попытку.');
    }
  }

  async function downloadPdf() {
    if (!result.rows.length || result.invalidSku.length) return setToast('Экспорт недоступен: спецификация пуста или содержит ошибки SKU.');
    try {
      await exportPdf(exportContext());
      setToast('PDF-файл сформирован.');
    } catch {
      setToast('Не удалось сформировать PDF. Повторите попытку.');
    }
  }

  async function downloadComparison() {
    if (compareRooms.invalidSku.length || compareCategories.invalidSku.length) {
      return setToast('Экспорт сравнения недоступен: одна из спецификаций содержит ошибки SKU.');
    }
    try {
      await exportComparisonExcel({
        projectName: project.name,
        projectNumber: project.number,
        apartment,
        color: project.color,
        rooms: compareRooms,
        categories: compareCategories,
      });
      setToast('Excel со сравнением сформирован.');
    } catch {
      setToast('Не удалось сформировать Excel со сравнением. Повторите попытку.');
    }
  }

  async function validateImport() {
    if (!calculationsFile || !catalogFile) return setToast('Выберите оба Excel-файла.');
    setImporting(true);
    try {
      setImportReport(await parseUpdatedFiles(calculationsFile, catalogFile, DEFAULT_DATA));
    } catch {
      setImportReport(null);
      setToast('Файлы не удалось прочитать. Проверьте формат и структуру Excel.');
    } finally {
      setImporting(false);
    }
  }

  function applyImport() {
    if (!importReport?.valid || !importReport.data) return;
    setData(importReport.data);
    localStorage.setItem(DATA_KEY, JSON.stringify(importReport.data));
    const next = makeProject(importReport.data);
    setProject(next);
    setSelectedRoom(next.selectedRooms.studio[0] ?? '');
    setImportReport(null);
    setToast('Новые данные применены и сохранены в этом браузере.');
  }

  function resetData() {
    if (!window.confirm('Вернуться к встроенным данным? Импортированная версия будет удалена из этого браузера.')) return;
    localStorage.removeItem(DATA_KEY);
    setData(DEFAULT_DATA);
    const next = makeProject(DEFAULT_DATA);
    setProject(next);
    setSelectedRoom(next.selectedRooms.studio[0] ?? '');
    setImportReport(null);
    setToast('Восстановлены встроенные исходные данные.');
  }

  function handlePlanFile(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) {
      return setToast('Поддерживаются PDF, JPG и PNG.');
    }
    if (uploadedPlan) URL.revokeObjectURL(uploadedPlan.url);
    const next = { url: URL.createObjectURL(file), type: file.type, name: file.name };
    setUploadedPlan(next);
    updateProject({ mode: 'manual' });
    setShowDataUpdate(false);
    setToast('План загружен как визуальная подложка. Включён ручной режим без распознавания.');
  }

  const steps = [
    ['01', 'Проект', project.number, () => { setShowDataUpdate(false); document.getElementById('project-controls')?.scrollIntoView({ behavior: 'smooth' }); }],
    ['02', 'Тип квартиры', apartment.area, () => { setShowDataUpdate(false); document.getElementById('apartment')?.scrollIntoView({ behavior: 'smooth' }); }],
    ['03', 'Режим расчёта', modeLabel[project.mode], () => { setShowDataUpdate(false); document.getElementById('mode')?.scrollIntoView({ behavior: 'smooth' }); }],
    ['04', 'Конфигурация', project.mode === 'manual' ? 'Каталог' : 'Планировка', () => { setShowDataUpdate(false); document.getElementById('configuration')?.scrollIntoView({ behavior: 'smooth' }); }],
    ['05', 'Спецификация', giftPositions ? `Подарок: ${giftPositions}` : 'Подарок: 0', () => { setShowDataUpdate(false); document.getElementById('specification')?.scrollIntoView({ behavior: 'smooth' }); }],
    ['06', 'Клиентский вид', 'Просмотр и экспорт', () => setShowClient(true)],
    ['07', 'Обновление данных', data.meta.version, () => setShowDataUpdate(true)],
  ] as const;

  return (
    <main className="app-shell">
      <header className="topbar" id="project-controls">
        <div className="brand-lockup">
          <img src={publicAsset('/sber-smart-home-logo.jpg')} alt="Умный дом Sber" />
          <div><p className="eyebrow">Конфигуратор оборудования</p><h1>Умный дом Sber</h1></div>
        </div>
        <div className="project-fields">
          <label><span>Проект</span><input value={project.name} onChange={(event) => updateProject({ name: event.target.value })} /></label>
          <label><span>Номер</span><input value={project.number} onChange={(event) => updateProject({ number: event.target.value })} /></label>
        </div>
        <div className="topbar-actions">
          <button className="button-quiet" onClick={resetProject}>Новый</button>
          <button className="button-quiet" onClick={() => setShowProjects(true)}>Проекты <span className="count-badge">{savedProjects.length}</span></button>
          <button className="button-secondary" onClick={saveProject}>Сохранить</button>
          <button className="button-primary" onClick={() => setShowClient(true)}>Клиентский вид</button>
        </div>
      </header>

      <div className="workspace">
        <aside className="steps-panel" aria-label="Этапы настройки">
          <p className="panel-kicker">Настройка проекта</p>
          <nav>
            {steps.map(([numberLabel, title, detail, action], index) => (
              <button className={`step ${showDataUpdate ? (index === 6 ? 'active' : '') : index === 3 ? 'active' : ''}`} key={numberLabel} onClick={action}>
                <span>{numberLabel}</span><strong>{title}</strong><small>{detail}</small>
              </button>
            ))}
          </nav>
          <div className="local-note"><span className="status-dot" />Проекты и импортированные данные хранятся только на этом устройстве.</div>
        </aside>

        {showDataUpdate ? (
          <section className="content data-update-page">
            <div className="page-heading">
              <div><p className="panel-kicker">Обновление данных</p><h2>Проверка новых Excel-файлов</h2><p>Новая версия применяется только после критической проверки. Для всех пользователей данные меняются только при новом развёртывании приложения.</p></div>
              <button className="button-secondary" onClick={() => setShowDataUpdate(false)}>Вернуться к расчёту</button>
            </div>
            <div className="update-grid">
              <article className="upload-card">
                <span className="upload-number">1</span>
                <div><h3>Типовые расчёты</h3><p>Ожидаются четыре листа квартир и лист «Сценарии».</p><label className="file-button"><input type="file" accept=".xlsx" onChange={(event) => setCalculationsFile(event.target.files?.[0] ?? null)} />{calculationsFile?.name ?? 'Выбрать Excel'}</label></div>
              </article>
              <article className="upload-card">
                <span className="upload-number">2</span>
                <div><h3>Каталог и прайс-лист</h3><p>Нужны SKU, официальные названия, описания и РРЦ с НДС.</p><label className="file-button"><input type="file" accept=".xlsx" onChange={(event) => setCatalogFile(event.target.files?.[0] ?? null)} />{catalogFile?.name ?? 'Выбрать Excel'}</label></div>
              </article>
            </div>
            <div className="update-actions">
              <button className="button-primary" disabled={importing || !calculationsFile || !catalogFile} onClick={validateImport}>{importing ? 'Проверяем…' : 'Проверить файлы'}</button>
              <button className="button-danger-quiet" onClick={resetData}>Вернуться к встроенным данным</button>
            </div>
            {importReport && <ImportReportView report={importReport} onApply={applyImport} />}
            {!importReport && (
              <article className="current-data-card">
                <div><p className="panel-kicker">Текущая версия</p><h3>{data.meta.version}</h3><p>{data.meta.source} · РРЦ с {data.meta.priceDate}</p></div>
                <div className="source-metrics"><span><strong>{data.catalog.length}</strong> товаров</span><span><strong>{new Set(data.readyRows.map((row) => row.sku)).size}</strong> SKU в наборах</span><span><strong>4</strong> типа квартир</span></div>
              </article>
            )}
          </section>
        ) : (
          <section className="content">
            <div className="metrics-grid">
              <article className="metric"><span>Квартира</span><strong>{apartment.name}</strong><small>{apartment.area}</small></article>
              <article className="metric"><span>Помещений</span><strong>{roomCount}</strong><small>{project.mode === 'rooms' ? `из ${availableRooms.length} выбрано` : 'вся квартира'}</small></article>
              <article className="metric"><span>Устройств</span><strong>{number.format(result.devices)}</strong><small>по подробным строкам</small></article>
              <article className="metric"><span>Подарок</span><strong>{giftPositions ? `${giftPositions} позиции` : '0'}</strong><small>{giftPositions ? 'умная прихожая' : 'выключен'}</small></article>
              <article className="metric"><span>Оборудование</span><strong>{currency.format(result.total)}</strong><small>РРЦ с НДС</small></article>
              <article className="metric total"><span>Общий итог</span><strong>{currency.format(result.total)}</strong><small>только оборудование</small></article>
            </div>

            <section className="apartment-section" id="apartment">
              <div><p className="panel-kicker">Тип квартиры</p><div className="apartment-tabs">{data.apartments.map((item) => <button className={project.apartment === item.key ? 'selected' : ''} onClick={() => selectApartment(item.key)} key={item.key}><strong>{item.name}</strong><span>{item.area}</span></button>)}</div></div>
              <button className="button-secondary compare-button" onClick={() => setShowCompare(true)}>Сравнить варианты</button>
            </section>

            <section className="control-row" id="mode">
              <div><p className="panel-kicker">Режим расчёта</p><div className="segmented mode-switch"><button className={project.mode === 'rooms' ? 'selected' : ''} onClick={() => updateProject({ mode: 'rooms' })}>По помещениям</button><button className={project.mode === 'categories' ? 'selected' : ''} onClick={() => updateProject({ mode: 'categories' })}>По категориям</button><button className={project.mode === 'manual' ? 'selected' : ''} onClick={() => updateProject({ mode: 'manual' })}>Собрать самостоятельно</button></div></div>
              {project.mode === 'manual' && <div className="color-control"><p className="panel-kicker">Цвет оборудования</p><ColorSelector color={project.color} onSelect={selectColor} /></div>}
            </section>

            {result.invalidSku.length > 0 && <div className="alert error"><strong>Расчёт не прошёл проверку.</strong> В актуальном каталоге нет корректной цены для SKU: {result.invalidSku.join(', ')}.</div>}
            {belowMinimum && result.rows.length > 0 && <div className="alert warning"><strong>Минимальная сумма заказа — {currency.format(data.meta.minimumOrder)}.</strong> Текущий итог не изменён, товары автоматически не добавлялись.</div>}
            {manualHubWarning && <div className="alert warning"><strong>Проверьте наличие хаба.</strong> В ручной комплектации есть умные устройства, но «Умный хаб Sber» не добавлен. Хаб не добавляется автоматически.</div>}

            <section id="configuration">
              {project.mode === 'manual' ? (
                <ManualConfiguration
                  data={data}
                  project={project}
                  filteredCatalog={filteredCatalog}
                  catalogGroups={catalogGroups}
                  catalogSearch={catalogSearch}
                  catalogCategory={catalogCategory}
                  uploadedPlan={uploadedPlan}
                  planInput={planInput}
                  setCatalogSearch={setCatalogSearch}
                  setCatalogCategory={setCatalogCategory}
                  setCartQuantity={setCartQuantity}
                  addToCart={addToCart}
                  setSelectedSku={setSelectedSku}
                  handlePlanFile={handlePlanFile}
                  clearPlan={() => { if (uploadedPlan) URL.revokeObjectURL(uploadedPlan.url); setUploadedPlan(null); }}
                />
              ) : (
                <div className="main-grid">
                  <article className="plan-card">
                    <div className="card-heading">
                      <div><p className="panel-kicker">{project.mode === 'rooms' ? 'Интерактивная планировка' : 'Выбор категорий для всей квартиры'}</p><h2>{apartment.name} · {apartment.area}</h2></div>
                      <div className="plan-actions"><button className="button-quiet small" onClick={() => planInput.current?.click()}>Загрузить свой план</button><input ref={planInput} hidden type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => handlePlanFile(event.target.files?.[0])} /><div className="zoom-controls"><button onClick={() => setZoom((value) => Math.max(80, value - 10))} aria-label="Уменьшить масштаб">−</button><span>{zoom}%</span><button onClick={() => setZoom((value) => Math.min(130, value + 10))} aria-label="Увеличить масштаб">+</button><button onClick={() => setZoom(100)} aria-label="Сбросить масштаб">↺</button></div></div>
                    </div>
                    {project.mode === 'categories' && <div className="category-picker">{CATEGORIES.map((category) => { const selected = project.selectedCategories.includes(category); const categoryResult = calculateReady(data, { apartment: project.apartment, color: project.color, mode: 'categories', selectedRooms: activeRooms, selectedCategories: [category], includeGift: project.includeGift, includeLeakProtection: false, quantityOverrides: project.readyQuantities.categories }); return <button className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => toggleCategory(category)} key={category}><span className={`category-icon ${category.toLowerCase()}`}>{categoryMeta[category].letter}</span><span><strong>{category}</strong><small>{categoryMeta[category].description}</small></span><b>{currency.format(categoryResult.total)}</b></button>; })}</div>}
                    <div className="plan-stage"><PlanView apartment={project.apartment} rooms={availableRooms} selectedRooms={project.mode === 'rooms' ? activeRooms : availableRooms} rows={readyRowsForPlan} interactive={project.mode === 'rooms'} selectedRoom={selectedRoom} onSelectRoom={setSelectedRoom} onToggleRoom={toggleRoom} zoom={zoom} /></div>
                    {project.mode === 'rooms' && <div className="rooms-strip">{availableRooms.map((room) => { const roomRows = readyRowsForPlan.filter((row) => row.room === room); const subtotal = roomRows.reduce((sum, row) => sum + row.amount, 0); return <label key={room}><input type="checkbox" checked={activeRooms.includes(room)} onChange={() => toggleRoom(room)} /><span onClick={() => setSelectedRoom(room)}><strong>{room}</strong><small>{roomRows.reduce((sum, row) => sum + row.quantity, 0)} шт. · {currency.format(subtotal)}</small></span></label>; })}</div>}
                  </article>
                  <DetailsPanel product={selectedProduct} room={selectedRoom} roomRows={selectedRoomRows} onSelectProduct={setSelectedSku} clearProduct={() => setSelectedSku(null)} />
                </div>
              )}
            </section>

            {project.mode !== 'manual' && (
              <section className="option-grid">
                <article className={`option-card ${project.includeGift ? 'selected' : ''}`}><div className="option-heading"><span className="option-symbol">П</span><div><p className="panel-kicker">Подарок</p><h3>Умная прихожая</h3></div><label className="switch"><input type="checkbox" checked={project.includeGift} onChange={(event) => updateProject({ includeGift: event.target.checked })} /><span /></label></div><p>Умный хаб Sber, выключатель и датчик открытия. РРЦ берётся из каталога, статус подарка показывается отдельно.</p></article>
                <article className={`option-card ${project.includeLeakProtection ? 'selected' : ''}`}><div className="option-heading"><span className="option-symbol water">В</span><div><p className="panel-kicker">Рекомендуемый модуль</p><h3>Защита от протечек</h3></div><label className="switch"><input type="checkbox" checked={project.includeLeakProtection} onChange={(event) => updateProject({ includeLeakProtection: event.target.checked })} /><span /></label></div><p>Добавляется по явному выбору ровно один раз. В категории «Безопасность» эти строки уже учтены и не дублируются.</p></article>
              </section>
            )}

            <section className="spec-card" id="specification">
              <div className="spec-heading"><div><p className="panel-kicker">Результат расчёта</p><h2>Спецификация</h2><p>{modeLabel[project.mode]} · {project.color === 'white' ? 'Белый' : 'Карбон'} · {data.meta.version}</p></div><div className="export-buttons"><button className="button-secondary" onClick={downloadExcel}>Скачать Excel</button><button className="button-primary" onClick={downloadPdf}>Скачать PDF</button></div></div>
              <div className="spec-filters"><label className="search-field"><span>⌕</span><input placeholder="Поиск по товару или SKU" value={specSearch} onChange={(event) => setSpecSearch(event.target.value)} /></label><select aria-label="Фильтр по помещению" value={specRoom} onChange={(event) => setSpecRoom(event.target.value)}><option value="all">Все помещения</option>{allSpecRooms.map((room) => <option key={room}>{room}</option>)}</select><select aria-label="Фильтр по категории" value={specCategory} onChange={(event) => setSpecCategory(event.target.value)}><option value="all">Все категории</option>{allSpecCategories.map((category) => <option key={category}>{category}</option>)}</select>{project.mode !== 'manual' && <div className="spec-color-control"><span>Цвет</span><ColorSelector color={project.color} onSelect={selectColor} /></div>}</div>
              <div className="table-scroll"><table><thead><tr><th>Категория</th><th>Помещение</th><th>Товар</th><th>SKU</th><th>Количество</th><th>Цена</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{filteredRows.length ? filteredRows.map((row) => <tr key={row.id}><td><span className={`category-pill ${row.category.toLowerCase()}`}>{row.category}</span></td><td>{project.mode === 'manual' ? <select className="room-select" aria-label={`Помещение ${row.name}`} value={project.manualRooms[row.sku] ?? ''} onChange={(event) => setManualRoom(row.sku, event.target.value as ManualRoom | '')}><option value="">{MANUAL_ROOM_PLACEHOLDER}</option>{MANUAL_ROOMS.map((room) => <option key={room} value={room}>{room}</option>)}</select> : row.room}</td><td><button className="product-cell" onClick={() => setSelectedSku(row.sku)}><ProductImage row={row} compact /><span>{row.name}</span></button></td><td className="sku-cell">{row.sku}</td><td><QuantityControl label={row.name} quantity={row.quantity} onChange={(quantity) => project.mode === 'manual' ? setCartQuantity(row.sku, quantity) : setReadyQuantity(project.mode, row.id, quantity)} /></td><td>{currency.format(row.price)}</td><td><strong>{currency.format(row.amount)}</strong></td><td>{statusText(row) && <span className={`status-tag ${row.gift ? 'gift' : 'recommended'}`}>{statusText(row)}</span>}</td></tr>) : <tr><td className="empty-table" colSpan={8}>В спецификации нет позиций. Измените выбор или добавьте товары из каталога.</td></tr>}</tbody><tfoot><tr><td colSpan={4}>Итого по подробным строкам</td><td>{number.format(result.devices)}</td><td /><td>{currency.format(result.total)}</td><td>{giftPositions ? `Подарок — ${giftPositions} позиции` : 'Подарок — 0'}</td></tr></tfoot></table></div>
            </section>

            <section className="scenarios-section">
              <div className="section-heading"><div><p className="panel-kicker">Сценарии из исходного Excel</p><h2>Что умеет выбранная конфигурация</h2></div><span>{scenarios.reduce((sum, group) => sum + group.items.length, 0)} сценариев</span></div>
              {scenarios.length ? <div className="scenario-grid">{scenarios.map((group) => <article key={group.category}><span className={`category-icon ${group.category.toLowerCase()}`}>{categoryMeta[group.category].letter}</span><h3>{group.category}</h3><p>{group.intro}</p><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div> : <div className="empty-state"><strong>Сценарии пока не определены</strong><p>Для этого ручного состава нет прямой связи со сценариями из исходного файла.</p></div>}
            </section>
            <footer className="app-footer"><span>Данные: {data.meta.version} · РРЦ с {data.meta.priceDate}</span><span>Общий итог включает только оборудование. НДС включён в РРЦ.</span></footer>
          </section>
        )}
      </div>

      {showProjects && <Modal title="Сохранённые проекты" onClose={() => setShowProjects(false)}><div className="saved-projects">{savedProjects.length ? savedProjects.map((item) => { const savedApartment = data.apartments.find((apartmentItem) => apartmentItem.key === item.apartment); return <article key={item.id}><div><strong>{item.name}</strong><span>{item.number}</span><small>{savedApartment?.name} · {modeLabel[item.mode]} · {new Date(item.updatedAt).toLocaleString('ru-RU')}</small></div><div><button className="button-secondary" onClick={() => openProject(item)}>Открыть</button><button className="button-danger-quiet" onClick={() => deleteProject(item.id)}>Удалить</button></div></article>; }) : <div className="empty-state"><strong>Сохранённых проектов нет</strong><p>Назовите текущий проект и нажмите «Сохранить».</p></div>}</div></Modal>}
      {showCompare && <CompareModal rooms={compareRooms} categories={compareCategories} selectedCategories={project.selectedCategories} onClose={() => setShowCompare(false)} onExport={downloadComparison} />}
      {showClient && <ClientView project={project} apartment={apartment} data={data} rows={result.rows} total={result.total} devices={result.devices} scenarios={scenarios} onClose={() => setShowClient(false)} onExcel={downloadExcel} onPdf={downloadPdf} />}
      {project.mode === 'manual' && selectedProduct && <ProductModal product={selectedProduct} quantity={project.manualCart[selectedProduct.sku] ?? 0} onAdd={() => addToCart(selectedProduct.sku)} onClose={() => setSelectedSku(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function ProductModal({ product, quantity, onAdd, onClose }: { product: SourceData['catalog'][number]; quantity: number; onAdd: () => void; onClose: () => void }) {
  return <Modal title="Карточка товара" onClose={onClose}><div className="product-modal-grid"><div className="product-modal-image">{product.image ? <img src={publicAsset(product.image)} alt={product.name} /> : <span className="product-placeholder">{product.sku.slice(0, 2)}</span>}</div><div><p className="sku-line">{product.sku}</p><h2>{product.name}</h2><p className="product-description">{product.description || 'Описание отсутствует в каталоге.'}</p>{product.badge && <span className="product-badge inline">{product.badge}</span>}<div className="room-summary"><span>Актуальная РРЦ</span><strong>{typeof product.price === 'number' ? currency.format(product.price) : 'Нет цены'}</strong></div><button className="button-primary product-modal-add" disabled={typeof product.price !== 'number'} onClick={onAdd}>{quantity ? `Добавить ещё · сейчас ${quantity}` : 'Добавить в спецификацию'}</button></div></div></Modal>;
}

function DetailsPanel({ product, room, roomRows, onSelectProduct, clearProduct }: { product: SourceData['catalog'][number] | undefined | null; room: string; roomRows: SpecificationRow[]; onSelectProduct: (sku: string) => void; clearProduct: () => void }) {
  if (product) {
    const usage = roomRows.filter((row) => row.sku === product.sku).reduce((sum, row) => sum + row.quantity, 0);
    return <aside className="details-card"><button className="back-link" onClick={clearProduct}>← К помещению</button><div className="product-hero">{product.image ? <img src={publicAsset(product.image)} alt={product.name} /> : <span className="product-placeholder">{product.sku.slice(0, 2)}</span>}</div><p className="panel-kicker">Карточка товара</p><h2>{product.name}</h2><p className="sku-line">{product.sku}</p><p className="product-description">{product.description || 'Описание отсутствует в каталоге.'}</p><div className="room-summary"><span>Актуальная РРЦ</span><strong>{typeof product.price === 'number' ? currency.format(product.price) : 'Нет цены'}</strong></div><dl className="product-facts"><div><dt>В выбранном помещении</dt><dd>{usage || '—'}</dd></div><div><dt>Источник</dt><dd>Каталог 2Q 2026</dd></div></dl></aside>;
  }
  const subtotal = roomRows.reduce((sum, row) => sum + row.amount, 0);
  return <aside className="details-card"><p className="panel-kicker">Выбранное помещение</p><h2>{room || 'Помещение не выбрано'}</h2><p className="muted">{roomRows.reduce((sum, row) => sum + row.quantity, 0)} устройств</p><div className="room-summary"><span>Стоимость помещения</span><strong>{currency.format(subtotal)}</strong></div><div className="device-list">{roomRows.map((row) => <button onClick={() => onSelectProduct(row.sku)} key={row.id}><ProductImage row={row} compact /><span><strong>{row.name}</strong><small>{row.sku} · {row.quantity} шт.</small></span><b>{currency.format(row.amount)}</b></button>)}</div>{!roomRows.length && <div className="empty-state small"><strong>Нет выбранных устройств</strong><p>Включите помещение или выберите другое.</p></div>}</aside>;
}

function ManualConfiguration({ data, project, filteredCatalog, catalogGroups, catalogSearch, catalogCategory, uploadedPlan, planInput, setCatalogSearch, setCatalogCategory, setCartQuantity, addToCart, setSelectedSku, handlePlanFile, clearPlan }: { data: SourceData; project: ConfiguratorProject; filteredCatalog: SourceData['catalog']; catalogGroups: string[]; catalogSearch: string; catalogCategory: string; uploadedPlan: { url: string; type: string; name: string } | null; planInput: React.RefObject<HTMLInputElement | null>; setCatalogSearch: (value: string) => void; setCatalogCategory: (value: string) => void; setCartQuantity: (sku: string, quantity: number) => void; addToCart: (sku: string) => void; setSelectedSku: (sku: string) => void; handlePlanFile: (file?: File) => void; clearPlan: () => void }) {
  return <div className="manual-layout"><section className="manual-sidebar"><article className="manual-card"><div className="card-heading compact-heading"><div><p className="panel-kicker">Визуальная подложка</p><h2>Собственный план</h2></div></div><div className="manual-plan">{uploadedPlan ? <><PlanView apartment={project.apartment} rooms={[]} selectedRooms={[]} rows={[]} interactive={false} selectedRoom="" onSelectRoom={() => undefined} onToggleRoom={() => undefined} zoom={100} uploadedPlan={uploadedPlan} /><button className="button-danger-quiet" onClick={clearPlan}>Удалить подложку</button></> : <div className="plan-upload-empty"><span>PDF · JPG · PNG</span><strong>Загрузите план квартиры</strong><p>Он будет только визуальной подложкой. Комнаты и устройства не распознаются.</p><button className="button-secondary" onClick={() => planInput.current?.click()}>Выбрать файл</button></div>}<input ref={planInput} hidden type="file" accept="image/png,image/jpeg,application/pdf" onChange={(event) => handlePlanFile(event.target.files?.[0])} /></div></article><article className="manual-card hints-card"><p className="panel-kicker">Поля для самопроверки</p><h2>Подсказки комплектации</h2><p>Количество связано со строкой товара в ручной спецификации.</p><div className="hint-grid">{MANUAL_HINTS.map(({ label, displayName, help, sku }) => { const product = data.catalog.find((item) => item.sku === sku); const quantity = project.manualCart[sku] ?? 0; return <label key={sku}><span>{label}</span><input aria-label={label} type="number" min="0" max="999" value={quantity} onChange={(event) => setCartQuantity(sku, Number(event.target.value))} /><strong>{displayName}</strong><small>{help}{typeof product?.price === 'number' ? ` · ${currency.format(product.price)}` : ''}</small>{quantity > 0 && <small className="replacement-hint">Уже в спецификации: {quantity} шт. Новое значение заменит текущее количество.</small>}</label>; })}</div></article></section><section className="catalog-card"><div className="spec-heading"><div><p className="panel-kicker">Актуальный прайс-лист</p><h2>Каталог оборудования</h2><p>{data.catalog.length} товаров · цены с {data.meta.priceDate}</p></div></div><div className="spec-filters"><label className="search-field"><span>⌕</span><input placeholder="Название или SKU" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} /></label><select aria-label="Фильтр каталога" value={catalogCategory} onChange={(event) => setCatalogCategory(event.target.value)}><option value="all">Все группы</option>{catalogGroups.map((group) => <option key={group}>{group}</option>)}</select></div><div className="catalog-grid">{filteredCatalog.map((product) => <article className="product-card" key={product.sku}><button className="product-preview" onClick={() => setSelectedSku(product.sku)}>{product.image ? <img src={publicAsset(product.image)} alt={product.name} /> : <span className="product-placeholder">{product.sku.slice(0, 2)}</span>}{product.badge && <span className="product-badge">{product.badge}</span>}</button><div><span className="sku-line">{product.sku}</span><h3>{product.name}</h3><p>{product.description}</p></div><footer><strong>{typeof product.price === 'number' ? currency.format(product.price) : 'Нет цены'}</strong><button className="button-primary" disabled={typeof product.price !== 'number'} onClick={() => addToCart(product.sku)}>{project.manualCart[product.sku] ? `Добавлено: ${project.manualCart[product.sku]}` : 'Добавить'}</button></footer></article>)}</div></section></div>;
}

function ImportReportView({ report, onApply }: { report: ImportReport; onApply: () => void }) {
  const issues = [
    ...report.missingSheets.map((value) => `Нет обязательного листа: ${value}`),
    ...report.missingSku.map((value) => `SKU отсутствует в каталоге: ${value}`),
    ...report.duplicateSku.map((value) => `Дублирующийся SKU каталога: ${value}`),
    ...report.invalidPriceSku.map((value) => `Некорректная цена: ${value}`),
    ...report.externalFormulaWithoutValue.map((value) => `Внешняя формула без сохранённой цены: ${value}`),
  ];
  return <article className={`import-report ${report.valid ? 'success' : 'failed'}`}><div className="report-title"><div><p className="panel-kicker">Отчёт проверки</p><h3>{report.valid ? 'Критическая проверка пройдена' : 'Импорт заблокирован'}</h3></div><span>{report.valid ? 'Готово к применению' : `${issues.length} критических проблем`}</span></div><div className="source-metrics"><span><strong>{report.requiredSheetsFound.length}</strong> обязательных листов</span><span><strong>{report.apartmentTypesFound}</strong> типа квартир</span><span><strong>{report.productCount}</strong> товаров</span><span><strong>{report.readySkuCount}</strong> SKU в наборах</span></div>{issues.length > 0 && <div className="report-list critical"><strong>Критические проблемы</strong><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}{(report.headingIssues.length > 0 || report.formulaIssues.length > 0) && <div className="report-list warning-list"><strong>Некритические особенности</strong><ul>{[...report.headingIssues, ...report.formulaIssues].map((issue) => <li key={issue}>{issue} Приложение пересчитает результат по подробным строкам.</li>)}</ul></div>}<button className="button-primary" disabled={!report.valid} onClick={onApply}>Применить проверенные данные</button></article>;
}

function CompareSpecification({ title, rows, total }: { title: string; rows: SpecificationRow[]; total: number }) {
  return <article className="compare-spec"><h3>{title}</h3><div className="table-scroll"><table><thead><tr><th>Помещение</th><th>Товар</th><th>SKU</th><th>Кол-во</th><th>Сумма</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.room}</td><td>{row.name}</td><td className="sku-cell">{row.sku}</td><td>{row.quantity}</td><td>{currency.format(row.amount)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>Итого</td><td>{rows.reduce((sum, row) => sum + row.quantity, 0)}</td><td>{currency.format(total)}</td></tr></tfoot></table></div></article>;
}

function CompareModal({ rooms, categories, selectedCategories, onClose, onExport }: { rooms: ReturnType<typeof calculateReady>; categories: ReturnType<typeof calculateReady>; selectedCategories: SmartCategory[]; onClose: () => void; onExport: () => void }) {
  const [showFull, setShowFull] = useState(false);
  const left = new Map(aggregateBySku(rooms).map((item) => [item.sku, item]));
  const right = new Map(aggregateBySku(categories).map((item) => [item.sku, item]));
  const differences = Array.from(new Set([...left.keys(), ...right.keys()])).map((sku) => ({ sku, left: left.get(sku), right: right.get(sku) })).filter((item) => item.left?.quantity !== item.right?.quantity);
  return <Modal title="Сравнение вариантов" onClose={onClose} wide><div className="compare-grid"><article><p className="panel-kicker">Вариант 1</p><h3>По помещениям</h3><div className="compare-metrics"><span><strong>{rooms.devices}</strong> устройств</span><span><strong>{currency.format(rooms.total)}</strong> итог</span></div></article><article><p className="panel-kicker">Вариант 2</p><h3>По категориям</h3><p className="compare-subtitle">{selectedCategories.join(', ') || 'Категории не выбраны'}</p><div className="compare-metrics"><span><strong>{categories.devices}</strong> устройств</span><span><strong>{currency.format(categories.total)}</strong> итог</span></div></article></div><h3 className="difference-heading">Различающиеся позиции</h3><div className="difference-list">{differences.length ? differences.map(({ sku, left: leftItem, right: rightItem }) => <div key={sku}><span><strong>{leftItem?.name ?? rightItem?.name}</strong><small>{sku}</small></span><b>{leftItem?.quantity ?? 0} шт.</b><i>→</i><b>{rightItem?.quantity ?? 0} шт.</b></div>) : <div className="empty-state"><strong>Состав совпадает</strong><p>Количество каждой позиции одинаково.</p></div>}</div><p className="compare-note">Варианты показаны отдельно и не объединяются в одну спецификацию.</p><div className="compare-actions"><button className="button-primary" onClick={() => setShowFull((value) => !value)}>{showFull ? 'Скрыть полные спецификации' : 'Сравнить полные спецификации'}</button><button className="button-secondary" onClick={onExport}>Скачать сравнение Excel</button></div>{showFull && <div className="full-compare-grid"><CompareSpecification title="По помещениям" rows={rooms.rows} total={rooms.total} /><CompareSpecification title="По категориям" rows={categories.rows} total={categories.total} /></div>}</Modal>;
}

function ClientView({ project, apartment, data, rows, total, devices, scenarios, onClose, onExcel, onPdf }: { project: ConfiguratorProject; apartment: Apartment; data: SourceData; rows: SpecificationRow[]; total: number; devices: number; scenarios: SourceData['scenarios']; onClose: () => void; onExcel: () => void; onPdf: () => void }) {
  return <div className="client-view" role="dialog" aria-modal="true" aria-label="Клиентский вид"><header><img src={publicAsset('/sber-smart-home-logo.jpg')} alt="Умный дом Sber" /><div className="client-actions"><button onClick={onExcel}>Excel</button><button onClick={onPdf}>PDF</button><a href="https://sberdevices.ru/b2b/" target="_blank" rel="noreferrer">Оформить заказ</a><button onClick={onClose}>Закрыть</button></div></header><main><section className="client-title"><p>Проект {project.number}</p><h1>{project.name}</h1><span>{apartment.name} · {apartment.area} · {modeLabel[project.mode]} · {project.color === 'white' ? 'Белый' : 'Карбон'}</span></section><section className="client-metrics"><article><span>Устройств</span><strong>{devices}</strong></article></section>{total < data.meta.minimumOrder && rows.length > 0 && <div className="alert warning"><strong>Минимальная сумма заказа — {currency.format(data.meta.minimumOrder)}.</strong> Состав и итог не изменены.</div>}<section className="client-section"><h2>Спецификация</h2><div className="table-scroll"><table><thead><tr><th>Категория</th><th>Помещение</th><th>Наименование</th><th>SKU</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.category}</td><td>{row.room}</td><td>{row.name}{statusText(row) && <small className="inline-status">{statusText(row)}</small>}</td><td>{row.sku}</td><td>{row.quantity}</td><td>{currency.format(row.price)}</td><td>{currency.format(row.amount)}</td></tr>)}</tbody></table></div></section><section className="client-total"><span>Общий итог</span><strong>{currency.format(total)}</strong></section><section className="client-section"><h2>Сценарии</h2>{scenarios.length ? <div className="client-scenarios">{scenarios.map((group) => <article key={group.category}><h3>{group.category}</h3><p>{group.intro}</p><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div> : <p>Для текущего состава сценарии из источника не определены.</p>}</section><footer><span>Данные: {data.meta.version} · РРЦ с {data.meta.priceDate}</span></footer></main></div>;
}
