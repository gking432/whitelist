"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
} from "react";
import { BarChart3, LayoutDashboard, Palette, Upload } from "lucide-react";

import {
  brandStyleVariables,
  normalizeBrandColor,
} from "@/lib/branding";
import { initialFormState, type FormState } from "@/lib/forms/state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type BrandingFormValue = {
  productName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  supportLabel: string;
  reportFooterText: string;
};

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p className="mt-1.5 text-xs text-destructive">{message}</p>
  ) : null;
}

function ColorField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const safeValue = normalizeBrandColor(value, "#000000");

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5 flex gap-2">
        <input
          type="color"
          value={safeValue}
          onChange={(event) => onChange(event.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-md border bg-card p-1"
          aria-label={`${label} picker`}
        />
        <Input
          id={id}
          name={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={7}
          spellCheck={false}
          className="font-mono"
        />
      </div>
      <FieldError message={error} />
    </div>
  );
}

export function BrandingForm({
  action,
  initial,
  submitLabel = "Save branding",
}: {
  action: (previousState: FormState, formData: FormData) => Promise<FormState>;
  initial: BrandingFormValue;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    initialFormState,
  );
  const [productName, setProductName] = useState(initial.productName);
  const [primaryColor, setPrimaryColor] = useState(initial.primaryColor);
  const [secondaryColor, setSecondaryColor] = useState(initial.secondaryColor);
  const [accentColor, setAccentColor] = useState(initial.accentColor);
  const [logoPreview, setLogoPreview] = useState<string | null>(
    initial.logoUrl,
  );
  const [localLogoUrl, setLocalLogoUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const errors = state.fieldErrors ?? {};

  useEffect(
    () => () => {
      if (localLogoUrl) URL.revokeObjectURL(localLogoUrl);
    },
    [localLogoUrl],
  );

  const previewStyle = useMemo(
    () =>
      brandStyleVariables({
        primaryColor,
        secondaryColor,
        accentColor,
      }),
    [accentColor, primaryColor, secondaryColor],
  );

  return (
    <form action={formAction} className="space-y-7">
      {state.message ? (
        <div
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              : "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          }
        >
          {state.message}
        </div>
      ) : null}

      <fieldset className="space-y-5" disabled={pending}>
        <legend className="text-[11px] font-semibold uppercase text-muted-foreground">
          Product identity
        </legend>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Label htmlFor="product_name">CRM product name</Label>
            <Input
              id="product_name"
              name="product_name"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              maxLength={50}
              className="mt-1.5"
              placeholder="Your Agency CRM"
            />
            <FieldError message={errors.product_name} />
          </div>
          <div>
            <Label htmlFor="logo">Logo</Label>
            <div className="mt-1.5 flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-card">
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoPreview}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <Palette className="size-4 text-muted-foreground" />
                )}
              </span>
              <Input
                id="logo"
                name="logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="min-w-0"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (localLogoUrl) URL.revokeObjectURL(localLogoUrl);
                  const nextUrl = URL.createObjectURL(file);
                  setLocalLogoUrl(nextUrl);
                  setLogoPreview(nextUrl);
                  setRemoveLogo(false);
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              PNG, JPG, or WebP. Maximum 2 MB.
            </p>
            <FieldError message={errors.logo} />
            {initial.logoUrl ? (
              <label className="mt-3 flex items-center gap-2 text-xs">
                <Checkbox
                  name="remove_logo"
                  checked={removeLogo}
                  onChange={(event) => {
                    setRemoveLogo(event.target.checked);
                    setLogoPreview(
                      event.target.checked
                        ? null
                        : localLogoUrl ?? initial.logoUrl,
                    );
                  }}
                />
                Remove the current logo
              </label>
            ) : null}
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={pending}>
        <legend className="text-[11px] font-semibold uppercase text-muted-foreground">
          Brand colors
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorField
            id="primary_color"
            label="Primary"
            value={primaryColor}
            onChange={setPrimaryColor}
            error={errors.primary_color}
          />
          <ColorField
            id="secondary_color"
            label="Navigation"
            value={secondaryColor}
            onChange={setSecondaryColor}
            error={errors.secondary_color}
          />
          <ColorField
            id="accent_color"
            label="Accent"
            value={accentColor}
            onChange={setAccentColor}
            error={errors.accent_color}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4" disabled={pending}>
        <legend className="text-[11px] font-semibold uppercase text-muted-foreground">
          Client support
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="support_label">Support label</Label>
            <Input
              id="support_label"
              name="support_label"
              defaultValue={initial.supportLabel}
              className="mt-1.5"
              placeholder="Your Agency Support"
              maxLength={60}
            />
            <FieldError message={errors.support_label} />
          </div>
          <div>
            <Label htmlFor="report_footer_text">Report footer</Label>
            <Input
              id="report_footer_text"
              name="report_footer_text"
              defaultValue={initial.reportFooterText}
              className="mt-1.5"
              placeholder="Managed by Your Agency"
              maxLength={180}
            />
            <FieldError message={errors.report_footer_text} />
          </div>
        </div>
      </fieldset>

      <section className="overflow-hidden rounded-lg border" style={previewStyle}>
        <div className="grid min-h-72 grid-cols-[10rem_minmax(0,1fr)] bg-background">
          <aside className="bg-sidebar p-4 text-sidebar-foreground">
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-brand-gold text-brand-deep">
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoPreview}
                    alt=""
                    className="size-full object-contain"
                  />
                ) : (
                  <Palette className="size-4" />
                )}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold">
                  {productName || "Your CRM"}
                </p>
                <p className="truncate text-[10px] opacity-65">
                  Client Workspace
                </p>
              </div>
            </div>
            <div className="mt-7 space-y-1">
              <div className="flex items-center gap-2 rounded-md bg-white/10 px-2 py-2 text-xs">
                <LayoutDashboard className="size-3.5" />
                Overview
              </div>
              <div className="flex items-center gap-2 px-2 py-2 text-xs opacity-70">
                <BarChart3 className="size-3.5" />
                Reports
              </div>
            </div>
          </aside>
          <div className="min-w-0">
            <div className="flex h-12 items-center border-b bg-card px-4">
              <p className="text-sm font-semibold">Overview</p>
              <span className="ml-auto rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground">
                New lead
              </span>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="rounded-md border bg-card p-3">
                <p className="text-[10px] text-muted-foreground">Open leads</p>
                <p className="mt-2 text-sm font-semibold">No data</p>
              </div>
              <div className="rounded-md border bg-card p-3">
                <p className="text-[10px] text-muted-foreground">
                  Automation health
                </p>
                <p className="mt-2 text-sm font-semibold text-primary">
                  Not connected
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Upload aria-hidden="true" />
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}
