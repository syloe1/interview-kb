import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-[var(--text-primary)] text-[var(--card-bg)] hover:opacity-90',
        secondary:
          'border-transparent bg-[var(--badge-secondary-bg)] text-[var(--badge-secondary-text)] hover:opacity-90',
        destructive:
          'border-transparent bg-red-500 text-white hover:bg-red-600',
        outline: 'text-[var(--text-secondary)] border-[var(--border)]',
        success:
          'border-transparent bg-[var(--badge-bg)] text-[var(--badge-text)] hover:opacity-90',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
