export function ConfigError({ message }: { message: string }) {
  return (
    <div className="config-error" role="alert">
      <h1>⚠️ Dashboard misconfigured</h1>
      <p>The page loaded, but the server did not hand it usable configuration.</p>
      <pre>{message}</pre>
    </div>
  )
}
