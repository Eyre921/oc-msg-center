import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warn" | "danger" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-border",
  success: "bg-[#e6f4ea] text-[#137333] border-[#cdebd6]",
  warn: "bg-[#fef3da] text-[#9a6700] border-[#f7e2b5]",
  danger: "bg-[#fdeced] text-[#c0292e] border-[#f6d3d5]",
  accent: "bg-[#e8f1fe] text-[#0b5cca] border-[#d2e3fc]",
};

export function Badge({
  tone = "neutral",
  className,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {props.children}
    </span>
  );
}
