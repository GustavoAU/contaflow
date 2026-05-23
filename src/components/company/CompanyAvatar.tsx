import { cn } from "@/lib/utils";
import { AVATAR_COLORS, hashIdx, getInitials } from "@/lib/company-utils";

const SIZE: Record<string, string> = {
  xs: "w-6  h-6  text-10",
  sm: "w-7  h-7  text-11",
  md: "w-9  h-9  text-13",
  lg: "w-11 h-11 text-15",
};

export function CompanyAvatar({
  id,
  name,
  size = "sm",
  className,
}: {
  id: string;
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        SIZE[size],
        AVATAR_COLORS[hashIdx(id)],
        "rounded-lg flex items-center justify-center font-bold text-white shrink-0 select-none",
        className
      )}
    >
      {getInitials(name)}
    </div>
  );
}
