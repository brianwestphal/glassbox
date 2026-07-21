/**
 * esbuild's `binary` loader turns a `.wasm` import into a `Uint8Array` of the
 * file's bytes, inlined into the bundle — so the compiled plugin is
 * self-contained (no separate `.wasm` file to locate at runtime, the property
 * that lets it load against the frozen desktop sidecar). Declared here so the
 * plugin's own `tsc` typechecks the import.
 */
declare module '*.wasm' {
  const bytes: Uint8Array;
  export default bytes;
}
