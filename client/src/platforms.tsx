import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, CircleHelp, Filter, Link2, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Bootstrap, Connection, ConnectorDefinition, Platform } from './api';
import { Button, EmptyState, Field, Modal } from './ui';
import { t, useI18n } from './i18n';
import { catalogMessages } from './locales/catalog';

type Capability = 'native' | 'service' | 'bridge' | 'export';
type Filters = { query: string; region: string; category: string; capability: string };
const DEFAULT_FILTERS: Filters = { query: '', region: '', category: '', capability: '' };
const CATEGORY_LABELS = { article: '文章', social: '动态', video: '视频' };
const CAPABILITY_LABELS: Record<Capability, string> = { native: '原生接口', service: '外部服务', bridge: '浏览器交接', export: '仅导出' };
const FORMAT_LABELS: Record<string, string> = { text: '文字', dynamic: '动态', image: '图片', video: '视频', article: '文章', markdown: 'Markdown', html: 'HTML', thread: '连续帖', audio: '音频', link: '链接', pdf: 'PDF' };
const DIRECTORY_STATE_KEY = 'creator-platform:directory-view';

export function publishingOptions(platform: Platform, definitions: ConnectorDefinition[]) {
  const compatible = definitions.filter(d => d.platformIds.includes(platform.id));
  const native = compatible.filter(d => d.id.startsWith('native:'));
  const bridge = compatible.filter(d => d.mode === 'bridge');
  const service = compatible.filter(d => !d.id.startsWith('native:') && d.mode !== 'bridge' && d.mode !== 'custom');
  const custom = compatible.filter(d => d.mode === 'custom');
  const capabilities: Capability[] = [...(native.length ? ['native' as const] : []), ...(service.length ? ['service' as const] : []), ...(bridge.length ? ['bridge' as const] : [])];
  if (!capabilities.length) capabilities.push('export');
  return { native, service, bridge, custom, compatible, capabilities };
}

export function matchesPlatform(platform: Platform, definitions: ConnectorDefinition[], filters: Filters) {
  const options = publishingOptions(platform, definitions);
  const original = platform as Platform & {originalName?: string; originalDescription?: string; originalShortName?: string};
  const haystack = [platform.name, platform.shortName, platform.id, platform.description, original.originalName, original.originalDescription, original.originalShortName, catalogMessages[original.originalName || platform.name], ...options.compatible.flatMap(d => [d.name, catalogMessages[d.name]])].filter(Boolean).join(' ').toLowerCase();
  return (!filters.query.trim() || haystack.includes(filters.query.trim().toLowerCase()))
    && (!filters.region || platform.region === filters.region)
    && (!filters.category || platform.category === filters.category || platform.formats.includes(filters.category === 'social' ? 'dynamic' : filters.category))
    && (!filters.capability || options.capabilities.includes(filters.capability as Capability));
}

export function platformSearchText(platform?: Platform) {
  if (!platform) return '';
  return [platform.name, platform.shortName, platform.id, platform.originalName, platform.originalShortName,
    catalogMessages[platform.originalName || platform.name], catalogMessages[platform.originalShortName || platform.shortName]].filter(Boolean).join(' ').toLowerCase();
}

function readDirectoryState(): { filters: Filters; activeId: string } {
  try {
    const value = JSON.parse(sessionStorage.getItem(DIRECTORY_STATE_KEY) || '{}');
    const filters = Object.fromEntries(Object.keys(DEFAULT_FILTERS).map(key => [key, typeof value.filters?.[key] === 'string' ? value.filters[key] : ''])) as Filters;
    return { filters, activeId: typeof value.activeId === 'string' ? value.activeId : '' };
  } catch { return { filters: { ...DEFAULT_FILTERS }, activeId: '' }; }
}

function useCompactDirectory() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1050px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1050px)');
    const change = () => setCompact(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  return compact;
}

