import { redirect } from "next/navigation";
import { listFortuneProfiles } from "@/entities/fortune-profile/server";
import { auth } from "@/shared/lib/auth";
import { FortuneProfileList } from "@/widgets/fortune-profiles";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function FortunePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profiles = await listFortuneProfiles(session.user.id);

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="사주 프로필"
        subtitle="오늘의 운세 위젯에 표시할 사람들을 관리해요."
      />
      <FortuneProfileList profiles={profiles} />
    </PageContainer>
  );
}
