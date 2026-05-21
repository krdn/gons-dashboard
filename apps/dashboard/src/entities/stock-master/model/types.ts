import type { InferSelectModel } from "drizzle-orm";
import type { stockMaster } from "@/shared/lib/db/schema";

export type StockMasterRow = InferSelectModel<typeof stockMaster>;
