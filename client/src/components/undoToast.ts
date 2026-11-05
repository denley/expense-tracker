/*
  A success toast with an Undo button. Undo stays available a little longer
  than a plain toast, and confirms what it did.
*/
import { toast } from "sonner";

export function toastWithUndo(message: string, undo: () => void, undoneMessage = "Undone"): void {
  toast.success(message, {
    duration: 8000,
    action: {
      label: "Undo",
      onClick: () => {
        undo();
        toast(undoneMessage);
      },
    },
  });
}
