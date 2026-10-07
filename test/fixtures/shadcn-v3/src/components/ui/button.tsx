import { cva } from "class-variance-authority"

const buttonVariants = cva("inline-flex items-center rounded-md", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:bg-primary/90",
      "muted-link": ["text-muted-foreground", "hover:text-foreground"],
    },
  },
})
