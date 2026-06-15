// server entrypoint — DB 의존(getEmailSettings) 포함.
import "server-only";
export { getEmailSettings } from "./api/getEmailSettings";
export {
  EMAIL_SETTINGS_DEFAULTS,
  meetsSeverity,
  meetsImportance,
  isSyncDue,
  isDigestDue,
  type EmailSettings,
} from "./model/types";
