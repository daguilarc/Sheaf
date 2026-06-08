export interface RestErrorBody {
    error: {
        code: string;
        message: string;
    };
}
export declare function FormatRestError(code: string, message: string): RestErrorBody;
//# sourceMappingURL=errors.d.ts.map