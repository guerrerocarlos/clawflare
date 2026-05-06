export interface PluginRef {
  source: "clawhub";
  name: string;
  version?: string;
}

export function resolvePluginRef(ref: string): PluginRef {
  const withoutPrefix = ref.startsWith("clawhub:") ? ref.slice("clawhub:".length) : ref;
  const at = withoutPrefix.lastIndexOf("@");

  if (withoutPrefix.length === 0) {
    throw new Error("Plugin ref is empty.");
  }

  if (at > 0 && at < withoutPrefix.length - 1) {
    return {
      source: "clawhub",
      name: withoutPrefix.slice(0, at),
      version: withoutPrefix.slice(at + 1),
    };
  }

  return {
    source: "clawhub",
    name: withoutPrefix,
  };
}
