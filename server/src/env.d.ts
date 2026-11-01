declare module '*.sql' {
  const text: string
  export default text
}

// bundled with `with { type: 'file' }`: the path to read it from (inside the compiled binary too)
declare module '*.wasm' {
  const path: string
  export default path
}
