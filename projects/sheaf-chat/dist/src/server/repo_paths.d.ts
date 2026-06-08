export interface SheafChatPaths {
    globalConfigFile: string;
    apiKeysFile: string;
    servicesJsonFile: string;
    dataDir: string;
    sessionsDir: string;
    authDir: string;
}
declare const x_globalConfigRelative = "config/global_config.json";
declare const x_apiKeysRelative = "config/api_keys.json";
declare const x_servicesJsonRelative = "config/services.json";
declare const x_dataDirRelative = "data/sheaf-chat";
declare const x_sessionsDirRelative = "data/sheaf-chat/sessions";
declare const x_authDirRelative = "data/sheaf-chat/auth";
export declare function FindRepositoryRoot(startPath?: string): string | undefined;
export declare function ResolveRepositoryPath(relativePath: string, root?: string): string;
export declare function GetDefaultSheafChatPaths(root?: string): SheafChatPaths;
export { x_apiKeysRelative, x_authDirRelative, x_dataDirRelative, x_globalConfigRelative, x_servicesJsonRelative, x_sessionsDirRelative, };
//# sourceMappingURL=repo_paths.d.ts.map