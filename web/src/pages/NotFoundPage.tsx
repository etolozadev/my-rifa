export function NotFoundPage({ title = 'No encontramos esta rifa', text = 'Revisa que el enlace que te compartieron esté completo.' }: { title?: string; text?: string }) {
  return (
    <main className="center">
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </main>
  );
}