function configuredConnections(platform: Platform, definitions: ConnectorDefinition[], connections: Connection[]) {
  const compatible = publishingOptions(platform, definitions).compatible;
  return connections.filter(connection => connection.platformId === platform.id && connection.enabled && connection.configured
    && compatible.some(definition => definition.id === connection.connector || (definition.id.startsWith('native:') && connection.connector === 'native')));
}

function isExperimental(platform: Platform) { return platform.notes.some(note => note.includes('实验性') || /\bexperimental\b/i.test(note)); }
function formatsText(platform: Platform) { return platform.formats.map(format => t(FORMAT_LABELS[format] || format)).join(' / ') || t(CATEGORY_LABELS[platform.category]); }

export function platformMonogram(platform?: Platform) {
  if (!platform) return '';
  const marks: Record<string, string> = { xiaohongshu: 'RN', wechat: 'WX', wechat_channels: 'WXC', zhihu: 'ZH', bilibili: 'Bili', threads: 'Th', bluesky: 'BS' };
  if (/[\u4e00-\u9fff]/.test(platform.shortName) || platform.shortName.length <= 4) return platform.shortName;
  return marks[platform.id] || platform.id.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase();
}

function connectorOutcome(definition: ConnectorDefinition) {
  if (definition.mode === 'bridge') return '浏览器审阅后发布';
  if (definition.mode === 'draft') return '默认保存草稿';
  if (definition.id === 'native:teams') return '工作流受理后待确认';
  if (definition.id === 'xiaohongshu') return '调用后需核对结果';
  if (definition.id === 'postiz') return '远端队列需核对';
  if (definition.mode === 'custom') return '自行实现发布服务';
  return '通过接口提交发布';
}

function platformOutcome(platform: Platform, definitions: ConnectorDefinition[]) {
  const options = publishingOptions(platform, definitions);
  if (options.capabilities.includes('export')) return '复制或导出后发布';
  if (platform.id === 'teams') return '工作流受理后待确认';
  if (platform.id === 'xiaohongshu') return '图文 / 同机视频需核对';
  if (options.native.some(d => d.mode === 'draft')) return '原生接口默认草稿';
  if (!options.native.length && options.service.some(d => d.mode === 'draft')) return '草稿或浏览器审阅';
  if (!options.native.length && !options.service.length) return '前台审阅，手动完成发布';
  if (!options.native.length) return '外部服务提交，核对结果';
  return '';
}

function PathTags({ platform, definitions }: { platform: Platform; definitions: ConnectorDefinition[] }) {
  useI18n();
  return <span className="platform-path-tags">{publishingOptions(platform, definitions).capabilities.map(capability => <span className="platform-path-tag" key={capability}>{t(CAPABILITY_LABELS[capability])}</span>)}</span>;
}

function PlatformFilters({ value, onChange, disabled = false }: { value: Filters; onChange: (value: Filters) => void; disabled?: boolean }) {
  useI18n();
  const change = (key: keyof Filters, next: string) => onChange({ ...value, [key]: next });
  return <div className="platform-filter-fields">
    <Field label={t("搜索平台")} className="platform-query"><span className="platform-search-control"><Search size={16} aria-hidden="true" /><input type="search" placeholder={t("名称、英文 ID 或连接方式")} value={value.query} onChange={event => change('query', event.target.value)} disabled={disabled} /></span></Field>
    <Field label={t("平台地区")}><select value={value.region} onChange={event => change('region', event.target.value)} disabled={disabled}><option value="">{t("全部地区")}</option><option value="domestic">{t("国内")}</option><option value="global">{t("海外")}</option></select></Field>
    <Field label={t("内容类型")}><select value={value.category} onChange={event => change('category', event.target.value)} disabled={disabled}><option value="">{t("全部类型")}</option><option value="article">{t("文章")}</option><option value="social">{t("动态")}</option><option value="video">{t("视频")}</option></select></Field>
    <Field label={t("发布路径")}><select value={value.capability} onChange={event => change('capability', event.target.value)} disabled={disabled}><option value="">{t("全部路径")}</option>{Object.entries(CAPABILITY_LABELS).map(([id, name]) => <option value={id} key={id}>{t(name)}</option>)}</select></Field>
  </div>;
}

