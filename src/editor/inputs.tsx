import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatLengthValue, parseLength } from '../model/units';

interface CommitInputProps<T> {
  value: T;
  format: (v: T) => string;
  /** Return undefined for invalid input. */
  parse: (text: string) => T | undefined;
  onCommit: (v: T) => void;
  suffix?: ReactNode;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}

/** Text input that only commits on Enter or blur (so typing doesn't create an undo step per key). Esc reverts. */
export function CommitInput<T>({ value, format, parse, onCommit, suffix, className, ariaLabel, placeholder }: CommitInputProps<T>) {
  const [text, setText] = useState(format(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const skipCommit = useRef(false);

  useEffect(() => {
    if (!focused) setText(format(value));
  }, [value, focused, format]);

  const commit = () => {
    const parsed = parse(text);
    if (parsed === undefined) {
      setText(format(value));
    } else if (format(parsed) !== format(value)) {
      onCommit(parsed);
    }
    setInvalid(false);
  };

  return (
    <span className={`commit-input ${className ?? ''}`}>
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={invalid ? 'invalid' : ''}
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setInvalid(parse(e.target.value) === undefined);
        }}
        onBlur={() => {
          setFocused(false);
          if (skipCommit.current) {
            skipCommit.current = false;
            setText(format(value));
            setInvalid(false);
          } else {
            commit();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            skipCommit.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      {suffix}
    </span>
  );
}

export function LengthInput({
  value,
  onCommit,
  min = 1,
  max = 100_000,
  ariaLabel,
}: {
  value: number;
  onCommit: (mm: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
}) {
  const parse = (text: string) => {
    const mm = parseLength(text);
    return mm !== null && mm >= min && mm <= max ? mm : undefined;
  };
  return (
    <CommitInput
      value={value}
      format={formatLengthValue}
      parse={parse}
      onCommit={onCommit}
      suffix={<span className="unit">cm</span>}
      className="length"
      ariaLabel={ariaLabel}
    />
  );
}

const identity = (s: string) => s;
const nonEmpty = (s: string) => (s.trim() ? s.trim() : undefined);

export function TextInput({ value, onCommit, ariaLabel }: { value: string; onCommit: (v: string) => void; ariaLabel?: string }) {
  return <CommitInput value={value} format={identity} parse={nonEmpty} onCommit={onCommit} ariaLabel={ariaLabel} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

const formatPrice = (v: number | null) => (v === null ? '' : v.toFixed(2));
const parsePrice = (text: string): number | null | undefined => {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return undefined;
  return Math.round(Number(t) * 100) / 100;
};

/** Price input; empty means unknown (null). */
export function PriceInput({ value, currency, onCommit, ariaLabel }: { value: number | null; currency: string; onCommit: (v: number | null) => void; ariaLabel?: string }) {
  return (
    <CommitInput
      value={value}
      format={formatPrice}
      parse={parsePrice}
      onCommit={onCommit}
      suffix={<span className="unit">{currency}</span>}
      className="length"
      ariaLabel={ariaLabel}
    />
  );
}

const formatOptionalLength = (v: number | null) => (v === null ? '' : formatLengthValue(v));

/** Length input whose value may be unknown/mixed (shown empty with a placeholder). Empty input commits nothing. */
export function OptionalLengthInput({
  value,
  onCommit,
  placeholder,
  min = 1,
  max = 100_000,
  ariaLabel,
}: {
  value: number | null;
  onCommit: (mm: number) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  ariaLabel?: string;
}) {
  const parse = (text: string): number | null | undefined => {
    if (text.trim() === '') return value === null ? null : undefined;
    const mm = parseLength(text);
    return mm !== null && mm >= min && mm <= max ? mm : undefined;
  };
  return (
    <CommitInput<number | null>
      value={value}
      format={formatOptionalLength}
      parse={parse}
      onCommit={(v) => v !== null && onCommit(v)}
      suffix={<span className="unit">cm</span>}
      className="length"
      ariaLabel={ariaLabel}
      placeholder={placeholder}
    />
  );
}
