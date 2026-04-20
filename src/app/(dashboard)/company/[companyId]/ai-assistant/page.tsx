// src/app/(dashboard)/company/[companyId]/ai-assistant/page.tsx

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { canAccess, ROLES } from "@/lib/auth-helpers";
import { AIAssistantChat } from "@/modules/ai-assistant/components/AIAssistantChat";

type Props = {
  params: Promise<{ companyId: string }>;
};

export default async function AIAssistantPage({ params }: Props) {
  const { companyId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const member = await prisma.companyMember.findFirst({
    where: { companyId, userId },
  });
  if (!member || !canAccess(member.role, ROLES.ACCOUNTING)) {
    redirect(`/company/${companyId}`);
  }

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      <AIAssistantChat companyId={companyId} />
    </div>
  );
}
