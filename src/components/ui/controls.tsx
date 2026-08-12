import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './Icon';

type ButtonVariant = 'ghost' | 'primary' | 'outline' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  iconOnly?: boolean;
  active?: boolean;
  size?: 'sm' | 'md';
  block?: boolean;
}

export function Button({
  variant = 'ghost',
  icon,
  iconOnly,
  active,
  size = 'md',
  block,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'btn',
    variant !== 'ghost' ? `btn--${variant}` : '',
    iconOnly ? 'btn--icon' : '',
    active ? 'btn--active' : '',
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} aria-pressed={active} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {!iconOnly && children}
    </button>
  );
}

export interface FieldProps {
  label: string;
  hint?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, children }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export const TextInput = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={`input ${props.className ?? ''}`} />
);

export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={`select ${props.className ?? ''}`} />
);

export const TextArea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={`textarea ${props.className ?? ''}`} />
);

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}

export const Checkbox = ({ checked, onChange, label, disabled }: CheckboxProps) => (
  <label className="checkbox">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>{label}</span>
  </label>
);

export interface ModalProps {
  title: string;
  icon?: IconName;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Describes the dialog for assistive tech beyond the title. */
  description?: string;
  /**
   * Render above the progress overlay. Needed by prompts that appear *during* a
   * long operation — a password request, for instance.
   */
  elevated?: boolean;
}

export function Modal({ title, icon, onClose, children, footer, wide, description, elevated }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    node?.querySelector<HTMLElement>('input, select, textarea, button, [tabindex]')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const focusable = [
        ...node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={`modal-backdrop ${elevated ? 'modal-backdrop--top' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'modal--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        ref={ref}
      >
        <div className="modal__header">
          {icon && <Icon name={icon} size={18} />}
          <h2 id={titleId}>{title}</h2>
          <Button icon="close" iconOnly aria-label="Close dialog" onClick={onClose} />
        </div>
        <div className="modal__body">
          {description && (
            <p id={descId} className="muted small" style={{ marginTop: 0 }}>
              {description}
            </p>
          )}
          {children}
        </div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: SegmentedProps<T>) {
  return (
    <div className="btn-group" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`btn btn--sm ${value === option.value ? 'btn--active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size={14} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const Note = ({
  kind = 'info',
  children,
}: {
  kind?: 'info' | 'warning' | 'danger' | 'neutral';
  children: ReactNode;
}) => (
  <div className={`note ${kind === 'neutral' ? '' : `note--${kind}`}`}>
    <Icon name={kind === 'warning' || kind === 'danger' ? 'alert' : 'info'} size={15} />
    <div>{children}</div>
  </div>
);
