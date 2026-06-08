import { createServer } from "node:http";
import { FormatRestError } from "../shared/errors.js";
export const x_serviceName = "sheaf-chat";
export const x_serviceVersion = "0.1.0";
function SendJson(response, statusCode, body) {
    const payload = JSON.stringify(body);
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
    });
    response.end(payload);
}
function HandleHealth(response) {
    SendJson(response, 200, {
        service: x_serviceName,
        version: x_serviceVersion,
        status: "ok",
    });
}
function HandleNotFound(response) {
    SendJson(response, 404, FormatRestError("not_found", "route not found"));
}
export function CreateSheafChatServer(options) {
    const httpServer = createServer((request, response) => {
        const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
        if (request.method === "GET" && url.pathname === "/api/health") {
            HandleHealth(response);
            return;
        }
        HandleNotFound(response);
    });
    return {
        httpServer,
        listen: () => new Promise((resolve, reject) => {
            httpServer.once("error", reject);
            httpServer.listen(options.bindPort, options.bindHost, () => {
                httpServer.off("error", reject);
                const address = httpServer.address();
                if (address === null || typeof address === "string") {
                    resolve(options.bindPort);
                    return;
                }
                resolve(address.port);
            });
        }),
        close: () => new Promise((resolve, reject) => {
            httpServer.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        }),
    };
}
//# sourceMappingURL=server.js.map