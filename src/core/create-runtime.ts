import type { CommandAliasMap } from "./command-registry.js";
import { ExplanationService } from "./explanation-service.js";
import { RuntimeController } from "./runtime-controller.js";
import type { ExplanationProviderConfig } from "../providers/explanation-provider.js";

export function createRuntime(options?: {
  commandAliases?: CommandAliasMap;
  assistant?: ExplanationProviderConfig;
  initialCwd?: string;
}): RuntimeController {
  return new RuntimeController({
    commandAliases: options?.commandAliases,
    explanationService: ExplanationService.fromConfig(options?.assistant),
    initialCwd: options?.initialCwd,
  });
}
