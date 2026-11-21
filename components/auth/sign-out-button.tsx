import { signOut } from "@/app/auth/actions";

export function SignOutButton({ className = "" }: { className?: string }) {
  return <form action={signOut}><button type="submit" className={`min-h-10 rounded-lg border px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 ${className}`}>Sign out</button></form>;
}
