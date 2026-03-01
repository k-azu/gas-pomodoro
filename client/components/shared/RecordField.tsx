import type { ReactNode } from "react";
import s from "./RecordField.module.css";

export function RecordField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s['record-field']}>
      <label className={s['record-field-label']}>{label}</label>
      {children}
    </div>
  );
}
