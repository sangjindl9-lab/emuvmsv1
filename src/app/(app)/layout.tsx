import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const tenant = await prisma.tenant.findUnique({ where: { id: session.tid } });
  return (
    <AppShell
      user={{ name: session.name, email: session.email, role: session.roleCode, permissions: session.permissions }}
      tenant={{ name: tenant?.name ?? "EUMBMS", plan: tenant?.plan ?? "STANDARD" }}
    >
      {children}
    </AppShell>
  );
}
