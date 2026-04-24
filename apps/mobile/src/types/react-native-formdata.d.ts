interface ReactNativeFileObject {
  uri: string;
  name: string;
  type: string;
}

declare global {
  interface FormData {
    append(name: string, value: ReactNativeFileObject, fileName?: string): void;
  }
}

export {};
