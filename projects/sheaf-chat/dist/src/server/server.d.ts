import { type Server } from "node:http";
import type { SheafChatConfig } from "./config.js";
export declare const x_serviceName = "sheaf-chat";
export declare const x_serviceVersion = "0.1.0";
export interface SheafChatServerOptions {
    config: SheafChatConfig;
    bindHost: string;
    bindPort: number;
}
export interface SheafChatServer {
    httpServer: Server;
    listen: () => Promise<number>;
    close: () => Promise<void>;
}
export declare function CreateSheafChatServer(options: SheafChatServerOptions): SheafChatServer;
//# sourceMappingURL=server.d.ts.map