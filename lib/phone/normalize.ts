export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;

  const digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits.slice(1);
  }

  return digits.length >= 7 ? digits : null;
}

export function phoneSearchVariants(
  value: string | null | undefined,
): string[] {
  const normalized = normalizePhone(value);

  if (!normalized) return [];

  const variants = new Set<string>([normalized, `+1${normalized}`]);

  if (normalized.length === 10) {
    variants.add(
      `(${normalized.slice(0, 3)}) ${normalized.slice(3, 6)}-${normalized.slice(6)}`,
    );
    variants.add(
      `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`,
    );
  }

  if (value?.trim()) variants.add(value.trim());

  return [...variants];
}
