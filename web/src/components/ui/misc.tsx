import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin text-faint", className)} size={16} />;
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20 text-faint">
      <Spinner className="mr-2" /> 加载中…
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-subtle/40 px-6 py-14 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <div className="text-sm font-medium text-ink">{title}</div>
      {hint && <div className="mt-1 max-w-sm text-[13px] text-muted">{hint}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-success",
    pending: "bg-warn",
    error: "bg-danger",
    disabled: "bg-neutral-300",
  };
  return <span className={cn("inline-block h-2 w-2 rounded-full", map[status] ?? "bg-neutral-300")} />;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name.slice(0, 2).toUpperCase();
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className={cn("flex items-center justify-center rounded-full text-[11px] font-semibold text-white", className)}
      style={{ background: `hsl(${hue} 55% 55%)` }}
    >
      {initials}
    </div>
  );
}