export function PlatformPicker({ platforms, definitions, selected, onChange, disabled, openDirectory, connections = [] }: { platforms: Platform[]; definitions: ConnectorDefinition[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean; openDirectory: () => void; connections?: Connection[] }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [onlySelected, setOnlySelected] = useState(false);
  const selectedPlatforms = selected.flatMap(id => { const platform = platforms.find(p => p.id === id); return platform ? [platform] : []; });
  const visibleChips = showAll ? selectedPlatforms : selectedPlatforms.slice(0, 8);
  const filtered = useMemo(() => platforms.filter(platform => matchesPlatform(platform, definitions, filters) && (!onlySelected || draft.includes(platform.id))), [platforms, definitions, filters, onlySelected, draft]);
  const selectedVisible = filtered.filter(platform => draft.includes(platform.id)).length;
  const allVisibleSelected = filtered.length > 0 && selectedVisible === filtered.length;
  const updateDraft = (ids: string[]) => setDraft([...new Set(ids)].filter(id => platforms.some(platform => platform.id === id)));
  const toggleFiltered = () => updateDraft(allVisibleSelected ? draft.filter(id => !filtered.some(platform => platform.id === id)) : [...draft, ...filtered.map(platform => platform.id)]);
  const startSelection = () => { updateDraft(selected); setOnlySelected(false); setOpen(true); };
  const applySelection = () => { onChange(draft.filter(id => platforms.some(platform => platform.id === id))); setOpen(false); };
  return <section className="platform-picker" aria-label={t("创作目标平台")}>
    <div className="picker-heading"><h3>{t("目标平台")}<span>{t('{count} 个', {count: selectedPlatforms.length})}</span></h3><Button className="quiet" disabled={disabled} onClick={startSelection}><SlidersHorizontal size={14} aria-hidden="true" />{t("选择平台")}</Button></div>
    {selectedPlatforms.length ? <div className={`picker-chips ${showAll ? 'expanded' : ''}`}>{visibleChips.map(platform => <span className="picker-chip" key={platform.id}><span>{platform.name}</span><button className="picker-chip-remove" aria-label={t('移除目标平台 {name}', {name: platform.name})} onClick={() => onChange(selected.filter(id => id !== platform.id))} disabled={disabled}><X size={13} aria-hidden="true" /></button></span>)}</div> : <p className="picker-empty">{t("选择目标平台后，生成对应的内容版本。")}</p>}
    <div className="picker-footer">{selectedPlatforms.length > 8 ? <button className="text-button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>{showAll ? t('收起已选平台') : t('查看其余 {count} 个', {count: selectedPlatforms.length - 8})}<ChevronDown size={13} className={showAll ? 'rotated' : ''} aria-hidden="true" /></button> : <span>{t("先适配内容，再安排账号分发。")}</span>}<button className="text-button" disabled={disabled} onClick={openDirectory}>{t("浏览平台目录")}<ArrowRight size={13} aria-hidden="true" /></button></div>
    {open && <div className="platform-selection-overlay"><Modal title={t("选择创作平台")} close={() => setOpen(false)}><div className="platform-selection-body">
      <p className="platform-selection-intro">{t("选择要生成的版本。平台选择与发布账号分开，应用后才会更新本次创作。")}</p>
      <PlatformFilters value={filters} onChange={setFilters} disabled={disabled} />
      <div className="picker-selection-toolbar"><label className="picker-only-selected"><input type="checkbox" checked={onlySelected} onChange={event => setOnlySelected(event.target.checked)} disabled={disabled} />{t("仅看已选")}</label><span role="status">{t('{count} 个结果 · 当前筛选已选 {selected} 个', {count: filtered.length, selected: selectedVisible})}</span></div>
      <div className="picker-bulk-actions"><button className="text-button" disabled={disabled || !filtered.length} onClick={toggleFiltered}>{t(allVisibleSelected ? '取消当前筛选 · {count}' : '全选当前筛选 · {count}', {count: filtered.length})}</button><button className="text-button" disabled={disabled || !draft.length} onClick={() => updateDraft([])}>{t("清空全部选择")}</button></div>
      <div className="picker-selection-list" aria-label={t("可选目标平台")}>{filtered.map(platform => {
        const configured = configuredConnections(platform, definitions, connections).length;
        const outcome = platformOutcome(platform, definitions);
        return <label className={`picker-selection-row ${draft.includes(platform.id) ? 'selected' : ''}`} key={platform.id}><input type="checkbox" checked={draft.includes(platform.id)} onChange={event => updateDraft(event.target.checked ? [...draft, platform.id] : draft.filter(id => id !== platform.id))} disabled={disabled} /><span className="picker-selection-row-copy"><span className="picker-selection-row-heading"><strong>{platform.name}</strong>{isExperimental(platform) && <span className="platform-experimental-tag">{t("实验性")}</span>}{configured > 0 && <span className="platform-configured-tag">{t('{count} 个已配置', {count: configured})}</span>}</span><span className="picker-selection-row-meta">{t(platform.region === 'domestic' ? '国内' : '海外')} · {formatsText(platform)}</span><PathTags platform={platform} definitions={definitions} />{outcome && <span className="picker-selection-row-note">{t(outcome)}</span>}</span><Check className="picker-selection-check" size={16} aria-hidden="true" /></label>;
      })}{!filtered.length && <EmptyState title={t(onlySelected ? '当前筛选没有已选平台' : '没有匹配的平台')} description={t("调整关键词或筛选条件，继续选择目标平台。")} icon={<Search size={24} />} action={<Button className="quiet" onClick={() => { setFilters({ ...DEFAULT_FILTERS }); setOnlySelected(false); }}>{t("清空筛选")}</Button>} />}</div>
      <p className="picker-selection-hint">{t('已选择 {count} / {total} 个。全选或取消仅影响当前筛选，其他已选平台会保留。', {count: draft.length, total: platforms.length})}</p>
    </div><div className="platform-selection-footer"><Button className="quiet" onClick={() => setOpen(false)}>{t("取消")}</Button><Button className="primary" disabled={disabled} onClick={applySelection}>{t('应用 {count} 个平台', {count: draft.length})}</Button></div></Modal></div>}
  </section>;
}

function PlatformDetails({ platform, data, selected, addPlatformToComposer, connectPlatform, disabled }: { platform: Platform; data: Bootstrap; selected: boolean; addPlatformToComposer?: (id: string) => void; connectPlatform: (id: string) => void; disabled: boolean }) {
  useI18n();
  const options = publishingOptions(platform, data.connectorDefinitions);
  const standard = [...options.native, ...options.service, ...options.bridge];
  const configured = configuredConnections(platform, data.connectorDefinitions, data.connections);
  return <div className="directory-detail-content">
    <div className="directory-detail-heading"><span className="directory-monogram" aria-hidden="true">{platformMonogram(platform)}</span><div><h2>{platform.name}</h2><p>{t(platform.region === 'domestic' ? '国内' : '海外')} · {t(CATEGORY_LABELS[platform.category])}{isExperimental(platform) && <span className="platform-experimental-tag">{t("实验性适配")}</span>}</p></div></div>
    <div className="directory-detail-actions">{addPlatformToComposer && <Button className="primary" disabled={disabled} onClick={() => addPlatformToComposer(platform.id)}>{selected ? <Check size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}{t(selected ? '已选，前往创作' : '加入本次创作')}</Button>}<Button className="quiet" disabled={disabled} onClick={() => connectPlatform(platform.id)}><Link2 size={15} aria-hidden="true" />{t("配置发布账号")}</Button></div>
    <p className="directory-account-status">{configured.length ? t('{count} 个已启用且已配置的渠道。发布权限仍以实际接口检查为准。', {count: configured.length}) : t('尚未配置发布渠道。可以先生成版本，再连接账号或导出。')}</p>
    <section className="directory-detail-section"><h3>{t("可选发布路径")}</h3>{standard.length ? <div className="directory-connector-list">{standard.map(definition => <div className="directory-definition" key={definition.id}><div className="directory-definition-heading"><strong>{definition.name}</strong><span className="platform-outcome-tag">{t(connectorOutcome(definition))}</span></div><p>{t(definition.description)}</p>{definition.fields.some(field => field.required) && <p className="directory-definition-requirements">{t('需要：{fields}', {fields: definition.fields.filter(field => field.required).map(field => t(field.label)).join(t('、'))})}</p>}</div>)}</div> : <p className="directory-export-note">{t("当前没有现成发布连接器。复制或导出内容，在平台编辑器完成发布。")}</p>}{options.custom.length > 0 && <p className="directory-custom-note">{t("另支持自定义 Webhook，需要自行实现发布服务，不计入现成发布路径。")}</p>}</section>
    <section className="directory-detail-section"><h3>{t("内容格式与默认限制")}</h3><dl className="directory-specs"><div><dt>{t("内容格式")}</dt><dd>{formatsText(platform)}</dd></div><div><dt>{t("标题")}</dt><dd>{platform.titleLimit > 0 ? t('{count} 字符', {count: platform.titleLimit.toLocaleString()}) : t('未设默认上限')}</dd></div><div><dt>{t("正文")}</dt><dd>{platform.bodyLimit > 0 ? t(platform.id === 'x' ? '{count} 加权字符 / 帖' : '{count} 字符', {count: platform.bodyLimit.toLocaleString()}) : t('未设默认上限')}</dd></div>{platform.requiredMedia && <div><dt>{t("媒体要求")}</dt><dd>{t(platform.requiredMedia === 'image' ? '需图片素材' : platform.requiredMedia === 'video' ? '需视频素材' : '需附带媒体素材')}</dd></div>}<div><dt>{t("建议表达")}</dt><dd>{t(platform.recommendedTone)}</dd></div></dl></section>
    {platform.notes.length > 0 && <section className="directory-detail-section directory-important-notes"><h3><CircleHelp size={14} aria-hidden="true" />{t("发布条件与注意事项")}</h3><ul>{platform.notes.map((note, index) => <li key={index}>{t(note)}</li>)}</ul></section>}
  </div>;
}

export function PlatformDirectoryPage({ data, connectPlatform, selectedPlatformIds = [], addPlatformToComposer, disabled = false }: { data: Bootstrap; connectPlatform: (platformId: string) => void; selectedPlatformIds?: string[]; addPlatformToComposer?: (platformId: string) => void; disabled?: boolean }) {
  useI18n();
  const [initial] = useState(readDirectoryState);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [activeId, setActiveId] = useState(initial.activeId);
  const [showDetails, setShowDetails] = useState(false);
  const compact = useCompactDirectory();
  const filtered = useMemo(() => data.platforms.filter(platform => matchesPlatform(platform, data.connectorDefinitions, filters)), [data.platforms, data.connectorDefinitions, filters]);
  const activePlatform = filtered.find(platform => platform.id === activeId) || filtered[0];
  const domesticCount = data.platforms.filter(platform => platform.region === 'domestic').length;
  const hasFilter = Object.values(filters).some(Boolean);
  useEffect(() => { if (activePlatform && activeId !== activePlatform.id) setActiveId(activePlatform.id); }, [activePlatform, activeId]);
  useEffect(() => { try { sessionStorage.setItem(DIRECTORY_STATE_KEY, JSON.stringify({ filters, activeId })); } catch { /* Storage may be disabled; browsing still works. */ } }, [filters, activeId]);
  useEffect(() => { if (!compact || !activePlatform) setShowDetails(false); }, [compact, activePlatform]);
  const openPlatform = (platform: Platform) => { setActiveId(platform.id); if (compact) setShowDetails(true); };
  const addToComposer = addPlatformToComposer ? (id: string) => { setShowDetails(false); addPlatformToComposer(id); } : undefined;
  const connect = (id: string) => { setShowDetails(false); connectPlatform(id); };
  return <section className="platform-directory" aria-label={t("平台目录")}>
    <div className="directory-overview"><p>{t('{count} 个平台 · {domestic} 个国内 · {global} 个海外', {count: data.platforms.length, domestic: domesticCount, global: data.platforms.length - domesticCount})}</p><span>{t("所有平台可适配内容，发布方式按连接器和账号条件决定。")}</span></div>
    <div className="directory-filter-panel"><PlatformFilters value={filters} onChange={setFilters} /><div className="directory-filter-result"><span role="status">{t(hasFilter ? '找到 {count} 个平台' : '全部 {count} 个平台', {count: filtered.length})}<span className="directory-result-guidance">{t(' · 选择一行查看发布条件')}</span></span>{hasFilter && <button className="text-button" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>{t("清空筛选")}</button>}</div></div>
    {!filtered.length ? <div className="panel"><EmptyState title={t("没有符合条件的平台")} description={t("试试其他关键词，或调整地区、类型和发布路径。")} icon={<Filter size={25} />} action={<Button className="quiet" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>{t("清空筛选")}</Button>} /></div> : <div className="directory-columns"><div className="directory-list-panel"><div className="directory-list-heading"><span>{t("平台")}</span><span>{t("可选发布路径")}</span><span>{t("渠道配置")}</span><span /></div><div className="directory-platform-list" aria-label={t("平台列表")}>{filtered.map(platform => {
      const configured = configuredConnections(platform, data.connectorDefinitions, data.connections).length;
      const outcome = platformOutcome(platform, data.connectorDefinitions);
      return <button className={`directory-platform-row ${activePlatform?.id === platform.id ? 'active' : ''}`} key={platform.id} onClick={() => openPlatform(platform)} aria-pressed={activePlatform?.id === platform.id} aria-label={t('查看 {name} 的发布条件', {name: platform.name})} aria-haspopup={compact ? 'dialog' : undefined}>
        <span className="directory-row-identity"><span className="directory-row-monogram" aria-hidden="true">{platformMonogram(platform)}</span><span><span className="directory-row-name">{platform.name}{isExperimental(platform) && <span className="platform-experimental-tag">{t("实验性")}</span>}</span><span className="directory-row-meta">{t(platform.region === 'domestic' ? '国内' : '海外')} · {formatsText(platform)}</span></span></span>
        <span className="directory-row-paths"><PathTags platform={platform} definitions={data.connectorDefinitions} />{outcome && <span className="directory-row-outcome">{t(outcome)}</span>}</span><span className={`directory-row-accounts ${configured ? 'configured' : ''}`}>{configured ? t('{count} 个已配置', {count: configured}) : t('未配置')}</span><ChevronRight className="directory-row-arrow" size={15} aria-hidden="true" />
      </button>;
    })}</div></div>{!compact && activePlatform && <aside className="directory-detail-panel" aria-label={t('{name} 的发布详情', {name: activePlatform.name})}><PlatformDetails platform={activePlatform} data={data} selected={selectedPlatformIds.includes(activePlatform.id)} addPlatformToComposer={addToComposer} connectPlatform={connect} disabled={disabled} /></aside>}</div>}
    <p className="directory-footnote"><CircleHelp size={14} aria-hidden="true" />{t("“已配置”表示本地资料完整，不代表已通过鉴权。草稿、浏览器交接和接口受理均与正式发布分开记录。")}</p>
    {compact && showDetails && activePlatform && <div className="platform-detail-overlay"><Modal title={t('{name} · 发布详情', {name: activePlatform.name})} close={() => setShowDetails(false)}><PlatformDetails platform={activePlatform} data={data} selected={selectedPlatformIds.includes(activePlatform.id)} addPlatformToComposer={addToComposer} connectPlatform={connect} disabled={disabled} /></Modal></div>}
  </section>;
}
