import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  Button as MantineButton,
  Checkbox,
  Radio,
  Select as MantineSelect,
  TextInput,
  Textarea,
  UnstyledButton,
  type ComboboxItem,
  type SelectProps,
} from '@mantine/core';
import classes from './theme.module.css';

const DisabledFields = createContext(false);

export function FormFieldset({ disabled, ...props }: ComponentProps<'fieldset'>) {
  const inherited = useContext(DisabledFields);
  return (
    <DisabledFields.Provider value={disabled || inherited}>
      <fieldset {...props} disabled={disabled || inherited} />
    </DisabledFields.Provider>
  );
}

function optionText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : String(child),
    )
    .join('');
}

function selectOptions(children: ReactNode): ComboboxItem[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<ComponentProps<'option'>>(child)) return [];
    if (child.type === Fragment) return selectOptions(child.props.children);
    return [
      {
        value: String(child.props.value ?? optionText(child.props.children)),
        label: optionText(child.props.children),
        disabled: child.props.disabled,
      },
    ];
  });
}

/** Shared menus retain the surrounding field labels and stable option values. */
export function SelectField({
  children,
  value,
  defaultValue,
  disabled,
  onChange,
  className,
  ...props
}: Omit<SelectProps, 'data' | 'value' | 'defaultValue' | 'onChange' | 'children'> & {
  children: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string) => void | Promise<void>;
}) {
  const inherited = useContext(DisabledFields);
  const data = selectOptions(children);
  return (
    <MantineSelect
      {...props}
      className={`ui-select ${className ?? ''}`}
      data={data}
      value={value === undefined ? undefined : String(value)}
      defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
      disabled={disabled || inherited}
      allowDeselect={false}
      searchable={data.length > 8}
      nothingFoundMessage="No matching options"
      maxDropdownHeight={260}
      withScrollArea={false}
      comboboxProps={{ withinPortal: true, offset: 6, shadow: 'md' }}
      rightSection={
        <svg
          className="select-chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      }
      onChange={(next) => void onChange?.(next ?? '')}
      attributes={{
        input: {
          'aria-describedby': props['aria-describedby'],
          'aria-invalid': props['aria-invalid'],
        },
      }}
    />
  );
}

/** Keep native input semantics, constraints and events beneath the shared theme. */
export function InputField({ type, size: _size, className, ...props }: ComponentProps<'input'>) {
  const inherited = useContext(DisabledFields);
  if (type === 'checkbox' || type === 'radio') {
    const Selection = type === 'checkbox' ? Checkbox : Radio;
    return (
      <Selection
        {...props}
        disabled={props.disabled || inherited}
        className={`ui-selection ${className ?? ''}`}
      />
    );
  }
  return (
    <TextInput
      {...props}
      type={type}
      disabled={props.disabled || inherited}
      className={`ui-input ${className ?? ''}`}
      classNames={{ root: classes.inlineField }}
      attributes={{
        input: {
          'aria-describedby': props['aria-describedby'],
          'aria-invalid': props['aria-invalid'],
        },
      }}
    />
  );
}

export function TextAreaField({ className, ...props }: ComponentProps<'textarea'>) {
  const inherited = useContext(DisabledFields);
  return (
    <Textarea
      {...props}
      disabled={props.disabled || inherited}
      className={`ui-textarea ${className ?? ''}`}
      attributes={{
        input: {
          'aria-describedby': props['aria-describedby'],
          'aria-invalid': props['aria-invalid'],
        },
      }}
    />
  );
}

export function Button({ className = '', type = 'submit', ...props }: ComponentProps<'button'>) {
  // Navigation, content cards and media buttons keep their structural layout.
  if (
    /\b(nav-link|nav-current|assignment-row|media-image-button|question-issue-link|text-button|score-link)\b/.test(
      className,
    )
  )
    return <UnstyledButton {...props} type={type} className={className} />;
  const variant = /\bprimary\b/.test(className)
    ? 'filled'
    : /\bsecondary\b/.test(className)
      ? 'default'
      : /\b(text-button|icon-button)\b/.test(className)
        ? 'subtle'
        : 'light';
  return <MantineButton {...props} type={type} className={className} variant={variant} />;
}
