import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-28 w-full resize-y rounded-lg border border-input bg-card px-3 py-2.5 text-base shadow-soft transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-muted-foreground/80 hover:border-primary/35 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/15 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/10 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70 read-only:bg-muted/70 read-only:text-muted-foreground md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
