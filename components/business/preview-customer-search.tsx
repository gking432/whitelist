"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Search, X } from "lucide-react";

export type PreviewCustomer = {
  name: string;
  email?: string | null;
  phone?: string | null;
  summary?: string;
};

export function PreviewCustomerSearch({ customers }: { customers: PreviewCustomer[] }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PreviewCustomer | null>(null);
  const matches = query.trim()
    ? customers.filter((customer) =>
        [customer.name, customer.email, customer.phone].some((value) =>
          value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
        ),
      ).slice(0, 5)
    : [];

  return (
    <div role="search" className="relative mx-3 pt-3">
      <label htmlFor={searchId} className="sr-only">Find a sample customer</label>
      <div className="relative">
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(null); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setQuery(""); setSelected(null); }
            if (event.key === "Enter" && matches[0]) { event.preventDefault(); setSelected(matches[0]); }
          }}
          placeholder="Find a customer"
          maxLength={120}
          className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-2.5 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        />
        <Search aria-hidden="true" className="pointer-events-none absolute right-3 top-3 size-4 text-slate-500" />
      </div>
      {query.trim() ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10">
          {selected ? (
            <div className="p-2 text-xs leading-5 text-slate-600">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-900">{selected.name}</p>
                <button type="button" aria-label="Close customer details" onClick={() => { setSelected(null); setQuery(""); }} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"><X aria-hidden="true" className="size-4" /></button>
              </div>
              {selected.summary ? <p className="mt-2">{selected.summary}</p> : null}
              {selected.email ? <p className="mt-2 break-all">{selected.email}</p> : null}
              {selected.phone ? <p className="mt-1">{selected.phone}</p> : null}
              <Link href="/preview/customers" onClick={() => { setSelected(null); setQuery(""); }} className="mt-3 inline-flex text-xs font-semibold text-blue-700 hover:underline">Everything about {selected.name.split(/\s+/)[0]}</Link>
              <p className="mt-2 text-[11px] text-slate-400">Sample customer</p>
            </div>
          ) : matches.length ? matches.map((customer) => (
            <button key={`${customer.name}:${customer.email ?? ""}`} type="button" onClick={() => setSelected(customer)} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              <span className="block text-xs font-medium text-slate-900">{customer.name}</span>
              {customer.email ? <span className="block truncate text-[11px] text-slate-500">{customer.email}</span> : null}
            </button>
          )) : <p className="px-2 py-3 text-xs text-slate-500">No sample customer matches.</p>}
        </div>
      ) : null}
    </div>
  );
}
