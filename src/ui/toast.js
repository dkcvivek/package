import { toast } from "react-toastify";

export function useToast() {
  return {
    toast: ({ title, description, variant } = {}) => {
      const message = description ? `${title}: ${description}` : title;
      if (variant === "destructive") {
        toast.error(message, { autoClose: 4000 });
      } else {
        toast.success(message, { autoClose: 3000 });
      }
    },
  };
}