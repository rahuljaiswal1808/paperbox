import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect?: () => void;
  separatorBefore?: boolean;
}

interface MenuProps {
  label: string;
  items: MenuItem[];
  icon?: IconName;
  children?: ReactNode;
}

export function Menu({ label, items, icon }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className={`btn ${open ? 'btn--active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {icon && <Icon name={icon} size={15} />}
        {label}
        <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 232,
            padding: 4,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-2)',
            zIndex: 60,
          }}
        >
          {items.map((item) => (
            <div key={item.id}>
              {item.separatorBefore && (
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
              )}
              <button
                type="button"
                role="menuitem"
                className="list-row"
                disabled={item.disabled}
                style={{
                  borderRadius: 'var(--radius-sm)',
                  opacity: item.disabled ? 0.45 : 1,
                  color: item.danger ? 'var(--danger)' : undefined,
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                }}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect?.();
                }}
              >
                <span style={{ width: 18, display: 'inline-flex' }}>
                  {item.icon && <Icon name={item.icon} size={15} />}
                </span>
                <span className="grow">{item.label}</span>
                {item.shortcut && <span className="kbd">{item.shortcut}</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
