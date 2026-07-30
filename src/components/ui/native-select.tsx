import * as React from "react";
import { cn } from "@/lib/utils";

const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "field h-control cursor-pointer appearance-none border border-input bg-card pr-10 text-sm shadow-soft transition-[border-color,box-shadow,background-color] duration-200 hover:border-primary/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/15 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
