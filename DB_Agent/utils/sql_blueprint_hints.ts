/**
 * 蓝图「模板/记忆」层：由模型语义选取域 blueprint（data/domains/<domain>/blueprint.json）中的提示。
 */
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { selectBlueprintHintsWithModel } from "./blueprint_config";

export async function getSqlBlueprintTemplateHints(
  model: BaseLanguageModel,
  question: string,
): Promise<string> {
  return selectBlueprintHintsWithModel(model, question);
}
