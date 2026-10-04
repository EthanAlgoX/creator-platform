import { LanguageSwitcher, localizeBootstrap, t, useI18n } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCheck, CircleHelp, Clock3, Compass, Copy, Download, Feather, Files, ImagePlus, LibraryBig, Link2, Menu, PencilLine, Plus, Save, Send, Settings2, Sparkles, UserRound, X } from 'lucide-react';
import type { Bootstrap, Connection, Content, Media, Variant } from './api';
import { errorText, request, send } from './api';
import { appUrl, mediaUrl, resolveUploadReferences } from './urls';
import { Badge, Button, EmptyState, ErrorMessage, Field, Modal, formatDate } from './ui';
import { ConnectionsPage, LibraryPage, ProfilesPage, QueuePage, SettingsPage } from './pages';
import { PlatformDirectoryPage, PlatformPicker, platformMonogram, platformSearchText } from './platforms';
import { accountState, aiReady, generationTargets, isSourceDirty, needsSourceReview } from './workflow';

type Page = 'studio' | 'library' | 'queue' | 'platforms' | 'connections' | 'profiles' | 'settings';
type Composer = { id?: string; title: string; source: string; profileId: string; media: Media[] };
export type VariantEdit = { title: string; body: string; tags: string; thread: string };
const INITIAL_PLATFORMS = ['x', 'reddit', 'xiaohongshu', 'zhihu', 'wechat'];
const EMPTY_COMPOSER: Composer = { title: '', source: '', profileId: '', media: [] };
const DRAFT_KEY = 'creator-workbench-draft-v1';
const NAV = [
  { id: 'studio' as Page, label: '创作工作台', icon: PencilLine },
  { id: 'library' as Page, label: '内容库', icon: LibraryBig },
  { id: 'queue' as Page, label: '发布任务', icon: Clock3 },
  { id: 'platforms' as Page, label: '平台目录', icon: Compass },
  { id: 'connections' as Page, label: '发布账号', icon: Link2 },
  { id: 'profiles' as Page, label: '写作画像', icon: UserRound },
  { id: 'settings' as Page, label: '工作区设置', icon: Settings2 },
];
const TITLE: Record<Page, { title: string; desc: string }> = {
  studio: { title: '创作工作台', desc: '写好原稿，逐平台确认，再安排分发。' },
  library: { title: '内容库', desc: '原稿、平台版本与素材，都留在自己的工作区。' },
  queue: { title: '发布任务', desc: '按渠道查看排期、发布结果与需要你处理的事项。' },
  platforms: { title: '平台目录', desc: '查看内容适配、发布方式与每个平台的实际条件。' },
  connections: { title: '发布账号', desc: '为每个账号选择合适的发布方式。' },
  profiles: { title: '写作画像', desc: '把你的受众、语气和偏好，带进每一次创作。' },
  settings: { title: '工作区设置', desc: '配置本地工作台、生成模型与时间显示。' },
};
const upsert = <T extends { id: string }>(items: T[], item: T) => items.some(x => x.id === item.id) ? items.map(x => x.id === item.id ? item : x) : [item, ...items];
const toComposer = (content: Content): Composer => ({ id: content.id, title: content.title, source: content.source, profileId: content.profileId || '', media: content.media });
const toEdit = (variant: Variant): VariantEdit => ({ title: variant.title, body: variant.body, tags: variant.tags.join(', '), thread: variant.thread.join('\n\n---\n\n') });
const splitTags = (text: string) => text.split(/[,，\n]/).map(x => x.trim().replace(/^#/, '')).filter(Boolean);
const splitThread = (text: string) => text.split(/\n\s*---\s*\n/).map(x => x.trim()).filter(Boolean);

function currentPage(): Page { const hash = window.location.hash.slice(1); return NAV.some(x => x.id === hash) ? hash as Page : 'studio'; }

export default function App() {
  const { locale } = useI18n();
  const [rawData, setData] = useState<Bootstrap | null>(null);
  const data = useMemo(() => localizeBootstrap(rawData, locale), [rawData, locale]);
  const [page, setPage] = useState<Page>(currentPage);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [composer, setComposer] = useState<Composer>(EMPTY_COMPOSER);
  const [edits, setEdits] = useState<Record<string, VariantEdit>>({});
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(INITIAL_PLATFORMS);
  const [activeVariantId, setActiveVariantId] = useState('');
  const [generationMode, setGenerationMode] = useState<'rules' | 'ai'>('rules');
  const [preview, setPreview] = useState(false);
  const [connectionPreset, setConnectionPreset] = useState('');
  const [schedule, setSchedule] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [batchTargets, setBatchTargets] = useState<string[]>([]);
  const [step, setStep] = useState<'write' | 'review' | 'distribute'>('write');
  const [variantQuery, setVariantQuery] = useState('');
  const [regenerateIds, setRegenerateIds] = useState<string[] | null>(null);
  const [sourceReviewOpen, setSourceReviewOpen] = useState(false);
  const [managementDirty, setManagementDirty] = useState(false);
  const [backupSucceeded, setBackupSucceeded] = useState(true);
  const [deliveryTiming, setDeliveryTiming] = useState<'now' | 'scheduled'>('now');
  const operationLock = useRef(false);
  const initialized = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const pendingJobIntent = useRef<{ fingerprint: string; key: string } | null>(null);
  const bootController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const next = await request<Bootstrap>('/api/bootstrap');
    setData(next); return next;
  }, []);
  useEffect(() => {
    if (!isMobile || !mobileNav) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const node = sidebarRef.current;
    const controls = () => [...(node?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || [])];
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileNav(false); }
      if (event.key === 'Tab') {
        const items = controls();
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      if (window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(() => mobileMenuRef.current?.focus());
    };
  }, [isMobile, mobileNav]);

  const boot = useCallback(async () => {
    setLoadError('');
    const controller = new AbortController(); bootController.current?.abort(); bootController.current = controller;
    try {
      const next = await request<Bootstrap>('/api/bootstrap', { signal: controller.signal });
      if (controller.signal.aborted) return;
      setData(next);
      if (!initialized.current) {
        try {
          const cached = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
          if (cached?.composer && typeof cached.composer.source === 'string' && typeof cached.composer.title === 'string') {
            const contentExists = next.contents.some(x => x.id === cached.composer.id);
            setComposer({ ...EMPTY_COMPOSER, ...cached.composer, id: contentExists ? cached.composer.id : undefined, media: Array.isArray(cached.composer.media) ? cached.composer.media : [] });
            setEdits(Object.fromEntries(Object.entries(cached.edits || {}).filter(([id]) => next.variants.some(x => x.id === id))) as Record<string, VariantEdit>);
            if (Array.isArray(cached.platforms)) setSelectedPlatforms(cached.platforms.filter((id: string) => next.platforms.some(p => p.id === id)));
            if (['write', 'review', 'distribute'].includes(cached.step)) setStep(cached.step);
            if (next.variants.some(v => v.id === cached.activeVariantId && v.contentId === cached.composer.id)) setActiveVariantId(cached.activeVariantId);
          }
        } catch { /* An unreadable draft does not prevent access to server-saved content. */ }
        initialized.current = true;
      }
    } catch (e) { if (!controller.signal.aborted) setLoadError(errorText(e)); }
  }, []);

  useEffect(() => { void boot(); return () => bootController.current?.abort(); }, [boot]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [page, step, composer.id]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const change = () => {
      if (query.matches && sidebarRef.current?.contains(document.activeElement)) mobileMenuRef.current?.focus();
      setIsMobile(query.matches); setMobileNav(false);
    };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => { const handler = () => {
    const next = currentPage(); if (next === page) return;
    if (operationLock.current || (managementDirty && !window.confirm(t("当前页面有未保存修改。离开会放弃这些修改，是否继续？")))) { window.location.hash = page; return; }
    setManagementDirty(false); setPage(next); closeMobileNav();
  }; window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, [page, managementDirty]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 6500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!data || !initialized.current) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ composer, edits, platforms: selectedPlatforms, step, activeVariantId })); setBackupSucceeded(true); }
    catch { setBackupSucceeded(false); setError(t("本机草稿备份失败。请使用“保存修改”写入工作区后再关闭页面。")); }
  }, [composer, edits, selectedPlatforms, step, activeVariantId, !!data]);

  const savedContent = data?.contents.find(x => x.id === composer.id);
  const sourceDirty = isSourceDirty(composer, savedContent);
  const hasDirty = sourceDirty || Object.keys(edits).length > 0;
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (hasDirty || managementDirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [hasDirty, managementDirty]);
  const currentVariants = useMemo(() => data?.variants.filter(v => v.contentId === composer.id) || [], [data?.variants, composer.id]);
  const activeVariant = currentVariants.find(v => v.id === activeVariantId) || currentVariants[0];
  const platform = data?.platforms.find(p => p.id === activeVariant?.platformId);
  const activeEdit = activeVariant ? edits[activeVariant.id] || toEdit(activeVariant) : null;
  const variantDirty = Boolean(activeVariant && edits[activeVariant.id]);
  const activeJobs = data?.jobs.filter(j => ['queued', 'scheduled', 'running', 'needs_action', 'unconfirmed'].includes(j.status)).length || 0;
  const approved = Boolean(activeVariant?.approved && !variantDirty && !sourceDirty);
  const dateTimezone = data?.settings.timezone || 'Asia/Shanghai';
  const reviewedVariants = currentVariants.filter(v => v.approved && !edits[v.id] && !sourceDirty && !v.issues.some(issue => issue.severity === 'error'));

  useEffect(() => {
    if (!data?.jobs.some(j => ['queued', 'scheduled', 'running', 'unconfirmed'].includes(j.status))) return;
    let live = true;
    const timer = setInterval(() => { void request<Bootstrap>('/api/bootstrap').then(next => { if (live) setData(next); }).catch(() => { /* Manual refresh keeps errors actionable without repeated background banners. */ }); }, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [data?.jobs.some(j => ['queued', 'scheduled', 'running', 'unconfirmed'].includes(j.status))]);

  const closeMobileNav = () => { setMobileNav(false); };
  const navigate = (next: Page, internal = false) => {
    if (operationLock.current && !internal) return false;
    if (next !== page && managementDirty && !window.confirm(t("当前页面有未保存修改。离开会放弃这些修改，是否继续？"))) return false;
    if (next !== page) setManagementDirty(false);
    if (next === 'connections') setConnectionPreset(''); setPage(next); window.location.hash = next; closeMobileNav(); setError(''); return true;
  };
  const connectPlatform = (platformId: string) => { if (navigate('connections')) setConnectionPreset(platformId); };
  const addPlatformToComposer = (platformId: string) => { if (!navigate('studio')) return; setSelectedPlatforms(previous => [...new Set([...previous, platformId])]); setStep('write'); setNotice(t("平台已加入本次创作，原稿与现有版本保留。")); };
  const updateComposer = (patch: Partial<Composer>) => setComposer(c => ({ ...c, ...patch }));
  const updateVariant = (patch: Partial<VariantEdit>) => {
    if (!activeVariant) return;
    setEdits(prev => {
      const current = prev[activeVariant.id] || toEdit(activeVariant);
      const next = { ...current, ...patch };
      if (patch.body !== undefined && current.thread.trim()) next.thread = [patch.body, ...splitThread(current.thread).slice(1)].join('\n\n---\n\n');
      if (patch.thread !== undefined) { const first = splitThread(patch.thread)[0]; if (first) next.body = first; }
      return { ...prev, [activeVariant.id]: next };
    });
  };

  const deletedContent = (id: string) => {
    if (composer.id !== id) return;
    setComposer(EMPTY_COMPOSER); setEdits({}); setActiveVariantId(''); setBatchTargets([]);
  };

  async function saveSource(): Promise<Content> {
    if (!composer.source.trim()) throw new Error(t("请先写下主题或原稿，再保存。素材需要配合文字内容使用。"));
    const title = composer.title.trim() || composer.source.trim().split('\n')[0].slice(0, 40) || t("未命名稿件");
    if (!sourceDirty && savedContent) return savedContent;
    const payload = { title, source: composer.source, profileId: composer.profileId || undefined, media: composer.media };
    const content = await send<Content>(composer.id ? `/api/contents/${composer.id}` : '/api/contents', payload, composer.id ? 'PUT' : 'POST');
    setComposer(toComposer(content));
    setData(previous => previous ? { ...previous, contents: upsert(previous.contents, content), variants: previous.variants.map(v => v.contentId === content.id ? { ...v, approved: false, issues: [...v.issues.filter(i => !i.message.includes('原稿')), { severity: 'error' as const, message: '原稿已修改，请重新核对这个平台版本' }] } : v) } : previous);
    return content;
  }

  async function saveVariant(id: string, edit: VariantEdit) {
    const variant = await send<Variant>(`/api/variants/${id}`, { title: edit.title, body: edit.body, tags: splitTags(edit.tags), thread: splitThread(edit.thread) }, 'PUT');
    setData(previous => previous ? { ...previous, variants: upsert(previous.variants, variant) } : previous);
    setEdits(previous => { const next = { ...previous }; delete next[id]; return next; });
    return variant;
  }

  async function saveAll(): Promise<Content | undefined> {
    let content = savedContent;
    if (sourceDirty) content = await saveSource();
    for (const [id, edit] of Object.entries(edits)) await saveVariant(id, edit);
    return content;
  }

  async function run(label: string, action: () => Promise<void>) {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(label); setError('');
    try { await action(); } catch (e) { setError(errorText(e)); } finally { operationLock.current = false; setBusy(''); }
  }

  const save = () => run('save', async () => { await saveAll(); setNotice(t("原稿与平台版本已保存到本地工作区。")); });
  async function preserveBeforeSwitch() {
    if (sourceDirty && !composer.source.trim()) {
      if (!window.confirm(t("正文为空，当前标题和素材修改还不能保存。是否放弃这些未保存的原稿修改并继续？工作区中已保存的稿件会保留。"))) return { cancelled: true, content: undefined };
      for (const [id, edit] of Object.entries(edits)) await saveVariant(id, edit);
      return { cancelled: false, content: savedContent };
    }
    return { cancelled: false, content: await saveAll() };
  }
  const openContent = (content: Content) => run('open', async () => {
    const result = await preserveBeforeSwitch(); if (result.cancelled) return;
    const saved = result.content; setComposer(toComposer(saved?.id === content.id ? saved : content)); setEdits({});
    setActiveVariantId(data?.variants.find(v => v.contentId === content.id)?.id || '');
    setStep('write'); setBatchTargets([]); setSchedule(''); setDeliveryTiming('now'); setVariantQuery(''); navigate('studio', true);
  });
  const newContent = (example = false) => run('new', async () => {
    const result = await preserveBeforeSwitch(); if (result.cancelled) return;
    setComposer(example ? { ...EMPTY_COMPOSER, title: t("把碎片阅读变成长期知识"), source: t("我想分享一个亲自实践的阅读方法：读完一篇文章，不急着收藏，先用自己的话写下一个观点、一个例子和一个可以尝试的行动。\n\n观点：知识只有被重新表达和使用，才会真正留下来。\n例子：读到时间管理的方法后，我用它重新安排了下周的写作时间，而不是再下载一个工具。\n行动：每天花五分钟整理一条阅读笔记，每周选一条去实践。\n\n这只是我个人的尝试，不需要每天读很多，先从一条有用的笔记开始。") } : EMPTY_COMPOSER);
    setEdits({}); setActiveVariantId(''); setStep('write'); setBatchTargets([]); setSchedule(''); setDeliveryTiming('now'); setVariantQuery(''); navigate('studio', true);
    if (example) setNotice(t("示例原稿已载入。它可编辑，不会创建连接或发布任务。"));
  });

  const generate = (replace = false, requested = selectedPlatforms) => run('generate', async () => {
    if (!requested.length) throw new Error(t("请至少选择一个目标平台。"));
    if (!composer.source.trim()) throw new Error(t("请先写下主题或原稿。"));
    if (generationMode === 'ai' && data && !aiReady(data.settings)) throw new Error(t("AI 配置不完整。请在工作区设置保存服务地址、模型名称和密钥。"));
    const targets = generationTargets(requested, currentVariants, replace);
    if (!targets.length) { setStep('review'); return; }
    const content = await saveAll() || await saveSource();
    const result = await send<{ variants: Variant[]; mode: string }>(`/api/contents/${content.id}/generate`, { platformIds: targets, mode: generationMode, replaceExisting: replace });
    setData(previous => previous ? { ...previous, variants: [...previous.variants.filter(v => !(v.contentId === content.id && targets.includes(v.platformId))), ...result.variants] } : previous);
    setActiveVariantId(result.variants[0]?.id || ''); setPreview(false);
    setStep('review'); setRegenerateIds(null);
    setNotice(t("{p0}已完成，{p1} 个平台版本等待你审阅。", { p0: generationMode === 'ai' ? t("AI 创作") : t("规则适配"), p1: result.variants.length }));
  });

  const approve = (rebase = false) => {
    if (!activeVariant) return;
    if (!rebase && (sourceDirty || needsSourceReview(activeVariant))) { setSourceReviewOpen(true); return; }
    return run('approve', async () => {
    if (!activeVariant) return;
    await saveAll();
    if (rebase) await send<Variant>(`/api/variants/${activeVariant.id}`, { rebase: true }, 'PUT');
    const result = await send<Variant>(`/api/variants/${activeVariant.id}`, { approved: true }, 'PUT');
    setData(previous => previous ? { ...previous, variants: upsert(previous.variants, result) } : previous);
    setNotice(t("当前平台版本已审阅确认。修改内容后需要再次确认。"));
    setSourceReviewOpen(false);
  }); };

  async function createJobs(targets: { variantId: string; connectionId: string }[]) {
    if (!targets.length) throw new Error(t("请选择至少一个兼容且已配置的渠道。"));
    let scheduledAt: string | undefined;
    if (deliveryTiming === 'scheduled') { if (!schedule) throw new Error(t("请选择预约时间。")); const date = new Date(schedule); if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error(t("排期时间需要晚于现在。")); scheduledAt = date.toISOString(); }
    const payload = { contentId: composer.id, targets, scheduledAt };
    const fingerprint = JSON.stringify(payload);
    if (pendingJobIntent.current?.fingerprint !== fingerprint) pendingJobIntent.current = { fingerprint, key: crypto.randomUUID() };
    const result = await send<{ jobs: Bootstrap['jobs'] }>('/api/jobs', payload, 'POST', { 'Idempotency-Key': pendingJobIntent.current.key });
    pendingJobIntent.current = null;
    setData(previous => previous ? { ...previous, jobs: [...result.jobs, ...previous.jobs.filter(j => !result.jobs.some(n => n.id === j.id))] } : previous);
    setNotice(t("{p0} 个渠道任务已{p1}。实际结果请查看发布任务。", { p0: result.jobs.length, p1: scheduledAt ? t("加入排期") : t("加入队列") })); setSchedule(''); setDeliveryTiming('now'); setBatchTargets([]); navigate('queue', true);
  }

  const publishBatch = () => run('publish-batch', async () => {
    const targets = reviewedVariants.flatMap(v => (data?.connections || []).filter(c => c.platformId === v.platformId && c.enabled && c.configured && batchTargets.includes(`${v.id}:${c.id}`) && !data?.jobs.some(j => j.contentId === composer.id && j.platformId === v.platformId && j.connectionId === c.id && ['queued', 'scheduled', 'running', 'unconfirmed', 'needs_action'].includes(j.status))).map(c => ({ variantId: v.id, connectionId: c.id })));
    await createJobs(targets);
  });

  const upload = (files: FileList | null) => run('upload', async () => {
    if (!files?.length) return;
    if (composer.media.length + files.length > 20) throw new Error(t("每份内容最多保存 20 个素材。请先移除不需要的附件。"));
    for (const file of Array.from(files)) {
      if (file.size > 25 * 1024 * 1024) throw new Error(t("{p0} 超过 25 MB，请先压缩。", { p0: file.name }));
      const form = new FormData(); form.append('file', file);
      const media = await request<Media>('/api/uploads', { method: 'POST', body: form });
      setComposer(c => ({ ...c, media: [...c.media, media] }));
    }
    if (fileInput.current) fileInput.current.value = '';
  });

  const copy = () => run('copy', async () => {
    if (!activeEdit) return;
    const thread = splitThread(activeEdit.thread);
    const text = platform?.id === 'x' ? (thread.length ? thread.join('\n\n---\n\n') : activeEdit.body) : [activeEdit.title, activeEdit.body, splitTags(activeEdit.tags).map(t => `#${t}`).join(' ')].filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text); setNotice(t("当前版本已复制，可粘贴到平台编辑器。"));
  });

  const exportContent = (format: 'markdown' | 'html' | 'json') => run('export', async () => {
    if (!activeVariant) return;
    await saveAll();
    const response = await fetch(appUrl(`/api/contents/${activeVariant.contentId}/export?platformId=${encodeURIComponent(activeVariant.platformId)}&format=${format}`));
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || t("导出没有完成，请重试。")); }
    const blob = format === 'json' ? await response.blob() : new Blob(
      [resolveUploadReferences(await response.text(), format, window.location.origin)],
      { type: response.headers.get('Content-Type') || (format === 'html' ? 'text/html' : 'text/markdown') },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `${(activeEdit?.title || composer.title || t("内容")).replace(/[\\/:*?"<>|]/g, '-')}-${activeVariant.platformId}.${format === 'markdown' ? 'md' : format}`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(t("导出完成。文件已准备好，尚未发布到任何平台。"));
  });

  if (!data) return <div className="boot-screen"><LanguageSwitcher /><div className="brand-symbol"><Feather size={25} /></div><h1>{t("创作间")}</h1><p>{t("正在打开本地工作区")}</p>{loadError ? <><ErrorMessage>{t(loadError)}</ErrorMessage><Button className="primary" onClick={() => void boot()}>{t("重新连接")}</Button></> : <div className="loading-line" aria-label={t("正在加载工作区")} />}</div>;

  const missingTargets = generationTargets(selectedPlatforms, currentVariants);
  const visibleVariants = currentVariants.filter(v => `${platformSearchText(data.platforms.find(p => p.id === v.platformId))} ${v.title}`.toLowerCase().includes(variantQuery.toLowerCase()));
  const variantState = (v: Variant) => sourceDirty || needsSourceReview(v) ? t("需核对原稿") : edits[v.id] ? t("有修改") : v.issues.some(i => i.severity === 'error') ? t("需修正") : v.approved ? t("已确认") : t("待审阅");
  const definitionFor = (c: Connection) => data.connectorDefinitions.find(d => d.id === (c.connector === 'native' ? `native:${c.platformId}` : c.connector));
  const routeName = (c: Connection) => c.connector === 'multipost' ? t("浏览器审阅") : c.connector === 'wechatsync' || (definitionFor(c)?.mode === 'draft' && c.config.postType !== 'publish') ? t("保存草稿") : c.connector === 'postiz' && c.config.postType === 'draft' ? t("Postiz 草稿") : c.connector === 'xiaohongshu' || c.platformId === 'teams' || c.connector === 'postiz' || c.connector === 'webhook' ? t("提交后核对结果") : t("接口提交");
  const hasActiveTarget = (platformId: string, connectionId: string) => data.jobs.some(j => j.contentId === composer.id && j.platformId === platformId && j.connectionId === connectionId && ['queued', 'scheduled', 'running', 'unconfirmed', 'needs_action'].includes(j.status));
  const validTargetKeys = new Set(reviewedVariants.flatMap(v => data.connections.filter(c => c.platformId === v.platformId && c.enabled && c.configured && !hasActiveTarget(v.platformId, c.id)).map(c => `${v.id}:${c.id}`)));
  const selectedTargetCount = batchTargets.filter(key => validTargetKeys.has(key)).length;
  const managementProps = { data, refresh, notify: setNotice, onDirtyChange: setManagementDirty, globalBusy: !!busy, navigate: (next: string) => { if (NAV.some(n => n.id === next)) navigate(next as Page); } };
  const changeVariant = (id: string) => { setActiveVariantId(id); };
  const steps = [
    { id: 'write' as const, title: t("写原稿"), detail: savedContent && !sourceDirty ? t("已保存") : t("主题、素材与画像"), icon: PencilLine },
    { id: 'review' as const, title: t("适配与审阅"), detail: currentVariants.length ? t("{p0} / {p1} 已确认", { p0: reviewedVariants.length, p1: currentVariants.length }) : t("生成平台版本"), icon: CheckCheck },
    { id: 'distribute' as const, title: t("分发"), detail: t("选账号、安排时间"), icon: Send },
  ];
  return <div className="app-shell">
    <aside id="workspace-sidebar" ref={sidebarRef} className={`sidebar ${mobileNav ? 'mobile-open' : ''}`} inert={isMobile && !mobileNav} aria-hidden={isMobile && !mobileNav ? true : undefined} onKeyDown={event => { if (isMobile && event.key === 'Escape') { event.preventDefault(); closeMobileNav(); } }}>
      <a className="brand" href="#studio" onClick={e => { e.preventDefault(); navigate('studio'); }}><span className="brand-symbol"><Feather size={22} strokeWidth={1.7} /></span><span><strong>{t("创作间")}</strong><small>{t("个人内容工作台")}</small></span></a>
      <nav aria-label={t("工作区导航")}>{[[t("内容工作流"), ['studio', 'library', 'queue']], [t("工作区"), ['platforms', 'connections', 'profiles', 'settings']]].map(([label, ids]) => <div className="nav-group" key={label as string}><p className="workspace-label">{t(label as string)}</p>{NAV.filter(item => (ids as string[]).includes(item.id)).map(item => <button disabled={!!busy} key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={18} strokeWidth={1.8} /><span>{t(item.label)}</span>{item.id === 'queue' && activeJobs > 0 && <span className="nav-count">{activeJobs}</span>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><div className="local-mark"><span className="status-dot" />{t(data.remoteMode ? "私有工作区" : "本地工作区")}</div><p>{t(data.remoteMode ? "原稿和配置保存于此服务器。" : "原稿和配置保存于这台电脑。")}</p><button className="sidebar-account-link" disabled={!!busy} onClick={() => navigate('connections')}><Link2 size={15} /><span>{t("发布账号：{count}", { count: data.connections.length })}</span><ArrowRight size={14} /></button></div>
    </aside>
    {isMobile && mobileNav && <button className="nav-overlay" aria-label={t("关闭导航")} onClick={closeMobileNav} />}
    <main className="main-shell" inert={isMobile && mobileNav}>
      <header className="topbar"><div className="breadcrumb"><button ref={mobileMenuRef} className="icon-button mobile-menu" aria-label={t("展开导航")} aria-controls="workspace-sidebar" aria-expanded={isMobile && mobileNav} onClick={() => mobileNav ? closeMobileNav() : setMobileNav(true)}><Menu size={20} /></button><span>{t("个人工作区")}</span><span className="breadcrumb-slash">/</span><strong>{t(TITLE[page].title)}</strong></div><div className="topbar-actions"><span className="local-pill"><span className="status-dot" />{t(data.remoteMode ? "服务器运行" : "本地运行")}</span><LanguageSwitcher /></div></header>
      <div className={`page-container ${page === 'studio' ? 'studio-page' : ''}`}>
        <div className="page-heading"><div><h1>{page === 'studio' ? composer.title || t("开始一份内容") : t(TITLE[page].title)}</h1><p>{t(TITLE[page].desc)}</p></div><div className="heading-actions">{page === 'studio' && <Button onClick={() => void newContent()} disabled={!!busy}><Plus size={16} />{t("新建内容")}</Button>}{page === 'studio' && <Button onClick={() => void save()} disabled={!!busy || !hasDirty} busy={busy === 'save'}><Save size={16} />{t("保存修改")}</Button>}{page === 'queue' && <Button onClick={() => void run('refresh', async () => { await refresh(); setNotice(t("任务状态已刷新。")); })} busy={busy === 'refresh'}>{t("刷新状态")}</Button>}</div></div>
        {error && <ErrorMessage>{t(error)}</ErrorMessage>}
        {notice && <div className="notice" role="status"><Check size={16} /><span>{t(notice)}</span><button aria-label={t("关闭提示")} className="icon-button" onClick={() => setNotice('')}><X size={16} /></button></div>}
        {page === 'studio' && <>
          <div className="workflow-header"><nav className="workflow-steps" aria-label={t("内容工作流程")}>{steps.map((s, i) => <button key={s.id} className={step === s.id ? 'active' : ''} aria-current={step === s.id ? 'step' : undefined} onClick={() => setStep(s.id)} disabled={!!busy}><span className="workflow-step-icon"><s.icon size={17} /></span><span><strong>{s.title}</strong><small>{s.detail}</small></span>{i < 2 && <ArrowRight size={15} className="step-arrow" />}</button>)}</nav><span className={`save-status ${hasDirty ? 'dirty' : ''}`} role="status">{hasDirty ? (backupSucceeded ? t("未保存 · 浏览器已备份") : t("未保存 · 备份失败，请保存")) : composer.id ? t("已保存 {p0}", { p0: savedContent ? formatDate(savedContent.updatedAt, dateTimezone) : '' }) : t("新稿件")}</span></div>
          {busy === 'generate' && <div className="operation-progress" role="status"><Sparkles size={18} /><div><strong>{t("正在生成平台版本")}</strong><p>{generationMode === 'ai' ? t("每次最多处理 6 个平台，全部成功后保存。请保留页面，{p0} 批请求可能需要几分钟。", { p0: Math.ceil((regenerateIds?.length || missingTargets.length) / 6) }) : t("正在整理原稿并检查各平台格式。")}</p></div></div>}
          {step === 'write' && <div className="writing-layout">
            <section className="panel writing-canvas" aria-labelledby="source-heading"><div className="panel-heading"><div><h2 id="source-heading">{t("原稿")}</h2><p>{t("保留完整内容，再为不同平台调整表达。")}</p></div><Badge>{composer.id ? t("本地稿件") : t("新内容")}</Badge></div><div className="source-fields">
              <Field label={t("内容标题")}><input placeholder={t("为这次创作起个名字")} value={composer.title} onChange={e => updateComposer({ title: e.target.value })} disabled={!!busy} maxLength={500} /></Field>
              <Field label={t("主题与正文")}><textarea className="source-textarea" placeholder={t("写下主题、观点或一篇完整原稿。\n\n可以从你的经验、一个例子和想传达的结论开始。")} value={composer.source} onChange={e => updateComposer({ source: e.target.value })} disabled={!!busy} maxLength={100000} /></Field>
              <div className="source-meta"><span>{t("字符数：{count}", { count: Array.from(composer.source).length.toLocaleString(locale === "en" ? "en-US" : "zh-CN") })}</span>{!composer.id && !composer.source && <button className="text-button" onClick={() => void newContent(true)} disabled={!!busy}>{t("载入示例原稿")}<ArrowRight size={14} /></button>}</div>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,application/pdf" multiple hidden onChange={e => void upload(e.target.files)} />
              <div className="source-attachments"><div className="section-label"><h3>{t("素材与附件")}</h3><span className="subtle-label">{composer.media.length} / 20</span></div>{composer.media.length > 0 && <div className="media-list">{composer.media.map(media => <div className="media-item" key={media.id}>{media.mime.startsWith('image/') ? <img src={mediaUrl(media.url)} alt={media.name} /> : <Files size={21} />}<span title={media.name}>{media.name}</span><button className="icon-button" aria-label={t("移除素材 {p0}", { p0: media.name })} onClick={() => updateComposer({ media: composer.media.filter(m => m.id !== media.id) })} disabled={!!busy}><X size={15} /></button></div>)}</div>}<Button className="media-button" onClick={() => fileInput.current?.click()} busy={busy === 'upload'} disabled={!!busy || composer.media.length >= 20}><ImagePlus size={17} />{t("添加图片、视频或 PDF")}</Button><p className="field-hint">{t("单文件 ≤ 25 MB。PDF 仅作为附件保存，需要改写的文字请粘贴到原稿。")}</p></div>
            </div></section>
            <aside className="writing-options"><section className="panel options-panel"><div className="panel-heading"><h2>{t("本次创作")}</h2></div><div className="options-body"><Field label={t("本次写作画像")} hint={t("指定受众、语气和禁用词。")}><select value={composer.profileId} onChange={e => updateComposer({ profileId: e.target.value })} disabled={!!busy}><option value="">{t("通用表达")}</option>{data.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>{!data.profiles.length && <button className="text-button" onClick={() => navigate('profiles')} disabled={!!busy}>{t("建立写作画像")}<ArrowRight size={14} /></button>}</div><PlatformPicker platforms={data.platforms} definitions={data.connectorDefinitions} connections={data.connections} selected={selectedPlatforms} onChange={setSelectedPlatforms} disabled={!!busy} openDirectory={() => navigate('platforms')} />
              <div className="generation-options"><h3>{t("适配方式")}</h3><label className={`mode-option ${generationMode === 'rules' ? 'selected' : ''}`}><input type="radio" name="generation" value="rules" checked={generationMode === 'rules'} onChange={() => setGenerationMode('rules')} disabled={!!busy} /><span><strong>{t("规则整理")}</strong><small>{t("整理现有文字，不调用模型")}</small></span></label><label className={`mode-option ${generationMode === 'ai' ? 'selected' : ''}`}><input type="radio" name="generation" value="ai" checked={generationMode === 'ai'} onChange={() => setGenerationMode('ai')} disabled={!!busy} /><span><strong>{t("AI 改写")}</strong><small>{aiReady(data.settings) ? data.settings.generation.model : t("需配置模型服务")}</small></span></label>{generationMode === 'ai' && !aiReady(data.settings) && <p className="inline-guidance">{t("先")} <button className="text-button" onClick={() => navigate('settings')}>{t("配置生成模型")}</button> {t("，或使用规则整理。")}</p>}
                {missingTargets.length > 0 ? <Button className="primary full-button" onClick={() => void generate()} busy={busy === 'generate'} disabled={!!busy || !composer.source.trim() || generationMode === 'ai' && !aiReady(data.settings)}><Sparkles size={17} />{t(missingTargets.length === 1 ? "生成 1 个平台版本" : "生成 {count} 个平台版本", { count: missingTargets.length })}<ArrowRight size={15} /></Button> : <Button className="primary full-button" onClick={() => setStep('review')} disabled={!!busy || !currentVariants.length}><CheckCheck size={17} />{t("前往适配与审阅")}<ArrowRight size={15} /></Button>}
                <p className="field-hint">{currentVariants.length ? t("现有版本会保留。重新生成时会再次确认替换范围。") : t("生成后逐平台编辑与审阅，再安排分发。")}{!selectedPlatforms.length && t("请先选择目标平台。")}</p>{currentVariants.length > 0 && selectedPlatforms.length > 0 && <button className="text-button" onClick={() => setRegenerateIds(selectedPlatforms)} disabled={!!busy}>{t("重新生成所选平台")}</button>}
              </div></section><div className="workspace-tip"><CircleHelp size={16} /><p>{t("只有主题时，AI 会先给出待补充提纲。规则整理适用于已有原稿。")}</p></div></aside>
          </div>}
          {step === 'review' && (!activeVariant || !activeEdit || !platform ? <section className="panel"><EmptyState title={t("先生成平台版本")} description={t("在原稿中选择目标平台，生成后就可以分别编辑、预览和确认。")} action={<Button className="primary" onClick={() => setStep('write')}>{t("返回写原稿")}</Button>} /></section> : <>
            <div className="review-overview"><span>{t("版本：{count} · 已确认：{approved}", { count: currentVariants.length, approved: reviewedVariants.length })}</span><Button className="primary" onClick={() => setStep('distribute')} disabled={!!busy || !reviewedVariants.length}><Send size={16} />{t("安排分发")}<ArrowRight size={15} /></Button></div>
            <div className="review-layout"><aside className="panel version-navigation"><div className="version-list-header"><h2>{t("平台版本")}</h2><input type="search" aria-label={t("搜索平台版本")} placeholder={t("搜索平台或标题")} value={variantQuery} onChange={e => setVariantQuery(e.target.value)} /></div><div className="version-list" role="tablist" aria-label={t("平台版本")} aria-orientation="vertical">{visibleVariants.map((v, i) => <button id={`version-${v.id}`} role="tab" aria-selected={v.id === activeVariant.id} tabIndex={v.id === activeVariant.id || (i === 0 && !visibleVariants.some(item => item.id === activeVariant.id)) ? 0 : -1} key={v.id} className={`version-row ${v.id === activeVariant.id ? 'active' : ''}`} onClick={() => changeVariant(v.id)} disabled={!!busy} onKeyDown={e => { let index: number | undefined; if (e.key === 'ArrowDown') index = (i + 1) % visibleVariants.length; if (e.key === 'ArrowUp') index = (i - 1 + visibleVariants.length) % visibleVariants.length; if (e.key === 'Home') index = 0; if (e.key === 'End') index = visibleVariants.length - 1; if (index !== undefined) { e.preventDefault(); changeVariant(visibleVariants[index].id); document.getElementById(`version-${visibleVariants[index].id}`)?.focus(); } }}><span className="version-monogram">{platformMonogram(data.platforms.find(p => p.id === v.platformId))}</span><span><strong>{data.platforms.find(p => p.id === v.platformId)?.name || v.platformId}</strong><small>{variantState(v)}</small></span>{v.approved && !edits[v.id] && !sourceDirty && <Check size={15} />}</button>)}</div>{!visibleVariants.length && <p className="list-no-results">{t("没有匹配的平台版本。")}</p>}<div className="mobile-version-select"><Field label={t("选择平台版本")}><select value={activeVariant.id} onChange={e => changeVariant(e.target.value)} disabled={!!busy}>{currentVariants.map(v => <option key={v.id} value={v.id}>{data.platforms.find(p => p.id === v.platformId)?.name} · {variantState(v)}</option>)}</select></Field></div><button className="text-button version-back" onClick={() => setStep('write')}>{t("调整原稿与目标")}<ArrowRight size={14} /></button></aside>
              <section className="panel version-editor" aria-label={t("{p0} 内容版本", { p0: platform.name })}><div className="editor-heading"><div><h2>{platform.name}</h2><div className="editor-meta"><span>{activeVariant.source === 'ai' ? t("AI 改写") : activeVariant.source === 'rules' ? t("规则整理") : t("人工编辑")}</span><Badge kind={approved ? 'success' : ''}>{variantState(activeVariant)}</Badge></div></div><div className="segmented" aria-label={t("显示方式")}><button className={!preview ? 'active' : ''} onClick={() => setPreview(false)} aria-pressed={!preview}>{t("编辑")}</button><button className={preview ? 'active' : ''} onClick={() => setPreview(true)} aria-pressed={preview}>{t("预览")}</button></div></div>
                <div className="variant-workspace">{(sourceDirty || needsSourceReview(activeVariant)) && <div className="inline-note"><CircleHelp size={17} /><span>{t("原稿已更新。你可以重新生成，或核对原稿后保留当前文案并再次确认。")}</span><button className="text-button" onClick={() => setStep('write')}>{t("查看原稿")}</button></div>}
                  {preview ? <div className="preview-surface">{platform.category === 'article' && activeVariant.html && !variantDirty ? <iframe title={t("{p0} 文章预览", { p0: platform.name })} className="html-preview" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;color:#182538}article{max-width:70ch;margin:auto}h1{font-size:24px;line-height:1.5}</style><article><h1>${activeEdit.title.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c))}</h1>${resolveUploadReferences(activeVariant.html, 'html', window.location.origin)}</article>`} /> : <article className="plain-preview">{platform.id !== 'x' && <h2>{activeEdit.title}</h2>}{!(platform.id === 'x' && splitThread(activeEdit.thread).length) && <div>{activeEdit.body}</div>}{activeEdit.thread && <div className="thread-preview">{splitThread(activeEdit.thread).map((t, i) => <div key={i}><span>{i + 1}</span><p>{t}</p></div>)}</div>}{platform.id !== 'x' && activeEdit.tags && <p className="preview-tags">{splitTags(activeEdit.tags).map(t => `#${t}`).join(' ')}</p>}</article>}</div> : <div className="variant-fields">{platform.titleLimit > 0 && <Field label={t("标题")}><input value={activeEdit.title} onChange={e => updateVariant({ title: e.target.value })} disabled={!!busy} /></Field>}<Field label={activeEdit.thread ? t("正文 · 串帖第一条") : t("正文")}><textarea className="variant-textarea" value={activeEdit.body} onChange={e => updateVariant({ body: e.target.value })} disabled={!!busy} /></Field>{platform.id === 'x' && <details className="thread-details" key={activeVariant.id}><summary>{t("连续帖子")}{activeEdit.thread ? t(" · {p0} 条", { p0: splitThread(activeEdit.thread).length }) : t("（可选）")}</summary><Field label={t("完整串帖")} hint={t("各帖之间用单独一行 --- 分隔。首帖与正文同步。")}><textarea className="thread-textarea" value={activeEdit.thread} onChange={e => updateVariant({ thread: e.target.value })} disabled={!!busy} /></Field></details>}<Field label={t("话题标签（可选）")} hint={t("用逗号分隔，不适用的平台可留空。")}><input value={activeEdit.tags} onChange={e => updateVariant({ tags: e.target.value })} disabled={!!busy} placeholder={t("阅读笔记, 知识管理")} /></Field></div>}
                  <div className="variant-counts">{platform.titleLimit > 0 && <span>{t("标题")} {Array.from(activeEdit.title).length} / {platform.titleLimit}</span>}<span>{t("正文")} {Array.from(activeEdit.body).length.toLocaleString()} {t("字符")}</span><span>{platform.id === 'x' ? t("保存时按加权字符逐帖检查") : t("默认上限 {p0}", { p0: platform.bodyLimit.toLocaleString() })}</span></div>
                  {variantDirty ? <div className="validation-box muted"><CircleHelp size={16} /><span>{t("有未保存的编辑，保存后重新校验。")}</span></div> : <div className="validation-list">{activeVariant.issues.filter(i => !i.message.includes('原稿')).map((issue, i) => <div key={i} className={`validation-box ${issue.severity}`}><CircleHelp size={16} /><span>{t(issue.message)}</span>{issue.severity === 'error' && /图片|视频|素材/.test(issue.message) && <button className="text-button" onClick={() => setStep('write')}>{t("补充素材")}</button>}</div>)}{!activeVariant.issues.some(i => i.severity === 'error') && <div className="validation-box passed"><Check size={16} /><span>{t("格式检查通过，观点和信息仍需你核对。")}</span></div>}</div>}
                </div><div className="editor-actions"><div className="editor-secondary-actions"><button className="text-button" onClick={() => void copy()} disabled={!!busy}><Copy size={15} />{t("复制")}</button><details className="export-menu"><summary>{t("导出")}<Download size={14} /></summary><div><button onClick={() => void exportContent('markdown')} disabled={!!busy}>Markdown</button>{platform.category === 'article' && <button onClick={() => void exportContent('html')} disabled={!!busy}>{t("HTML 文章")}</button>}<button onClick={() => void exportContent('json')} disabled={!!busy}>JSON</button></div></details><button className="text-button" onClick={() => setRegenerateIds([platform.id])} disabled={!!busy}>{t("重新生成")}</button></div><div className="review-actions"><Button onClick={() => void run('variant-save', async () => { if (activeVariant && edits[activeVariant.id]) await saveVariant(activeVariant.id, edits[activeVariant.id]); setNotice(t("当前版本已保存并重新校验。")); })} disabled={!!busy || !variantDirty}><Save size={15} />{t("保存")}</Button><Button className={approved ? 'approved-button' : 'primary'} onClick={() => void approve()} disabled={!!busy || approved || (!variantDirty && activeVariant.issues.some(i => i.severity === 'error' && !i.message.includes('原稿')))} busy={busy === 'approve'}><CheckCheck size={16} />{approved ? t("已确认") : variantDirty ? t("保存并确认") : t("确认此版本")}</Button></div></div>
              </section></div>
          </>)}
          {step === 'distribute' && <div className="distribution-layout"><section className="panel distribution-targets"><div className="panel-heading"><div><h2>{t("选择发布版本与账号")}</h2><p>{t("只有已确认的版本可以创建任务。")}</p></div><span className="subtle-label">{t("可分发版本：{count}", { count: reviewedVariants.length })}</span></div>{!currentVariants.length ? <EmptyState title={t("还没有可分发的版本")} description={t("先生成并确认平台版本，再选择你的发布账号。")} action={<Button onClick={() => setStep('write')}>{t("返回写原稿")}</Button>} /> : currentVariants.map(v => {
            const ready = reviewedVariants.some(r => r.id === v.id); const accounts = data.connections.filter(c => c.platformId === v.platformId);
            return <div className={`distribution-version ${ready ? '' : 'not-reviewed'}`} key={v.id}><div className="distribution-version-heading"><div><h3>{data.platforms.find(p => p.id === v.platformId)?.name}</h3><p>{v.title}</p></div><Badge kind={ready ? 'success' : ''}>{variantState(v)}</Badge></div>{!ready ? <button className="text-button" onClick={() => { changeVariant(v.id); setStep('review'); }}>{t("前往审阅")}<ArrowRight size={14} /></button> : !accounts.length ? <div className="account-empty"><span>{t("还没有这个平台的发布账号。也可复制或导出。")}</span><button className="text-button" onClick={() => connectPlatform(v.platformId)}>{t("添加账号")}</button></div> : <div className="publish-channels">{accounts.map(c => {
              const key = `${v.id}:${c.id}`; const exists = hasActiveTarget(v.platformId, c.id); const selectable = c.enabled && c.configured && !exists;
              return <label className={`account-choice ${selectable ? '' : 'disabled'}`} key={c.id}><input type="checkbox" checked={selectable && batchTargets.includes(key)} onChange={e => setBatchTargets(previous => e.target.checked ? [...new Set([...previous, key])] : previous.filter(x => x !== key))} disabled={!!busy || !selectable} /><span><strong>{c.name}</strong><small>{routeName(c)} · {exists ? t("已有待处理任务") : accountState(c)}</small></span></label>;
            })}</div>}</div>;
          })}</section><aside className="panel delivery-panel"><div className="panel-heading"><h2>{t("分发安排")}</h2></div><div className="delivery-body"><p className="delivery-selection"><strong>{t("账号目标：{count}", { count: selectedTargetCount })}</strong></p><fieldset className="timing-choice"><legend>{t("执行时间")}</legend><label className="checkbox-row"><input type="radio" name="delivery-time" checked={deliveryTiming === 'now'} onChange={() => setDeliveryTiming('now')} disabled={!!busy} />{t("现在加入队列")}</label><label className="checkbox-row"><input type="radio" name="delivery-time" checked={deliveryTiming === 'scheduled'} onChange={() => setDeliveryTiming('scheduled')} disabled={!!busy} />{t("预约时间")}</label></fieldset>{deliveryTiming === 'scheduled' && <Field label={t("预约时间")} hint={t("按本机 {p0} 输入。", { p0: Intl.DateTimeFormat().resolvedOptions().timeZone })}><input type="datetime-local" value={schedule} onChange={e => setSchedule(e.target.value)} disabled={!!busy} /></Field>}<div className="delivery-notes"><p>{t("创建任务后会保存当前已审阅快照。之后修改原稿不会更新这些任务。")}</p><p>{t("浏览器渠道需前台完成操作，草稿成功会单独记录。预约时工作台服务需运行。")}</p></div><Button className="primary full-button" onClick={() => void publishBatch()} busy={busy === 'publish-batch'} disabled={!!busy || !selectedTargetCount || deliveryTiming === 'scheduled' && !schedule}><Send size={17} />{deliveryTiming === 'scheduled' ? t("创建预约任务") : t("创建分发任务")}</Button>{!selectedTargetCount && <p className="field-hint">{t("先在左侧选择至少一个已确认版本的账号。")}</p>}<button className="text-button" onClick={() => setStep('review')}>{t("返回适配与审阅")}</button></div></aside></div>}
        </>}
        {page === 'library' && <LibraryPage {...managementProps} openContent={openContent} newContent={() => void newContent()} onDeleted={deletedContent} />}
        {page === 'queue' && <QueuePage {...managementProps} />}
        {page === 'platforms' && <PlatformDirectoryPage data={data} connectPlatform={connectPlatform} selectedPlatformIds={selectedPlatforms} addPlatformToComposer={addPlatformToComposer} disabled={!!busy} />}
        {page === 'connections' && <ConnectionsPage {...managementProps} initialPlatformId={connectionPreset} />}
        {page === 'profiles' && <ProfilesPage {...managementProps} />}
        {page === 'settings' && <SettingsPage {...managementProps} />}
      </div>
    </main>
    {regenerateIds && <Modal title={t("重新生成平台版本")} close={() => { if (!busy) setRegenerateIds(null); }}><p className="modal-description">{t("将使用 {method} 重新生成以下目标。已有版本的人工编辑和审阅状态会被替换；原稿、其他平台版本及已创建任务的快照会保留。", { method: t(generationMode === "ai" ? "AI 改写" : "规则整理") })}</p><div className="replacement-platforms">{regenerateIds.map(id => <Badge key={id}>{data.platforms.find(p => p.id === id)?.name || id}</Badge>)}</div><p className="field-hint">{t("需要保留旧文案时，请先复制或导出。如果只想确认原稿变化，可以保留当前版本并重新审阅。")}</p>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="modal-actions"><Button onClick={() => setRegenerateIds(null)} disabled={!!busy}>{t("保留现有版本")}</Button><Button className="primary" onClick={() => void generate(true, regenerateIds)} busy={busy === 'generate'} disabled={!!busy || generationMode === 'ai' && !aiReady(data.settings)}>{t("确认替换并生成")}</Button></div></Modal>}
    {sourceReviewOpen && <Modal title={t("核对原稿，保留当前文案")} close={() => { if (!busy) setSourceReviewOpen(false); }}><p className="modal-description">{t("原稿已经变化。请确认当前平台文案仍准确，并与新的原稿、素材和画像一致。此操作保留文案，重新校验后确认；已有排期任务仍使用原快照。")}</p><div className="rebase-source"><h3>{t("当前原稿")}</h3><p><strong>{composer.title || t("未命名稿件")}</strong></p><p className="rebase-meta">{t("写作画像：")}{data.profiles.find(p => p.id === composer.profileId)?.name || t("通用表达")} {t("· 素材：")}{composer.media.length} {t("个")}{composer.media.length > 0 && `（${composer.media.map(m => m.name).join("、")}）`}</p><p>{composer.source}</p></div>{error && <ErrorMessage>{error}</ErrorMessage>}<div className="modal-actions"><Button onClick={() => setSourceReviewOpen(false)} disabled={!!busy}>{t("返回修改")}</Button><Button className="primary" onClick={() => void approve(true)} busy={busy === 'approve'} disabled={!!busy}>{t("已核对，保留并确认")}</Button></div></Modal>}
  </div>;
}
