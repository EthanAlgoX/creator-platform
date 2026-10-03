import { useEffect, useRef } from 'react';
import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { AlertCircle, Check, FileText, LoaderCircle, X } from 'lucide-react';

export function Button({ children, busy = false, className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} type={type} aria-busy={busy || undefined} disabled={props.disabled || busy} className={`button ${className}`}>
    {busy && <LoaderCircle size={17} className="spin" aria-hidden="true" />}{children}
  </button>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return <div className="error-message" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{children}</span></div>;
}

export function Badge({ children, kind = '' }: { children: ReactNode; kind?: string }) {
  return <span className={`badge ${kind}`}>{kind === 'success' && <Check size={12} aria-hidden="true" />}{children}</span>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon || <FileText size={28} strokeWidth={1.5} />}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node?.showModal();
    node?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !node) return;
      const focusable = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')];
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); node?.close(); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="modal" aria-label={title} onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  }}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={close}><X size={20} /></button></div>{children}
  </dialog>;
}

export function formatDate(date: string, timezone = 'Asia/Shanghai') {
  try { return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(date)); }
  catch { return date; }
}

export const jobLabels: Record<string, string> = {
  queued: '等待发布', scheduled: '已排期', running: '发布中', published: '已发布',
  drafted: '已保存草稿', failed: '失败', unconfirmed: '结果待确认', needs_action: '待手动处理', cancelled: '已取消',
};

export const jobKind = (status: string) => status === 'published' ? 'success' : status === 'failed' ? 'danger' : ['unconfirmed', 'needs_action'].includes(status) ? 'warning' : '';
