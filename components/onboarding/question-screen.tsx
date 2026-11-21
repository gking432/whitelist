"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export type QuestionScreenProps = {
  question: string;
  children: ReactNode;
  step: number;
  total: number;
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  pending?: boolean;
  nextDisabled?: boolean;
  nextType?: "button" | "submit";
  error?: string;
  notice?: string;
  help?: ReactNode;
};

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

/** Presentation only. The caller owns the form, saved answers and progression. */
export function QuestionScreen({ question, children, step, total, onBack, onNext, onSkip, nextLabel = "Next", pending = false, nextDisabled = false, nextType = "button", error, notice, help }: QuestionScreenProps) {
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); }, [question]);
  return <section data-question-screen aria-labelledby={titleId} aria-busy={pending} className="flex min-h-dvh w-full flex-col bg-white px-6 py-8 text-slate-900 sm:px-10 sm:py-12">
    <p className="text-center text-xs text-slate-400" aria-label="Setup progress">Step {step} of {total}</p>
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-12 sm:py-16">
      <h1 ref={title} id={titleId} tabIndex={-1} className="text-center text-3xl font-bold leading-tight tracking-[-0.035em] outline-none sm:text-5xl">{question}</h1>
      {help ? <div className="mx-auto mt-5 max-w-xl text-center text-sm leading-7 text-slate-500">{help}</div> : null}
      <div className="mx-auto mt-9 w-full max-w-xl" data-question-answer>{children}</div>
      {error ? <p role="alert" className="mx-auto mt-5 w-full max-w-xl text-center text-sm leading-6 text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="mx-auto mt-5 w-full max-w-xl text-center text-xs leading-6 text-slate-500">{notice}</p> : null}
      <div className="mx-auto mt-9 flex w-full max-w-xl flex-wrap items-center justify-center gap-4">
        {onBack ? <button type="button" onClick={onBack} disabled={pending} className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-slate-500 hover:text-slate-900 disabled:opacity-40 ${focus}`}>Back</button> : null}
        <button type={nextType} onClick={onNext} disabled={pending || nextDisabled} className={`inline-flex min-h-12 min-w-32 items-center justify-center rounded-xl bg-blue-700 px-7 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40 ${focus}`}>{pending ? "Saving…" : nextLabel}</button>
        {onSkip ? <button type="button" onClick={onSkip} disabled={pending} className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm text-slate-500 hover:text-slate-900 disabled:opacity-40 ${focus}`}>Skip for now</button> : null}
      </div>
    </div>
  </section>;
}
