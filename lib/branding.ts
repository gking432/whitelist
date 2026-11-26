import type { CSSProperties } from "react";

export const DEFAULT_BRAND_COLORS = {
  primary: "#1e4735",
  secondary: "#12291d",
  accent: "#c79a3b",
} as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeBrandColor(
  value: string | null | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim() ?? "";
  return HEX_COLOR.test(trimmed) ? trimmed.toLowerCase() : fallback;
}

export function isBrandColor(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}

export function contrastColor(hex: string): "#ffffff" | "#191d1a" {
  const value = normalizeBrandColor(hex, "#ffffff").slice(1);
  const channel = (start: number) => {
    const raw = Number.parseInt(value.slice(start, start + 2), 16) / 255;
    return raw <= 0.04045
      ? raw / 12.92
      : Math.pow((raw + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkLuminance = 0.0115;
  const darkContrast =
    (Math.max(luminance, darkLuminance) + 0.05) /
    (Math.min(luminance, darkLuminance) + 0.05);

  return darkContrast >= whiteContrast ? "#191d1a" : "#ffffff";
}

export type BrandColors = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
};

export type BrandStyleVariables = CSSProperties &
  Record<`--${string}`, string>;

export function brandStyleVariables(
  colors: BrandColors,
): BrandStyleVariables {
  const primary = normalizeBrandColor(
    colors.primaryColor,
    DEFAULT_BRAND_COLORS.primary,
  );
  const secondary = normalizeBrandColor(
    colors.secondaryColor,
    DEFAULT_BRAND_COLORS.secondary,
  );
  const accent = normalizeBrandColor(
    colors.accentColor,
    DEFAULT_BRAND_COLORS.accent,
  );

  return {
    "--primary": primary,
    "--primary-foreground": contrastColor(primary),
    "--ring": primary,
    "--sidebar": secondary,
    "--sidebar-foreground": contrastColor(secondary),
    "--brand-deep": secondary,
    "--brand-gold": accent,
    "--accent": accent,
    "--accent-foreground": contrastColor(accent),
  };
}
