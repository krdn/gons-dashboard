import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getSkills, getSkillCategories } from "@/entities/skill/server";
import { SkillCatalog } from "@/widgets/skill-catalog";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const skills = getSkills();
  const categories = getSkillCategories();

  return (
    <PageContainer>
      <PageHeader
        title="Claude Code 스킬"
        subtitle={`설치된 스킬의 사용법과 출처를 살펴봅니다 (${skills.length}개).`}
      />
      <SkillCatalog skills={skills} categories={categories} />
    </PageContainer>
  );
}
