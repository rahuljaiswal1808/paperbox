import { useUiStore } from '../../state/uiStore';
import { Button } from './controls';
import { Icon, type IconName } from './Icon';

const TOAST_ICON: Record<string, IconName> = {
  success: 'check',
  error: 'alert',
  warning: 'alert',
  info: 'info',
};

export function Toasts() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast__icon">
            <Icon name={TOAST_ICON[toast.kind]} size={16} />
          </span>
          <div className="grow">
            <div className="toast__title">{toast.title}</div>
            {toast.detail && <div className="toast__detail">{toast.detail}</div>}
            {toast.notes && toast.notes.length > 0 && (
              <ul className="toast__detail" style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                {toast.notes.slice(0, 4).map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </div>
          <Button icon="close" iconOnly size="sm" aria-label="Dismiss" onClick={() => dismiss(toast.id)} />
        </div>
      ))}
    </div>
  );
}

export function ProgressOverlay() {
  const progress = useUiStore((state) => state.progress);
  if (!progress) return null;

  const percent = progress.fraction === null ? null : Math.round(progress.fraction * 100);

  return (
    <div className="progress-overlay" role="dialog" aria-modal="true" aria-label="Working">
      <div className="progress-card">
        <div className="row">
          <strong className="grow">{progress.label}</strong>
          {percent !== null && <span className="mono">{percent}%</span>}
        </div>
        <div className={`progress-bar ${percent === null ? 'progress-bar--indeterminate' : ''}`}>
          <div
            className="progress-bar__fill"
            style={percent === null ? undefined : { width: `${percent}%` }}
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <div className="row">
          <span className="small muted grow">Running on this machine — nothing is being uploaded.</span>
          {progress.cancel && (
            <Button size="sm" onClick={progress.cancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
