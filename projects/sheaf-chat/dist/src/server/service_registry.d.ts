export interface ServiceDefinition {
    name: string;
    host: string;
    port: number;
    home_path: string;
    command: string;
}
export declare function LoadServiceRegistry(servicesJsonPath: string): Promise<ServiceDefinition[]>;
export declare function FindServiceByName(services: ServiceDefinition[], serviceName: string): ServiceDefinition | undefined;
//# sourceMappingURL=service_registry.d.ts.map