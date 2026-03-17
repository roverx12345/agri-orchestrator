import { normalizeCropName } from "./helpers.js";
import { cornRulePackage } from "./packages/corn.js";
import { genericConservativeRulePackage } from "./packages/generic.js";
import { hyacinthRulePackage } from "./packages/hyacinth.js";
import { wheatRulePackage } from "./packages/wheat.js";
import type { CropRulePackage } from "./types.js";

const REGISTERED_PACKAGES: CropRulePackage[] = [
  hyacinthRulePackage,
  cornRulePackage,
  wheatRulePackage,
];

export function resolveCropRulePackage(crop: string | undefined): CropRulePackage | undefined {
  const normalized = normalizeCropName(crop);
  return REGISTERED_PACKAGES.find((item) => item.cropAliases.some((alias) => normalizeCropName(alias) === normalized));
}

export function getGenericConservativePackage(): CropRulePackage {
  return genericConservativeRulePackage;
}

