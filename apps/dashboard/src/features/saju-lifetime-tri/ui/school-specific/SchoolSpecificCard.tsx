// 학파별 detail 컴포넌트 dispatcher.
import type {
  SchoolSpecific,
  SchoolSpecificKo,
  SchoolSpecificZiping,
  SchoolSpecificMangpai,
  SchoolSpecificJp,
} from "@/shared/lib/db/schema";
import type { NarrativeSchool } from "../../api/prompts";
import { KoSchoolDetail } from "./KoSchoolDetail";
import { ZipingSchoolDetail } from "./ZipingSchoolDetail";
import { MangpaiSchoolDetail } from "./MangpaiSchoolDetail";
import { JpSchoolDetail } from "./JpSchoolDetail";

interface Props {
  school: NarrativeSchool;
  schoolSpecific: SchoolSpecific;
}

export function SchoolSpecificCard({ school, schoolSpecific }: Props) {
  switch (school) {
    case "ko":
      return <KoSchoolDetail data={schoolSpecific as SchoolSpecificKo} />;
    case "cn-ziping":
      return (
        <ZipingSchoolDetail data={schoolSpecific as SchoolSpecificZiping} />
      );
    case "cn-mangpai":
      return (
        <MangpaiSchoolDetail data={schoolSpecific as SchoolSpecificMangpai} />
      );
    case "jp":
      return <JpSchoolDetail data={schoolSpecific as SchoolSpecificJp} />;
  }
}
