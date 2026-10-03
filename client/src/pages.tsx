import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Bootstrap, Connection, ConnectorDefinition, Content, Job, Profile, Settings } from './api';
import { errorText, request, send } from './api';
import { mediaUrl } from './urls';
import { detectMultiPost, dispatchMultiPost } from '../bridge';
import { ArrowLeft, ArrowRight, ChevronDown, Clock3, ExternalLink, Eye, EyeOff, Files, Link2, LoaderCircle, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorMessage, Field, Modal, formatDate, jobKind, jobLabels } from './ui';
import './management.css';

type PageProps = {
  data: Bootstrap;
  refresh: () => Promise<Bootstrap>;
  notify: (message: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  navigate?: (page: string) => void;
  globalBusy?: boolean;
};
type TestResult = { at: string; ok: boolean; message: string; scope: 'configuration' | 'credentials' };
const ACTIVE_STATES = ['queued', 'scheduled', 'running', 'needs_action', 'unconfirmed'];
const COMMON_PLATFORMS = ['x', 'reddit', 'xiaohongshu', 'zhihu', 'wechat'];
const languageName = (language: string) => ({ 'zh-CN': '简体中文', 'zh-TW': '繁体中文', en: 'English' }[language] || language);
const hasActive = (job: Job) => ACTIVE_STATES.includes(job.status);

function useDirtyGuard(dirty: boolean, onDirtyChange?: PageProps['onDirtyChange']) {
  const callback = useRef(onDirtyChange);
  callback.current = onDirtyChange;
  useEffect(() => { callback.current?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => callback.current?.(false), []);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

async function refreshAfterWrite(refresh: PageProps['refresh'], setError: (message: string) => void, done?: () => void) {
  try { await refresh(); done?.(); }
  catch { setError('操作已保存，但列表未刷新。请刷新页面查看最新记录；无需再次提交。'); }
}
function safeLink(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(mediaUrl(value), window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}
function ToolbarSearch({ value, onChange, placeholder, label }: { value: string; onChange: (value: string) => void; placeholder: string; label: string }) {
  return <label className="management-search"><Search size={16} aria-hidden="true" /><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={label} /></label>;
}
function Unsaved({ dirty }: { dirty: boolean }) { return dirty ? <span className="management-unsaved">有未保存修改</span> : null; }
function Muted({ children }: { children: ReactNode }) { return <span className="management-muted">{children}</span>; }

export function LibraryPage({ data, refresh, notify, openContent, newContent, onDeleted, navigate, globalBusy = false }: PageProps & { openContent: (content: Content) => void; newContent: () => void; onDeleted: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [removed, setRemoved] = useState<string[]>([]);
  const rows = useMemo(() => data.contents.filter(content => !removed.includes(content.id)).map(content => {
    const variants = data.variants.filter(variant => variant.contentId === content.id);
    const approved = variants.filter(variant => variant.approved && !variant.issues.some(issue => issue.severity === 'error')).length;
    const jobs = data.jobs.filter(job => job.contentId === content.id);
    const active = jobs.filter(hasActive);
    const published = new Set(jobs.filter(job => job.status === 'published').map(job => job.connectionId)).size;
    const drafted = new Set(jobs.filter(job => job.status === 'drafted').map(job => job.connectionId)).size;
    const needs = active.filter(job => ['unconfirmed', 'needs_action'].includes(job.status)).length;
    const updatedAt = [content.updatedAt, ...variants.map(variant => variant.updatedAt)].sort().at(-1)!;
    return { content, variants, approved, active, published, drafted, needs, updatedAt };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data, removed]);
  const visible = rows.filter(row => {
    const profile = data.profiles.find(item => item.id === row.content.profileId);
    const matches = `${row.content.title} ${row.content.source} ${profile?.name || ''}`.toLowerCase().includes(search.trim().toLowerCase());
    return matches && (filter === 'all' || filter === 'source' && !row.variants.length || filter === 'review' && row.variants.length > row.approved || filter === 'ready' && row.approved > 0 || filter === 'action' && row.needs > 0);
  });
  const remove = async (content: Content) => {
    if (!window.confirm(`删除“${content.title}”和全部平台版本？发布历史会保留，此操作无法撤销。`)) return;
    setBusy(content.id); setError('');
    try {
      await request(`/api/contents/${content.id}`, { method: 'DELETE' });
      setRemoved(previous => [...previous, content.id]); onDeleted(content.id); notify('内容及平台版本已删除。');
      await refreshAfterWrite(refresh, setError, () => setRemoved([]));
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  };
  const locked = Boolean(busy) || globalBusy;
  return <div className="management-page management-library">
    <div className="management-toolbar"><ToolbarSearch value={search} onChange={setSearch} placeholder="搜索标题、原稿或画像" label="搜索内容库" /><select value={filter} onChange={event => setFilter(event.target.value)} aria-label="按创作状态筛选"><option value="all">全部内容 · {rows.length}</option><option value="source">仅有原稿</option><option value="review">等待审阅</option><option value="ready">已有审阅版本</option><option value="action">分发需要处理</option></select><Button className="primary" onClick={newContent} disabled={locked}><Plus size={16} />新建内容</Button></div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    {!rows.length ? <div className="panel"><EmptyState title="先留下一份原稿" description="保存后的原稿、平台版本和分发进度会汇集在这里。" icon={<Files size={28} />} action={<Button className="primary" onClick={newContent} disabled={locked}>开始创作<ArrowRight size={16} /></Button>} /></div> : !visible.length ? <div className="panel"><EmptyState title="没有符合条件的内容" description="调整关键词或创作状态，继续查找。" action={<Button onClick={() => { setSearch(''); setFilter('all'); }}>清空筛选</Button>} /></div> : <div className="panel management-table-wrap"><table className="management-table"><thead><tr><th scope="col">内容</th><th scope="col">审阅进度</th><th scope="col">账号分发</th><th scope="col">最近编辑</th><th scope="col"><span className="management-sr-only">操作</span></th></tr></thead><tbody>{visible.map(row => {
      const profile = data.profiles.find(item => item.id === row.content.profileId);
      return <tr key={row.content.id}><td className="management-main-cell"><button className="management-title-button" onClick={() => openContent(row.content)} disabled={locked}>{row.content.title}</button><p className="management-excerpt">{row.content.source}</p><div className="management-row-meta">{profile?.name && <span>{profile.name}</span>}<span>{row.content.media.length ? `${row.content.media.length} 个素材` : '文字原稿'}</span>{row.variants.length > 0 && <span>{row.variants.map(variant => data.platforms.find(platform => platform.id === variant.platformId)?.shortName || variant.platformId).slice(0, 3).join('、')}{row.variants.length > 3 ? ` 等 ${row.variants.length} 个平台` : ''}</span>}</div></td><td data-label="审阅进度">{row.variants.length ? <><strong>{row.approved} / {row.variants.length} 已审阅</strong><Muted>{row.variants.length > row.approved ? `${row.variants.length - row.approved} 个版本待确认` : '可选择账号分发'}</Muted></> : <Badge>仅原稿</Badge>}</td><td data-label="账号分发"><div className="management-status-stack">{row.needs > 0 && <Badge kind="warning">{row.needs} 个任务需处理</Badge>}{row.published > 0 && <span>已发布到 {row.published} 个账号</span>}{row.drafted > 0 && <span>已存 {row.drafted} 个账号草稿</span>}{!row.published && !row.drafted && !row.needs && <Muted>{row.active.length ? `${row.active.length} 个任务执行或排期中` : '尚无完成的分发'}</Muted>}</div></td><td className="management-date" data-label="最近编辑">{formatDate(row.updatedAt, data.settings.timezone)}</td><td data-label="操作"><div className="management-actions"><Button className="quiet" onClick={() => openContent(row.content)} disabled={locked} aria-label={`继续编辑 ${row.content.title}`}>编辑<ArrowRight size={14} /></Button>{row.active.length > 0 && navigate && <Button className="quiet" onClick={() => navigate('queue')} disabled={locked}>查看任务</Button>}<button className="icon-button" aria-label={`删除 ${row.content.title}`} title={row.active.length ? '请先处理或取消关联发布任务' : '删除内容'} disabled={locked || row.active.length > 0} onClick={() => void remove(row.content)}><Trash2 size={16} /></button></div></td></tr>;
    })}</tbody></table></div>}
    {rows.length > 0 && <p className="management-footnote">显示 {visible.length} / {rows.length} 篇 · 时间按 {data.settings.timezone} 显示。审阅通过和实际发布分别记录。</p>}
  </div>;
}

const EMPTY_PROFILE = { name: '', audience: '', tone: '自然、真诚、有条理', language: 'zh-CN', description: '', forbiddenWords: '' };
export function ProfilesPage({ data, refresh, notify, onDirtyChange, navigate, globalBusy = false }: PageProps) {
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [showForm, setShowForm] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [overrides, setOverrides] = useState<Record<string, Profile>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  useDirtyGuard(dirty, onDirtyChange);
  const profiles = [...data.profiles.map(profile => overrides[profile.id] || profile), ...Object.values(overrides).filter(profile => !data.profiles.some(item => item.id === profile.id))].filter(profile => !removed.includes(profile.id));
  const usage = (id: string) => data.contents.filter(content => content.profileId === id);
  const change = (key: keyof typeof form, value: string) => { setForm(previous => ({ ...previous, [key]: value })); setDirty(true); };
  const start = (profile?: Profile) => {
    if (dirty && !window.confirm('放弃尚未保存的画像修改，切换编辑对象？')) return;
    setEditingId(profile?.id || '');
    setForm(profile ? { ...profile, forbiddenWords: profile.forbiddenWords.join('\n') } : EMPTY_PROFILE);
    setShowForm(true); setDirty(false); setError('');
  };
  const close = () => { if (!dirty || window.confirm('放弃尚未保存的画像修改？')) { setShowForm(false); setDirty(false); setError(''); } };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy('save'); setError('');
    try {
      const result = await send<Profile>(editingId ? `/api/profiles/${editingId}` : '/api/profiles', { ...form, forbiddenWords: form.forbiddenWords.split(/[,，\n]/).map(word => word.trim()).filter(Boolean) }, editingId ? 'PUT' : 'POST');
      setOverrides(previous => ({ ...previous, [result.id]: result })); setEditingId(''); setShowForm(false); setDirty(false);
      notify(editingId && usage(editingId).length ? '画像已保存。关联内容的平台版本需重新审阅后再分发。' : '画像已保存，可在创作台选用。');
      await refreshAfterWrite(refresh, setError, () => setOverrides({}));
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  };
  const remove = async (profile: Profile) => {
    if (!window.confirm(`删除未被使用的画像“${profile.name}”？`)) return;
    setBusy(profile.id); setError('');
    try {
      await request(`/api/profiles/${profile.id}`, { method: 'DELETE' }); setRemoved(previous => [...previous, profile.id]);
      if (editingId === profile.id) { setShowForm(false); setDirty(false); }
      notify('画像已删除。'); await refreshAfterWrite(refresh, setError, () => setRemoved([]));
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  };
  const locked = Boolean(busy) || globalBusy;
  return <div className="management-page management-profiles">
    <div className="management-toolbar"><p className="management-intro">画像定义“为谁写、怎样表达”，可以用于多份内容。</p><Button className="primary" onClick={() => start()} disabled={locked}><Plus size={16} />新建画像</Button></div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <div className={`management-split ${showForm ? 'has-editor' : ''}`}><section aria-label="创作画像列表">{!profiles.length ? <div className="panel"><EmptyState title="留住你的表达习惯" description="先定义受众、语气和写作方向，生成内容时就能直接选用。" icon={<UserRound size={28} />} action={<Button onClick={() => start()} disabled={locked}>建立第一个画像</Button>} /></div> : <div className="panel management-record-list">{profiles.map(profile => {
      const used = usage(profile.id);
      return <article className="management-record" key={profile.id}><div className="management-record-heading"><div className="management-record-identity"><span className="management-avatar">{profile.name.slice(0, 1)}</span><div><h2>{profile.name}</h2><p>{languageName(profile.language)} · 用于 {used.length} 篇内容</p></div></div><div className="management-actions"><Button className="quiet" onClick={() => start(profile)} disabled={locked}><Pencil size={14} />编辑</Button><button className="icon-button" aria-label={`删除画像 ${profile.name}`} title={used.length ? '请先修改引用此画像的内容' : '删除未使用画像'} disabled={locked || used.length > 0} onClick={() => void remove(profile)}><Trash2 size={16} /></button></div></div><p className="management-profile-description">{profile.description || '尚未填写创作方向'}</p><dl className="management-key-values"><div><dt>目标受众</dt><dd>{profile.audience || '未指定'}</dd></div><div><dt>表达语气</dt><dd>{profile.tone || '通用表达'}</dd></div></dl><details className="management-details"><summary>使用情况与表达偏好<ChevronDown size={14} /></summary><div className="management-detail-body"><p>{profile.forbiddenWords.length ? `避免使用：${profile.forbiddenWords.join('、')}` : '没有设置避免使用的词语。'}</p>{used.length > 0 && <><p>使用此画像：{used.slice(0, 5).map(content => content.title).join('、')}{used.length > 5 ? ` 等 ${used.length} 篇` : ''}。修改画像会撤销关联版本的审阅确认；已创建任务仍使用原快照。</p>{navigate && <Button className="quiet" onClick={() => navigate('library')}>前往内容库<ArrowRight size={14} /></Button>}</>}</div></details></article>;
    })}</div>}</section>
      {showForm && <section className="panel management-editor"><div className="management-editor-heading"><div><h2>{editingId ? '编辑画像' : '新建画像'}</h2><Unsaved dirty={dirty} /></div><button className="icon-button" aria-label="关闭画像编辑" onClick={close} disabled={locked}><X size={18} /></button></div><form onSubmit={save} className="management-form"><Field label="画像名称"><input value={form.name} onChange={event => change('name', event.target.value)} placeholder="例如：我的知识分享账号" required maxLength={100} disabled={locked} /></Field><Field label="目标受众"><input value={form.audience} onChange={event => change('audience', event.target.value)} placeholder="这份内容主要写给谁？" disabled={locked} /></Field><Field label="表达语气"><input value={form.tone} onChange={event => change('tone', event.target.value)} placeholder="自然、专业，或像和朋友聊天" disabled={locked} /></Field><Field label="创作方向"><textarea rows={3} value={form.description} onChange={event => change('description', event.target.value)} placeholder="你熟悉哪些主题，希望给读者带来什么？" disabled={locked} /></Field><details className="management-details" open={Boolean(form.forbiddenWords)}><summary>语言与避免使用的词语<ChevronDown size={14} /></summary><div className="management-detail-body management-form"><Field label="内容语言"><select value={form.language} onChange={event => change('language', event.target.value)} disabled={locked}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="zh-TW">繁体中文</option>{!['zh-CN', 'en', 'zh-TW'].includes(form.language) && <option value={form.language}>{form.language}</option>}</select></Field><Field label="避免使用的词语" hint="每行一个，或用逗号分隔。"><textarea rows={3} value={form.forbiddenWords} onChange={event => change('forbiddenWords', event.target.value)} disabled={locked} /></Field></div></details>{editingId && usage(editingId).length > 0 && <p className="management-callout">此画像用于 {usage(editingId).length} 篇内容。保存修改后，关联平台版本需要重新审阅。</p>}<div className="management-form-actions"><Button onClick={close} disabled={locked}>取消</Button><Button className="primary" type="submit" disabled={locked || !dirty} busy={busy === 'save'}>保存画像</Button></div></form></section>}
    </div>
  </div>;
}

function definitionFor(connection: Connection, definitions: ConnectorDefinition[]) { return definitions.find(definition => definition.id === (connection.connector === 'native' ? `native:${connection.platformId}` : connection.connector)); }
function methodType(definition: ConnectorDefinition) { return definition.id.startsWith('native:') ? '官方接口' : definition.mode === 'bridge' ? '浏览器辅助' : definition.mode === 'custom' ? '自建服务' : '外部服务'; }
function methodOutcome(definition: ConnectorDefinition) { return definition.mode === 'draft' ? '以草稿保存为主' : definition.mode === 'bridge' ? '需要在平台完成操作' : definition.mode === 'custom' ? '由你的服务处理' : '提交到发布接口'; }
function testBadge(result?: TestResult) {
  if (!result) return { label: '待检查', kind: '' };
  if (!result.ok) return { label: '检查失败', kind: 'danger' };
  return result.scope === 'credentials' ? { label: '凭据检查通过', kind: 'success' } : { label: '参数检查通过', kind: '' };
}
function configChoices(key: string, definition: ConnectorDefinition): string[] | undefined {
  if (key === 'postType') return definition.id === 'postiz' ? ['now', 'draft'] : ['draft', 'publish'];
  if (key === 'format') return definition.id === 'xiaohongshu' ? ['image', 'video'] : ['text', 'markdown'];
  if (key === 'visibility') return definition.id === 'native:misskey' ? ['public', 'home', 'followers'] : ['public', 'unlisted', 'private', 'direct'];
  if (key === 'apiVersion') return ['v3', 'v4'];
  return;
}
const CHOICE_LABELS: Record<string, string> = { now: '立即提交发布', draft: '仅保存草稿', publish: '正式发布', image: '图文', video: '视频', text: '普通文本', markdown: 'Markdown', public: '公开', home: '仅主页', followers: '仅关注者', unlisted: '不列入公共时间线', private: '仅关注者', direct: '私信' };

type ChannelForm = { name: string; platformId: string; definitionId: string; config: Record<string, string>; enabled: boolean };
const channelBlank = (platformId = ''): ChannelForm => ({ name: '', platformId, definitionId: '', config: {}, enabled: true });
export function ConnectionsPage({ data, refresh, notify, initialPlatformId = '', onDirtyChange, navigate, globalBusy = false }: PageProps & { initialPlatformId?: string }) {
  const preset = data.platforms.some(platform => platform.id === initialPlatformId) ? initialPlatformId : '';
  const [form, setForm] = useState<ChannelForm>(() => channelBlank(preset));
  const [step, setStep] = useState<1 | 2 | 3>(preset ? 2 : 1);
  const [showForm, setShowForm] = useState(Boolean(preset));
  const [editingId, setEditingId] = useState('');
  const [savedSecrets, setSavedSecrets] = useState<string[]>([]);
  const [showSecrets, setShowSecrets] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(preset);
  const [search, setSearch] = useState('');
  const [platformSearch, setPlatformSearch] = useState('');
  const [overrides, setOverrides] = useState<Record<string, Connection>>({});
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [extensionMessage, setExtensionMessage] = useState('');
  useDirtyGuard(dirty, onDirtyChange);
  const channels = [...data.connections.map(connection => overrides[connection.id] || connection), ...Object.values(overrides).filter(connection => !data.connections.some(item => item.id === connection.id))].filter(connection => !removed.includes(connection.id));
  const available = channels.filter(connection => (!filter || connection.platformId === filter) && `${connection.name} ${data.platforms.find(platform => platform.id === connection.platformId)?.name || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const definitions = data.connectorDefinitions.filter(definition => definition.platformIds.includes(form.platformId)).sort((a, b) => {
    const rank = (definition: ConnectorDefinition) => definition.id.startsWith('native:') ? 0 : definition.mode === 'bridge' ? 1 : definition.mode === 'custom' ? 3 : 2;
    return rank(a) - rank(b);
  });
  const definition = definitions.find(item => item.id === form.definitionId);
  const platform = data.platforms.find(item => item.id === form.platformId);
  const visiblePlatforms = data.platforms.filter(item => `${item.name} ${item.shortName} ${item.id}`.toLowerCase().includes(platformSearch.trim().toLowerCase())).sort((a, b) => Number(COMMON_PLATFORMS.includes(b.id)) - Number(COMMON_PLATFORMS.includes(a.id)));
  const relatedJobs = data.jobs.filter(job => job.connectionId === editingId && hasActive(job));
  const configLocked = Boolean(editingId && relatedJobs.length);
  const locked = Boolean(busy) || globalBusy;
  const start = (connection?: Connection) => {
    if (dirty && !window.confirm('放弃尚未保存的连接修改，切换编辑对象？')) return;
    const id = connection?.platformId || filter || preset;
    setForm(connection ? { name: connection.name, platformId: connection.platformId, definitionId: definitionFor(connection, data.connectorDefinitions)?.id || '', config: { ...connection.config }, enabled: connection.enabled } : channelBlank(id));
    setEditingId(connection?.id || ''); setSavedSecrets(connection?.secretKeys || []); setShowSecrets(false); setDirty(false); setShowForm(true); setStep(connection ? 3 : id ? 2 : 1); setPlatformSearch(''); setError('');
  };
  const update = (patch: Partial<ChannelForm>) => { setForm(previous => ({ ...previous, ...patch })); setDirty(true); };
  const close = () => { if (!dirty || window.confirm('放弃尚未保存的连接修改？')) { setShowForm(false); setDirty(false); setSavedSecrets([]); setShowSecrets(false); setForm(channelBlank()); setError(''); } };
  const choosePlatform = (platformId: string) => {
    if (platformId !== form.platformId && (form.name || Object.values(form.config).some(Boolean)) && !window.confirm('切换平台后需要重新填写账号与连接参数，确定切换？')) return;
    if (platformId !== form.platformId) { update(channelBlank(platformId)); setSavedSecrets([]); }
    setStep(2);
  };
  const chooseMethod = (next: ConnectorDefinition) => {
    if (next.id !== form.definitionId && Object.values(form.config).some(Boolean) && !window.confirm('更换发布方式后需要重新填写连接参数，确定更换？')) return;
    if (next.id !== form.definitionId) { update({ definitionId: next.id, config: {} }); setSavedSecrets([]); }
    setStep(3);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!definition) return;
    setBusy('save'); setError('');
    try {
      const result = await send<Connection>(editingId ? `/api/connections/${editingId}` : '/api/connections', { ...form, connector: definition.id.startsWith('native:') ? 'native' : definition.id }, editingId ? 'PUT' : 'POST');
      setOverrides(previous => ({ ...previous, [result.id]: result }));
      setTestResults(previous => { const next = { ...previous }; delete next[result.id]; return next; });
      setShowForm(false); setDirty(false); setEditingId(''); setSavedSecrets([]); setShowSecrets(false); setForm(channelBlank());
      notify(result.configured ? '连接参数已保存。请主动检查；参数齐全不代表账号已验证。' : '连接已保存，仍需补全参数。');
      await refreshAfterWrite(refresh, setError, () => setOverrides({}));
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  };
  const remove = async (connection: Connection) => {
    if (!window.confirm(`删除账号连接“${connection.name}”？不会删除平台账号或已发布内容。`)) return;
    setBusy(`delete:${connection.id}`); setError('');
    try {
      await request(`/api/connections/${connection.id}`, { method: 'DELETE' }); setRemoved(previous => [...previous, connection.id]);
      if (editingId === connection.id) { setShowForm(false); setDirty(false); }
      notify('账号连接已删除。'); await refreshAfterWrite(refresh, setError, () => setRemoved([]));
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  };
  const check = async (connection: Connection) => {
    setBusy(`test:${connection.id}`); setError('');
    try {
      const result = await send<TestResult>(`/api/connections/${connection.id}/test`, {});
      setTestResults(previous => ({ ...previous, [connection.id]: result }));
      notify(result.message);
      await refreshAfterWrite(refresh, setError, () => setTestResults(previous => { const next = { ...previous }; delete next[connection.id]; return next; }));
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  };
  const detect = async () => {
    setBusy('detect'); setError('');
    try {
      const result = await detectMultiPost();
      const message = !result.installed ? '未检测到 MultiPost。请安装并启用扩展，再将工作台域名加入扩展信任列表后重试。' : result.platforms.length ? `已检测到扩展和 ${result.platforms.length} 个平台入口。账号登录与最终发布仍需在目标网站核实。` : '扩展已响应，但未返回平台列表。请检查工作台域名是否已获信任。';
      setExtensionMessage(message); notify(message);
    } catch (e) { setError(errorText(e)); } finally { setBusy(''); }
  };
  const renderField = (field: ConnectorDefinition['fields'][number]) => {
    if (!definition) return null;
    const value = form.config[field.key] || '';
    const choices = configChoices(field.key, definition);
    const retained = field.secret && savedSecrets.includes(field.key);
    const required = field.required && !retained;
    const control = field.key === 'settingsJson' || field.key === 'cw'
      ? <textarea rows={field.key === 'settingsJson' ? 4 : 2} value={value} onChange={event => update({ config: { ...form.config, [field.key]: event.target.value } })} placeholder={field.placeholder} disabled={locked || configLocked} spellCheck={false} />
      : choices ? <select value={value} onChange={event => update({ config: { ...form.config, [field.key]: event.target.value } })} disabled={locked || configLocked}><option value="">默认{field.placeholder ? `（${CHOICE_LABELS[field.placeholder] || field.placeholder}）` : ''}</option>{[...new Set([...choices, ...(value && !choices.includes(value) ? [value] : [])])].map(choice => <option key={choice} value={choice}>{CHOICE_LABELS[choice] || choice}</option>)}</select>
      : <input type={field.secret && !showSecrets ? 'password' : ['baseUrl', 'url', 'healthUrl'].includes(field.key) && !field.secret ? 'url' : 'text'} value={value} onChange={event => update({ config: { ...form.config, [field.key]: event.target.value } })} placeholder={retained ? '已保存，留空保留' : field.placeholder || ''} required={required} disabled={locked || configLocked} autoComplete={field.secret ? 'new-password' : 'off'} spellCheck={false} />;
    return <Field key={field.key} label={`${field.label}${field.required ? ' *' : ''}`} hint={<>{field.help}{retained && <span className="management-retained"><ShieldCheck size={12} />凭据已保存；留空保留原值</span>}</>}>{control}</Field>;
  };
  const primaryFields = definition?.fields.filter(field => field.required || field.secret || ['format', 'postType', 'visibility'].includes(field.key)) || [];
  const advancedFields = definition?.fields.filter(field => !primaryFields.includes(field)) || [];
  return <div className="management-page management-connections">
    <div className="management-toolbar"><ToolbarSearch value={search} onChange={setSearch} placeholder="搜索账号或平台" label="搜索账号连接" /><select value={filter} onChange={event => setFilter(event.target.value)} aria-label="按平台筛选账号"><option value="">全部平台 · {channels.length} 个连接</option>{data.platforms.filter(item => channels.some(connection => connection.platformId === item.id) || item.id === preset).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><Button className="primary" onClick={() => start()} disabled={locked}><Plus size={16} />添加账号连接</Button></div>
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <div className={`management-split ${showForm ? 'has-editor' : ''}`}><section aria-label="账号连接列表">{!available.length ? <div className="panel"><EmptyState title={channels.length ? '没有匹配的账号连接' : '先连接一个你常用的账号'} description="选择平台和发布方式，使用自己的接口凭据、浏览器扩展或外部服务。未连接的内容仍可复制与导出。" icon={<Link2 size={28} />} action={<Button onClick={() => start()} disabled={locked}><Plus size={16} />添加连接</Button>} /></div> : <div className="panel management-record-list">{available.map(connection => {
      const target = data.platforms.find(item => item.id === connection.platformId);
      const def = definitionFor(connection, data.connectorDefinitions);
      const result = testResults[connection.id] || connection.lastTest;
      const status = testBadge(result);
      const pending = data.jobs.filter(job => job.connectionId === connection.id && hasActive(job)).length;
      return <article className="management-record" key={connection.id}><div className="management-record-heading"><div className="management-record-identity"><span className="management-platform-mark">{target?.shortName || connection.platformId}</span><div><h2>{connection.name}</h2><p>{target?.name || connection.platformId} · {def?.name || connection.connector}</p></div></div><div className="management-status-stack">{!connection.enabled ? <Badge>已停用</Badge> : <Badge kind={connection.configured ? '' : 'warning'}>{connection.configured ? '参数齐全' : '参数待补全'}</Badge>}<Badge kind={status.kind}>{status.label}</Badge></div></div>{pending > 0 && <p className="management-connection-pending">{pending} 个任务尚待处理；账号参数暂不可修改。</p>}<div className="management-record-footer"><span>{def ? methodOutcome(def) : '连接方式暂不可用'}</span><div className="management-actions"><Button className="quiet" onClick={() => void check(connection)} busy={busy === `test:${connection.id}`} disabled={locked || !connection.configured}><RefreshCw size={14} />主动检查</Button><Button className="quiet" onClick={() => start(connection)} disabled={locked}><Pencil size={14} />编辑</Button><button className="icon-button" aria-label={`删除账号连接 ${connection.name}`} title={pending ? '请先处理关联发布任务' : '删除连接'} disabled={locked || pending > 0} onClick={() => void remove(connection)}><Trash2 size={16} /></button></div></div><details className="management-details"><summary>检查记录与发布条件<ChevronDown size={14} /></summary><div className="management-detail-body">{result ? <><p>{result.message}</p><p>检查于 {formatDate(result.at, data.settings.timezone)}。{result.scope === 'configuration' ? '仅检查配置格式，未验证账号凭据或远端权限。' : '凭据检查结果来自当时的只读请求，不保证后续发布权限或额度。'}</p></> : <p>还没有检查记录。保存参数不会自动验证账号。</p>}<p>{def?.description}</p><p>{connection.secretKeys.length ? `${connection.secretKeys.length} 个凭据字段已在本机加密保存。` : '该方式不需要保存秘密凭据，或尚未填写凭据。'}</p>{pending > 0 && navigate && <Button className="quiet" onClick={() => navigate('queue')}>处理关联任务<ArrowRight size={14} /></Button>}</div></details></article>;
    })}</div>}<div className="management-extension-check"><div><strong>使用 MultiPost 浏览器扩展？</strong><p>{extensionMessage || '检测只由你主动发起。扩展存在、账号登录和实际发布分别核实。'}</p></div><Button className="quiet" onClick={() => void detect()} disabled={locked} busy={busy === 'detect'}>检测扩展</Button></div></section>
      {showForm && <section className="panel management-editor management-channel-editor"><div className="management-editor-heading"><div><h2>{editingId ? '编辑账号连接' : '添加账号连接'}</h2><Unsaved dirty={dirty} /></div><button className="icon-button" aria-label="关闭账号连接表单" onClick={close} disabled={locked}><X size={18} /></button></div><ol className="management-stepper" aria-label="连接步骤">{['目标平台', '发布方式', '连接参数'].map((label, index) => <li className={step === index + 1 ? 'current' : step > index + 1 ? 'complete' : ''} key={label}><button type="button" disabled={locked || Boolean(editingId) || index === 1 && !form.platformId || index === 2 && !form.definitionId} onClick={() => setStep(index + 1 as 1 | 2 | 3)} aria-current={step === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</button></li>)}</ol>
        {step === 1 && <div className="management-step-body"><h3>选择要连接的平台</h3><ToolbarSearch value={platformSearch} onChange={setPlatformSearch} placeholder="搜索平台名称或英文 ID" label="搜索目标平台" /><div className="management-platform-choices">{visiblePlatforms.map(item => <button type="button" key={item.id} className={form.platformId === item.id ? 'selected' : ''} onClick={() => choosePlatform(item.id)} disabled={locked}><span>{item.name}</span><small>{item.region === 'domestic' ? '国内' : '海外'}</small><ArrowRight size={14} /></button>)}</div>{!visiblePlatforms.length && <p className="management-hint">没有匹配平台。试试中文名或英文 ID。</p>}</div>}
        {step === 2 && <div className="management-step-body"><div className="management-step-context"><span>{platform?.name}</span><Button className="quiet" onClick={() => setStep(1)} disabled={locked}><ArrowLeft size={14} />换个平台</Button></div><h3>你希望怎样分发？</h3><p className="management-hint">选择你已经具备条件的方式。每个账号可分别添加连接。</p><div className="management-method-choices">{definitions.filter(item => item.mode !== 'custom').map(item => <button type="button" key={item.id} onClick={() => chooseMethod(item)} disabled={locked} className={form.definitionId === item.id ? 'selected' : ''}><span><strong>{item.name}</strong><small>{methodType(item)} · {methodOutcome(item)}</small></span><ArrowRight size={16} /></button>)}</div>{!definitions.some(item => item.mode !== 'custom') && <p className="management-callout">此平台暂无现成的发布连接。可以先生成、复制或导出内容。</p>}{definitions.some(item => item.mode === 'custom') && <details className="management-details"><summary>我有自己的发布服务<ChevronDown size={14} /></summary><div className="management-detail-body"><p>自定义 Webhook 需要自行实现接收和发布接口。</p>{definitions.filter(item => item.mode === 'custom').map(item => <Button key={item.id} className="quiet" onClick={() => chooseMethod(item)} disabled={locked}>{item.name}<ArrowRight size={14} /></Button>)}</div></details>}</div>}
        {step === 3 && <form className="management-form" onSubmit={save}><div className="management-selected-method"><strong>{platform?.name}</strong><span>{definition?.name || '连接方式暂不可用'}</span>{!editingId && <Button className="quiet" onClick={() => setStep(2)} disabled={locked}>更换方式</Button>}</div>{configLocked && <p className="management-callout">还有 {relatedJobs.length} 个关联任务，当前仅能修改名称或启用状态。请处理任务后再改账号参数。</p>}<Field label="账号连接名称"><input value={form.name} onChange={event => update({ name: event.target.value })} placeholder={`例如：我的 ${platform?.shortName || '创作'} 账号`} maxLength={100} required disabled={locked} /></Field>{definition && <details className="management-details"><summary>查看此方式的发布条件<ChevronDown size={14} /></summary><div className="management-detail-body"><p>{definition.description}</p></div></details>}{definition?.fields.some(field => field.secret) && <div className="management-secret-heading"><span>必要参数与凭据</span><Button className="quiet" onClick={() => setShowSecrets(previous => !previous)} disabled={locked || configLocked}>{showSecrets ? <EyeOff size={14} /> : <Eye size={14} />}{showSecrets ? '隐藏' : '显示输入'}</Button></div>}{primaryFields.map(renderField)}{definition && !definition.fields.length && <p className="management-callout">此方式无需凭据。发布时由前台浏览器交给扩展，仍需你在平台检查并完成操作。</p>}{advancedFields.length > 0 && <details className="management-details"><summary>更多连接选项<ChevronDown size={14} /></summary><div className="management-detail-body management-form">{advancedFields.map(renderField)}</div></details>}<label className="management-checkbox"><input type="checkbox" checked={form.enabled} onChange={event => update({ enabled: event.target.checked })} disabled={locked} /><span>启用这个账号连接</span></label><div className="management-form-actions"><Button onClick={close} disabled={locked}>取消</Button><Button className="primary" type="submit" disabled={locked || !definition} busy={busy === 'save'}>保存连接</Button></div><p className="management-hint">保存后再主动检查。已保存的凭据不返回浏览器；未输入的新值不会替换原凭据。</p></form>}
      </section>}
    </div>
  </div>;
}

function settingsForm(settings: Settings) { return { enabled: settings.generation.enabled, baseUrl: settings.generation.baseUrl, model: settings.generation.model, apiKey: '', timezone: settings.timezone, clearApiKey: false }; }
export function SettingsPage({ data, refresh, notify, onDirtyChange, globalBusy = false }: PageProps) {
  const [saved, setSaved] = useState(data.settings);
  const [form, setForm] = useState(() => settingsForm(data.settings));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  useDirtyGuard(dirty, onDirtyChange);
  const savedSettingsKey = JSON.stringify(data.settings);
  useEffect(() => { if (!dirty) { setSaved(data.settings); setForm(settingsForm(data.settings)); } }, [savedSettingsKey]);
  const change = (patch: Partial<typeof form>) => { setForm(previous => ({ ...previous, ...patch })); setDirty(true); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (form.enabled && (!form.baseUrl.trim() || !form.model.trim() || !(form.apiKey.trim() || saved.generation.hasApiKey && !form.clearApiKey))) { setError('启用 AI 前，请补全服务地址、模型名称和密钥。'); return; }
    setBusy(true);
    try {
      const result = await send<Settings>('/api/settings', { generation: { enabled: form.enabled, baseUrl: form.baseUrl.trim(), model: form.model.trim(), apiKey: form.apiKey, clearApiKey: form.clearApiKey }, timezone: form.timezone }, 'PUT');
      setSaved(result); setForm(settingsForm(result)); setDirty(false); setShowKey(false); notify('工作台设置已保存。');
      await refreshAfterWrite(refresh, setError);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const locked = busy || globalBusy;
  const complete = Boolean(saved.generation.hasApiKey && saved.generation.model && saved.generation.baseUrl);
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return <div className="management-page management-settings">
    {error && <ErrorMessage>{error}</ErrorMessage>}
    <form onSubmit={save} className="management-settings-form"><section className="panel management-settings-section"><div className="management-section-heading"><div><h2>内容生成</h2><p>规则适配可直接使用。需要围绕主题创作时，再启用 AI。</p></div><Badge kind={saved.generation.enabled && !complete ? 'warning' : ''}>{saved.generation.enabled ? complete ? 'AI 配置已启用' : '配置不完整' : '规则适配可用'}</Badge></div><label className="management-checkbox management-ai-toggle"><input type="checkbox" checked={form.enabled} onChange={event => change({ enabled: event.target.checked, clearApiKey: event.target.checked ? false : form.clearApiKey })} disabled={locked} /><span><strong>启用 AI 创作</strong><small>生成时仍可选择规则适配，不会自动调用模型。</small></span></label><details className="management-details" open={form.enabled}><summary>{form.enabled ? 'AI 服务配置' : '查看或编辑 AI 服务配置'}<ChevronDown size={14} /></summary><div className="management-detail-body management-form"><Field label="模型服务地址" hint="使用兼容 OpenAI API 的服务地址；密钥不要放进 URL。"><input type="url" value={form.baseUrl} onChange={event => change({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" required={form.enabled} disabled={locked} spellCheck={false} /></Field><Field label="模型名称" hint="填写该服务提供的模型 ID。"><input value={form.model} onChange={event => change({ model: event.target.value })} placeholder="模型 ID" required={form.enabled} disabled={locked} spellCheck={false} /></Field><div className="management-secret-heading"><span>服务密钥</span><Button className="quiet" onClick={() => setShowKey(previous => !previous)} disabled={locked}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}{showKey ? '隐藏' : '显示输入'}</Button></div><Field label="API Key" hint={saved.generation.hasApiKey && !form.clearApiKey ? '已加密保存；留空保留，填写新值替换。' : '加密保存在本机服务端。'}><input type={showKey ? 'text' : 'password'} value={form.apiKey} onChange={event => change({ apiKey: event.target.value, clearApiKey: false })} placeholder={saved.generation.hasApiKey && !form.clearApiKey ? '已保存，留空保留' : '输入服务密钥'} required={form.enabled && !(saved.generation.hasApiKey && !form.clearApiKey)} disabled={locked} autoComplete="new-password" spellCheck={false} /></Field>{saved.generation.hasApiKey && <label className="management-checkbox"><input type="checkbox" checked={form.clearApiKey} onChange={event => change({ clearApiKey: event.target.checked, apiKey: event.target.checked ? '' : form.apiKey, enabled: event.target.checked ? false : form.enabled })} disabled={locked} /><span>保存时清除密钥，并关闭 AI 创作</span></label>}<p className="management-hint">AI 创作会把当前主题、原稿和画像信息发送给你配置的模型服务。生成结果仍需审阅。</p></div></details></section>
      <section className="panel management-settings-section"><div className="management-section-heading"><div><h2>时间与排期</h2><p>清楚区分工作区显示时区和排期输入时区。</p></div><Clock3 size={20} /></div><Field label="记录显示时区"><select value={form.timezone} onChange={event => change({ timezone: event.target.value })} disabled={locked}>{[...new Set([form.timezone, 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC'])].map(zone => <option key={zone} value={zone}>{zone}</option>)}</select></Field><p className="management-hint">队列与记录按 {form.timezone} 显示；创作台的排期输入按本机 {browserTimezone} 解释，保存时转换为同一实际时刻。</p></section>
      <div className="management-settings-save"><Unsaved dirty={dirty} /><Button className="primary" type="submit" disabled={locked || !dirty} busy={busy}>保存设置</Button></div>
    </form>
    <section className="panel management-settings-section management-data-section"><div className="management-section-heading"><div><h2>本地数据</h2><p>原稿、平台版本、任务与加密凭据保存在工作台的数据目录。</p></div><ShieldCheck size={20} /></div><dl className="management-key-values"><div><dt>生成与发布</dt><dd>规则适配在本地完成；外部模型与发布渠道只在你主动操作时使用。</dd></div><div><dt>备份方法</dt><dd>停止工作台服务后，完整备份数据目录（默认是项目内的 data）。数据库、uploads 素材目录和 vault.key 密钥文件应一起保存。</dd></div><div><dt>恢复凭据</dt><dd>vault.key 用于解密已保存的凭据。只复制数据库无法恢复凭据；自定义数据目录以你的启动配置为准。</dd></div></dl></section>
  </div>;
}

function Snapshot({ job, data }: { job: Job; data: Bootstrap }) {
  const target = data.platforms.find(platform => platform.id === job.platformId);
  return <div className="management-snapshot"><dl className="management-key-values"><div><dt>目标</dt><dd>{target?.name || job.platformId} · {job.connectionName}</dd></div><div><dt>快照时间</dt><dd>{formatDate(job.snapshot.updatedAt, data.settings.timezone)}</dd></div><div><dt>任务状态</dt><dd>{jobLabels[job.status] || job.status}</dd></div></dl><h3>{job.snapshot.title || '已审阅正文'}</h3>{job.snapshot.thread.length > 0 ? <ol className="management-snapshot-thread">{job.snapshot.thread.map((part, index) => <li key={index}><span>第 {index + 1} 条</span><pre>{part}</pre></li>)}</ol> : <pre className="management-snapshot-body">{job.snapshot.body}</pre>}{job.snapshot.tags.length > 0 && <div className="management-snapshot-tags">{job.snapshot.tags.map((tag, index) => <Badge key={`${tag}:${index}`}>#{tag.replace(/^#/, '')}</Badge>)}</div>}{job.media.length > 0 && <div className="management-snapshot-media"><h3>所附素材 · {job.media.length}</h3>{job.media.map(media => <div key={media.id}><Files size={15} /><span>{media.name}</span><Muted>{media.mime.startsWith('video/') ? '视频' : media.mime.startsWith('image/') ? '图片' : '文件'}</Muted>{safeLink(media.url) && <a href={safeLink(media.url)} target="_blank" rel="noreferrer">查看<ExternalLink size={12} /></a>}</div>)}</div>}<p className="management-hint">这是加入队列时保存的内容快照。后续编辑原稿或画像不会改写此任务。</p></div>;
}
function sessionHandoffs(): string[] { try { const value = JSON.parse(sessionStorage.getItem('creator-multipost-handoffs') || '[]'); return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []; } catch { return []; } }
const QUEUE_FILTERS = [{ id: 'needs', label: '需要处理', states: ['needs_action', 'unconfirmed'] }, { id: 'active', label: '执行与排期', states: ['queued', 'scheduled', 'running'] }, { id: 'published', label: '已发布', states: ['published'] }, { id: 'drafted', label: '已存草稿', states: ['drafted'] }, { id: 'failed', label: '失败与取消', states: ['failed', 'cancelled'] }];
export function QueuePage({ data, refresh, notify, onDirtyChange, navigate, globalBusy = false }: PageProps) {
  const [filter, setFilter] = useState('needs');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [snapshotJob, setSnapshotJob] = useState<Job | null>(null);
  const [retryJob, setRetryJob] = useState<Job | null>(null);
  const [confirmJob, setConfirmJob] = useState<Job | null>(null);
  const [outcome, setOutcome] = useState<'' | 'published' | 'drafted' | 'failed'>('');
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  const [confirmDirty, setConfirmDirty] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Job>>({});
  const [handedOff, setHandedOff] = useState(sessionHandoffs);
  useDirtyGuard(confirmDirty, onDirtyChange);
  useEffect(() => { try { sessionStorage.setItem('creator-multipost-handoffs', JSON.stringify(handedOff)); } catch { /* Receipt state is retained in memory if storage is unavailable. */ } }, [handedOff]);
  const jobs = [...data.jobs.map(job => overrides[job.id] || job), ...Object.values(overrides).filter(job => !data.jobs.some(item => item.id === job.id))];
  const shown = jobs.filter(job => (filter === 'all' || QUEUE_FILTERS.find(item => item.id === filter)?.states.includes(job.status)) && `${job.title} ${job.connectionName} ${data.platforms.find(platform => platform.id === job.platformId)?.name || ''}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => filter === 'active' ? a.scheduledAt.localeCompare(b.scheduledAt) : b.createdAt.localeCompare(a.createdAt));
  const locked = Boolean(busy) || globalBusy;
  const mark = (job: Job) => setOverrides(previous => ({ ...previous, [job.id]: job }));
  const afterWrite = () => refreshAfterWrite(refresh, setError, () => setOverrides({}));
  const execute = async (id: string, action: () => Promise<void>) => { setBusy(id); setError(''); try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(''); } };
  const dispatched = (job: Job) => handedOff.includes(job.id) || /^(内容已交给 MultiPost|已交接到浏览器扩展)/.test(job.message);
  const cancel = (job: Job) => {
    if (dispatched(job) && !window.confirm('扩展已经接收这份内容。取消只结束本地任务，不会撤回扩展窗口或远端内容。确认结束本地任务？')) return;
    void execute(job.id, async () => { mark(await send<Job>(`/api/jobs/${job.id}/cancel`, {})); notify('本地待处理任务已取消。'); await afterWrite(); });
  };
  const canRetry = (job: Job) => {
    const connection = data.connections.find(item => item.id === job.connectionId);
    return connection?.enabled && connection.configured && !jobs.some(item => item.id !== job.id && item.contentId === job.contentId && item.platformId === job.platformId && item.connectionId === job.connectionId && hasActive(item));
  };
  const retry = async () => {
    if (!retryJob) return;
    const job = retryJob;
    await execute(job.id, async () => { const result = await send<Job>(`/api/jobs/${job.id}/retry`, {}); mark(result); setRetryJob(null); setFilter('active'); notify('已按原任务快照创建一次新的尝试。'); await afterWrite(); });
  };
  const bridge = (job: Job) => void execute(job.id, async () => {
    if (data.remoteMode && job.media.some(media => media.url.startsWith('/uploads/'))) {
      throw new Error('尚未交接：云端上传素材受登录认证保护，MultiPost 扩展无法直接下载。可取消此任务，在原稿中移除素材后重新创建；或选择支持直接上传文件的连接器。');
    }
    const target = data.platforms.find(platform => platform.id === job.platformId);
    if (!target) throw new Error('未找到目标平台，请刷新列表。');
    const result = await dispatchMultiPost(target, job.snapshot, job.media);
    if (result.dispatched) {
      setHandedOff(previous => [...new Set([...previous, job.id])]);
      notify('扩展已接收内容。请在平台完成操作，再记录实际结果。');
    } else if (result.outcome === 'unconfirmed') {
      mark({ ...job, status: 'unconfirmed', message: result.message });
      notify(result.message);
    }
    try { mark(await send<Job>(`/api/jobs/${job.id}/bridge`, { outcome: result.outcome, message: result.message })); }
    catch (e) { throw new Error(result.dispatched ? '扩展已接收，但工作台未保存交接回执。请核实平台结果并手动确认，不要重复交接。' : result.outcome === 'unconfirmed' ? '扩展交接结果未知，且工作台未保存状态。请先核对扩展窗口和平台结果，再手动确认，不要重复交接。' : errorText(e)); }
    if (result.outcome === 'failed') setError(result.message);
    await afterWrite();
  });
  const startConfirm = (job: Job) => { setConfirmJob(job); setOutcome(''); setUrl(job.url || ''); setMessage(''); setConfirmDirty(false); setError(''); };
  const closeConfirm = () => { if (!locked && (!confirmDirty || window.confirm('放弃尚未保存的结果记录？'))) { setConfirmJob(null); setConfirmDirty(false); } };
  const confirm = async (event: FormEvent) => {
    event.preventDefault(); if (!confirmJob || !outcome) return;
    const job = confirmJob;
    if (url.trim() && (!/^https?:\/\//i.test(url.trim()) || !safeLink(url.trim()))) { setError('远端结果链接应为有效的 HTTP(S) 地址，且不能包含账号密码。'); return; }
    await execute(job.id, async () => { mark(await send<Job>(`/api/jobs/${job.id}/confirm`, { outcome, url: url.trim() || undefined, message: message.trim() || undefined })); setConfirmJob(null); setConfirmDirty(false); notify('已记录你核实的实际结果，没有再次发送内容。'); await afterWrite(); });
  };
  const currentConfirm = confirmJob ? jobs.find(job => job.id === confirmJob.id) || confirmJob : undefined;
  const confirmAllowed = currentConfirm && ['needs_action', 'unconfirmed'].includes(currentConfirm.status);
  return <div className="management-page management-queue">
    <div className="management-queue-tools"><div className="management-queue-filters" aria-label="按任务状态筛选">{QUEUE_FILTERS.map(item => <button type="button" key={item.id} className={filter === item.id ? 'active' : ''} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{jobs.filter(job => item.states.includes(job.status)).length}</span></button>)}<button type="button" className={filter === 'all' ? 'active' : ''} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>全部</button></div><ToolbarSearch value={search} onChange={setSearch} placeholder="搜索稿件、账号或平台" label="搜索发布队列" /></div>
    <p className="management-hint">时间按 {data.settings.timezone} 显示。草稿、浏览器交接和正式发布分别记录；结果未知时先核实远端。</p>
    {error && !confirmJob && !retryJob && <ErrorMessage>{error}</ErrorMessage>}
    {!shown.length ? <div className="panel"><EmptyState title={!jobs.length ? '先审阅，再安排分发' : search ? '没有匹配的发布任务' : filter === 'needs' ? '暂时没有需要你处理的任务' : '这个分类还没有任务'} description={!jobs.length ? '在创作台审阅平台版本，选择账号连接后加入队列。' : '可以切换分类，查看执行中的任务或已完成记录。'} icon={<Clock3 size={28} />} action={!jobs.length && navigate ? <Button className="primary" onClick={() => navigate('studio')}>前往创作台<ArrowRight size={16} /></Button> : jobs.length ? <Button onClick={() => { setFilter('all'); setSearch(''); }}>查看全部任务</Button> : undefined} /></div> : <div className="panel management-table-wrap"><table className="management-table management-queue-table"><thead><tr><th scope="col">稿件与目标</th><th scope="col">实际状态</th><th scope="col">时间</th><th scope="col"><span className="management-sr-only">处理任务</span></th></tr></thead><tbody>{shown.map(job => {
      const connection = data.connections.find(item => item.id === job.connectionId);
      const target = data.platforms.find(platform => platform.id === job.platformId);
      const received = dispatched(job);
      return <tr key={job.id}><td className="management-main-cell"><button className="management-title-button" onClick={() => setSnapshotJob(job)}>{job.title || '查看任务快照'}</button><div className="management-row-meta"><span>{target?.name || job.platformId}</span><span>{job.connectionName}</span><span>{job.attempts} 次执行</span></div><p className="management-excerpt management-job-message" title={job.message}>{job.message || '等待更新状态'}</p></td><td data-label="实际状态"><Badge kind={jobKind(job.status)}>{jobLabels[job.status] || job.status}</Badge>{received && job.status === 'needs_action' && <Muted>扩展已接收，等待平台核实</Muted>}{job.status === 'running' && <Muted><LoaderCircle size={12} className="spin" />状态会自动更新</Muted>}</td><td className="management-date" data-label="时间">{formatDate(job.status === 'scheduled' ? job.scheduledAt : job.createdAt, data.settings.timezone)}<Muted>{job.status === 'scheduled' ? '计划执行' : '任务创建'}</Muted></td><td data-label="操作"><div className="management-actions">{job.status === 'needs_action' && connection?.connector === 'multipost' && !received && <Button className="primary" onClick={() => bridge(job)} busy={busy === job.id} disabled={locked}><ExternalLink size={14} />交给扩展</Button>}{['needs_action', 'unconfirmed'].includes(job.status) && <Button className={received || job.status === 'unconfirmed' ? 'primary' : 'quiet'} onClick={() => startConfirm(job)} disabled={locked}>确认结果</Button>}{['queued', 'scheduled', 'needs_action'].includes(job.status) && <Button className="quiet" onClick={() => cancel(job)} disabled={locked}>取消</Button>}{['failed', 'unconfirmed', 'cancelled'].includes(job.status) && <Button className="quiet" onClick={() => { setRetryJob(job); setError(''); }} disabled={locked || !canRetry(job)} title={canRetry(job) ? '核实后按原快照重试' : '需要有效连接，且同一内容与账号不能有其他待处理任务'}><RefreshCw size={14} />重试</Button>}{safeLink(job.url) && <a className="button quiet" href={safeLink(job.url)} target="_blank" rel="noreferrer">查看远端<ExternalLink size={14} /></a>}<Button className="quiet" onClick={() => setSnapshotJob(job)}>快照</Button></div></td></tr>;
    })}</tbody></table></div>}
    {shown.length > 0 && <p className="management-footnote">显示 {shown.length} 个任务。重试创建新的任务，使用原任务的已审核内容快照。</p>}
    {snapshotJob && <Modal title="任务内容快照" close={() => setSnapshotJob(null)}><Snapshot job={jobs.find(job => job.id === snapshotJob.id) || snapshotJob} data={data} /><div className="management-modal-footer"><Button onClick={() => setSnapshotJob(null)}>关闭</Button></div></Modal>}
    {retryJob && <Modal title="按原快照重试" close={() => { if (!locked) setRetryJob(null); }}><div className="management-retry"><p className="management-callout">先检查平台是否已有这份内容。新尝试可能产生重复发布，并且使用下面的原任务快照，不会采用后来编辑的原稿。</p>{error && <ErrorMessage>{error}</ErrorMessage>}<details className="management-details" open><summary>检查将再次发送的内容<ChevronDown size={14} /></summary><div className="management-detail-body"><Snapshot job={retryJob} data={data} /></div></details><div className="management-form-actions"><Button onClick={() => setRetryJob(null)} disabled={locked}>取消</Button><Button className="primary" onClick={() => void retry()} busy={busy === retryJob.id} disabled={locked || !canRetry(retryJob)}>按此快照重试</Button></div></div></Modal>}
    {confirmJob && <Modal title="记录核实后的结果" close={closeConfirm}><form className="management-form" onSubmit={confirm}><p className="management-hint">请先在 {data.platforms.find(platform => platform.id === confirmJob.platformId)?.name || confirmJob.platformId} 检查“{confirmJob.title}”。这里仅记录实际结果，不会发送内容。</p>{error && <ErrorMessage>{error}</ErrorMessage>}{!confirmAllowed && <p className="management-callout">任务状态已经更新为“{jobLabels[currentConfirm?.status || ''] || currentConfirm?.status}”，无需继续人工确认。</p>}<Field label="你实际核实的结果"><select value={outcome} onChange={event => { setOutcome(event.target.value as typeof outcome); setConfirmDirty(true); }} required disabled={locked || !confirmAllowed}><option value="" disabled>请选择核实结果</option><option value="published">已在平台正式发布</option><option value="drafted">仅保存为平台草稿</option><option value="failed">确认未发布或操作失败</option></select></Field><Field label="远端链接（可选）"><input type="url" value={url} onChange={event => { setUrl(event.target.value); setConfirmDirty(true); }} placeholder="https://…" disabled={locked || !confirmAllowed} /></Field><Field label="核实备注（可选）"><textarea rows={3} maxLength={1000} value={message} onChange={event => { setMessage(event.target.value); setConfirmDirty(true); }} placeholder="例如：在平台后台找到了对应草稿" disabled={locked || !confirmAllowed} /></Field><div className="management-form-actions"><Button onClick={closeConfirm} disabled={locked}>取消</Button><Button className="primary" type="submit" disabled={locked || !outcome || !confirmAllowed} busy={busy === confirmJob.id}>记录结果</Button></div></form></Modal>}
  </div>;
}
