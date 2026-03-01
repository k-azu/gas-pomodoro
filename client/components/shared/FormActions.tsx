import type { ReactNode } from "react";
import s from "./FormActions.module.css";

export function FormActions({ children }: { children: ReactNode }) {
  return <div className={s['form-actions']}>{children}</div>;
}
