/**
 * Make labels unique by suffixing duplicates with " (2)", " (3)", ... while never producing
 * a label that already exists in the input or was assigned earlier. Pickers look items up by
 * label, so every label must map to exactly one item.
 */
export function uniqueLabels(labels: string[]): string[] {
  const originals = new Set(labels);
  const used = new Set<string>();
  return labels.map((label) => {
    if (!used.has(label)) {
      used.add(label);
      return label;
    }
    let n = 2;
    let candidate = `${label} (${n})`;
    while (used.has(candidate) || originals.has(candidate)) {
      n += 1;
      candidate = `${label} (${n})`;
    }
    used.add(candidate);
    return candidate;
  });
}
