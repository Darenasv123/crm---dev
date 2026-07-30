import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-control w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-soft transition-[border-color,box-shadow,background-color] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:text-muted-foreground/80 hover:border-primary/35 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/15 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/10 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70 read-only:bg-muted/70 read-only:text-muted-foreground md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
