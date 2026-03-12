// src/components/company/ReactivateCompanyButton.tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArchiveRestoreIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reactivateCompanyAction } from "@/modules/company/actions/company.actions";

type Props = {
  companyId: string;
  companyName: string;
  userId: string;
};

export function ReactivateCompanyButton({ companyId, companyName, userId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleReactivate() {
    startTransition(async () => {
      const result = await reactivateCompanyAction(companyId, userId);
      if (result.success) {
        toast.success(`Empresa "${companyName}" reactivada correctamente`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleReactivate}
      disabled={isPending}
      className="w-full gap-2"
    >
      <ArchiveRestoreIcon className="h-4 w-4" />
      {isPending ? "Reactivando..." : "Reactivar Empresa"}
    </Button>
  );
}
