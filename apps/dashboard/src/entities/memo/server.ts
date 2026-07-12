// entities/memo — server entrypoint (DB 접근 CRUD). "server-only".
import "server-only";
export {
  listMemos,
  getMemo,
  createMemo,
  updateMemo,
  deleteMemo,
  searchMemos,
  setMemoCategory,
  listUnclassifiedMemos,
  listMemosBetween,
  listMemosOlderThan,
  getMemosByIds,
  listMemoAuthorUserIds,
  type CreateMemoInput,
} from "./api/memoRepo";
export {
  insertDigest,
  hasDigest,
  getLatestDigest,
  type InsertDigestInput,
} from "./api/memoDigestRepo";
export {
  classifyMemoContent,
  classifyAndPersistMemoCategory,
  type ClassifyMemoContentResult,
  type ClassifyAndPersistResult,
} from "./api/classifyMemo";
export {
  MEMO_CATEGORY_IDS,
  MEMO_CATEGORY_LABELS,
  isMemoCategory,
  type MemoCategory,
} from "./model/category";
export { tokenizeSearchQuery, SEARCH_MEMOS_LIMIT } from "./model/search";
export {
  upsertTransformation,
  listTransformationsByUser,
  type UpsertTransformationInput,
} from "./api/memoTransformRepo";
export {
  listPresetsByUser,
  getPresetBySlug,
  upsertPreset,
  insertPreset,
  deletePresetBySlug,
  countCustomPresets,
  getDefaultMemoModel,
  upsertDefaultMemoModel,
  type UpsertPresetInput,
} from "./api/memoPresetRepo";
export type {
  Memo,
  MemoSource,
  MemoDigest,
  MemoTransformation,
  TransformPresetId,
  MemoModelKey,
  MemoModelSelection,
  MemoModelCatalog,
  MemoModelCatalogSnapshot,
} from "./model/types";
export type { MemoTransformPreset } from "./model/types";
export {
  TRANSFORM_PRESET_IDS,
  TRANSFORM_PRESET_LABELS,
  MEMO_MODEL_KEYS,
  MEMO_MODEL_META,
  DEFAULT_MEMO_MODEL_KEY,
  isMemoModelKey,
  isMemoModelIdForProvider,
} from "./model/types";
