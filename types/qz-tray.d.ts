// Minimal types for the parts of QZ Tray 2.x this app uses.
declare module "qz-tray" {
  type Resolver<T> = (resolve: (value: T) => void, reject: (reason?: unknown) => void) => void;
  type PrinterRef = string | { host: string; port: number };
  type PrintConfig = { readonly printer: PrinterRef };
  type RawData = { type: "raw"; format: "command" | "image"; flavor: "base64" | "plain" | "file"; data: string; options?: Record<string, unknown> };
  const qz: {
    websocket: { isActive(): boolean; connect(options?: { retries?: number; delay?: number }): Promise<void>; disconnect(): Promise<void> };
    security: {
      setCertificatePromise(promise: Resolver<string>): void;
      setSignatureAlgorithm(algorithm: "SHA1" | "SHA256" | "SHA512"): void;
      setSignaturePromise(factory: (toSign: string) => Resolver<string>): void;
    };
    printers: { find(query?: string): Promise<string | string[]>; getDefault(): Promise<string> };
    configs: { create(printer: PrinterRef, options?: Record<string, unknown>): PrintConfig };
    print(config: PrintConfig, data: RawData[]): Promise<void>;
  };
  export default qz;
}
