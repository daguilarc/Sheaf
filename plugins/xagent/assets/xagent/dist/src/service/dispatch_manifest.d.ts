export type Derivation = {
    readonly kind: "repo_root";
} | {
    readonly kind: "plan_workspace";
    readonly pattern: string;
    readonly requires_existing: boolean;
};
export type ManifestEntry = {
    readonly variant: string;
    readonly field: string | null;
    readonly source: "renderer" | "service";
    readonly rendererOption: string | null;
    readonly provenance: "caller_input" | "ledger" | "derived";
    readonly surfaceKind: "path" | "text";
    readonly direction: "reads" | "writes" | null;
    readonly transport: "path_substituted" | "inlined_contents" | "not_applicable";
    readonly requiredCondition: "always" | "unless-derivable" | "optional";
    readonly derivation: Derivation | null;
};
export type DispatchVariant = (typeof DISPATCH_VARIANTS)[number];
export declare const DISPATCH_VARIANTS: readonly ["implementer", "reviewer:task", "reviewer:branch", "fixer", "re-reviewer", "followup:fix", "followup:re-review"];
export declare const OPERATIONAL_FIELDS: readonly string[];
export declare const ARTIFACT_FIELDS: readonly string[];
export declare const REGISTRY: Record<DispatchVariant, readonly string[]>;
export declare const x_ServiceEntries: readonly ManifestEntry[];
export declare const x_VariantTemplates: Record<string, string | null>;
export declare const x_OptionFields: Record<string, Record<string, string>>;
export type DescribeSlot = {
    readonly option: string;
    readonly token: string;
    readonly kind: string;
    readonly direction: "reads" | "writes" | null;
    readonly has_fallback: boolean;
    readonly derivation: Derivation | null;
};
export type DescribeSlotsDoc = {
    readonly schema_version: number;
    readonly templates: Record<string, readonly DescribeSlot[]>;
};
export declare function JoinDescribeSlots(doc: DescribeSlotsDoc): ManifestEntry[];
export type GeneratedManifest = {
    readonly schema_version: 1;
    readonly entries: ManifestEntry[];
};
export declare function DispatchManifest(): ManifestEntry[];
export declare function LoadDispatchManifest(): ManifestEntry[];
export declare function CallerInputProjection(): Array<{
    variant: string;
    field: string;
}>;
export declare function SurfaceFieldFor(variant: string, rendererOption: string): string | null;
export declare function ManifestEntryFor(variant: string, rendererOption: string, provenance: ManifestEntry["provenance"]): ManifestEntry | undefined;
export declare function ResolveFaultProvenance(variant: string, rendererOption: string, callerSuppliedOptions: ReadonlySet<string>): ManifestEntry["provenance"] | null;
export declare function DiffDerivationPattern(variant: string): string | null;
export declare function ResetDispatchManifestCacheForTests(): void;
//# sourceMappingURL=dispatch_manifest.d.ts.map