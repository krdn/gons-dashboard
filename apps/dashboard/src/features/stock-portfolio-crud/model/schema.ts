import { z } from "zod";

const AssetClassSchema = z.enum(["stock", "crypto", "commodity"]);
const MarketSchema = z.enum(["NASDAQ", "NYSE", "KRX", "CRYPTO", "COMMODITY"]);

const PositiveNumericString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "양수 (소수점 8자리까지) 형식이어야 합니다");

const NonNegativeNumericString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "0 이상 (소수점 8자리까지) 형식이어야 합니다");

export const AddHoldingSchema = z.object({
  symbol: z.string().min(1).max(32),
  assetClass: AssetClassSchema,
  market: MarketSchema,
  displayName: z.string().min(1).max(200),
  quantity: PositiveNumericString,
  avgCost: NonNegativeNumericString,
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const UpdateHoldingSchema = z.object({
  id: z.string().uuid(),
  quantity: PositiveNumericString.optional(),
  avgCost: NonNegativeNumericString.optional(),
  purchasedAt: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional(),
});

export const DeleteHoldingSchema = z.object({
  id: z.string().uuid(),
});

export type AddHoldingInput = z.infer<typeof AddHoldingSchema>;
export type UpdateHoldingInput = z.infer<typeof UpdateHoldingSchema>;
export type DeleteHoldingInput = z.infer<typeof DeleteHoldingSchema>;
