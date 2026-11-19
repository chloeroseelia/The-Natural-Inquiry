const INSPECTION_LIMIT = 16000;

export function formatExcludedRecord(record) {
  try {
    const seen = new WeakSet();
    const text = JSON.stringify(record, (_key, value) => {
      if (typeof value === "bigint") return `${value}n`;
      if (typeof value === "undefined") return "[undefined]";
      if (typeof value === "function") return `[Function${value.name ? `: ${value.name}` : ""}]`;
      if (typeof value === "symbol") return String(value);
      if (value && typeof value === "object") {
        if (typeof Blob !== "undefined" && value instanceof Blob) {
          return { type: "Blob", mimeType: value.type, size: value.size };
        }
        if (ArrayBuffer.isView(value)) {
          return { type: value.constructor.name, length: value.byteLength };
        }
        if (value instanceof ArrayBuffer) return { type: "ArrayBuffer", length: value.byteLength };
        if (seen.has(value)) return "[Circular or repeated reference]";
        seen.add(value);
      }
      return value;
    }, 2);
    const output = text ?? String(record);
    return output.length > INSPECTION_LIMIT
      ? `${output.slice(0, INSPECTION_LIMIT)}\n… truncated for display (${output.length.toLocaleString()} characters total)`
      : output;
  } catch (error) {
    return `Unable to format this record for display: ${error?.message || String(error)}`;
  }
}
