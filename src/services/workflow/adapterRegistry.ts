import type { OmcWorkflowAdapter } from "../../types/workflow";

export interface AdapterRegistry {
  resolve(templateId: string): OmcWorkflowAdapter;
}

export class DefaultAdapterRegistry implements AdapterRegistry {
  private readonly mapping: Map<string, OmcWorkflowAdapter>;

  constructor(
    private readonly fallback: OmcWorkflowAdapter,
    entries: Iterable<readonly [string, OmcWorkflowAdapter]> = [],
  ) {
    this.mapping = new Map(entries);
  }

  static of(
    fallback: OmcWorkflowAdapter,
    entries: ReadonlyArray<readonly [string, OmcWorkflowAdapter]> = [],
  ): DefaultAdapterRegistry {
    return new DefaultAdapterRegistry(fallback, entries);
  }

  resolve(templateId: string): OmcWorkflowAdapter {
    return this.mapping.get(templateId) ?? this.fallback;
  }

  register(templateId: string, adapter: OmcWorkflowAdapter): void {
    this.mapping.set(templateId, adapter);
  }
}
