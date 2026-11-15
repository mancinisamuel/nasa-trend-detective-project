import type { ComponentPropsWithRef } from "react";

type ButtonVariant = "primary" | "secondary";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
};

// UI primitive: no data logic. Defaults to type="button" so it never submits a form by accident.
export function Button({
  variant = "primary",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  const classes = ["td-button", `td-button--${variant}`, className]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}
