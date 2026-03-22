export class DIContainer {
  private static factories: Map<string, () => any> = new Map();
  private static instances: Map<string, any> = new Map();

  static register<T>(key: string, ClassRef: new (...args: any[]) => T) {
    this.factories.set(key, () => new ClassRef());
  }

  static registerFactory<T>(key: string, factory: () => T) {
    this.factories.set(key, factory);
  }

  static resolve<T>(key: string): T {
    if (!this.instances.has(key)) {
      const factory = this.factories.get(key);
      if (!factory) throw new Error(`Dependency not registered: ${key}`);
      this.instances.set(key, factory());
    }
    return this.instances.get(key) as T;
  }
}
