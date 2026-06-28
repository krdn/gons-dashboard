import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getPlugins, getPluginMarketplaces } from "@/entities/plugin/server";
import { PluginCatalog } from "@/widgets/plugin-catalog";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function PluginsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const plugins = getPlugins();
  const marketplaces = getPluginMarketplaces();

  return (
    <PageContainer>
      <PageHeader
        title="Claude Code 플러그인"
        subtitle={`설치된 plugin 의 구성요소와 마켓플레이스를 살펴봅니다 (${plugins.length}개).`}
      />
      <PluginCatalog plugins={plugins} marketplaces={marketplaces} />
    </PageContainer>
  );
}
