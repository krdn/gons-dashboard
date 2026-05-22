import { DartError } from "./dart-types";
import corpCodes from "./dart-corp-codes.json" with { type: "json" };

const CORP_MAP = corpCodes as Record<string, string>;
const KRX_CODE_REGEX = /^[\dA-Z]{6}$/;

export function lookupCorpCode(krxCode: string): string {
  if (!KRX_CODE_REGEX.test(krxCode)) {
    throw new DartError(`invalid_krx_code: ${krxCode}`);
  }
  const corp = CORP_MAP[krxCode];
  if (!corp) {
    throw new DartError(`not_listed_in_dart: ${krxCode}`);
  }
  return corp;
}
