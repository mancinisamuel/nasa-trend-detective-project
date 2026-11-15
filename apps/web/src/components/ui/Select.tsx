import { Fragment, useId, type ComponentPropsWithRef } from "react";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Consecutive options with the same group label are wrapped in an optgroup. */
  group?: string;
};

type SelectProps = Omit<ComponentPropsWithRef<"select">, "children"> & {
  /** Visible label text (always rendered, required for accessibility). */
  label: string;
  options: readonly SelectOption[];
};

type OptionBlock = { group?: string; options: SelectOption[] };

function groupedOptions(options: readonly SelectOption[]): OptionBlock[] {
  const blocks: OptionBlock[] = [];
  for (const option of options) {
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.group === option.group) {
      last.options.push(option);
    } else {
      blocks.push({ group: option.group, options: [option] });
    }
  }
  return blocks;
}

function SelectOptionItem({ option }: { option: SelectOption }) {
  return (
    <option value={option.value} disabled={option.disabled}>
      {option.label}
    </option>
  );
}

// UI primitive: no data logic. Options and labels are provided by the caller.
export function Select({
  label,
  options,
  id,
  className,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const classes = ["td-select", className].filter(Boolean).join(" ");
  return (
    <div className="td-field">
      <label className="td-field__label" htmlFor={selectId}>
        {label}
      </label>
      <select id={selectId} className={classes} {...rest}>
        {groupedOptions(options).map((block, index) =>
          block.group === undefined ? (
            <Fragment key={index}>
              {block.options.map((option) => (
                <SelectOptionItem key={option.value} option={option} />
              ))}
            </Fragment>
          ) : (
            <optgroup key={block.group} label={block.group}>
              {block.options.map((option) => (
                <SelectOptionItem key={option.value} option={option} />
              ))}
            </optgroup>
          ),
        )}
      </select>
    </div>
  );
}
