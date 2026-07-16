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
  setMemoCategoryOwned,
  listUnclassifiedMemos,
  listMemosBetween,
  listMemosOlderThan,
  getMemosByIds,
  listMemoAuthorUserIds,
  listMemoFactsForInsights,
  type CreateMemoInput,
} from "./api/memoRepo";
export {
  insertDigest,
  hasDigest,
  getLatestDigest,
  listDigestsByUser,
  type InsertDigestInput,
} from "./api/memoDigestRepo";
export { listMemosNeedingExtraction } from "./api/memoRepo";
export {
  insertActionItemsAndMark,
  listActionItemsByUser,
  updateActionItemStatus,
  listDueReminders,
  markActionItemReminded,
  type NewActionItem,
} from "./api/memoActionItemRepo";
export {
  ACTION_ITEM_KINDS,
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_KIND_LABELS,
  ACTION_ITEM_ALLOWED_FROM,
  isActionItemKind,
  isActionItemStatus,
  canTransition,
  type ActionItemKind,
  type ActionItemStatus,
} from "./model/actionItem";
export {
  classifyMemoContent,
  classifyAndPersistMemoCategory,
  type ClassifyMemoContentResult,
  type ClassifyAndPersistResult,
} from "./api/classifyMemo";
export {
  SEED_MEMO_CATEGORIES,
  SEED_CATEGORY_LABELS,
  CATEGORY_SLUG_RE,
  isValidCategorySlug,
  type MemoCategory,
} from "./model/category";
export {
  listCategories,
  upsertCategory,
  type MemoCategoryRow,
} from "./api/categoryRepo";
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
  MemoFact,
  MemoDigest,
  MemoActionItem,
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
